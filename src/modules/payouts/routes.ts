import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  createPayoutSchema,
  listPayoutsQuerySchema,
  payoutIdParamSchema,
  type ListPayoutsQuery,
} from "./schemas.js";
import {
  getMerchantPayout,
  initiatePayout,
  listMerchantPayouts,
} from "./service.js";

export const payoutsRouter = Router();

payoutsRouter.use(requireAuth, requireMerchant);

payoutsRouter.post(
  "/",
  validate(createPayoutSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const payout = await initiatePayout({
        merchant,
        bankAccountId: req.body.bank_account_id,
        amount: req.body.amount,
        currency: req.body.currency,
        initiatedBy: "merchant",
        initiatedByUid: req.user!.id,
      });
      res.status(201).json({ payout });
    } catch (err) {
      next(err);
    }
  },
);

payoutsRouter.get(
  "/",
  validate(listPayoutsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as ListPayoutsQuery;
      const rows = await listMerchantPayouts(req.merchant!.id, query);
      res.json({ payouts: rows });
    } catch (err) {
      next(err);
    }
  },
);

payoutsRouter.get(
  "/:id",
  validate(payoutIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const payout = await getMerchantPayout(req.merchant!.id, id);
      res.json({ payout });
    } catch (err) {
      next(err);
    }
  },
);
