import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  merchantBankAccounts,
  merchants,
  type Merchant,
  type MerchantBankAccount,
} from "../../db/schema/merchants.js";
import { getDefaultGateway } from "../../gateways/registry.js";
import { GatewayError } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { newId, newMerchantCode } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import type {
  ApplyMerchantInput,
  CreateBankAccountInput,
  UpdateMerchantSettingsInput,
} from "./schemas.js";

/**
 * Create (or refresh) the gateway split destination for a merchant's bank
 * account and cache its code on the merchant. Split gateways (Paystack) settle
 * collections straight to this subaccount, so we never hold merchant funds.
 * No-op for gateways that don't support subaccounts (Flutterwave).
 */
export async function ensureMerchantSubaccount(
  merchant: Merchant,
  bank: Pick<MerchantBankAccount, "bankCode" | "accountNumber" | "accountName">,
  force = false,
): Promise<void> {
  const gateway = getDefaultGateway();
  if (!gateway.ensureSubaccount) return;
  if (!force && merchant.gatewaySubaccountIds?.[gateway.name]) return;

  try {
    const { subaccountCode } = await gateway.ensureSubaccount({
      businessName: merchant.displayName ?? bank.accountName,
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      percentageCharge: 0,
    });
    await db
      .update(merchants)
      .set({
        gatewaySubaccountIds: sql`jsonb_set(${merchants.gatewaySubaccountIds}, ${`{${gateway.name}}`}, ${`"${subaccountCode}"`}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, merchant.id));

    await recordAudit({
      actorUid: merchant.userId,
      action: "merchant.subaccount.create",
      entityType: "merchant",
      entityId: merchant.id,
      metadata: { gateway: gateway.name, subaccount_code: subaccountCode },
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new HttpError(
        502,
        "gateway_error",
        `Failed to create payout subaccount: ${err.message}`,
      );
    }
    throw err;
  }
}

export async function findMerchantByUser(
  userId: string,
): Promise<Merchant | undefined> {
  return db.query.merchants.findFirst({
    where: eq(merchants.userId, userId),
  });
}

export async function getMerchantForUser(userId: string): Promise<Merchant> {
  const merchant = await findMerchantByUser(userId);
  if (!merchant) {
    throw new HttpError(
      404,
      "merchant_not_found",
      "No merchant account exists for this user",
    );
  }
  return merchant;
}

export async function applyAsMerchant(
  userId: string,
  input: ApplyMerchantInput,
): Promise<Merchant> {
  const existing = await findMerchantByUser(userId);
  if (existing) {
    throw new HttpError(
      409,
      "merchant_already_exists",
      `Merchant already ${existing.status}`,
    );
  }

  const id = newId();
  const merchantCode = newMerchantCode();

  const [created] = await db
    .insert(merchants)
    .values({
      id,
      userId,
      merchantCode,
      displayName: input.display_name,
      applicationNote: input.application_note ?? null,
    })
    .returning();

  if (!created) {
    throw new HttpError(500, "internal_error", "Failed to create merchant");
  }

  await recordAudit({
    actorUid: userId,
    action: "merchant.apply",
    entityType: "merchant",
    entityId: id,
    metadata: { display_name: input.display_name },
  });

  return created;
}

export async function updateMerchantSettings(
  merchant: Merchant,
  input: UpdateMerchantSettingsInput,
): Promise<Merchant> {
  const patch: Partial<typeof merchants.$inferInsert> = {};
  let bankToRepoint: MerchantBankAccount | undefined;
  if (input.display_name !== undefined) patch.displayName = input.display_name;
  if (input.logo_url !== undefined) patch.logoUrl = input.logo_url;
  if (input.payout_mode !== undefined) patch.payoutMode = input.payout_mode;
  if (input.email_notification_for_transactions !== undefined) {
    patch.emailNotificationForTransactions =
      input.email_notification_for_transactions;
  }
  if (input.email_notification_period !== undefined) {
    patch.emailNotificationPeriod = input.email_notification_period;
  }

  if (input.default_bank_account_id !== undefined) {
    if (input.default_bank_account_id === null) {
      patch.defaultBankAccountId = null;
    } else {
      const bank = await db.query.merchantBankAccounts.findFirst({
        where: and(
          eq(merchantBankAccounts.id, input.default_bank_account_id),
          eq(merchantBankAccounts.merchantId, merchant.id),
        ),
      });
      if (!bank) {
        throw new HttpError(
          422,
          "invalid_bank_account",
          "Bank account does not belong to this merchant",
        );
      }
      patch.defaultBankAccountId = bank.id;
      bankToRepoint = bank;
    }
  }

  patch.updatedAt = new Date();

  const [updated] = await db
    .update(merchants)
    .set(patch)
    .where(eq(merchants.id, merchant.id))
    .returning();

  if (!updated) {
    throw new HttpError(500, "internal_error", "Failed to update merchant");
  }

  if (bankToRepoint) {
    await ensureMerchantSubaccount(updated, bankToRepoint, true);
    const refreshed = await db.query.merchants.findFirst({
      where: eq(merchants.id, merchant.id),
    });
    if (refreshed) return refreshed;
  }
  return updated;
}

export async function listMerchantBankAccounts(
  merchantId: string,
): Promise<MerchantBankAccount[]> {
  return db.query.merchantBankAccounts.findMany({
    where: eq(merchantBankAccounts.merchantId, merchantId),
  });
}

export async function createMerchantBankAccount(
  merchant: Merchant,
  input: CreateBankAccountInput,
): Promise<MerchantBankAccount> {
  const gateway = getDefaultGateway();
  let accountName: string;
  try {
    const result = await gateway.resolveAccountName({
      bankCode: input.bank_code,
      accountNumber: input.account_number,
      currency: input.currency,
    });
    accountName = result.accountName;
  } catch (err) {
    if (
      err instanceof GatewayError &&
      err.status !== undefined &&
      err.status >= 400 &&
      err.status < 500
    ) {
      throw new HttpError(422, "bank_account_unverified", err.message);
    }
    throw err;
  }

  const id = newId();
  const shouldBeDefault =
    input.is_default === true || merchant.defaultBankAccountId === null;

  const created = await db.transaction(async (tx) => {
    if (shouldBeDefault) {
      await tx
        .update(merchantBankAccounts)
        .set({ isDefault: false })
        .where(eq(merchantBankAccounts.merchantId, merchant.id));
    }

    const [row] = await tx
      .insert(merchantBankAccounts)
      .values({
        id,
        merchantId: merchant.id,
        accountNumber: input.account_number,
        accountName,
        bankCode: input.bank_code,
        currency: input.currency,
        isDefault: shouldBeDefault,
        verifiedAt: new Date(),
      })
      .returning();

    if (shouldBeDefault) {
      await tx
        .update(merchants)
        .set({ defaultBankAccountId: id, updatedAt: new Date() })
        .where(eq(merchants.id, merchant.id));
    }

    return row;
  });

  if (!created) {
    throw new HttpError(500, "internal_error", "Failed to add bank account");
  }

  if (shouldBeDefault) {
    await ensureMerchantSubaccount(merchant, created, true);
  }

  await recordAudit({
    actorUid: merchant.userId,
    action: "merchant.bank_account.create",
    entityType: "merchant_bank_account",
    entityId: created.id,
    metadata: {
      merchant_id: merchant.id,
      bank_code: input.bank_code,
      account_number: input.account_number,
    },
  });

  return created;
}

export async function deleteMerchantBankAccount(
  merchant: Merchant,
  bankAccountId: string,
): Promise<void> {
  const bank = await db.query.merchantBankAccounts.findFirst({
    where: and(
      eq(merchantBankAccounts.id, bankAccountId),
      eq(merchantBankAccounts.merchantId, merchant.id),
    ),
  });
  if (!bank) {
    throw new HttpError(404, "not_found", "Bank account not found");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(merchantBankAccounts)
      .where(eq(merchantBankAccounts.id, bankAccountId));

    if (merchant.defaultBankAccountId === bankAccountId) {
      await tx
        .update(merchants)
        .set({ defaultBankAccountId: null, updatedAt: new Date() })
        .where(eq(merchants.id, merchant.id));
    }
  });

  await recordAudit({
    actorUid: merchant.userId,
    action: "merchant.bank_account.delete",
    entityType: "merchant_bank_account",
    entityId: bankAccountId,
    metadata: { merchant_id: merchant.id },
  });
}
