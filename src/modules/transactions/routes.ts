import { Router } from "express";
import type { Transaction } from "../../db/schema/transactions.js";
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

transactionsRouter.use(requireAuth);

// Merchant-wide list, e.g. GET /api/transactions?status=success&limit=50
transactionsRouter.get("/", requireMerchant, async (req, res, next) => {
  try {
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as Transaction["status"])
        : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const data = await listTransactionsForMerchant(req.merchant!, {
      status,
      limit,
      offset,
    });
    res.json(data);
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
      res.json(data);
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
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);
