import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { users } from "./auth.js";
import {
  MONEY_PRECISION,
  type EmailNotificationPeriod,
  type KycStatus,
  type MerchantStatus,
  type PayoutMode,
} from "./enums.js";

export const merchants = pgTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantCode: text("merchant_code").notNull(),
    displayName: text("display_name"),
    status: text("status")
      .$type<MerchantStatus>()
      .notNull()
      .default("pending"),
    walletBalanceNgn: numeric("wallet_balance_ngn", MONEY_PRECISION)
      .notNull()
      .default(0),
    payoutsBalanceNgn: numeric("payouts_balance_ngn", MONEY_PRECISION)
      .notNull()
      .default(0),
    payoutMode: text("payout_mode")
      .$type<PayoutMode>()
      .notNull()
      .default("manual"),
    defaultBankAccountId: text("default_bank_account_id"),
    emailNotificationForTransactions: boolean(
      "email_notification_for_transactions",
    )
      .notNull()
      .default(true),
    emailNotificationPeriod: text("email_notification_period")
      .$type<EmailNotificationPeriod>()
      .notNull()
      .default("immediate"),
    applicationNote: text("application_note"),
    adminReviewNote: text("admin_review_note"),
    reviewedByUid: text("reviewed_by_uid").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
    gatewayCustomerIds: jsonb("gateway_customer_ids")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    gatewaySubaccountIds: jsonb("gateway_subaccount_ids")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // Progressive KYC: collecting is open from day one, withdrawals unlock only
    // after the NIN owner and the settlement bank account names match.
    kycStatus: text("kyc_status")
      .$type<KycStatus>()
      .notNull()
      .default("unverified"),
    canCollect: boolean("can_collect").notNull().default(true),
    canWithdraw: boolean("can_withdraw").notNull().default(false),
    ninHash: text("nin_hash"),
    ninLast4: text("nin_last4"),
    kycLegalName: text("kyc_legal_name"),
    kycProviderRef: text("kyc_provider_ref"),
    ninVerifiedAt: timestamp("nin_verified_at", {
      mode: "date",
      withTimezone: true,
    }),
    bankVerifiedAt: timestamp("bank_verified_at", {
      mode: "date",
      withTimezone: true,
    }),
    logoUrl: text("logo_url"),
    treasurerName: text("treasurer_name"),
    treasurerPhone: text("treasurer_phone"),
    escrowEnabled: boolean("escrow_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("merchants_user_id_unique").on(table.userId),
    uniqueIndex("merchants_merchant_code_unique").on(table.merchantCode),
  ],
);

export const merchantBankAccounts = pgTable("merchant_bank_accounts", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  bankCode: text("bank_code").notNull(),
  currency: text("currency").notNull().default("NGN"),
  isDefault: boolean("is_default").notNull().default(false),
  verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertMerchantSchema = createInsertSchema(merchants);
export const selectMerchantSchema = createSelectSchema(merchants);
export const insertMerchantBankAccountSchema = createInsertSchema(
  merchantBankAccounts,
);
export const selectMerchantBankAccountSchema = createSelectSchema(
  merchantBankAccounts,
);

export type NewMerchant = z.infer<typeof insertMerchantSchema>;
export type Merchant = z.infer<typeof selectMerchantSchema>;
export type NewMerchantBankAccount = z.infer<
  typeof insertMerchantBankAccountSchema
>;
export type MerchantBankAccount = z.infer<
  typeof selectMerchantBankAccountSchema
>;