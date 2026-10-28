import { Router } from "express";
import { rateLimiter } from "../../middleware/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import { initPaymentSchema } from "./schemas.js";
import { initPayment } from "./service.js";

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/init",
  rateLimiter.paymentLimiter,
  validate(initPaymentSchema),
  async (req, res, next) => {
    try {
      const result = await initPayment(req.user!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);
