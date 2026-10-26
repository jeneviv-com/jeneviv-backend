import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import { merchants } from "../../db/schema/merchants.js";
import { refunds, type Refund } from "../../db/schema/payouts.js";
import { transactions } from "../../db/schema/transactions.js";
import { getGateway } from "../../gateways/registry.js";
import { GatewayError } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";

const REFERENCE_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function newRefundReference(): string {
  let out = "rfnd";
  for (let i = 0; i < 24; i++) {
    out +=
      REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return out;
}

/**
 * Split gateways (Paystack) settle straight to the merchant's bank, so there is
 * no platform-held balance to debit or restore. Only gateways that hold funds
 * (Flutterwave) use the wallet ledger.
 */
function gatewayHoldsFunds(gateway: string): boolean {
  return gateway !== "paystack";
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
      "Merchant payouts balance is insufficient to cover this refund",
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

export async function refundTransaction(args: {
  actor: User;
  transactionId: string;
  reason: string;
}): Promise<Refund> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, args.transactionId),
  });
  if (!tx) throw new HttpError(404, "not_found", "Transaction not found");

  if (args.actor.role !== "admin") {
    const merchant = await db.query.merchants.findFirst({
      where: eq(merchants.userId, args.actor.id),
    });
    if (!merchant || merchant.id !== tx.merchantId) {
      throw new HttpError(403, "forbidden", "Not the owning merchant");
    }
  }

  if (tx.status !== "success") {
    throw new HttpError(
      422,
      "invalid_status",
      `Cannot refund a transaction in status ${tx.status}`,
    );
  }

  const existing = await db.query.refunds.findFirst({
    where: eq(refunds.transactionId, tx.id),
  });
  if (existing && existing.status !== "failed") {
    throw new HttpError(
      409,
      "already_refunded",
      `Refund already ${existing.status}`,
    );
  }

  if (!tx.gatewayId) {
    throw new HttpError(
      422,
      "missing_gateway_id",
      "Transaction has no gateway charge id to refund",
    );
  }

  const refundAmount = tx.amount;
  const holdsFunds = gatewayHoldsFunds(tx.gateway);
  if (holdsFunds) await debitPayoutsBalance(tx.merchantId, refundAmount);

  const id = newId();
  const reference = newRefundReference();
  // Refund through the gateway that captured the payment, which may differ
  // from the current default while a switch-over is in progress.
  const gateway = getGateway(tx.gateway);

  const [created] = await db
    .insert(refunds)
    .values({
      id,
      transactionId: tx.id,
      merchantId: tx.merchantId,
      amount: refundAmount,
      reason: args.reason,
      status: "pending",
      gatewayRef: reference,
      initiatedByUid: args.actor.id,
    })
    .returning();

  if (!created) {
    if (holdsFunds) await creditPayoutsBalance(tx.merchantId, refundAmount);
    throw new HttpError(500, "internal_error", "Failed to record refund");
  }

  let gatewayResult;
  try {
    gatewayResult = await gateway.initiateRefund({
      reference,
      chargeId: tx.gatewayId,
      amount: refundAmount,
      currency: tx.currency,
      reason: args.reason,
    });
  } catch (err) {
    const reason =
      err instanceof GatewayError ? err.message : (err as Error).message;
    await db
      .update(refunds)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(refunds.id, id));
    if (holdsFunds) await creditPayoutsBalance(tx.merchantId, refundAmount);
    await recordAudit({
      actorUid: args.actor.id,
      action: "refund.failed",
      entityType: "refund",
      entityId: id,
      metadata: {
        transaction_id: tx.id,
        amount: refundAmount,
        reason,
      },
    });
    throw new HttpError(502, "gateway_error", `Failed to initiate refund: ${reason}`);
  }

  const nextStatus =
    gatewayResult.status === "success"
      ? "success"
      : gatewayResult.status === "failed"
        ? "failed"
        : "pending";

  const [updated] = await db
    .update(refunds)
    .set({
      status: nextStatus,
      gatewayRefundId: gatewayResult.gatewayRefundId,
      failureReason: nextStatus === "failed" ? "Gateway rejected the refund" : null,
      updatedAt: new Date(),
    })
    .where(eq(refunds.id, id))
    .returning();

  await recordAudit({
    actorUid: args.actor.id,
    action: "refund.initiated",
    entityType: "refund",
    entityId: id,
    metadata: {
      transaction_id: tx.id,
      amount: refundAmount,
      currency: tx.currency,
      gateway_refund_id: gatewayResult.gatewayRefundId,
      gateway_status: gatewayResult.status,
    },
  });

  if (nextStatus === "failed" && holdsFunds) {
    await creditPayoutsBalance(tx.merchantId, refundAmount);
  }

  return updated ?? created;
}

/**
 * Webhooks identify a refund by our reference, the gateway's refund id, or the
 * original transaction reference depending on the gateway and event.
 */
async function findRefundForGatewayEvent(
  ...references: Array<string | undefined>
): Promise<Refund | null> {
  const refs = references.filter((value): value is string => Boolean(value));
  if (refs.length === 0) return null;

  const direct = await db.query.refunds.findFirst({
    where: or(
      ...refs.flatMap((reference) => [
        eq(refunds.gatewayRef, reference),
        eq(refunds.gatewayRefundId, reference),
      ]),
    ),
  });
  if (direct) return direct;

  const tx = await db.query.transactions.findFirst({
    where: or(
      ...refs.flatMap((reference) => [
        eq(transactions.reference, reference),
        eq(transactions.gatewayId, reference),
      ]),
    ),
  });
  if (!tx) return null;

  return (
    (await db.query.refunds.findFirst({
      where: eq(refunds.transactionId, tx.id),
    })) ?? null
  );
}

export async function markRefundCompletedByRef(
  ...gatewayRefs: Array<string | undefined>
): Promise<Refund | null> {
  const refund = await findRefundForGatewayEvent(...gatewayRefs);
  if (!refund) return null;
  if (refund.status === "success") return refund;

  const [updated] = await db
    .update(refunds)
    .set({
      status: "success",
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(refunds.id, refund.id),
        or(eq(refunds.status, "pending"), eq(refunds.status, "needs_attention")),
      ),
    )
    .returning();

  await recordAudit({
    actorUid: null,
    action: "refund.completed",
    entityType: "refund",
    entityId: refund.id,
    metadata: { gateway_ref: gatewayRefs[0] ?? null, amount: refund.amount },
  });

  return updated ?? refund;
}

export async function markRefundFailedByRef(
  reason: string,
  ...gatewayRefs: Array<string | undefined>
): Promise<Refund | null> {
  const refund = await findRefundForGatewayEvent(...gatewayRefs);
  if (!refund) return null;
  if (refund.status !== "pending" && refund.status !== "needs_attention") {
    return refund;
  }

  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, refund.transactionId),
  });
  const holdsFunds = tx ? gatewayHoldsFunds(tx.gateway) : true;

  const [updated] = await db
    .update(refunds)
    .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(refunds.id, refund.id),
        or(eq(refunds.status, "pending"), eq(refunds.status, "needs_attention")),
      ),
    )
    .returning();

  if (updated && holdsFunds) {
    await creditPayoutsBalance(refund.merchantId, refund.amount);
  }

  await recordAudit({
    actorUid: null,
    action: "refund.failed",
    entityType: "refund",
    entityId: refund.id,
    metadata: {
      gateway_ref: gatewayRefs[0] ?? null,
      amount: refund.amount,
      reason,
    },
  });

  return updated ?? refund;
}

/**
 * Paystack could not route the refund because the payer's bank account was not
 * returned with the original charge. The merchant must supply it, then call
 * retryRefundWithBankDetails.
 */
export async function markRefundNeedsAttentionByRef(
  reason?: string,
  ...gatewayRefs: Array<string | undefined>
): Promise<Refund | null> {
  const refund = await findRefundForGatewayEvent(...gatewayRefs);
  if (!refund) return null;
  if (refund.status === "success" || refund.status === "failed") return refund;

  const [updated] = await db
    .update(refunds)
    .set({
      status: "needs_attention",
      failureReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(refunds.id, refund.id))
    .returning();

  await recordAudit({
    actorUid: null,
    action: "refund.needs_attention",
    entityType: "refund",
    entityId: refund.id,
    metadata: {
      gateway_ref: gatewayRefs[0] ?? null,
      amount: refund.amount,
      reason: reason ?? null,
    },
  });

  return updated ?? refund;
}

export async function retryRefundWithBankDetails(args: {
  actor: User;
  refundId: string;
  accountNumber: string;
  bankCode: string;
}): Promise<Refund> {
  const refund = await db.query.refunds.findFirst({
    where: eq(refunds.id, args.refundId),
  });
  if (!refund) throw new HttpError(404, "not_found", "Refund not found");

  if (args.actor.role !== "admin") {
    const merchant = await db.query.merchants.findFirst({
      where: eq(merchants.userId, args.actor.id),
    });
    if (!merchant || merchant.id !== refund.merchantId) {
      throw new HttpError(403, "forbidden", "Not the owning merchant");
    }
  }

  if (refund.status !== "needs_attention") {
    throw new HttpError(
      422,
      "invalid_status",
      `Refund is ${refund.status}; only needs_attention refunds can be retried`,
    );
  }

  if (!refund.gatewayRefundId) {
    throw new HttpError(
      422,
      "missing_gateway_refund_id",
      "Refund has no gateway refund id to retry",
    );
  }

  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, refund.transactionId),
  });
  if (!tx) throw new HttpError(404, "not_found", "Transaction not found");

  const gateway = getGateway(tx.gateway);
  if (!gateway.retryRefund) {
    throw new HttpError(
      422,
      "retry_unsupported",
      `${gateway.name} does not support retrying a refund with payer bank details`,
    );
  }

  let result;
  try {
    result = await gateway.retryRefund({
      gatewayRefundId: refund.gatewayRefundId,
      accountNumber: args.accountNumber,
      bankCode: args.bankCode,
      currency: tx.currency,
    });
  } catch (err) {
    const reason =
      err instanceof GatewayError ? err.message : (err as Error).message;
    await recordAudit({
      actorUid: args.actor.id,
      action: "refund.retry_failed",
      entityType: "refund",
      entityId: refund.id,
      metadata: { reason, account_number: args.accountNumber },
    });
    throw new HttpError(
      502,
      "gateway_error",
      `Failed to retry refund: ${reason}`,
    );
  }

  const nextStatus =
    result.status === "success"
      ? "success"
      : result.status === "failed"
        ? "failed"
        : "pending";

  const [updated] = await db
    .update(refunds)
    .set({
      status: nextStatus,
      gatewayRefundId: result.gatewayRefundId,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(refunds.id, refund.id))
    .returning();

  await recordAudit({
    actorUid: args.actor.id,
    action: "refund.retried",
    entityType: "refund",
    entityId: refund.id,
    metadata: {
      transaction_id: tx.id,
      account_number: args.accountNumber,
      bank_code: args.bankCode,
      gateway_refund_id: result.gatewayRefundId,
      gateway_status: result.status,
    },
  });

  return updated ?? refund;
}

export async function listRefunds(args: {
  actor: User;
  limit?: number;
}): Promise<Refund[]> {
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);

  if (args.actor.role === "admin") {
    return db.query.refunds.findMany({
      orderBy: (refund, { desc }) => [desc(refund.createdAt)],
      limit,
    });
  }

  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.userId, args.actor.id),
  });
  if (!merchant) return [];

  return db.query.refunds.findMany({
    where: eq(refunds.merchantId, merchant.id),
    orderBy: (refund, { desc }) => [desc(refund.createdAt)],
    limit,
  });
}
