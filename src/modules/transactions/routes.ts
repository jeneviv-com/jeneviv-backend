import { Router } from "express";
import type { TransactionStatus } from "../../db/schema/enums.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  reconcileTransactionsSchema,
  transactionIdParamSchema,
} from "./schemas.js";
import {
  getTransactionFor,
  listTransactionsForMerchant,
  reconcileTransactionsForMerchant,
} from "./service.js";

export const transactionsRouter = Router();

function presentTransaction(transaction: Record<string, unknown>) {
  const {
    payer_name,
    payer_email,
    collection_name,
    field_values,
    ...transactionFields
  } = transaction;
  return {
    ...transactionFields,
    payer_name: payer_name ?? null,
    payer_email: payer_email ?? null,
    collection_name: collection_name ?? null,
    field_values: field_values ?? {},
  };
}

transactionsRouter.use(requireAuth);

// Merchant-wide list, e.g. GET /api/transactions?status=success&limit=50
transactionsRouter.get("/", requireMerchant, async (req, res, next) => {
  try {
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as TransactionStatus)
        : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const data = await listTransactionsForMerchant(req.merchant!, {
      status,
      limit,
      offset,
    });
    res.json({
      transactions: data.transactions.map((transaction) =>
        presentTransaction(transaction as unknown as Record<string, unknown>),
      ),
    });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.patch(
  "/reconcile",
  requireMerchant,
  validate(reconcileTransactionsSchema),
  async (req, res, next) => {
    try {
      const { ids, reconciled } = req.body as {
        ids: string[];
        reconciled: boolean;
      };
      const data = await reconcileTransactionsForMerchant(
        req.merchant!,
        ids,
        reconciled,
      );
      res.json({ updated: data.transactions.length });
    } catch (err) {
      next(err);
    }
  },
);

transactionsRouter.get(
  "/:id",
  validate(transactionIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const data = await getTransactionFor(req.user!, id);
      res.json({
        ...data,
        transaction: presentTransaction(
          data.transaction as unknown as Record<string, unknown>,
        ),
        fields: data.fields.map((field) => ({
          ...field,
          field_id: field.fieldId,
          display_name: field.displayName,
        })),
        payment_account: data.payment_account,
      });
    } catch (err) {
      next(err);
    }
  },
);
