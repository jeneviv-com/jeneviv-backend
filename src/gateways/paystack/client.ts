import { env } from "../../env.js";
import { GatewayError } from "../types.js";

export interface PsRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface PsResponse<T> {
  status: number;
  data: T;
}

function buildUrl(path: string, query?: PsRequestOptions["query"]): string {
  const base = env.PAYSTACK_BASE_URL.replace(/\/+$/, "");
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

export async function psRequest<T>(opts: PsRequestOptions): Promise<PsResponse<T>> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new GatewayError("paystack", "PAYSTACK_SECRET_KEY must be set");
  }

  const url = buildUrl(opts.path, opts.query);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
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

  // Paystack signals logical failures with HTTP non-2xx OR `status: false`.
  const envelope =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  const logicalFailure = envelope?.status === false;

  if (!response.ok || logicalFailure) {
    const message =
      (typeof envelope?.message === "string" && envelope.message) ||
      `Paystack ${opts.method ?? "GET"} ${opts.path} failed: ${response.status}`;
    throw new GatewayError("paystack", message, {
      status: response.ok ? 400 : response.status,
      raw: parsed ?? raw,
    });
  }

  return { status: response.status, data: parsed as T };
}
