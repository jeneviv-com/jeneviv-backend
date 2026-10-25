import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { users } from "./auth.js";
import type { WithdrawalStatus } from "./enums.js";
import { merchants } from "./merchants.js";
import { payouts } from "./payouts.js";

/**
 * A sweep is requested by the workspace rep and stays frozen until the
 * treasurer approves it with the OTP sent to their phone. Only then is the
 * gateway disbursement attempted.
 */
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    source: text("source").$type<"escrow" | "payouts">().notNull().default("escrow"),
    status: text("status")
      .$type<WithdrawalStatus>()
      .notNull()
      .default("pending_treasurer"),
    requestedByUid: text("requested_by_uid").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    treasurerName: text("treasurer_name").notNull(),
    treasurerPhone: text("treasurer_phone").notNull(),
    approvalTokenHash: text("approval_token_hash").notNull(),
    otpHash: text("otp_hash").notNull(),
    otpExpiresAt: timestamp("otp_expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    treasurerApprovedAt: timestamp("treasurer_approved_at", {
      mode: "date",
      withTimezone: true,
    }),
    rejectedAt: timestamp("rejected_at", { mode: "date", withTimezone: true }),
    gateway: text("gateway"),
    gatewayRef: text("gateway_ref"),
    gatewayTxId: text("gateway_tx_id"),
    payoutId: text("payout_id").references(() => payouts.id, {
      onDelete: "set null",
    }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("withdrawals_approval_token_hash_unique").on(
      table.approvalTokenHash,
    ),
    uniqueIndex("withdrawals_gateway_ref_unique").on(table.gatewayRef),
  ],
);

export const insertWithdrawalSchema = createInsertSchema(withdrawals);
export const selectWithdrawalSchema = createSelectSchema(withdrawals);

export type NewWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = z.infer<typeof selectWithdrawalSchema>;
