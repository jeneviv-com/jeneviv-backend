import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  merchantBankAccounts,
  merchants,
  type Merchant,
} from "../../db/schema/merchants.js";
import { payouts, type Payout } from "../../db/schema/payouts.js";
import type { PayoutInitiator, PayoutStatus } from "../../db/schema/enums.js";
import { getDefaultGateway } from "../../gateways/registry.js";
import { GatewayError } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";

const REFERENCE_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function newPayoutReference(): string {
  let out = "pout";
  for (let i = 0; i < 24; i++) {
    out +=
      REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return out;
}

export interface InitiatePayoutArgs {
  merchant: Merchant;
  bankAccountId: string;
  amount: number;
  currency: string;
  initiatedBy: PayoutInitiator;
  initiatedByUid: string | null;
  narration?: string;
}

async function debitPayoutsBalance(
  merchantId: string,
  amount: number,
): Promise<void> {
  const updated = await db
    .update(merchants)
    .set({
      payoutsBalanceNgn: sql`${merchants.payoutsBalanceNgn} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(merchants.id, merchantId),
        gte(merchants.payoutsBalanceNgn, amount),
      ),
    )
    .returning({ id: merchants.id });
  if (updated.length === 0) {
    throw new HttpError(
      422,
      "insufficient_balance",
      "Payouts balance is insufficient",
    );
  }
}

async function creditPayoutsBalance(
  merchantId: string,
  amount: number,
): Promise<void> {
  await db
    .update(merchants)
    .set({
      payoutsBalanceNgn: sql`${merchants.payoutsBalanceNgn} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId));
}

/**
 * Gateways that settle straight to a merchant subaccount (Paystack) leave us
 * with no wallet/payouts balance to disburse, so merchant-initiated payouts and
 * payout crons are disabled while such a gateway is active.
 */
export function directSettlementActive(): boolean {
  return getDefaultGateway().ensureSubaccount !== undefined;
}

export function assertPayoutsEnabled(): void {
  if (directSettlementActive()) {
    throw new HttpError(
      400,
      "payouts_unavailable",
      "Payouts are not available: funds settle directly to merchant bank accounts via the active gateway",
    );
  }
}

export async function initiatePayout(args: InitiatePayoutArgs): Promise<Payout> {
  assertPayoutsEnabled();

  if (args.initiatedBy === "merchant" && !args.merchant.canWithdraw) {
    throw new HttpError(
      403,
      "kyc_incomplete",
      "Withdrawals unlock after your NIN and settlement bank account are verified.",
    );
  }

  if (args.currency !== "NGN") {
    throw new HttpError(
      422,
      "unsupported_currency",
      "Only NGN payouts are supported",
    );
  }

  const bank = await db.query.merchantBankAccounts.findFirst({
    where: and(
      eq(merchantBankAccounts.id, args.bankAccountId),
      eq(merchantBankAccounts.merchantId, args.merchant.id),
    ),
  });
  if (!bank) {
    throw new HttpError(404, "not_found", "Bank account not found");
  }

  await debitPayoutsBalance(args.merchant.id, args.amount);

  const id = newId();
  const reference = newPayoutReference();
  const gateway = getDefaultGateway();
  const narration = args.narration ?? `Jeneviv payout ${reference}`;

  const [created] = await db
    .insert(payouts)
    .values({
      id,
      merchantId: args.merchant.id,
      bankAccountId: bank.id,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      bankCode: bank.bankCode,
      amount: args.amount,
      currency: args.currency,
      status: "pending",
      gateway: gateway.name,
      gatewayRef: reference,
      initiatedBy: args.initiatedBy,
      initiatedByUid: args.initiatedByUid,
    })
    .returning();

  if (!created) {
    await creditPayoutsBalance(args.merchant.id, args.amount);
    throw new HttpError(500, "internal_error", "Failed to record payout");
  }

  let gatewayResult;
  try {
    gatewayResult = await gateway.initiateTransfer({
      reference,
      amount: args.amount,
      currency: args.currency,
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      narration,
      accountName: bank.accountName,
    });
  } catch (err) {
    const reason =
      err instanceof GatewayError ? err.message : (err as Error).message;
    await db
      .update(payouts)
      .set({
        status: "failed",
        failureReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(payouts.id, id));
    await creditPayoutsBalance(args.merchant.id, args.amount);
    await recordAudit({
      actorUid: args.initiatedByUid,
      action: "payout.failed",
      entityType: "payout",
      entityId: id,
      metadata: {
        merchant_id: args.merchant.id,
        amount: args.amount,
        reason,
        initiated_by: args.initiatedBy,
      },
    });
    throw new HttpError(502, "gateway_error", `Failed to initiate transfer: ${reason}`);
  }

  const nextStatus: PayoutStatus =
    gatewayResult.status === "success"
      ? "success"
      : gatewayResult.status === "failed"
        ? "failed"
        : "processing";

  const [updated] = await db
    .update(payouts)
    .set({
      gatewayTxId: gatewayResult.gatewayTxId,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, id))
    .returning();

  await recordAudit({
    actorUid: args.initiatedByUid,
    action: "payout.initiated",
    entityType: "payout",
    entityId: id,
    metadata: {
      merchant_id: args.merchant.id,
      amount: args.amount,
      currency: args.currency,
      bank_code: bank.bankCode,
      account_number: bank.accountNumber,
      initiated_by: args.initiatedBy,
      gateway_tx_id: gatewayResult.gatewayTxId,
      gateway_status: gatewayResult.status,
    },
  });

  if (nextStatus === "failed") {
    await creditPayoutsBalance(args.merchant.id, args.amount);
  }

  return updated ?? created;
}

export async function listMerchantPayouts(
  merchantId: string,
  query: { limit: number; offset: number },
): Promise<Payout[]> {
  return db
    .select()
    .from(payouts)
    .where(eq(payouts.merchantId, merchantId))
    .orderBy(desc(payouts.createdAt))
    .limit(query.limit)
    .offset(query.offset);
}

export async function getMerchantPayout(
  merchantId: string,
  payoutId: string,
): Promise<Payout> {
  const row = await db.query.payouts.findFirst({
    where: and(eq(payouts.id, payoutId), eq(payouts.merchantId, merchantId)),
  });
  if (!row) {
    throw new HttpError(404, "not_found", "Payout not found");
  }
  return row;
}

export async function markPayoutCompletedByRef(
  gatewayRef: string,
): Promise<Payout | null> {
  const payout = await db.query.payouts.findFirst({
    where: eq(payouts.gatewayRef, gatewayRef),
  });
  if (!payout) return null;
  if (payout.status === "success") return payout;

  const [updated] = await db
    .update(payouts)
    .set({ status: "success", updatedAt: new Date() })
    .where(
      and(
        eq(payouts.id, payout.id),
        inArray(payouts.status, ["pending", "processing"]),
      ),
    )
    .returning();

  if (!updated) return payout;

  await recordAudit({
    actorUid: null,
    action: "payout.completed",
    entityType: "payout",
    entityId: payout.id,
    metadata: { gateway_ref: gatewayRef, amount: payout.amount },
  });

  return updated;
}

export async function markPayoutFailedByRef(
  gatewayRef: string,
  reason: string,
): Promise<Payout | null> {
  const payout = await db.query.payouts.findFirst({
    where: eq(payouts.gatewayRef, gatewayRef),
  });
  if (!payout) return null;
  if (payout.status === "failed" || payout.status === "success") return payout;

  const [updated] = await db
    .update(payouts)
    .set({
      status: "failed",
      failureReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(payouts.id, payout.id),
        inArray(payouts.status, ["pending", "processing"]),
      ),
    )
    .returning();

  if (!updated) return payout;

  await creditPayoutsBalance(payout.merchantId, payout.amount);

  await recordAudit({
    actorUid: null,
    action: "payout.failed",
    entityType: "payout",
    entityId: payout.id,
    metadata: {
      gateway_ref: gatewayRef,
      amount: payout.amount,
      reason,
    },
  });

  return updated;
}

async function processOnePayoutForMerchant(
  merchant: Merchant,
): Promise<Payout | null> {
  if (!merchant.defaultBankAccountId) return null;
  if (merchant.payoutsBalanceNgn <= 0) return null;
  return initiatePayout({
    merchant,
    bankAccountId: merchant.defaultBankAccountId,
    amount: merchant.payoutsBalanceNgn,
    currency: "NGN",
    initiatedBy: "cron",
    initiatedByUid: null,
    narration: "Scheduled payout",
  });
}

export async function sweepMerchantPayout(
  merchantId: string,
): Promise<Payout | null> {
  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, merchantId),
  });
  if (!merchant) return null;
  return processOnePayoutForMerchant(merchant);
}
