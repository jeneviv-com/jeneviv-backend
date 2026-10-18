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
  BETTER_AUTH_URL: optional("BETTER_AUTH_URL", "http://localhost:3001"),
  // Browsers enforce CORS for the dashboard -> API hop. Defaults cover local
  // development (:5173 dashboard, :3000 landing) and the deployed dashboard;
  // extend with any additional origin rather than removing these.
  ALLOWED_ORIGINS: optional(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://jeneviv.up.railway.app",
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
  FLUTTERWAVE_BASE_URL: optional(
    "FLUTTERWAVE_BASE_URL",
    "https://f4bexperience.flutterwave.com",
  ),
  FLUTTERWAVE_IDP_URL: optional(
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
  PAYSTACK_BASE_URL: optional("PAYSTACK_BASE_URL", "https://api.paystack.co"),
  VIRTUAL_ACCOUNT_EXPIRY_SECONDS: optionalInt(
    "VIRTUAL_ACCOUNT_EXPIRY_SECONDS",
    1200,
  ),

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? "",

  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? "",

  CRON_SECRET: process.env.CRON_SECRET ?? "",
  AUTO_PAYOUT_MIN_NGN_MAJOR: optionalInt("AUTO_PAYOUT_MIN_NGN_MAJOR", 1000),
} as const;
