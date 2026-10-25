import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { GatewayError } from "../types.js";

interface MonnifyEnvelope<T> {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody: T;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function assertConfigured(): void {
  if (!env.MONNIFY_API_KEY || !env.MONNIFY_SECRET_KEY) {
    throw new GatewayError(
      "monnify",
      "MONNIFY_API_KEY and MONNIFY_SECRET_KEY must be set",
    );
  }
}

export function monnifyConfigured(): boolean {
  return Boolean(env.MONNIFY_API_KEY && env.MONNIFY_SECRET_KEY);
}

async function login(): Promise<string> {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(
    `${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`,
  ).toString("base64");
  const response = await fetch(
    new URL("/api/v1/auth/login", env.MONNIFY_BASE_URL),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as MonnifyEnvelope<{
    accessToken?: string;
    expiresIn?: number;
  }>;
  const token = body.responseBody?.accessToken;
  if (!response.ok || !token) {
    throw new GatewayError(
      "monnify",
      body.responseMessage ?? `Monnify login failed (${response.status})`,
      { status: response.status, raw: body },
    );
  }
  const ttl = Number(body.responseBody?.expiresIn ?? 3000);
  cachedToken = {
    value: token,
    expiresAt: Date.now() + Math.max(60, ttl) * 1000,
  };
  return token;
}

export interface MonnifyRequestOptions {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export async function monnifyRequest<T>(
  opts: MonnifyRequestOptions,
): Promise<T> {
  const token = await login();
  const url = new URL(opts.path, env.MONNIFY_BASE_URL);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GatewayError("monnify", "Could not reach Monnify");
  }

  const body = (await response.json().catch(() => ({}))) as MonnifyEnvelope<T>;
  if (!response.ok || body.requestSuccessful === false) {
    throw new GatewayError(
      "monnify",
      body.responseMessage ?? `Monnify request failed (${response.status})`,
      { status: response.status, raw: body },
    );
  }
  return body.responseBody;
}

export function verifyMonnifySignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!env.MONNIFY_SECRET_KEY) return false;
  const header = headers["monnify-signature"];
  const received = Array.isArray(header) ? header[0] : header;
  if (!received) return false;

  const expected = createHmac("sha512", env.MONNIFY_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
