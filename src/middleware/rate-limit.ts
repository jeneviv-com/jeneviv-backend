import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// express-rate-limit uses its process-local MemoryStore by default. Use a shared
// Redis store before running more than one Render instance, or limits will be
// applied independently per instance.
function createLimiter(options: {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
}) {
  return rateLimit({
    ...options,
    // Custom keys complement IP limiting; disable express-rate-limit's IP
    // validation only when a route deliberately supplies its own key.
    ...(options.keyGenerator ? { validate: { keyGeneratorIpFallback: false } } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many requests. Please try again later.",
        },
      });
    },
  });
}

export const rateLimiter = {
  // IP-based login/sign-up guard.
  authLimiter: createLimiter({ windowMs: FIFTEEN_MINUTES_MS, max: 10 }),
  // Per merchant, to avoid charging multiple merchants for a shared IP.
  kycLimiter: createLimiter({
    windowMs: ONE_HOUR_MS,
    max: 5,
    keyGenerator: (req) => `merchant:${req.user?.id ?? req.ip}`,
  }),
  paymentLimiter: createLimiter({ windowMs: FIFTEEN_MINUTES_MS, max: 10 }),
  // Per secret URL token. Existing OTP lockout in the service remains as a
  // durable second layer for wrong codes.
  approvalLimiter: createLimiter({
    windowMs: ONE_HOUR_MS,
    max: 5,
    keyGenerator: (req) => `approval:${String(req.params.token ?? req.ip)}`,
  }),
};