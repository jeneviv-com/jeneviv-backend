import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { merchants } from "../../db/schema/merchants.js";
import { webhookEvents } from "../../db/schema/platform.js";
import { transactions } from "../../db/schema/transactions.js";
import {
  getWebhookEventId,
  getWebhookEventType,
} from "../../gateways/flutterwave/webhook.js";
import {
  getPaystackEventId,
  getPaystackEventType,
} from "../../gateways/paystack/webhook.js";
import { getGateway } from "../../gateways/registry.js";
import type { GatewayName, NormalizedEvent } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { sendReceiptEmail } from "../verify/notify.js";
import { toMajor } from "../../lib/money.js";
import { newId } from "../../lib/short-code.js";
import {
  markPayoutCompletedByRef,
  markPayoutFailedByRef,
} from "../payouts/service.js";
import {
  markWithdrawalCompletedByRef,
  markWithdrawalFailedByRef,
} from "../withdrawals/service.js";
import {
  markRefundCompletedByRef,
  markRefundFailedByRef,
  markRefundNeedsAttentionByRef,
} from "../refunds/service.js";

export interface IngestResult {
  status: "ok" | "duplicate" | "ignored" | "invalid";
  message?: string;
}

interface EventIdentity {
  getEventId(payload: unknown): string | null;
  getEventType(payload: unknown): string | null;
}

async function ingestWebhook(
  gatewayName: GatewayName,
  identity: EventIdentity,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ result: IngestResult; httpStatus: number }> {
  const gateway = getGateway(gatewayName);

  const verified = gateway.verifyWebhookSignature(rawBody, headers);
  if (!verified) {
    return {
      result: { status: "invalid", message: "Invalid signature" },
      httpStatus: 401,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return {
      result: { status: "invalid", message: "Invalid JSON" },
      httpStatus: 400,
    };
  }

  const eventId = identity.getEventId(payload);
  const eventType = identity.getEventType(payload) ?? "unknown";
  if (!eventId) {
    return {
      result: { status: "invalid", message: "Missing event id" },
      httpStatus: 400,
    };
  }

  const existing = await db.query.webhookEvents.findFirst({
    where: (e, { and: andf, eq: eqf }) =>
      andf(eqf(e.gateway, gatewayName), eqf(e.eventId, eventId)),
  });

  if (existing) {
    return {
      result: { status: "duplicate", message: "Event already received" },
      httpStatus: 200,
    };
  }

  const eventRowId = newId();
  await db.insert(webhookEvents).values({
    id: eventRowId,
    gateway: gatewayName,
    eventId,
    eventType,
    signatureVerified: true,
    payload: payload as Record<string, unknown>,
  });

  const normalized = gateway.parseWebhookEvent(payload);
  if (!normalized) {
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, eventRowId));
    return {
      result: { status: "ignored", message: `Unhandled event: ${eventType}` },
      httpStatus: 200,
    };
  }

  try {
    await processNormalizedEvent(normalized);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, eventRowId));
    return { result: { status: "ok" }, httpStatus: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(webhookEvents)
      .set({ processingError: message })
      .where(eq(webhookEvents.id, eventRowId));
    return {
      result: { status: "invalid", message },
      httpStatus: 500,
    };
  }
}

export async function ingestFlutterwaveWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ result: IngestResult; httpStatus: number }> {
  return ingestWebhook(
    "flutterwave",
    { getEventId: getWebhookEventId, getEventType: getWebhookEventType },
    rawBody,
    headers,
  );
}

function getMonnifyEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { eventType?: string; eventData?: Record<string, unknown> };
  const data = root.eventData ?? {};
  const identity =
    data.transactionReference ?? data.paymentReference ?? data.reference;
  if (!identity || !root.eventType) return null;
  return `${root.eventType}:${String(identity)}`;
}

function getMonnifyEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  return (payload as { eventType?: string }).eventType ?? null;
}

export async function ingestMonnifyWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ result: IngestResult; httpStatus: number }> {
  return ingestWebhook(
    "monnify",
    { getEventId: getMonnifyEventId, getEventType: getMonnifyEventType },
    rawBody,
    headers,
  );
}

export async function ingestPaystackWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ result: IngestResult; httpStatus: number }> {
  return ingestWebhook(
    "paystack",
    { getEventId: getPaystackEventId, getEventType: getPaystackEventType },
    rawBody,
    headers,
  );
}

async function processNormalizedEvent(event: NormalizedEvent): Promise<void> {
  switch (event.type) {
    case "charge.success":
      await handleChargeSuccess(event);
      return;
    case "charge.failed":
      await handleChargeFailed(event);
      return;
    case "transfer.completed":
      await markPayoutCompletedByRef(event.reference);
      await markWithdrawalCompletedByRef(event.reference);
      return;
    case "transfer.failed":
      await markPayoutFailedByRef(event.reference, event.reason);
      await markWithdrawalFailedByRef(event.reference, event.reason);
      return;
    case "refund.completed":
      await markRefundCompletedByRef(event.reference, event.gatewayRefundId);
      return;
    case "refund.failed":
      await markRefundFailedByRef(
        event.reason,
        event.reference,
        event.gatewayRefundId,
      );
      return;
    case "refund.needs_attention":
      await markRefundNeedsAttentionByRef(
        event.reason,
        event.reference,
        event.gatewayRefundId,
      );
      return;
  }
}

async function handleChargeSuccess(
  event: Extract<NormalizedEvent, { type: "charge.success" }>,
): Promise<void> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.reference, event.reference),
  });
  if (!tx) return;
  if (tx.status === "success") return;

  // Flutterwave funds land in our balance and must be promoted to the merchant.
  // Split gateways (Paystack) settle straight to the merchant subaccount, so we
  // only record the transaction and never touch a wallet balance.
  const holdsFunds = tx.gateway !== "paystack";

  await db.transaction(async (trx) => {
    const updateRes = await trx
      .update(transactions)
      .set({
        status: "success",
        paidAt: event.paidAt,
        gatewayId: event.gatewayId,
        updatedAt: new Date(),
        ...(holdsFunds
          ? {
              // Normalized events report gateway fees in minor units;
              // transactions are stored in naira.
              gatewayFee: toMajor(event.gatewayFee, event.currency),
              totalCharged:
                tx.totalCharged -
                tx.gatewayFee +
                toMajor(event.gatewayFee, event.currency),
            }
          : { settledAt: event.paidAt }),
      })
      .where(
        and(
          eq(transactions.id, tx.id),
          eq(transactions.status, "pending"),
        ),
      )
      .returning({ id: transactions.id });
    if (updateRes.length === 0) return;

    if (holdsFunds) {
      await trx
        .update(merchants)
        .set({
          walletBalanceNgn: sql`${merchants.walletBalanceNgn} + ${tx.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(merchants.id, tx.merchantId));
    }
  });

  await recordAudit({
    actorUid: null,
    action: "transaction.success",
    entityType: "transaction",
    entityId: tx.id,
    metadata: {
      reference: event.reference,
      gateway: tx.gateway,
      gateway_id: event.gatewayId,
      amount: tx.amount,
      gateway_fee: toMajor(event.gatewayFee, event.currency),
      currency: tx.currency,
      settled_direct: !holdsFunds,
    },
  });

  await sendReceiptEmail({
    reference: tx.reference,
    transactionId: tx.id,
    collectionId: tx.collectionId,
  });
}

async function handleChargeFailed(
  event: Extract<NormalizedEvent, { type: "charge.failed" }>,
): Promise<void> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.reference, event.reference),
  });
  if (!tx) return;
  if (tx.status === "success" || tx.status === "failed") return;

  await db
    .update(transactions)
    .set({
      status: "failed",
      gatewayId: event.gatewayId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transactions.id, tx.id),
        eq(transactions.status, "pending"),
      ),
    );

  await recordAudit({
    actorUid: null,
    action: "transaction.failed",
    entityType: "transaction",
    entityId: tx.id,
    metadata: { reference: event.reference, reason: event.reason },
  });
}

/**
 * Records a payment that reconciliation confirmed with the gateway. Goes through
 * the same handler as a webhook, so it is idempotent and updates the same rows.
 */
export async function applyVerifiedCharge(args: {
  reference: string;
  gatewayId: string;
  amountPaidMinor: number;
  gatewayFeeMinor: number;
  currency: string;
  paidAt: Date;
}): Promise<void> {
  await handleChargeSuccess({
    type: "charge.success",
    gatewayId: args.gatewayId,
    reference: args.reference,
    amountPaid: args.amountPaidMinor,
    gatewayFee: args.gatewayFeeMinor,
    currency: args.currency,
    paidAt: args.paidAt,
    raw: null,
  });
}