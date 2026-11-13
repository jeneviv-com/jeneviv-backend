/**
 * Every money column is naira with two decimal places, because fees are a
 * percentage: a ₦200 collection can legitimately be charged ₦284.27. Integer
 * (bigint) money columns reject those rows at insert time.
 */
export const MONEY_PRECISION: {
  precision: number;
  scale: number;
  mode: "number";
} = { precision: 14, scale: 2, mode: "number" };

export type UserRole = "user" | "admin";
export type UserMethod = "email" | "google";

export type MerchantStatus = "pending" | "approved" | "rejected" | "suspended";
export type PayoutMode = "manual" | "auto_daily" | "auto_weekly";
export type EmailNotificationPeriod =
  | "immediate"
  | "hourly"
  | "6hourly"
  | "12hourly"
  | "daily";

export type CollectionFieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "email"
  | "phone"
  | "select"
  | "multiselect"
  | "image"
  | "file"
  | "date";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "cancelled"
  | "expired";

export type PayoutStatus = "pending" | "processing" | "success" | "failed";
export type PayoutInitiator = "merchant" | "cron";

export type KycStatus = "unverified" | "nin_verified" | "verified" | "rejected";

export type WithdrawalStatus =
  | "pending_treasurer"
  | "rejected"
  | "processing"
  | "success"
  | "failed"
  | "expired";

export type RefundStatus =
  | "pending"
  | "needs_attention"
  | "success"
  | "failed";

/**
 * Roles inside a workspace (the `merchants` table). `owner` is the account that
 * applied and holds settlement; `admin` runs day-to-day but cannot move money
 * to a different bank account; `collector` creates and records collections;
 * `viewer` reads only.
 */
export type WorkspaceRole = "owner" | "admin" | "collector" | "viewer";
export type WorkspaceMemberStatus = "active" | "removed";

export type GatewayName = "flutterwave" | "paystack" | "monnify" | "paga";
