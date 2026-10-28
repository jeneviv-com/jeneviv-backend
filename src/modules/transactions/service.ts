import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
} from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, type User } from "../../db/schema/auth.js";
import { collections } from "../../db/schema/collections.js";
import type { TransactionStatus } from "../../db/schema/enums.js";
import { merchants, type Merchant } from "../../db/schema/merchants.js";
import {
  paymentAccounts,
  transactionFields,
  transactions,
  type PaymentAccount,
  type Transaction,
  type TransactionField,
} from "../../db/schema/transactions.js";
import { HttpError } from "../../middleware/error.js";
import type { ListCollectionTransactionsQuery } from "./schemas.js";

export interface TransactionView {
  transaction: Transaction;
  fields: TransactionField[];
  payment_account: PaymentAccount | null;
}

export async function getTransactionFor(
  user: User,
  transactionId: string,
): Promise<TransactionView> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
  });
  if (!tx) {
    throw new HttpError(404, "not_found", "Transaction not found");
  }

  let canRead = tx.customerId === user.id;
  if (!canRead && user.role === "admin") {
    canRead = true;
  }
  if (!canRead) {
    const merchant = await db.query.merchants.findFirst({
      where: eq(merchants.userId, user.id),
    });
    if (merchant && merchant.id === tx.merchantId) {
      canRead = true;
    }
  }
  if (!canRead) {
    throw new HttpError(404, "not_found", "Transaction not found");
  }

  const fields = await db.query.transactionFields.findMany({
    where: eq(transactionFields.transactionId, tx.id),
    orderBy: asc(transactionFields.fieldId),
  });

  const account = await db.query.paymentAccounts.findFirst({
    where: eq(paymentAccounts.transactionId, tx.id),
  });

  return { transaction: tx, fields, payment_account: account ?? null };
}

export async function listCollectionTransactionsForMerchant(
  merchant: Merchant,
  collectionId: string,
  query: ListCollectionTransactionsQuery,
): Promise<{ transactions: Transaction[] }> {
  const collection = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!collection) {
    throw new HttpError(404, "not_found", "Collection not found");
  }

  const filters: SQL[] = [
    eq(transactions.collectionId, collectionId),
    eq(transactions.merchantId, merchant.id),
  ];
  if (query.status) filters.push(eq(transactions.status, query.status));
  if (query.settled === true) filters.push(isNotNull(transactions.settledAt));
  if (query.settled === false) filters.push(isNull(transactions.settledAt));

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return { transactions: rows };
}

/**
 * Merchant-wide list across all of the merchant's collections.
 * Used by GET /api/transactions.
 */
export async function listTransactionsForMerchant(
  merchant: Merchant,
  query: {
    status?: TransactionStatus;
    limit: number;
    offset: number;
  },
): Promise<{ transactions: Transaction[] }> {
  const filters: SQL[] = [eq(transactions.merchantId, merchant.id)];
  if (query.status) filters.push(eq(transactions.status, query.status));

  const rows = await db
    .select({
      transaction: transactions,
      payerName: users.name,
      payerEmail: users.email,
      collectionName: collections.name,
    })
    .from(transactions)
    .leftJoin(users, eq(users.id, transactions.customerId))
    .leftJoin(collections, eq(collections.id, transactions.collectionId))
    .where(and(...filters))
    .orderBy(desc(transactions.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  if (rows.length === 0) return { transactions: [] };

  const fields = await db.query.transactionFields.findMany({
    where: inArray(
      transactionFields.transactionId,
      rows.map((row) => row.transaction.id),
    ),
    orderBy: asc(transactionFields.fieldId),
  });
  const fieldsByTransaction = new Map<string, Record<string, string>>();
  for (const field of fields) {
    const values = fieldsByTransaction.get(field.transactionId) ?? {};
    values[field.fieldId] = field.value;
    fieldsByTransaction.set(field.transactionId, values);
  }

  return {
    transactions: rows.map((row) => ({
      ...row.transaction,
      payer_name: row.payerName,
      payer_email: row.payerEmail,
      collection_name: row.collectionName,
      field_values: fieldsByTransaction.get(row.transaction.id) ?? {},
    })),
  };
}

export async function reconcileTransactionsForMerchant(
  merchant: Merchant,
  ids: string[],
  reconciled: boolean,
): Promise<{ transactions: Transaction[] }> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length !== ids.length) {
    throw new HttpError(422, "duplicate_transaction_ids", "Each transaction may be selected only once");
  }

  const ownedRows = await db
    .select({ id: transactions.id, status: transactions.status })
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, uniqueIds),
        eq(transactions.merchantId, merchant.id),
      ),
    );
  const ownedIds = new Set(ownedRows.map((row) => row.id));
  const missing = uniqueIds.filter((id) => !ownedIds.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      404,
      "not_found",
      "One or more transactions not found",
      { missing },
    );
  }

  const unavailable = ownedRows
    .filter((row) => row.status !== "success")
    .map((row) => row.id);
  if (unavailable.length > 0) {
    throw new HttpError(
      409,
      "transaction_not_reconcilable",
      "Only confirmed successful transactions can be reconciled",
      { ids: unavailable },
    );
  }

  const updated = await db
    .update(transactions)
    .set({
      reconciled,
      reconciledAt: reconciled ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(transactions.id, uniqueIds),
        eq(transactions.merchantId, merchant.id),
      ),
    )
    .returning();

  if (updated.length !== uniqueIds.length) {
    const foundIds = new Set(updated.map((t) => t.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    throw new HttpError(
      404,
      "not_found",
      "One or more transactions not found",
      { missing },
    );
  }

  return { transactions: updated };
}
