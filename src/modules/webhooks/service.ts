import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { merchants } from "../../db/schema/merchants.js";
import { webhookEvents } from "../../db/schema/platform.js";
import { transactions } from "../../db/schema/transactions.js";
import {
  getWebhookEventId,
  getWebhookEventType,
} from "../../gateways/flutterwave/webhook.js";
import { getGateway } from "../../gateways/registry.js";
import type { NormalizedEvent } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { newId } from "../../lib/short-code.js";
import {
  markPayoutCompletedByRef,
  markPayoutFailedByRef,
} from "../payouts/service.js";
import {
  markRefundCompletedByRef,
  markRefundFailedByRef,
} from "../refunds/service.js";

export interface IngestResult {
  status: "ok" | "duplicate" | "ignored" | "invalid";
  message?: string;
}

export async function ingestFlutterwaveWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ result: IngestResult; httpStatus: number }> {
  const gateway = getGateway("flutterwave");

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

  const eventId = getWebhookEventId(payload);
  const eventType = getWebhookEventType(payload) ?? "unknown";
  if (!eventId) {
    return {
      result: { status: "invalid", message: "Missing event id" },
      httpStatus: 400,
    };
  }

  const existing = await db.query.webhookEvents.findFirst({
    where: (e, { and: andf, eq: eqf }) =>
      andf(eqf(e.gateway, "flutterwave"), eqf(e.eventId, eventId)),
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
    gateway: "flutterwave",
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
      return;
    case "transfer.failed":
      await markPayoutFailedByRef(event.reference, event.reason);
      return;
    case "refund.completed":
      await markRefundCompletedByRef(event.reference);
      return;
    case "refund.failed":
      await markRefundFailedByRef(event.reference, event.reason);
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

  await db.transaction(async (trx) => {
    const updateRes = await trx
      .update(transactions)
      .set({
        status: "success",
        paidAt: event.paidAt,
        gatewayId: event.gatewayId,
        gatewayFee: event.gatewayFee,
        totalCharged: tx.totalCharged - tx.gatewayFee + event.gatewayFee,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id))
      .returning({ id: transactions.id });
    if (updateRes.length === 0) return;

    await trx
      .update(merchants)
      .set({
        walletBalanceNgn: sql`${merchants.walletBalanceNgn} + ${tx.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, tx.merchantId));
  });

  await recordAudit({
    actorUid: null,
    action: "transaction.success",
    entityType: "transaction",
    entityId: tx.id,
    metadata: {
      reference: event.reference,
      gateway_id: event.gatewayId,
      amount: tx.amount,
      gateway_fee: event.gatewayFee,
      currency: tx.currency,
    },
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
    .where(eq(transactions.id, tx.id));

  await recordAudit({
    actorUid: null,
    action: "transaction.failed",
    entityType: "transaction",
    entityId: tx.id,
    metadata: { reference: event.reference, reason: event.reason },
  });
}
