import * as dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} must be a number, got: ${value}`);
  }
  return n;
}

/**
 * Normalises a URL env var. Hosting dashboards make it easy to paste a bare
 * host ("collect.paga.com"); fetch then fails at request time with "Failed to
 * parse URL". Add https:// when the scheme is missing, drop trailing slashes,
 * and refuse to boot if the value still isn't a URL. Empty stays empty when
 * the fallback is empty (for "derive it" settings like PAGA_CALLBACK_URL).
 */
export function normaliseUrl(name: string, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  if (withScheme !== value) {
    console.warn(`[ENV] ${name} has no scheme; using ${withScheme}. Set it with https:// to silence this.`);
  }
  try {
    new URL(withScheme);
  } catch {
    throw new Error(`Env var ${name} must be a URL, got: ${raw}`);
  }
  return withScheme.replace(/\/+$/, "");
}

function optionalUrl(name: string, fallback: string): string {
  return normaliseUrl(name, optional(name, fallback));
}

/** Reads a credential, trimming whitespace and one pair of wrapping quotes. */
function secretValue(name: string): string {
  const value = (process.env[name] ?? "").trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return (quoted ? quoted[2] : value).trim();
}

/**
 * Ports need stricter handling than optionalInt: some shells export PORT=0,
 * which makes the server bind to a random ephemeral port while clients keep
 * calling the documented one. Treat 0/out-of-range as "unset".
 */
function optionalPort(name: string, fallback: number): number {
  const n = optionalInt(name, fallback);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(
      `[ENV] Ignoring invalid ${name}=${process.env[name]} — using ${fallback}.`,
    );
    return fallback;
  }
  return n;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: optionalUrl("BETTER_AUTH_URL", "http://localhost:3001"),
  // Browsers enforce CORS for the dashboard -> API hop. Defaults cover local
  // development (:5173 dashboard, :3000 landing) and the deployed dashboard;
  // extend with any additional origin rather than removing these.
  ALLOWED_ORIGINS: optional(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://app-jeneviv.onrender.com,https://app-jeneviv.up.railway.app",
  ),
  // Google sign-in is optional: email + password still works without it.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // 3001 is the port the dashboard's API client and docs use by default.
  PORT: optionalPort("PORT", 3001),

  PLATFORM_FEE_NGN: optionalInt("PLATFORM_FEE_NGN", 75),
  DEFAULT_GATEWAY: optional("DEFAULT_GATEWAY", "flutterwave"),

  FLUTTERWAVE_CLIENT_ID: process.env.FLUTTERWAVE_CLIENT_ID ?? "",
  FLUTTERWAVE_CLIENT_SECRET: process.env.FLUTTERWAVE_CLIENT_SECRET ?? "",
  FLUTTERWAVE_BASE_URL: optionalUrl(
    "FLUTTERWAVE_BASE_URL",
    "https://f4bexperience.flutterwave.com",
  ),
  FLUTTERWAVE_IDP_URL: optionalUrl(
    "FLUTTERWAVE_IDP_URL",
    "https://idp.flutterwave.com",
  ),
  FLUTTERWAVE_WEBHOOK_SECRET: process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? "",
  FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE: optional(
    "FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE",
    "090772",
  ),
  FLUTTERWAVE_VIRTUAL_ACCOUNT_EXPIRY_SECONDS: optionalInt(
    "FLUTTERWAVE_VIRTUAL_ACCOUNT_EXPIRY_SECONDS",
    1200,
  ),

  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? "",
  PAYSTACK_BASE_URL: optionalUrl("PAYSTACK_BASE_URL", "https://api.paystack.co"),

  // Identity + escrow providers. They are optional so the existing gateway
  // keeps working, but KYC and two-man withdrawals switch on once configured.
  VERIPINE_API_KEY: process.env.VERIPINE_API_KEY ?? "",
  VERIPINE_BASE_URL: optionalUrl("VERIPINE_BASE_URL", "https://veripine.com"),

  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY ?? "",
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY ?? "",
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE ?? "",
  MONNIFY_WALLET_ACCOUNT_NUMBER: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER ?? "",
  MONNIFY_BASE_URL: optionalUrl("MONNIFY_BASE_URL", "https://api.monnify.com"),

  TERMII_API_KEY: process.env.TERMII_API_KEY ?? "",
  TERMII_SENDER_ID: optional("TERMII_SENDER_ID", "Jeneviv"),
  TERMII_BASE_URL: optionalUrl("TERMII_BASE_URL", "https://api.ng.termii.com"),

  // Public dashboard origin used to build treasurer approval links.
  APP_PUBLIC_URL: optionalUrl("APP_PUBLIC_URL", "http://localhost:5173"),
  // Local/dev escape hatch: lets the suite exercise provider flows without
  // live Veripine/Paystack/Monnify keys. Never enable in production.
  ALLOW_PROVIDER_MOCKS: optional("ALLOW_PROVIDER_MOCKS", "false") === "true",
  KYC_MOCK_LEGAL_NAME: optional("KYC_MOCK_LEGAL_NAME", "Test Merchant"),
  KYC_MOCK_ACCOUNT_NAME: optional("KYC_MOCK_ACCOUNT_NAME", "Test Merchant"),
  VIRTUAL_ACCOUNT_EXPIRY_SECONDS: optionalInt(
    "VIRTUAL_ACCOUNT_EXPIRY_SECONDS",
    1200,
  ),

  CLOUDINARY_CLOUD_NAME: (process.env.CLOUDINARY_CLOUD_NAME ?? "").trim(),
  CLOUDINARY_API_KEY: (process.env.CLOUDINARY_API_KEY ?? "").trim(),
  CLOUDINARY_API_SECRET: (process.env.CLOUDINARY_API_SECRET ?? "").trim(),

  // Paga Collect API. Public/secret keys authenticate the request; the hash key
  // signs it. Sandbox lives on beta-collect.paga.com.
  // Trimmed (and stripped of wrapping quotes): a stray newline or quote from
  // a hosting dashboard paste breaks Basic auth with "invalid username or password".
  PAGA_PUBLIC_KEY: secretValue("PAGA_PUBLIC_KEY"),
  PAGA_SECRET_KEY: secretValue("PAGA_SECRET_KEY"),
  PAGA_HASH_KEY: secretValue("PAGA_HASH_KEY"),
  PAGA_BASE_URL: optionalUrl("PAGA_BASE_URL", "https://collect.paga.com"),
  // Shown to payers on their bank's name enquiry for Paga transfer accounts.
  PAGA_PAYEE_NAME: optional("PAGA_PAYEE_NAME", "Jeneviv").trim(),
  // Where Paga posts payment-request notifications. Defaults to this API.
  PAGA_CALLBACK_URL: optionalUrl("PAGA_CALLBACK_URL", ""),

  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? "",

  CRON_SECRET: process.env.CRON_SECRET ?? "",
  AUTO_PAYOUT_MIN_NGN_MAJOR: optionalInt("AUTO_PAYOUT_MIN_NGN_MAJOR", 1000),
} as const;