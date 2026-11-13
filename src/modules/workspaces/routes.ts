import { Router, type Request } from "express";
import type { WorkspaceRole } from "../../db/schema/enums.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import { HttpError } from "../../middleware/error.js";
import {
  acceptInviteSchema,
  createInviteSchema,
  inviteIdParamSchema,
  memberIdParamSchema,
  updateMemberSchema,
} from "./schemas.js";
import {
  acceptInvite,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "./invites.js";
import { listWorkspacesForUser, roleAtLeast } from "./service.js";

export const workspacesRouter = Router();

function assertRole(req: Request, minimum: WorkspaceRole): void {
  const role = req.workspaceRole;
  if (!role || !roleAtLeast(role, minimum)) {
    throw new HttpError(
      403,
      "insufficient_role",
      `This action needs ${minimum} access to the workspace`,
    );
  }
}

/** The workspaces this user can open, for the account switcher. */
workspacesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const rows = await listWorkspacesForUser(req.user!.id);
    res.json({
      workspaces: rows.map((row) => ({
        id: row.workspace.id,
        name: row.workspace.displayName,
        status: row.workspace.status,
        logo_url: row.workspace.logoUrl,
        role: row.role,
        is_owner: row.role === "owner" || row.workspace.userId === req.user!.id,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Accepting an invite must work before the user belongs to any workspace, so
 * this route sits above the workspace requirement below.
 */
workspacesRouter.post(
  "/invites/accept",
  requireAuth,
  validate(acceptInviteSchema),
  async (req, res, next) => {
    try {
      const { token } = req.body as { token: string };
      const result = await acceptInvite(
        { id: req.user!.id, email: req.user!.email },
        token,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.use(requireAuth, requireMerchant);

workspacesRouter.get("/members", async (req, res, next) => {
  try {
    const members = await listMembers(req.merchant!.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.get("/invites", async (req, res, next) => {
  try {
    assertRole(req, "admin");
    const invites = await listInvites(req.merchant!.id);
    res.json({ invites });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post(
  "/invites",
  validate(createInviteSchema),
  async (req, res, next) => {
    try {
      assertRole(req, "admin");
      const result = await createInvite(
        req.merchant!.id,
        req.user!.id,
        req.body,
        req.header("origin") ?? undefined,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.post(
  "/invites/:id/revoke",
  validate(inviteIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      assertRole(req, "admin");
      const { id } = req.params as { id: string };
      await revokeInvite(req.merchant!.id, id, req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.patch(
  "/members/:id",
  validate(memberIdParamSchema, "params"),
  validate(updateMemberSchema),
  async (req, res, next) => {
    try {
      assertRole(req, "owner");
      const { id } = req.params as { id: string };
      const member = await updateMemberRole(
        req.merchant!.id,
        id,
        req.user!.id,
        req.body,
      );
      res.json({ member });
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.delete(
  "/members/:id",
  validate(memberIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      assertRole(req, "admin");
      const { id } = req.params as { id: string };
      await removeMember(req.merchant!.id, id, req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
