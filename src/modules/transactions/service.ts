import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import { merchants } from "../../db/schema/merchants.js";
import {
  paymentAccounts,
  transactionFields,
  transactions,
  type PaymentAccount,
  type Transaction,
  type TransactionField,
} from "../../db/schema/transactions.js";
import { HttpError } from "../../middleware/error.js";

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
