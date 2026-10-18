import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";

/**
 * The dashboard is served from a different origin in development
 * (Vite on :5173, landing on :3000) than the API, and it sends the
 * better-auth session cookie with `credentials: "include"`. Browsers
 * require an explicit allow-origin + allow-credentials pair for that.
 *
 * Credentials echo the caller's origin back (never "*"), so only
 * origins listed in ALLOWED_ORIGINS are accepted.
 */
const allowedOrigins = new Set(
  env.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
);

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin?.replace(/\/$/, "");

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ??
          "Content-Type, Authorization",
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    res.status(204).end();
    return;
  }

  next();
}
