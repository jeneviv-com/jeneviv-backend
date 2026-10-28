import { Router } from "express";
import { rateLimiter } from "../../middleware/rate-limit.js";
import { optionalAuth } from "../../middleware/optional-auth.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import { initPaymentSchema } from "./schemas.js";
import { getPublicPaymentStatus, initPayment } from "./service.js";

export const paymentsRouter = Router();

// Public: a payer checks their own payment by reference while they wait.
// Returns status only, never payer details.
paymentsRouter.get("/status/:reference", async (req, res, next) => {
  try {
    res.json(await getPublicPaymentStatus(req.params.reference));
  } catch (err) {
    next(err);
  }
});

// Public: payers do not need an account. A signed-in user is still recognised.
paymentsRouter.post(
  "/init",
  rateLimiter.paymentLimiter,
  optionalAuth,
  validate(initPaymentSchema),
  async (req, res, next) => {
    try {
      const result = await initPayment(req.user ?? null, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

paymentsRouter.use(requireAuth);