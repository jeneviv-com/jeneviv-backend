import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { HttpError } from "./error.js";

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      throw new HttpError(401, "unauthenticated", "Authentication required");
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      throw new HttpError(401, "unauthenticated", "User not found");
    }

    if (!user.active) {
      throw new HttpError(403, "inactive_account", "Account is inactive");
    }

    req.user = user;
    req.sessionId = session.session.id;
    next();
  } catch (err) {
    next(err);
  }
}
