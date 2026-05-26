import { env } from "../../env.js";
import { GatewayError } from "../types.js";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_REFRESH_SAFETY_MS = 30_000;

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  if (!env.FLUTTERWAVE_CLIENT_ID || !env.FLUTTERWAVE_CLIENT_SECRET) {
    throw new GatewayError(
      "flutterwave",
      "FLUTTERWAVE_CLIENT_ID and FLUTTERWAVE_CLIENT_SECRET must be set",
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.FLUTTERWAVE_CLIENT_ID,
    client_secret: env.FLUTTERWAVE_CLIENT_SECRET,
  });

  const url = `${env.FLUTTERWAVE_IDP_URL}/realms/flutterwave/protocol/openid-connect/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GatewayError(
      "flutterwave",
      `OAuth token request failed: ${response.status}`,
      { status: response.status, raw: text },
    );
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new GatewayError("flutterwave", "OAuth response missing access_token", {
      raw: data,
    });
  }

  const expiresInMs = Math.max(0, (data.expires_in ?? 0) * 1000);
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - TOKEN_REFRESH_SAFETY_MS > Date.now()) {
    return cached.token;
  }
  if (inflight) return inflight;

  inflight = fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface FwRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FwResponse<T> {
  status: number;
  data: T;
}

function buildUrl(path: string, query?: FwRequestOptions["query"]): string {
  const base = env.FLUTTERWAVE_BASE_URL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (!query) return `${base}${suffix}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}${suffix}?${qs}` : `${base}${suffix}`;
}

export async function fwRequest<T>(opts: FwRequestOptions): Promise<FwResponse<T>> {
  const token = await getAccessToken();
  const url = buildUrl(opts.path, opts.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(opts.headers ?? {}),
  };

  let bodyText: string | undefined;
  if (opts.body !== undefined) {
    bodyText = JSON.stringify(opts.body);
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const response = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: bodyText,
  });

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    let message: string | null = null;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.message === "string") message = obj.message;
      else if (
        obj.error &&
        typeof obj.error === "object" &&
        typeof (obj.error as Record<string, unknown>).message === "string"
      ) {
        message = String((obj.error as Record<string, unknown>).message);
      }
    }
    if (!message) {
      message = `Flutterwave ${opts.method ?? "GET"} ${opts.path} failed: ${response.status}`;
    }
    throw new GatewayError("flutterwave", message, {
      status: response.status,
      raw: parsed ?? raw,
    });
  }

  return { status: response.status, data: parsed as T };
}

export function __resetTokenCacheForTests(): void {
  cached = null;
  inflight = null;
}
