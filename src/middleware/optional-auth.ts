import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";

/**
 * Attaches the signed-in user when there is one, and carries on as a guest when
 * there isn't. Used by routes that payers reach without an account.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session) {
      const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
      if (user?.active) {
        req.user = user;
        req.sessionId = session.session.id;
      }
    }
  } catch {
    // A broken or missing session is treated as a guest, never as an error.
  }
  next();
}
