import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import {
  refundTransactionSchema,
  transactionIdParamSchema as refundTxIdParamSchema,
} from "../refunds/schemas.js";
import { refundTransaction } from "../refunds/service.js";
import {
  approveMerchantSchema,
  listMerchantsQuerySchema,
  merchantIdParamSchema,
  rejectMerchantSchema,
  suspendMerchantSchema,
} from "./schemas.js";
import {
  approveMerchant,
  listMerchants,
  rejectMerchant,
  suspendMerchant,
} from "./service.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);

// Refund endpoint allows admin OR owning merchant per spec, so it runs
// before requireAdmin and does its own authorization inside the service.
adminRouter.post(
  "/transactions/:id/refund",
  validate(refundTxIdParamSchema, "params"),
  validate(refundTransactionSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const refund = await refundTransaction({
        actor: req.user!,
        transactionId: id,
        reason: (req.body as { reason: string }).reason,
      });
      res.status(201).json({ refund });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.use(requireAdmin);

adminRouter.get(
  "/merchants",
  validate(listMerchantsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const rows = await listMerchants(
        req.query as unknown as import("./schemas.js").ListMerchantsQuery,
      );
      res.json({ merchants: rows });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  "/merchants/:id/approve",
  validate(merchantIdParamSchema, "params"),
  validate(approveMerchantSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const merchant = await approveMerchant(
        req.user!.id,
        id,
        (req.body as { note?: string }).note,
      );
      res.json({ merchant });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  "/merchants/:id/reject",
  validate(merchantIdParamSchema, "params"),
  validate(rejectMerchantSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const merchant = await rejectMerchant(
        req.user!.id,
        id,
        (req.body as { note: string }).note,
      );
      res.json({ merchant });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  "/merchants/:id/suspend",
  validate(merchantIdParamSchema, "params"),
  validate(suspendMerchantSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const merchant = await suspendMerchant(
        req.user!.id,
        id,
        (req.body as { note: string }).note,
      );
      res.json({ merchant });
    } catch (err) {
      next(err);
    }
  },
);
