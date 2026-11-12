import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { toMinor } from "../../lib/money.js";
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

function sha512Hex(value: string): string {
  return createHash("sha512").update(value).digest("hex");
}

function parseBody(rawBody: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads `a.b.c` out of the payload, which is how Paga names hash fields. */
function readField(
  payload: Record<string, unknown>,
  path: string,
): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      payload,
    );
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Paga sends `x-paga-hash` plus `x-paga-hash-parameters`, a comma-separated list
 * of the payload fields that were concatenated (in order) with the hash key and
 * hashed with SHA-512. Older payment-request callbacks instead carry the digest
 * in a body `hash` field, whose field order Paga does not publish, so the known
 * recipes are tried in turn.
 *
 * Money is never moved on the strength of this check alone: the webhook handler
 * re-reads the payment from POST /status before it credits anything.
 */
export function verifyPagaSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const hashKey = env.PAGA_HASH_KEY;
  if (!hashKey) return false;

  const payload = parseBody(rawBody);
  if (!payload) return false;

  const provided = (
    pickHeader(headers, "x-paga-hash") ?? String(payload.hash ?? "")
  )
    .trim()
    .toLowerCase();
  if (!provided) return false;

  const candidates: string[] = [];

  const parametersHeader = pickHeader(headers, "x-paga-hash-parameters");
  if (parametersHeader) {
    const fields = parametersHeader
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const values = fields.map((field) =>
      // Paga lists "hashKey" as the last parameter; it is appended below.
      field.toLowerCase() === "hashkey" ? "" : readField(payload, field),
    );
    candidates.push(values.join(""));
  }

  // Persistent payment account notification: transactionReference + accountNumber + amount.
  if (payload.transactionReference !== undefined) {
    candidates.push(
      `${readField(payload, "transactionReference")}${readField(payload, "accountNumber")}${readField(payload, "amount")}`,
    );
  }

  // Payment request notification: the request identity plus its state.
  const requestReference = readField(payload, "externalReferenceNumber");
  if (requestReference) {
    candidates.push(`${requestReference}${readField(payload, "statusCode")}`);
    candidates.push(
      `${readField(payload, "notificationId")}${requestReference}${readField(payload, "statusCode")}`,
    );
  }

  const given = Buffer.from(provided, "utf8");
  return candidates.some((candidate) => {
    const expected = Buffer.from(sha512Hex(`${candidate}${hashKey}`), "utf8");
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

const FAILED_STATES = new Set(["FAILED", "CANCELLED", "EXPIRED"]);

/**
 * Maps a Paga Collect callback onto the platform's normalized payment events.
 * Only payment-request notifications are handled; persistent payment account
 * notifications belong to a product this integration does not use.
 */
export function parsePagaEvent(payload: unknown): NormalizedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const reference = readField(body, "externalReferenceNumber").trim();
  if (!reference) return null;

  const event = readField(body, "event").toUpperCase();
  const state = readField(body, "state").toUpperCase();
  const currency = readField(body, "currency") || "NGN";
  const gatewayId = readField(body, "notificationId") || reference;

  if (event.includes("REFUND")) {
    if (event.includes("FAIL")) {
      return {
        type: "refund.failed",
        gatewayId,
        reference,
        reason: readField(body, "statusMessage") || event,
        raw: payload,
      };
    }
    return { type: "refund.completed", gatewayId, reference, raw: payload };
  }

  if (event === "PAYMENT_COMPLETE" || state === "CONSUMED") {
    const paid = Number(
      readField(body, "cumulativePaymentAmount") ||
        readField(body, "paymentAmount") ||
        0,
    );
    return {
      type: "charge.success",
      gatewayId,
      reference,
      amountPaid: toMinor(paid, currency),
      gatewayFee: toMinor(Number(readField(body, "collectionFee") || 0), currency),
      currency,
      paidAt: new Date(),
      raw: payload,
    };
  }

  if (event.includes("FAIL") || FAILED_STATES.has(state)) {
    return {
      type: "charge.failed",
      gatewayId,
      reference,
      reason: readField(body, "statusMessage") || state || event || "failed",
      raw: payload,
    };
  }

  return null;
}

export function getPagaEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const notification = readField(body, "notificationId");
  if (notification) return notification;
  const reference = readField(body, "externalReferenceNumber");
  if (!reference) return null;
  return `${reference}:${readField(body, "state") || readField(body, "event")}`;
}

export function getPagaEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  return readField(body, "event") || readField(body, "state") || null;
}
