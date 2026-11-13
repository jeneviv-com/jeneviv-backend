import type { NextFunction, Request, Response } from "express";
import type { WorkspaceRole } from "../db/schema/enums.js";
import { HttpError } from "./error.js";
import { activeWorkspace, requireWorkspaceRole } from "../modules/workspaces/service.js";

/** The workspace the client asked for, if it asked for one. */
export function requestedWorkspaceId(req: Request): string | null {
  const header = req.header("x-workspace-id");
  if (header) return header;
  const query = req.query.workspace_id;
  return typeof query === "string" && query.length > 0 ? query : null;
}

/**
 * Resolves `req.merchant` to the workspace this request operates on and records
 * the caller's role on it.
 *
 * A request may name a workspace with `X-Workspace-Id`; without one we fall back
 * to the user's first membership, which keeps single-workspace accounts working
 * exactly as before.
 */
export async function requireMerchant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, "unauthenticated", "Authentication required");
    }

    const context = await activeWorkspace(req.user.id, requestedWorkspaceId(req));

    if (context.workspace.status !== "approved") {
      throw new HttpError(
        403,
        "merchant_not_approved",
        `Merchant account is ${context.workspace.status}`,
      );
    }

    req.merchant = context.workspace;
    req.workspaceRole = context.role;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Gate a route on a minimum role. Use after `requireMerchant`:
 *
 *   requireMerchant, requireRole("admin")
 */
export function requireRole(minimum: WorkspaceRole) {
  return async function (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new HttpError(401, "unauthenticated", "Authentication required");
      }
      const context = await requireWorkspaceRole(
        req.user.id,
        requestedWorkspaceId(req),
        minimum,
      );
      req.merchant = context.workspace;
      req.workspaceRole = context.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
