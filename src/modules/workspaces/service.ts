import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { workspaceMembers } from "../../db/schema/members.js";
import { merchants } from "../../db/schema/merchants.js";
import type { Merchant } from "../../db/schema/merchants.js";
import type { WorkspaceRole } from "../../db/schema/enums.js";
import { HttpError } from "../../middleware/error.js";

/**
 * Workspace access rules, in one place.
 *
 * Everything that touches money resolves the workspace through `activeWorkspace`
 * so the check is identical on every route. Callers never pass a workspace id
 * they were given by the browser without it being matched against a membership
 * row first: a valid id belonging to someone else must look exactly like an id
 * that does not exist.
 */

export interface WorkspaceContext {
  workspace: Merchant;
  role: WorkspaceRole;
  /** True when the user owns the account rather than being an invited member. */
  isOwner: boolean;
}

/**
 * How privileged a role is. A higher rank includes everything below it, so
 * `atLeast("admin")` is true for owners without listing them everywhere.
 */
const RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  collector: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Every workspace this user can open, oldest membership first. */
export async function listWorkspacesForUser(userId: string) {
  return db
    .select({
      workspace: merchants,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(merchants, eq(merchants.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .orderBy(asc(workspaceMembers.createdAt));
}

/**
 * Resolve the workspace a request is operating on.
 *
 * `requestedId` comes from the client (header or query). It is only ever used as
 * a filter over the user's own memberships, never as a direct lookup, so passing
 * a stranger's workspace id yields "not found" rather than a peek at their data.
 */
export async function activeWorkspace(
  userId: string,
  requestedId?: string | null,
): Promise<WorkspaceContext> {
  const memberships = await listWorkspacesForUser(userId);

  if (requestedId) {
    const match = memberships.find((entry) => entry.workspace.id === requestedId);
    if (!match) {
      throw new HttpError(404, "workspace_not_found", "Workspace not found");
    }
    return {
      workspace: match.workspace,
      role: match.role,
      isOwner: match.role === "owner" || match.workspace.userId === userId,
    };
  }

  const first = memberships[0];
  if (first) {
    return {
      workspace: first.workspace,
      role: first.role,
      isOwner: first.role === "owner" || first.workspace.userId === userId,
    };
  }

  // Accounts created before memberships existed still resolve through the
  // account they applied with, so this migration cannot lock anyone out.
  const owned = await db.query.merchants.findFirst({
    where: eq(merchants.userId, userId),
  });
  if (!owned) {
    throw new HttpError(
      403,
      "merchant_required",
      "No workspace found for this user",
    );
  }
  return { workspace: owned, role: "owner", isOwner: true };
}

export async function requireWorkspaceRole(
  userId: string,
  requestedId: string | null | undefined,
  minimum: WorkspaceRole,
): Promise<WorkspaceContext> {
  const context = await activeWorkspace(userId, requestedId);
  if (!roleAtLeast(context.role, minimum)) {
    throw new HttpError(
      403,
      "insufficient_role",
      `This action needs ${minimum} access to the workspace`,
    );
  }
  return context;
}
