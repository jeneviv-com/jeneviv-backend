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

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: optional("BETTER_AUTH_URL", "http://localhost:3300"),
  GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
  PORT: optionalInt("PORT", 3300),

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

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? "",

  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? "",

  CRON_SECRET: process.env.CRON_SECRET ?? "",
  AUTO_PAYOUT_MIN_NGN_MAJOR: optionalInt("AUTO_PAYOUT_MIN_NGN_MAJOR", 1000),
} as const;
