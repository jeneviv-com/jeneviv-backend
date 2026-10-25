import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  createWithdrawalSchema,
  listWithdrawalsQuerySchema,
  withdrawalIdParamSchema,
  type ListWithdrawalsQuery,
} from "./schemas.js";
import {
  createWithdrawal,
  getWithdrawal,
  listWithdrawals,
} from "./service.js";

export const withdrawalsRouter = Router();

withdrawalsRouter.use(requireAuth, requireMerchant);

withdrawalsRouter.post(
  "/",
  validate(createWithdrawalSchema),
  async (req, res, next) => {
    try {
      const result = await createWithdrawal(
        req.merchant!,
        req.user!,
        req.body,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

withdrawalsRouter.get(
  "/",
  validate(listWithdrawalsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as ListWithdrawalsQuery;
      const rows = await listWithdrawals(req.merchant!, query.limit);
      res.json({ withdrawals: rows });
    } catch (err) {
      next(err);
    }
  },
);

withdrawalsRouter.get(
  "/:id",
  validate(withdrawalIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const withdrawal = await getWithdrawal(req.merchant!, id);
      res.json({ withdrawal });
    } catch (err) {
      next(err);
    }
  },
);
