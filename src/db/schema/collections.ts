import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { users } from "./auth.js";
import type { CollectionFieldType } from "./enums.js";
import { merchants } from "./merchants.js";

export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    shortCode: text("short_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    coverImageUrl: text("cover_image_url"),
    isActive: boolean("is_active").notNull().default(true),
    reconciliationEnabled: boolean("reconciliation_enabled")
      .notNull()
      .default(false),
    reconciliationLabel: text("reconciliation_label"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("collections_short_code_unique").on(table.shortCode)],
);

export const collectionFields = pgTable(
  "collection_fields",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    displayName: text("display_name").notNull(),
    fieldId: text("field_id").notNull(),
    type: text("type").$type<CollectionFieldType>().notNull(),
    required: boolean("required").notNull().default(true),
    options: jsonb("options").$type<string[] | null>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("collection_fields_collection_field_unique").on(
      table.collectionId,
      table.fieldId,
    ),
  ],
);

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").references(() => merchants.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templateFields = pgTable("template_fields", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => templates.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  displayName: text("display_name").notNull(),
  fieldId: text("field_id").notNull(),
  type: text("type").$type<CollectionFieldType>().notNull(),
  required: boolean("required").notNull().default(true),
  options: jsonb("options").$type<string[] | null>(),
});

export const customerFields = pgTable(
  "customer_fields",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull(),
    displayName: text("display_name").notNull(),
    type: text("type").$type<CollectionFieldType>().notNull(),
    value: text("value").notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_fields_user_field_unique").on(
      table.userId,
      table.fieldId,
    ),
  ],
);

export const insertCollectionSchema = createInsertSchema(collections);
export const selectCollectionSchema = createSelectSchema(collections);
export const insertCollectionFieldSchema = createInsertSchema(collectionFields);
export const selectCollectionFieldSchema = createSelectSchema(collectionFields);
export const insertTemplateSchema = createInsertSchema(templates);
export const selectTemplateSchema = createSelectSchema(templates);
export const insertTemplateFieldSchema = createInsertSchema(templateFields);
export const selectTemplateFieldSchema = createSelectSchema(templateFields);
export const insertCustomerFieldSchema = createInsertSchema(customerFields);
export const selectCustomerFieldSchema = createSelectSchema(customerFields);

export type NewCollection = z.infer<typeof insertCollectionSchema>;
export type Collection = z.infer<typeof selectCollectionSchema>;
export type NewCollectionField = z.infer<typeof insertCollectionFieldSchema>;
export type CollectionField = z.infer<typeof selectCollectionFieldSchema>;
export type NewTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = z.infer<typeof selectTemplateSchema>;
export type NewTemplateField = z.infer<typeof insertTemplateFieldSchema>;
export type TemplateField = z.infer<typeof selectTemplateFieldSchema>;
export type NewCustomerField = z.infer<typeof insertCustomerFieldSchema>;
export type CustomerField = z.infer<typeof selectCustomerFieldSchema>;
