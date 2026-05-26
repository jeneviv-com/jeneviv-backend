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

export function verifyFlutterwaveSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const secret = env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = pickHeader(headers, "flutterwave-signature");
  if (!provided) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface FwV4ChargeData {
  id?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  reference?: string;
  created_datetime?: string | number;
  processor_response?: { code?: string; type?: string; message?: string };
  payment_method?: { id?: string; type?: string };
}

interface FwV4TransferData {
  id?: string;
  reference?: string;
  status?: string;
  complete_message?: string;
  failure_reason?: string;
}

interface FwV4Envelope {
  id?: string;
  type?: string;
  timestamp?: number;
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
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

const SUCCESS_STATUSES = new Set(["succeeded", "successful", "success", "completed"]);

export function parseFlutterwaveEvent(payload: unknown): NormalizedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as FwV4Envelope;
  const eventType = (envelope.type ?? "").toString();
  const data = envelope.data;
  if (!data || typeof data !== "object") return null;

  if (eventType.startsWith("charge.")) {
    const d = data as FwV4ChargeData;
    const reference = asString(d.reference);
    const gatewayId = asString(d.id);
    if (!reference || !gatewayId) return null;

    const status = (d.status ?? "").toLowerCase();
    if (SUCCESS_STATUSES.has(status)) {
      const amountPaid = asNumber(d.amount) ?? 0;
      const currency = asString(d.currency) ?? "NGN";
      const paidAt = parseTimestamp(d.created_datetime);
      return {
        type: "charge.success",
        gatewayId,
        reference,
        amountPaid,
        gatewayFee: 0,
        currency,
        paidAt,
        raw: payload,
      };
    }
    const reason =
      asString(d.processor_response?.message) ??
      asString(d.processor_response?.type) ??
      status ??
      "failed";
    return {
      type: "charge.failed",
      gatewayId,
      reference,
      reason,
      raw: payload,
    };
  }

  if (eventType.startsWith("transfer.")) {
    const d = data as FwV4TransferData;
    const reference = asString(d.reference);
    const gatewayId = asString(d.id);
    if (!reference || !gatewayId) return null;
    const status = (d.status ?? "").toLowerCase();
    if (SUCCESS_STATUSES.has(status)) {
      return { type: "transfer.completed", gatewayId, reference, raw: payload };
    }
    return {
      type: "transfer.failed",
      gatewayId,
      reference,
      reason:
        asString(d.failure_reason) ?? asString(d.complete_message) ?? status ?? "failed",
      raw: payload,
    };
  }

  if (eventType.startsWith("refund.")) {
    const d = data as FwV4TransferData;
    const reference = asString(d.reference);
    const gatewayId = asString(d.id);
    if (!reference || !gatewayId) return null;
    const status = (d.status ?? "").toLowerCase();
    if (SUCCESS_STATUSES.has(status)) {
      return { type: "refund.completed", gatewayId, reference, raw: payload };
    }
    return {
      type: "refund.failed",
      gatewayId,
      reference,
      reason:
        asString(d.failure_reason) ?? asString(d.complete_message) ?? status ?? "failed",
      raw: payload,
    };
  }

  return null;
}

export function getWebhookEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as FwV4Envelope;
  return asString(envelope.id) ?? null;
}

export function getWebhookEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as FwV4Envelope;
  return asString(envelope.type) ?? null;
}
