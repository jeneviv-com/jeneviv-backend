import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./error.js";

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(new HttpError(401, "unauthenticated", "Authentication required"));
    return;
  }
  if (req.user.role !== "admin") {
    next(new HttpError(403, "forbidden", "Admin access required"));
    return;
  }
  next();
}
