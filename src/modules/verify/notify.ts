import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { collectionFields } from "../../db/schema/collections.js";
import { transactionFields } from "../../db/schema/transactions.js";
import { sendEmail } from "../../lib/email.js";
import { getPublicReceipt, renderPublicReceiptPdf } from "./service.js";

/** The payer's email: the collection's email field, or the one saved from the payment page. */
async function payerEmailFor(transactionId: string, collectionId: string): Promise<string | null> {
  const emailFields = await db
    .select({ fieldId: collectionFields.fieldId })
    .from(collectionFields)
    .where(and(eq(collectionFields.collectionId, collectionId), eq(collectionFields.type, "email")));

  const fieldIds = [...emailFields.map((field) => field.fieldId), "payer_email"];
  const [row] = await db
    .select({ value: transactionFields.value })
    .from(transactionFields)
    .where(
      and(
        eq(transactionFields.transactionId, transactionId),
        inArray(transactionFields.fieldId, fieldIds),
      ),
    )
    .limit(1);
  return row?.value?.trim() || null;
}

/**
 * Emails the receipt, with the PDF attached, once a payment is confirmed.
 * Never throws: a failed email must not undo or block a confirmed payment.
 */
export async function sendReceiptEmail(args: {
  reference: string;
  transactionId: string;
  collectionId: string;
}): Promise<void> {
  try {
    const to = await payerEmailFor(args.transactionId, args.collectionId);
    if (!to) return;

    const receipt = await getPublicReceipt(args.reference);
    const { bytes, filename } = await renderPublicReceiptPdf(args.reference);

    await sendEmail({
      to,
      subject: `Receipt ${receipt.reference} — ${receipt.collection_name}`,
      html: `
        <p>Thank you. Your payment for <strong>${escapeHtml(receipt.collection_name)}</strong> has been received.</p>
        <p>Reference: <strong>${escapeHtml(receipt.reference)}</strong><br/>
        Amount: <strong>${receipt.currency} ${receipt.amount.toLocaleString("en-NG")}</strong></p>
        <p>Your receipt is attached as a PDF. You can also view it at any time:<br/>
        ${escapeHtml(receipt.verify_url)}</p>
      `,
      attachments: [{ filename, content: Buffer.from(bytes).toString("base64") }],
    });
  } catch (err) {
    console.error(`[receipt-email] ${args.reference} failed:`, err);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
