import { createHash } from "node:crypto";
import { env } from "../../env.js";
import { GatewayError } from "../types.js";

/**
 * Paga signs every request with a plain SHA-512 (not an HMAC) of the request
 * fields concatenated in a fixed order, with the hash key appended last and no
 * separators. The order differs per operation, so callers pass the parts in the
 * order the operation documents and this helper only joins and hashes.
 */
export function pagaHash(
  parts: Array<string | number | undefined | null>,
): string {
  const hashKey = env.PAGA_HASH_KEY;
  if (!hashKey) {
    throw new GatewayError("paga", "PAGA_HASH_KEY must be set");
  }
  const joined = parts
    .map((part) => (part === undefined || part === null ? "" : String(part)))
    .join("");
  return createHash("sha512").update(`${joined}${hashKey}`).digest("hex");
}

export function pagaConfigured(): boolean {
  return Boolean(env.PAGA_PUBLIC_KEY && env.PAGA_SECRET_KEY && env.PAGA_HASH_KEY);
}

export interface PagaRequestOptions {
  /** Path below the Collect base URL, e.g. "/paymentRequest". */
  path: string;
  body: unknown;
  /** Values for the hash header, in the order Paga documents them. */
  hashParts: Array<string | number | undefined | null>;
  /**
   * Status codes that are not exceptions. Paga answers HTTP 200 for business
   * failures too, so callers narrow this to the codes they handle themselves.
   */
  acceptStatusCodes?: string[];
}

export interface PagaResponse<T> {
  status: number;
  data: T;
}

/**
 * Collect API call. Authentication is HTTP Basic with the business public key as
 * the username and the secret key as the password, plus the `hash` header.
 */
export async function pagaRequest<T>(
  opts: PagaRequestOptions,
): Promise<PagaResponse<T>> {
  if (!env.PAGA_PUBLIC_KEY || !env.PAGA_SECRET_KEY) {
    throw new GatewayError(
      "paga",
      "PAGA_PUBLIC_KEY and PAGA_SECRET_KEY must be set",
    );
  }

  const base = env.PAGA_BASE_URL.replace(/\/+$/, "");
  const suffix = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const credentials = Buffer.from(
    `${env.PAGA_PUBLIC_KEY}:${env.PAGA_SECRET_KEY}`,
  ).toString("base64");

  const response = await fetch(`${base}${suffix}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
      hash: pagaHash(opts.hashParts),
    },
    body: JSON.stringify(opts.body),
  });

  const text = await response.text();
  let parsed: unknown;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  const statusCode =
    envelope.statusCode === undefined ? undefined : String(envelope.statusCode);
  const accepted = opts.acceptStatusCodes ?? ["0"];

  if (!response.ok) {
    throw new GatewayError(
      "paga",
      typeof envelope.statusMessage === "string" && envelope.statusMessage
        ? envelope.statusMessage
        : `Paga POST ${opts.path} failed: ${response.status}`,
      { status: response.status, raw: parsed ?? text },
    );
  }

  // Paga returns 200 with a non-zero statusCode when the request was rejected.
  if (statusCode !== undefined && !accepted.includes(statusCode)) {
    throw new GatewayError(
      "paga",
      typeof envelope.statusMessage === "string" && envelope.statusMessage
        ? envelope.statusMessage
        : `Paga rejected the request (status ${statusCode})`,
      { status: response.status, raw: parsed },
    );
  }

  return { status: response.status, data: parsed as T };
}
