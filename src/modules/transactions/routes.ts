import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  reconcileTransactionsSchema,
  transactionIdParamSchema,
} from "./schemas.js";
import {
  getTransactionFor,
  reconcileTransactionsForMerchant,
} from "./service.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

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
