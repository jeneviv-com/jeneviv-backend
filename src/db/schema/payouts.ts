import {
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
  type GatewayName,
  type PayoutInitiator,
  type PayoutStatus,
  type RefundStatus,
} from "./enums.js";
import { merchantBankAccounts, merchants } from "./merchants.js";
import { transactions } from "./transactions.js";

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    bankAccountId: text("bank_account_id")
      .notNull()
      .references(() => merchantBankAccounts.id, { onDelete: "restrict" }),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    bankCode: text("bank_code").notNull(),
    amount: numeric("amount", MONEY_PRECISION).notNull(),
    currency: text("currency").notNull(),
    status: text("status")
      .$type<PayoutStatus>()
      .notNull()
      .default("pending"),
    gateway: text("gateway").$type<GatewayName>().notNull(),
    gatewayTxId: text("gateway_tx_id"),
    gatewayRef: text("gateway_ref").notNull(),
    failureReason: text("failure_reason"),
    initiatedBy: text("initiated_by").$type<PayoutInitiator>().notNull(),
    initiatedByUid: text("initiated_by_uid").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("payouts_gateway_ref_unique").on(table.gatewayRef)],
);

export const refunds = pgTable("refunds", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "restrict" }),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "restrict" }),
  amount: numeric("amount", MONEY_PRECISION).notNull(),
  reason: text("reason"),
  status: text("status").$type<RefundStatus>().notNull().default("pending"),
  gatewayRef: text("gateway_ref"),
  /** Gateway-side id, needed to retry a refund that needs payer bank details. */
  gatewayRefundId: text("gateway_refund_id"),
  failureReason: text("failure_reason"),
  initiatedByUid: text("initiated_by_uid").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPayoutSchema = createInsertSchema(payouts);
export const selectPayoutSchema = createSelectSchema(payouts);
export const insertRefundSchema = createInsertSchema(refunds);
export const selectRefundSchema = createSelectSchema(refunds);

export type NewPayout = z.infer<typeof insertPayoutSchema>;
export type Payout = z.infer<typeof selectPayoutSchema>;
export type NewRefund = z.infer<typeof insertRefundSchema>;
export type Refund = z.infer<typeof selectRefundSchema>;
