import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";

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
    // FIX: lets the browser read the token header on sign-in/sign-up
    res.setHeader("Access-Control-Expose-Headers", "set-auth-token");
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