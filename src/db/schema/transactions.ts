import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { users } from "./auth.js";
import { collections } from "./collections.js";
import type { GatewayName, TransactionStatus } from "./enums.js";
import { merchants } from "./merchants.js";

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<TransactionStatus>()
      .notNull()
      .default("pending"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    platformFee: bigint("platform_fee", { mode: "number" }).notNull(),
    gatewayFee: bigint("gateway_fee", { mode: "number" }).notNull().default(0),
    totalCharged: bigint("total_charged", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    gateway: text("gateway").$type<GatewayName>().notNull(),
    gatewayRef: text("gateway_ref"),
    gatewayId: text("gateway_id"),
    paymentAccountId: text("payment_account_id"),
    paidAt: timestamp("paid_at", { mode: "date", withTimezone: true }),
    settledAt: timestamp("settled_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("transactions_reference_unique").on(table.reference)],
);

export const transactionFields = pgTable("transaction_fields", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  fieldId: text("field_id").notNull(),
  displayName: text("display_name").notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentAccounts = pgTable("payment_accounts", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  forUserId: text("for_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  gateway: text("gateway").$type<GatewayName>().notNull(),
  gatewayAccountId: text("gateway_account_id").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),
  currency: text("currency").notNull(),
  expiryAt: timestamp("expiry_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions);
export const selectTransactionSchema = createSelectSchema(transactions);
export const insertTransactionFieldSchema = createInsertSchema(
  transactionFields,
);
export const selectTransactionFieldSchema = createSelectSchema(
  transactionFields,
);
export const insertPaymentAccountSchema = createInsertSchema(paymentAccounts);
export const selectPaymentAccountSchema = createSelectSchema(paymentAccounts);

export type NewTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = z.infer<typeof selectTransactionSchema>;
export type NewTransactionField = z.infer<typeof insertTransactionFieldSchema>;
export type TransactionField = z.infer<typeof selectTransactionFieldSchema>;
export type NewPaymentAccount = z.infer<typeof insertPaymentAccountSchema>;
export type PaymentAccount = z.infer<typeof selectPaymentAccountSchema>;
