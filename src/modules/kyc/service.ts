import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { merchants, merchantBankAccounts, type Merchant } from "../../db/schema/merchants.js";
import { env } from "../../env.js";
import { lookupBvn, lookupNin } from "../../lib/veripine.js";
import { hashBvn, hashNin } from "../../lib/secrets.js";
import { namesMatch } from "../../lib/names.js";
import { recordAudit } from "../../lib/audit.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import { paystackAdapter } from "../../gateways/paystack/adapter.js";
import { GatewayError } from "../../gateways/types.js";
import { ensureMerchantSubaccount } from "../merchants/service.js";
import type { SetTreasurerInput, VerifyBankInput } from "../merchants/schemas.js";
import { getDefaultGateway } from "../../gateways/registry.js";

export interface KycView {
  kyc_status: Merchant["kycStatus"];
  can_collect: boolean;
  can_withdraw: boolean;
  nin_last4: string | null;
  /** Which identity number verified this merchant, if any. */
  id_type: "nin" | "bvn" | null;
  /** Last four digits of that number (NIN or BVN). */
  id_last4: string | null;
  verified_legal_name: string | null;
  nin_verified_at: string | null;
  bank_verified_at: string | null;
  logo_url: string | null;
  treasurer_name: string | null;
  treasurer_phone: string | null;
  escrow_enabled: boolean;
  wallet_balance_minor: number;
  payouts_balance_minor: number;
  withdrawable_minor: number;
  maturity: "unverified" | "nin_verified" | "ready";
}

function idTypeOf(merchant: Merchant): "nin" | "bvn" | null {
  if (merchant.kycIdType === "bvn" || merchant.kycIdType === "nin") return merchant.kycIdType;
  // Rows verified before BVN support existed only ever used NIN.
  return merchant.ninVerifiedAt ? "nin" : null;
}

export function toKycView(merchant: Merchant): KycView {
  const idType = idTypeOf(merchant);
  return {
    kyc_status: merchant.kycStatus,
    can_collect: merchant.canCollect,
    can_withdraw: merchant.canWithdraw,
    nin_last4: merchant.ninLast4,
    id_type: idType,
    id_last4: idType === "bvn" ? merchant.bvnLast4 : merchant.ninLast4,
    verified_legal_name: merchant.kycLegalName,
    nin_verified_at: merchant.ninVerifiedAt?.toISOString() ?? null,
    bank_verified_at: merchant.bankVerifiedAt?.toISOString() ?? null,
    logo_url: merchant.logoUrl,
    treasurer_name: merchant.treasurerName,
    treasurer_phone: merchant.treasurerPhone,
    escrow_enabled: merchant.escrowEnabled,
    wallet_balance_minor: merchant.walletBalanceNgn,
    payouts_balance_minor: merchant.payoutsBalanceNgn,
    withdrawable_minor: merchant.escrowEnabled
      ? merchant.walletBalanceNgn
      : merchant.payoutsBalanceNgn,
    maturity: merchant.canWithdraw
      ? "ready"
      : merchant.ninVerifiedAt
        ? "nin_verified"
        : "unverified",
  };
}

async function reload(merchantId: string): Promise<Merchant> {
  const row = await db.query.merchants.findFirst({
    where: eq(merchants.id, merchantId),
  });
  if (!row) {
    throw new HttpError(404, "merchant_not_found", "Merchant not found");
  }
  return row;
}

export type IdentityType = "nin" | "bvn";

/**
 * Verifies the owner's identity with either a NIN or a BVN. Both unlock the
 * same step: collecting, and a legal name the settlement bank must match.
 */
export async function verifyIdentity(
  merchant: Merchant,
  idType: IdentityType,
  value: string,
): Promise<KycView> {
  const identity = idType === "nin" ? await lookupNin(value) : await lookupBvn(value);
  const last4 = value.slice(-4);

  const alreadyBankVerified = Boolean(
    merchant.canWithdraw &&
      merchant.kycLegalName &&
      namesMatch(merchant.kycLegalName, identity.fullName),
  );

  const now = new Date();
  await db
    .update(merchants)
    .set({
      kycStatus: alreadyBankVerified ? "verified" : "nin_verified",
      canCollect: true,
      canWithdraw: alreadyBankVerified,
      kycIdType: idType,
      ...(idType === "nin"
        ? { ninHash: hashNin(value), ninLast4: last4 }
        : { bvnHash: hashBvn(value), bvnLast4: last4 }),
      kycLegalName: identity.fullName,
      kycProviderRef: identity.provider,
      // Marks the identity step for either method; see the schema comment.
      ninVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(merchants.id, merchant.id));

  await recordAudit({
    actorUid: merchant.userId,
    action: idType === "nin" ? "merchant.kyc.nin_verified" : "merchant.kyc.bvn_verified",
    entityType: "merchant",
    entityId: merchant.id,
    metadata: {
      provider: identity.provider,
      id_type: idType,
      [`${idType}_last4`]: last4,
      legal_name: identity.fullName,
    },
  });

  return toKycView(await reload(merchant.id));
}

export function verifyNin(merchant: Merchant, nin: string): Promise<KycView> {
  return verifyIdentity(merchant, "nin", nin);
}

export function verifyBvn(merchant: Merchant, bvn: string): Promise<KycView> {
  return verifyIdentity(merchant, "bvn", bvn);
}

async function resolveBankName(
  bankCode: string,
  accountNumber: string,
): Promise<{ accountName: string; provider: "paystack" | "mock" }> {
  if (!env.PAYSTACK_SECRET_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      return { accountName: env.KYC_MOCK_ACCOUNT_NAME, provider: "mock" };
    }
    throw new HttpError(
      503,
      "bank_resolve_not_configured",
      "Bank verification is not configured. Set PAYSTACK_SECRET_KEY.",
    );
  }

  try {
    const resolved = await paystackAdapter.resolveAccountName({
      bankCode,
      accountNumber,
      currency: "NGN",
    });
    return { accountName: resolved.accountName, provider: "paystack" };
  } catch (err) {
    if (err instanceof GatewayError && err.status && err.status < 500) {
      throw new HttpError(422, "bank_account_unverified", err.message);
    }
    throw new HttpError(
      502,
      "bank_resolve_failed",
      err instanceof Error ? err.message : "Could not verify that bank account.",
    );
  }
}

export async function verifyKycBank(
  merchant: Merchant,
  input: VerifyBankInput,
): Promise<KycView> {
  if (!merchant.kycLegalName || !merchant.ninVerifiedAt) {
    throw new HttpError(
      422,
      "nin_required",
      "Verify your NIN or BVN before adding a settlement bank account.",
    );
  }

  const resolved = await resolveBankName(input.bank_code, input.account_number);
  const matched = namesMatch(merchant.kycLegalName, resolved.accountName);
  const idLabel = idTypeOf(merchant) === "bvn" ? "BVN" : "NIN";

  await recordAudit({
    actorUid: merchant.userId,
    action: matched ? "merchant.kyc.bank_verified" : "merchant.kyc.bank_mismatch",
    entityType: "merchant",
    entityId: merchant.id,
    metadata: {
      bank_code: input.bank_code,
      account_number_last4: input.account_number.slice(-4),
      legal_name: merchant.kycLegalName,
      account_name: resolved.accountName,
      provider: resolved.provider,
    },
  });

  if (!matched) {
    throw new HttpError(
      422,
      "bank_name_mismatch",
      `The bank account name (${resolved.accountName}) does not match the ${idLabel} record (${merchant.kycLegalName}).`,
      {
        matched: false,
        account_name: resolved.accountName,
        legal_name: merchant.kycLegalName,
        id_type: idTypeOf(merchant) ?? "nin",
      },
    );
  }

  const existing = await db.query.merchantBankAccounts.findFirst({
    where: and(
      eq(merchantBankAccounts.merchantId, merchant.id),
      eq(merchantBankAccounts.bankCode, input.bank_code),
      eq(merchantBankAccounts.accountNumber, input.account_number),
    ),
  });
  const makeDefault = !merchant.defaultBankAccountId;
  const now = new Date();

  const saved = await db.transaction(async (tx) => {
    if (makeDefault) {
      await tx
        .update(merchantBankAccounts)
        .set({ isDefault: false })
        .where(eq(merchantBankAccounts.merchantId, merchant.id));
    }

    if (existing) {
      const [updated] = await tx
        .update(merchantBankAccounts)
        .set({
          accountName: resolved.accountName,
          verifiedAt: now,
          isDefault: makeDefault ? true : existing.isDefault,
        })
        .where(eq(merchantBankAccounts.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(merchantBankAccounts)
      .values({
        id: newId(),
        merchantId: merchant.id,
        accountNumber: input.account_number,
        accountName: resolved.accountName,
        bankCode: input.bank_code,
        currency: "NGN",
        isDefault: makeDefault,
        verifiedAt: now,
      })
      .returning();
    return created;
  });

  if (!saved) {
    throw new HttpError(500, "internal_error", "Could not save the bank account");
  }

  await db
    .update(merchants)
    .set({
      canWithdraw: true,
      kycStatus: "verified",
      bankVerifiedAt: now,
      ...(makeDefault ? { defaultBankAccountId: saved.id } : {}),
      updatedAt: now,
    })
    .where(eq(merchants.id, merchant.id));

  const gateway = getDefaultGateway();
  if (gateway.ensureSubaccount) {
    await ensureMerchantSubaccount(merchant, saved, true);
  }

  return toKycView(await reload(merchant.id));
}

export async function setTreasurer(
  merchant: Merchant,
  input: SetTreasurerInput,
): Promise<KycView> {
  await db
    .update(merchants)
    .set({
      treasurerName: input.treasurer_name,
      treasurerPhone: input.treasurer_phone,
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchant.id));

  await recordAudit({
    actorUid: merchant.userId,
    action: "merchant.treasurer.set",
    entityType: "merchant",
    entityId: merchant.id,
    metadata: {
      treasurer_name: input.treasurer_name,
      treasurer_phone_last4: input.treasurer_phone.slice(-4),
    },
  });

  return toKycView(await reload(merchant.id));
}
