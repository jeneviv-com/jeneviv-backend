import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { users } from "./auth.js";
import type { GatewayName } from "./enums.js";

export const bankCodes = pgTable(
  "bank_codes",
  {
    code: text("code").notNull(),
    gateway: text("gateway").$type<GatewayName>().notNull(),
    country: text("country").notNull().default("NG"),
    name: text("name").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "bank_codes_pk",
      columns: [table.code, table.gateway],
    }),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    gateway: text("gateway").$type<GatewayName>().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", {
      mode: "date",
      withTimezone: true,
    }),
    processingError: text("processing_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_gateway_event_unique").on(
      table.gateway,
      table.eventId,
    ),
  ],
);

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  actorUid: text("actor_uid").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertBankCodeSchema = createInsertSchema(bankCodes);
export const selectBankCodeSchema = createSelectSchema(bankCodes);
export const insertWebhookEventSchema = createInsertSchema(webhookEvents);
export const selectWebhookEventSchema = createSelectSchema(webhookEvents);
export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const selectAuditLogSchema = createSelectSchema(auditLogs);

export type NewBankCode = z.infer<typeof insertBankCodeSchema>;
export type BankCode = z.infer<typeof selectBankCodeSchema>;
export type NewWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = z.infer<typeof selectWebhookEventSchema>;
export type NewAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = z.infer<typeof selectAuditLogSchema>;
