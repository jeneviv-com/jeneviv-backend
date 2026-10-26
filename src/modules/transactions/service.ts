import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import { collections } from "../../db/schema/collections.js";
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

  const filters = [
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
    status?: Transaction["status"];
    limit: number;
    offset: number;
  },
): Promise<{ transactions: Transaction[] }> {
  const filters = [eq(transactions.merchantId, merchant.id)];
  if (query.status) filters.push(eq(transactions.status, query.status));

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return { transactions: rows };
}

export async function reconcileTransactionsForMerchant(
  merchant: Merchant,
  ids: string[],
  reconciled: boolean,
): Promise<{ transactions: Transaction[] }> {
  const uniqueIds = Array.from(new Set(ids));

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
