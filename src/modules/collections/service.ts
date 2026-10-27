import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  collectionFields,
  collections,
  templateFields,
  templates,
  type Collection,
  type CollectionField,
} from "../../db/schema/collections.js";
import {
  merchantBankAccounts,
  type Merchant,
} from "../../db/schema/merchants.js";
import { transactions } from "../../db/schema/transactions.js";
import { newId, newShortCode } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import type { FieldInput } from "../templates/schemas.js";
import type {
  CreateCollectionInput,
  UpdateCollectionInput,
} from "./schemas.js";

export interface CollectionStats {
  paid: number;
  collected: number;
  pending: number;
  failed: number;
  total: number;
}

export type CollectionWithStats = Collection & { stats: CollectionStats };

const EMPTY_STATS: CollectionStats = {
  paid: 0,
  collected: 0,
  pending: 0,
  failed: 0,
  total: 0,
};

/**
 * Payment counters per collection. The dashboard shows collected totals and a
 * progress bar on every collection card, so it needs the numbers with the list
 * rather than an extra request per collection.
 */
async function loadCollectionStats(
  merchantId: string,
  collectionId?: string,
): Promise<Map<string, CollectionStats>> {
  const rows = await db
    .select({
      collectionId: transactions.collectionId,
      status: transactions.status,
      payments: sql<string | null>`count(*)`,
      volume: sql<string | null>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      collectionId
        ? and(
            eq(transactions.merchantId, merchantId),
            eq(transactions.collectionId, collectionId),
          )
        : eq(transactions.merchantId, merchantId),
    )
    .groupBy(transactions.collectionId, transactions.status);

  const byCollection = new Map<string, CollectionStats>();
  for (const row of rows) {
    const current = byCollection.get(row.collectionId) ?? { ...EMPTY_STATS };
    const payments = Number(row.payments ?? 0);
    current.total += payments;
    if (row.status === "success") {
      current.paid += payments;
      current.collected += Number(row.volume ?? 0);
    } else if (row.status === "pending" || row.status === "processing") {
      current.pending += payments;
    } else if (
      row.status === "failed" ||
      row.status === "cancelled" ||
      row.status === "expired"
    ) {
      current.failed += payments;
    }
    byCollection.set(row.collectionId, current);
  }
  return byCollection;
}

async function generateUniqueShortCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newShortCode();
    const existing = await db.query.collections.findFirst({
      where: eq(collections.shortCode, code),
    });
    if (!existing) return code;
  }
  throw new HttpError(500, "internal_error", "Failed to generate short code");
}

async function ensureTemplateUsable(
  templateId: string,
  merchant: Merchant,
): Promise<void> {
  const template = await db.query.templates.findFirst({
    where: eq(templates.id, templateId),
  });
  if (!template) {
    throw new HttpError(422, "invalid_template", "Template not found");
  }
  if (template.merchantId !== null && template.merchantId !== merchant.id) {
    throw new HttpError(
      403,
      "forbidden",
      "Template belongs to another merchant",
    );
  }
}

async function ensurePayoutSetupComplete(merchant: Merchant): Promise<void> {
  // Collections must have a payout destination before they can take money —
  // for split gateways (Paystack) this bank account is what the settlement
  // subaccount is built from, so without it funds have nowhere to land.
  if (merchant.defaultBankAccountId) {
    const bank = await db.query.merchantBankAccounts.findFirst({
      where: and(
        eq(merchantBankAccounts.id, merchant.defaultBankAccountId),
        eq(merchantBankAccounts.merchantId, merchant.id),
      ),
    });
    if (bank?.verifiedAt) return;
  }
  throw new HttpError(
    422,
    "payout_setup_required",
    "Add a verified bank account before creating a collection",
  );
}

export async function createCollection(
  merchant: Merchant,
  input: CreateCollectionInput,
): Promise<{ collection: Collection; fields: CollectionField[] }> {
  await ensurePayoutSetupComplete(merchant);

  if (input.template_id) {
    await ensureTemplateUsable(input.template_id, merchant);
  }

  const id = newId();
  const shortCode = await generateUniqueShortCode();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(collections)
      .values({
        id,
        merchantId: merchant.id,
        shortCode,
        name: input.name,
        description: input.description ?? null,
        amount: input.amount,
        currency: input.currency,
        coverImageUrl: input.cover_image_url ?? null,
        isActive: input.is_active ?? true,
        reconciliationEnabled: input.reconciliation_enabled ?? false,
        reconciliationLabel: input.reconciliation_label ?? null,
      })
      .returning();

    if (!created) {
      throw new HttpError(500, "internal_error", "Failed to create collection");
    }

    let seededFields: CollectionField[] = [];
    if (input.template_id) {
      const tf = await tx.query.templateFields.findMany({
        where: eq(templateFields.templateId, input.template_id),
        orderBy: [asc(templateFields.position), asc(templateFields.fieldId)],
      });
      if (tf.length > 0) {
        const rows = tf.map((f) => ({
          id: newId(),
          collectionId: id,
          position: f.position,
          displayName: f.displayName,
          fieldId: f.fieldId,
          type: f.type,
          required: f.required,
          options: f.options ?? null,
        }));
        await tx.insert(collectionFields).values(rows);
        seededFields = await tx.query.collectionFields.findMany({
          where: eq(collectionFields.collectionId, id),
          orderBy: [
            asc(collectionFields.position),
            asc(collectionFields.fieldId),
          ],
        });
      }
    }

    return { collection: created, fields: seededFields };
  });
}

export async function listMerchantCollections(
  merchantId: string,
): Promise<CollectionWithStats[]> {
  const rows = await db.query.collections.findMany({
    where: eq(collections.merchantId, merchantId),
    orderBy: desc(collections.createdAt),
  });
  if (rows.length === 0) return [];

  const stats = await loadCollectionStats(merchantId);
  return rows.map((collection) => ({
    ...collection,
    stats: stats.get(collection.id) ?? { ...EMPTY_STATS },
  }));
}

export async function getMerchantCollection(
  merchant: Merchant,
  collectionId: string,
): Promise<{ collection: CollectionWithStats; fields: CollectionField[] }> {
  const collection = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!collection) {
    throw new HttpError(404, "not_found", "Collection not found");
  }
  const [fields, stats] = await Promise.all([
    db.query.collectionFields.findMany({
      where: eq(collectionFields.collectionId, collection.id),
      orderBy: [asc(collectionFields.position), asc(collectionFields.fieldId)],
    }),
    loadCollectionStats(merchant.id, collection.id),
  ]);
  return {
    collection: {
      ...collection,
      stats: stats.get(collection.id) ?? { ...EMPTY_STATS },
    },
    fields,
  };
}

export async function updateCollection(
  merchant: Merchant,
  collectionId: string,
  input: UpdateCollectionInput,
): Promise<Collection> {
  const existing = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!existing) {
    throw new HttpError(404, "not_found", "Collection not found");
  }

  const patch: Partial<typeof collections.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.cover_image_url !== undefined) {
    patch.coverImageUrl = input.cover_image_url;
  }
  if (input.is_active !== undefined) patch.isActive = input.is_active;
  if (input.reconciliation_enabled !== undefined) {
    patch.reconciliationEnabled = input.reconciliation_enabled;
  }
  if (input.reconciliation_label !== undefined) {
    patch.reconciliationLabel = input.reconciliation_label;
  }

  const [updated] = await db
    .update(collections)
    .set(patch)
    .where(eq(collections.id, collectionId))
    .returning();
  if (!updated) {
    throw new HttpError(500, "internal_error", "Failed to update collection");
  }
  return updated;
}

export async function deleteCollection(
  merchant: Merchant,
  collectionId: string,
): Promise<void> {
  const existing = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!existing) {
    throw new HttpError(404, "not_found", "Collection not found");
  }
  await db.delete(collections).where(eq(collections.id, collectionId));
}

export async function replaceCollectionFields(
  merchant: Merchant,
  collectionId: string,
  fields: FieldInput[],
): Promise<CollectionField[]> {
  const existing = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!existing) {
    throw new HttpError(404, "not_found", "Collection not found");
  }

  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.field_id)) {
      throw new HttpError(
        422,
        "duplicate_field_id",
        `Duplicate field_id: ${f.field_id}`,
      );
    }
    seen.add(f.field_id);
  }

  return db.transaction(async (tx) => {
    await tx
      .delete(collectionFields)
      .where(eq(collectionFields.collectionId, collectionId));

    if (fields.length === 0) return [];

    const rows = fields.map((f) => ({
      id: newId(),
      collectionId,
      position: f.position,
      displayName: f.display_name,
      fieldId: f.field_id,
      type: f.type,
      required: f.required,
      options: f.options ?? null,
    }));
    await tx.insert(collectionFields).values(rows);

    return tx.query.collectionFields.findMany({
      where: eq(collectionFields.collectionId, collectionId),
      orderBy: [asc(collectionFields.position), asc(collectionFields.fieldId)],
    });
  });
}

export async function getCollectionByShortCode(
  shortCode: string,
): Promise<{ collection: Collection; fields: CollectionField[] }> {
  const collection = await db.query.collections.findFirst({
    where: eq(collections.shortCode, shortCode),
  });
  if (!collection) {
    throw new HttpError(404, "not_found", "Collection not found");
  }
  // A paused collection still resolves so its payer page can say it is closed
  // (the payer page renders that state). Refusing new payments is the job of
  // initPayment, which rejects inactive collections.
  const fields = await db.query.collectionFields.findMany({
    where: eq(collectionFields.collectionId, collection.id),
    orderBy: [asc(collectionFields.position), asc(collectionFields.fieldId)],
  });
  return { collection, fields };
}
