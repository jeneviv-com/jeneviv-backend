import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import { merchants } from "../../db/schema/merchants.js";
import { refunds, type Refund } from "../../db/schema/payouts.js";
import { transactions } from "../../db/schema/transactions.js";
import { getDefaultGateway } from "../../gateways/registry.js";
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
  await debitPayoutsBalance(tx.merchantId, refundAmount);

  const id = newId();
  const reference = newRefundReference();
  const gateway = getDefaultGateway();

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
    await creditPayoutsBalance(tx.merchantId, refundAmount);
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
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(refunds.id, id));
    await creditPayoutsBalance(tx.merchantId, refundAmount);
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
    .set({ status: nextStatus, updatedAt: new Date() })
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

  if (nextStatus === "failed") {
    await creditPayoutsBalance(tx.merchantId, refundAmount);
  }

  return updated ?? created;
}

export async function markRefundCompletedByRef(
  gatewayRef: string,
): Promise<Refund | null> {
  const refund = await db.query.refunds.findFirst({
    where: eq(refunds.gatewayRef, gatewayRef),
  });
  if (!refund) return null;
  if (refund.status === "success") return refund;

  const [updated] = await db
    .update(refunds)
    .set({ status: "success", updatedAt: new Date() })
    .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending")))
    .returning();

  await recordAudit({
    actorUid: null,
    action: "refund.completed",
    entityType: "refund",
    entityId: refund.id,
    metadata: { gateway_ref: gatewayRef, amount: refund.amount },
  });

  return updated ?? refund;
}

export async function markRefundFailedByRef(
  gatewayRef: string,
  reason: string,
): Promise<Refund | null> {
  const refund = await db.query.refunds.findFirst({
    where: eq(refunds.gatewayRef, gatewayRef),
  });
  if (!refund) return null;
  if (refund.status !== "pending") return refund;

  const [updated] = await db
    .update(refunds)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending")))
    .returning();

  if (updated) {
    await creditPayoutsBalance(refund.merchantId, refund.amount);
  }

  await recordAudit({
    actorUid: null,
    action: "refund.failed",
    entityType: "refund",
    entityId: refund.id,
    metadata: {
      gateway_ref: gatewayRef,
      amount: refund.amount,
      reason,
    },
  });

  return updated ?? refund;
}
