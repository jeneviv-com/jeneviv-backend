import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import { workspaceInvites, workspaceMembers } from "../../db/schema/members.js";
import { merchants } from "../../db/schema/merchants.js";
import { auditLogs } from "../../db/schema/platform.js";
import type { WorkspaceRole } from "../../db/schema/enums.js";
import { env } from "../../env.js";
import { sendEmail } from "../../lib/email.js";
import { HttpError } from "../../middleware/error.js";
import { newId } from "../../lib/short-code.js";
import type { CreateInviteInput, UpdateMemberInput } from "./schemas.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Only the hash is stored, so a leaked row cannot be replayed into access. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Pick the origin the invite link should point at.
 *
 * A request's Origin is only honoured when it is already whitelisted for CORS,
 * so a dev server on a different port gets a working link without turning this
 * into an open redirect.
 */
function inviteOrigin(requestOrigin: string | undefined): string {
  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const origin = requestOrigin?.trim().replace(/\/+$/, "");
  if (origin && allowed.includes(origin)) return origin;
  return env.APP_PUBLIC_URL.replace(/\/+$/, "");
}

function inviteLink(token: string, requestOrigin?: string): string {
  return `${inviteOrigin(requestOrigin)}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function audit(args: {
  actorUid: string;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId(),
    actorUid: args.actorUid,
    action: args.action,
    entityType: "workspace",
    entityId: args.entityId,
    metadata: args.metadata ?? null,
  });
}

/* ------------------------------------------------------------------ invites */

export async function createInvite(
  workspaceId: string,
  actorUid: string,
  input: CreateInviteInput,
  requestOrigin?: string,
) {
  // Already in the workspace? Say so instead of sending a dead link.
  const existingMember = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        eq(sql`lower(${users.email})`, input.email),
      ),
    )
    .limit(1);

  if (existingMember.length > 0) {
    throw new HttpError(
      409,
      "already_a_member",
      "That email already has access to this workspace",
    );
  }

  // Supersede any pending invite for the same address: one live link at a time.
  await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        eq(workspaceInvites.email, input.email),
        sql`${workspaceInvites.acceptedAt} is null`,
        sql`${workspaceInvites.revokedAt} is null`,
      ),
    );

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const id = newId();

  const [invite] = await db
    .insert(workspaceInvites)
    .values({
      id,
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedByUserId: actorUid,
      expiresAt,
    })
    .returning();

  const workspace = await db.query.merchants.findFirst({
    where: eq(merchants.id, workspaceId),
  });
  const link = inviteLink(token, requestOrigin);

  let emailed = false;
  try {
    await sendEmail({
      to: input.email,
      subject: `You've been invited to ${workspace?.displayName ?? "a Jeneviv workspace"}`,
      html: inviteHtml({
        workspaceName: workspace?.displayName ?? "a Jeneviv workspace",
        role: input.role,
        link,
        expiresAt,
      }),
    });
    emailed = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
  } catch (err) {
    // A mail outage must not lose the invite: the owner can still copy the link.
    console.warn("[invites] email failed:", err instanceof Error ? err.message : err);
  }

  await audit({
    actorUid,
    action: "workspace.invite_created",
    entityId: workspaceId,
    metadata: { email: input.email, role: input.role },
  });

  return {
    invite: invite ? publicInvite(invite) : null,
    // Returned so the owner can share it when email is not configured.
    invite_url: link,
    emailed,
  };
}

export async function listInvites(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.workspaceId, workspaceId))
    .orderBy(desc(workspaceInvites.createdAt));

  const now = Date.now();
  return rows
    .filter((row) => !row.revokedAt)
    .map((row) => ({
      ...publicInvite(row),
      status: row.acceptedAt
        ? ("accepted" as const)
        : row.expiresAt.getTime() < now
          ? ("expired" as const)
          : ("pending" as const),
    }));
}

export async function revokeInvite(
  workspaceId: string,
  inviteId: string,
  actorUid: string,
): Promise<void> {
  const [updated] = await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        sql`${workspaceInvites.acceptedAt} is null`,
        sql`${workspaceInvites.revokedAt} is null`,
      ),
    )
    .returning({ id: workspaceInvites.id });

  if (!updated) {
    throw new HttpError(404, "invite_not_found", "That invite is no longer pending");
  }

  await audit({
    actorUid,
    action: "workspace.invite_revoked",
    entityId: workspaceId,
    metadata: { inviteId },
  });
}

/* ------------------------------------------------------------------ accept */

export async function acceptInvite(
  user: { id: string; email: string },
  token: string,
) {
  const invite = await db.query.workspaceInvites.findFirst({
    where: eq(workspaceInvites.tokenHash, hashToken(token)),
  });

  if (!invite) {
    throw new HttpError(404, "invite_not_found", "This invite link is not valid");
  }
  if (invite.revokedAt) {
    throw new HttpError(
      410,
      "invite_revoked",
      "This invite was withdrawn. Ask for a new one.",
    );
  }
  if (invite.acceptedAt) {
    throw new HttpError(409, "invite_used", "This invite has already been used");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new HttpError(410, "invite_expired", "This invite has expired");
  }
  // The link is bound to the invited address, so forwarding it grants nothing.
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new HttpError(
      403,
      "invite_email_mismatch",
      `This invite was sent to ${invite.email}. Sign in as that account to accept it.`,
    );
  }

  const workspace = await db.query.merchants.findFirst({
    where: eq(merchants.id, invite.workspaceId),
  });
  if (!workspace) {
    throw new HttpError(404, "workspace_not_found", "That workspace no longer exists");
  }

  await db.transaction(async (tx) => {
    const existing = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, invite.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    });

    if (existing) {
      await tx
        .update(workspaceMembers)
        .set({
          status: "active",
          role: invite.role,
          updatedAt: new Date(),
        })
        .where(eq(workspaceMembers.id, existing.id));
    } else {
      await tx.insert(workspaceMembers).values({
        id: newId(),
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        status: "active",
        invitedByUserId: invite.invitedByUserId,
      });
    }

    await tx
      .update(workspaceInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
      .where(eq(workspaceInvites.id, invite.id));
  });

  await audit({
    actorUid: user.id,
    action: "workspace.invite_accepted",
    entityId: invite.workspaceId,
    metadata: { email: invite.email, role: invite.role },
  });

  return {
    workspace: {
      id: workspace.id,
      name: workspace.displayName,
      role: invite.role,
    },
  };
}

/* ----------------------------------------------------------------- members */

export async function listMembers(workspaceId: string) {
  return db
    .select({
      id: workspaceMembers.id,
      user_id: workspaceMembers.userId,
      role: workspaceMembers.role,
      status: workspaceMembers.status,
      joined_at: workspaceMembers.createdAt,
      last_active_at: workspaceMembers.lastActiveAt,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .orderBy(desc(workspaceMembers.createdAt));
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  actorUid: string,
  input: UpdateMemberInput,
) {
  const member = await findMember(workspaceId, memberId);
  if (member.role === "owner") {
    throw new HttpError(
      403,
      "cannot_change_owner",
      "The workspace owner's role cannot be changed",
    );
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ role: input.role, updatedAt: new Date() })
    .where(eq(workspaceMembers.id, memberId))
    .returning();

  await audit({
    actorUid,
    action: "workspace.member_role_changed",
    entityId: workspaceId,
    metadata: { memberId, userId: member.userId, role: input.role },
  });

  return updated;
}

export async function removeMember(
  workspaceId: string,
  memberId: string,
  actorUid: string,
): Promise<void> {
  const member = await findMember(workspaceId, memberId);
  if (member.role === "owner") {
    throw new HttpError(
      403,
      "cannot_remove_owner",
      "The workspace owner cannot be removed",
    );
  }

  await db
    .update(workspaceMembers)
    .set({ status: "removed", updatedAt: new Date() })
    .where(eq(workspaceMembers.id, memberId));

  await audit({
    actorUid,
    action: "workspace.member_removed",
    entityId: workspaceId,
    metadata: { memberId, userId: member.userId },
  });
}

async function findMember(workspaceId: string, memberId: string) {
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.id, memberId),
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.status, "active"),
    ),
  });
  if (!member) {
    throw new HttpError(404, "member_not_found", "That person is not in this workspace");
  }
  return member;
}

/* ------------------------------------------------------------------ output */

function publicInvite(invite: {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expires_at: invite.expiresAt,
    created_at: invite.createdAt,
  };
}

function inviteHtml(args: {
  workspaceName: string;
  role: string;
  link: string;
  expiresAt: Date;
}): string {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#151515;line-height:1.5">
    <h2 style="margin:0 0 8px">Join ${args.workspaceName} on Jeneviv</h2>
    <p style="margin:0 0 16px">You've been invited as <strong>${args.role}</strong>.
    Open the link below to accept.</p>
    <p style="margin:0 0 16px">
      <a href="${args.link}" style="background:#f26b1d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">
        Accept invite
      </a>
    </p>
    <p style="margin:0;font-size:13px;color:#666">This link expires on
      ${args.expiresAt.toDateString()} and only works for this email address.</p>
  </div>`;
}
