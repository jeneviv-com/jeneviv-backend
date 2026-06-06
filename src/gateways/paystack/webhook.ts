import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import type { NormalizedEvent } from "../types.js";

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function verifyPaystackSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;
  const provided = pickHeader(headers, "x-paystack-signature");
  if (!provided) return false;

  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface PsChargeData {
  id?: number | string;
  reference?: string;
  amount?: number | string;
  fees?: number | string;
  currency?: string;
  status?: string;
  paid_at?: string;
  paidAt?: string;
  gateway_response?: string;
  message?: string;
}

interface PsRefundData {
  id?: number | string;
  transaction_reference?: string;
  reference?: string;
  status?: string;
  merchant_note?: string;
}

interface PsEnvelope {
  event?: string;
  data?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseTimestamp(v: unknown): Date {
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Paystack amounts are already in minor units (kobo), so events flow through
 * the adapter without further conversion.
 */
export function parsePaystackEvent(payload: unknown): NormalizedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as PsEnvelope;
  const event = (envelope.event ?? "").toString();
  const data = envelope.data;
  if (!data || typeof data !== "object") return null;

  if (event === "charge.success") {
    const d = data as PsChargeData;
    const reference = asString(d.reference);
    const gatewayId = asString(d.id);
    if (!reference || !gatewayId) return null;
    return {
      type: "charge.success",
      gatewayId,
      reference,
      amountPaid: asNumber(d.amount) ?? 0,
      gatewayFee: asNumber(d.fees) ?? 0,
      currency: asString(d.currency) ?? "NGN",
      paidAt: parseTimestamp(d.paid_at ?? d.paidAt),
      raw: payload,
    };
  }

  if (event === "charge.failed") {
    const d = data as PsChargeData;
    const reference = asString(d.reference);
    const gatewayId = asString(d.id) ?? reference;
    if (!reference || !gatewayId) return null;
    return {
      type: "charge.failed",
      gatewayId,
      reference,
      reason:
        asString(d.gateway_response) ??
        asString(d.message) ??
        asString(d.status) ??
        "failed",
      raw: payload,
    };
  }

  if (event.startsWith("refund.")) {
    const d = data as PsRefundData;
    const reference = asString(d.reference) ?? asString(d.transaction_reference);
    const gatewayId = asString(d.id) ?? reference;
    if (!reference || !gatewayId) return null;
    if (event === "refund.processed") {
      return { type: "refund.completed", gatewayId, reference, raw: payload };
    }
    if (event === "refund.failed") {
      return {
        type: "refund.failed",
        gatewayId,
        reference,
        reason: asString(d.merchant_note) ?? asString(d.status) ?? "failed",
        raw: payload,
      };
    }
  }

  return null;
}

/**
 * Paystack does not send a dedicated event id, so we derive an idempotency key
 * from the event type and the resource id (or reference).
 */
export function getPaystackEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as PsEnvelope;
  const event = asString(envelope.event);
  const data = envelope.data;
  if (!event || !data || typeof data !== "object") return null;
  const d = data as { id?: number | string; reference?: string };
  const resourceId = asString(d.id) ?? asString(d.reference);
  if (!resourceId) return null;
  return `${event}:${resourceId}`;
}

export function getPaystackEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as PsEnvelope;
  return asString(envelope.event) ?? null;
}
