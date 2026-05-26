import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import { transactionIdParamSchema } from "./schemas.js";
import { getTransactionFor } from "./service.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

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
