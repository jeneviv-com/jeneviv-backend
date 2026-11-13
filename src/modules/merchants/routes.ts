import { Router } from "express";
import { HttpError } from "../../middleware/error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  applyMerchantSchema,
  bankAccountIdParamSchema,
  createBankAccountSchema,
  setTreasurerSchema,
  submitNinSchema,
  updateMerchantSettingsSchema,
  verifyBankSchema,
} from "./schemas.js";
import {
  applyAsMerchant,
  createMerchantBankAccount,
  deleteMerchantBankAccount,
  getMerchantForUser,
  getMerchantSettlementStatus,
  listMerchantBankAccounts,
  updateMerchantSettings,
} from "./service.js";
import {
  setTreasurer,
  toKycView,
  verifyKycBank,
  verifyNin,
} from "../kyc/service.js";

export const merchantsRouter = Router();

merchantsRouter.use(requireAuth);

merchantsRouter.post(
  "/apply",
  validate(applyMerchantSchema),
  async (req, res, next) => {
    try {
      const merchant = await applyAsMerchant(req.user!.id, req.body);
      res.status(201).json({ merchant });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.get("/me", async (req, res, next) => {
  try {
    const merchant = await getMerchantForUser(req.user!.id);
    res.json({ merchant });
  } catch (err) {
    next(err);
  }
});

merchantsRouter.patch(
  "/me/settings",
  // Admins can rename the workspace; only the owner decides where money lands.
  requireRole("admin"),
  validate(updateMerchantSettingsSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const updated = await updateMerchantSettings(merchant, req.body);
      res.json({ merchant: updated });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.get("/me/kyc", async (req, res, next) => {
  try {
    const merchant = await getMerchantForUser(req.user!.id);
    res.json({ kyc: toKycView(merchant) });
  } catch (err) {
    next(err);
  }
});

merchantsRouter.post(
  "/me/kyc/nin",
  requireRole("owner"),
  validate(submitNinSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const kyc = await verifyNin(merchant, req.body.nin);
      res.json({ kyc });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.post(
  "/me/kyc/bank",
  requireRole("owner"),
  validate(verifyBankSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const kyc = await verifyKycBank(merchant, req.body);
      res.json({ kyc });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.patch(
  "/me/treasurer",
  requireRole("owner"),
  validate(setTreasurerSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const kyc = await setTreasurer(merchant, req.body);
      res.json({ kyc });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.get("/me/bank-accounts", async (req, res, next) => {
  try {
    const merchant = await getMerchantForUser(req.user!.id);
    const accounts = await listMerchantBankAccounts(merchant.id);
    res.json({ bank_accounts: accounts });
  } catch (err) {
    next(err);
  }
});

merchantsRouter.post(
  "/me/bank-accounts",
  // Settlement destinations are owner-only: an admin cannot redirect payouts.
  requireRole("owner"),
  validate(createBankAccountSchema),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const account = await createMerchantBankAccount(merchant, req.body);
      res.status(201).json({ bank_account: account });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.delete(
  "/me/bank-accounts/:id",
  requireRole("owner"),
  validate(bankAccountIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const merchant = req.merchant!;
      const { id } = req.params as { id: string };
      if (!id) throw new HttpError(400, "bad_request", "id is required");
      await deleteMerchantBankAccount(merchant, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.get("/me/settlement-status", async (req, res, next) => {
  try {
    const merchant = await getMerchantForUser(req.user!.id);
    const gateway = req.query.gateway as string | undefined;
    
    // Get settlement status from service
    const status = await getMerchantSettlementStatus(merchant, gateway);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});
