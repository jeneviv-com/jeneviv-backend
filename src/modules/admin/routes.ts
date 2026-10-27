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
  listAuditLogsQuerySchema,
  listMerchantsQuerySchema,
  listPlatformTransactionsQuerySchema,
  merchantIdParamSchema,
  rejectMerchantSchema,
  suspendMerchantSchema,
  type ListAuditLogsQuery,
  type ListPlatformTransactionsQuery,
} from "./schemas.js";
import {
  approveMerchant,
  getAdminStats,
  listAuditLogs,
  listMerchants,
  listPlatformTransactions,
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

adminRouter.get("/stats", async (_req, res, next) => {
  try {
    res.json(await getAdminStats());
  } catch (err) {
    next(err);
  }
});

adminRouter.get(
  "/transactions",
  validate(listPlatformTransactionsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const transactions = await listPlatformTransactions(
        req.query as unknown as ListPlatformTransactionsQuery,
      );
      res.json({ transactions });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  "/audit-logs",
  validate(listAuditLogsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const logs = await listAuditLogs(
        req.query as unknown as ListAuditLogsQuery,
      );
      res.json({ logs });
    } catch (err) {
      next(err);
    }
  },
);

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
