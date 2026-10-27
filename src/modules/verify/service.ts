import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  collectionGroups,
  collections,
} from "../../db/schema/collections.js";
import { merchants } from "../../db/schema/merchants.js";
import {
  transactionFields,
  transactions,
  type Transaction,
} from "../../db/schema/transactions.js";
import { env } from "../../env.js";
import { renderReceiptPdf } from "../../lib/receipt-pdf.js";
import { HttpError } from "../../middleware/error.js";

export interface PublicReceipt {
  reference: string;
  school_name: string;
  logo_url: string | null;
  student_name: string;
  collection_name: string;
  payer_name: string;
  amount: number;
  currency: string;
  paid_at: string;
  nin_verified: boolean;
  bank_verified: boolean;
  verify_url: string;
  receipt_url: string;
  details: Array<{ label: string; value: string }>;
}

function verifyUrl(reference: string): string {
  return `${env.APP_PUBLIC_URL.replace(/\/+$/, "")}/verify/${encodeURIComponent(reference)}`;
}

async function loadReceipt(reference: string): Promise<{
  tx: Transaction;
  receipt: PublicReceipt;
}> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.reference, reference),
  });
  if (!tx || tx.status !== "success") {
    throw new HttpError(404, "receipt_not_found", "No verified receipt was found for that reference.");
  }

  const [merchant, collection, fields] = await Promise.all([
    db.query.merchants.findFirst({ where: eq(merchants.id, tx.merchantId) }),
    db.query.collections.findFirst({ where: eq(collections.id, tx.collectionId) }),
    db.query.transactionFields.findMany({
      where: eq(transactionFields.transactionId, tx.id),
      orderBy: asc(transactionFields.fieldId),
    }),
  ]);
  if (!merchant) {
    throw new HttpError(404, "receipt_not_found", "Receipt is unavailable");
  }

  const payer = await db.query.users.findFirst({
    where: (u, { eq: eqf }) => eqf(u.id, tx.customerId),
  });

  // A grouped collection is issued under its group: that is whose name and logo
  // the payer recognises, so the receipt carries them instead of the merchant's.
  const group = collection?.groupId
    ? ((await db.query.collectionGroups.findFirst({
        where: eq(collectionGroups.id, collection.groupId),
      })) ?? null)
    : null;

  const studentField =
    fields.find((f) => /student|pupil|child|ward/i.test(`${f.fieldId} ${f.displayName}`)) ??
    fields.find((f) => /payer|full.?name|^name$/i.test(f.fieldId)) ??
    fields.find((f) => /name/i.test(f.displayName));

  const details = fields
    .filter((f) => f.id !== studentField?.id)
    .slice(0, 6)
    .map((f) => ({ label: f.displayName, value: f.value }));

  const receipt: PublicReceipt = {
    reference: tx.reference,
    school_name: group?.name ?? merchant.displayName ?? merchant.merchantCode,
    logo_url: group?.logoUrl ?? merchant.logoUrl,
    student_name: studentField?.value ?? payer?.name ?? "Student",
    collection_name: collection?.name ?? "Payment",
    payer_name: payer?.name ?? "Payer",
    amount: tx.amount,
    currency: tx.currency,
    paid_at: (tx.paidAt ?? tx.createdAt).toISOString(),
    nin_verified: Boolean(merchant.ninVerifiedAt),
    bank_verified: Boolean(merchant.bankVerifiedAt),
    verify_url: verifyUrl(tx.reference),
    receipt_url: `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/api/verify/${encodeURIComponent(tx.reference)}/receipt.pdf`,
    details: [
      { label: "Collection", value: collection?.name ?? "Payment" },
      ...(group
        ? [
            {
              label: "Workspace",
              value: merchant.displayName ?? merchant.merchantCode,
            },
          ]
        : []),
      ...details,
    ],
  };

  return { tx, receipt };
}

export async function getPublicReceipt(reference: string): Promise<PublicReceipt> {
  return (await loadReceipt(reference)).receipt;
}

export async function renderPublicReceiptPdf(
  reference: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { receipt } = await loadReceipt(reference);
  const bytes = await renderReceiptPdf({
    reference: receipt.reference,
    schoolName: receipt.school_name,
    logoUrl: receipt.logo_url,
    studentName: receipt.student_name,
    collectionName: receipt.collection_name,
    payerName: receipt.payer_name,
    amount: receipt.amount,
    currency: receipt.currency,
    paidAt: new Date(receipt.paid_at),
    ninVerified: receipt.nin_verified,
    bankVerified: receipt.bank_verified,
    verifyUrl: receipt.verify_url,
    details: receipt.details.filter((d) => d.label !== "Collection"),
  });
  return {
    bytes,
    filename: `receipt-${receipt.reference}.pdf`,
  };
}

export async function getReceiptForMerchant(
  merchantId: string,
  transactionId: string,
): Promise<PublicReceipt> {
  const tx = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, transactionId),
      eq(transactions.merchantId, merchantId),
    ),
  });
  if (!tx) throw new HttpError(404, "not_found", "Transaction not found");
  return getPublicReceipt(tx.reference);
}