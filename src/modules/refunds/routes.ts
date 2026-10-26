import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import {
  listRefundsQuerySchema,
  refundIdParamSchema,
  retryRefundSchema,
} from "./schemas.js";
import type { Refund } from "../../db/schema/payouts.js";
import { listRefunds, retryRefundWithBankDetails } from "./service.js";

/** The dashboard speaks snake_case for refunds (matching the demo client). */
function toApiRefund(refund: Refund) {
  return {
    id: refund.id,
    transaction_id: refund.transactionId,
    merchant_id: refund.merchantId,
    amount: refund.amount,
    reason: refund.reason,
    status: refund.status,
    gateway_ref: refund.gatewayRef,
    gateway_refund_id: refund.gatewayRefundId,
    failure_reason: refund.failureReason,
    created_at: refund.createdAt.toISOString(),
    updated_at: refund.updatedAt.toISOString(),
  };
}

export const refundsRouter = Router();

refundsRouter.use(requireAuth);

refundsRouter.get(
  "/",
  validate(listRefundsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { limit } = req.query as unknown as { limit?: number };
      const rows = await listRefunds({ actor: req.user!, limit });
      res.json({ refunds: rows.map(toApiRefund) });
    } catch (err) {
      next(err);
    }
  },
);

refundsRouter.post(
  "/:id/retry",
  validate(refundIdParamSchema, "params"),
  validate(retryRefundSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const { account_number, bank_code } = req.body as {
        account_number: string;
        bank_code: string;
      };
      const refund = await retryRefundWithBankDetails({
        actor: req.user!,
        refundId: id,
        accountNumber: account_number,
        bankCode: bank_code,
      });
      res.json({ refund: toApiRefund(refund) });
    } catch (err) {
      next(err);
    }
  },
);
