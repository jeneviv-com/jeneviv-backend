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

export type GatewayName = "flutterwave" | "paystack" | "monnify";
