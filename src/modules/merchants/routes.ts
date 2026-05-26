import { Router } from "express";
import { HttpError } from "../../middleware/error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import {
  applyMerchantSchema,
  bankAccountIdParamSchema,
  createBankAccountSchema,
  updateMerchantSettingsSchema,
} from "./schemas.js";
import {
  applyAsMerchant,
  createMerchantBankAccount,
  deleteMerchantBankAccount,
  getMerchantForUser,
  listMerchantBankAccounts,
  updateMerchantSettings,
} from "./service.js";

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
  validate(updateMerchantSettingsSchema),
  async (req, res, next) => {
    try {
      const merchant = await getMerchantForUser(req.user!.id);
      const updated = await updateMerchantSettings(merchant, req.body);
      res.json({ merchant: updated });
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
  validate(createBankAccountSchema),
  async (req, res, next) => {
    try {
      const merchant = await getMerchantForUser(req.user!.id);
      const account = await createMerchantBankAccount(merchant, req.body);
      res.status(201).json({ bank_account: account });
    } catch (err) {
      next(err);
    }
  },
);

merchantsRouter.delete(
  "/me/bank-accounts/:id",
  validate(bankAccountIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const merchant = await getMerchantForUser(req.user!.id);
      const { id } = req.params as { id: string };
      if (!id) throw new HttpError(400, "bad_request", "id is required");
      await deleteMerchantBankAccount(merchant, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
