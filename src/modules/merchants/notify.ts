import { and, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import { collections } from "../../db/schema/collections.js";
import type { EmailNotificationPeriod } from "../../db/schema/enums.js";
import { merchants } from "../../db/schema/merchants.js";
import { transactions } from "../../db/schema/transactions.js";
import { sendEmail } from "../../lib/email.js";
import { env } from "../../env.js";

/** How long each batched period lasts. `immediate` is handled at payment time. */
export const PERIOD_MS: Record<Exclude<EmailNotificationPeriod, "immediate">, number> = {
  hourly: 60 * 60 * 1000,
  "6hourly": 6 * 60 * 60 * 1000,
  "12hourly": 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

async function ownerEmail(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const owner = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return owner?.email?.trim() || null;
}

function money(amount: number, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tells the workspace owner about one confirmed payment, when they asked for
 * immediate emails. Batched periods are left to the notification-batcher job.
 * Never throws: a failed email must not undo or block a confirmed payment.
 */
export async function notifyMerchantOfPayment(transactionId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        reference: transactions.reference,
        amount: transactions.amount,
        currency: transactions.currency,
        collectionName: collections.name,
        merchantUserId: merchants.userId,
        displayName: merchants.displayName,
        enabled: merchants.emailNotificationForTransactions,
        period: merchants.emailNotificationPeriod,
      })
      .from(transactions)
      .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
      .innerJoin(collections, eq(collections.id, transactions.collectionId))
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!row || !row.enabled || row.period !== "immediate") return;
    const to = await ownerEmail(row.merchantUserId);
    if (!to) return;

    await sendEmail({
      to,
      subject: `Payment received — ${money(row.amount, row.currency)} for ${row.collectionName}`,
      html: `
        <p>A payment into <strong>${escapeHtml(row.collectionName)}</strong> has been confirmed.</p>
        <p>Amount: <strong>${escapeHtml(money(row.amount, row.currency))}</strong><br/>
        Reference: <strong>${escapeHtml(row.reference)}</strong></p>
        <p><a href="${env.APP_PUBLIC_URL}/transactions">View it in your dashboard</a></p>
        <p style="color:#777;font-size:12px">You get these because payment emails are on for
        ${escapeHtml(row.displayName ?? "your workspace")}. Change it in Settings → Notifications.</p>
      `,
    });
  } catch (err) {
    console.error(`[merchant-notify] payment email for ${transactionId} failed:`, err);
  }
}

export interface DigestRunResult {
  flushed: number;
  skipped: number;
  failed: number;
}

/**
 * Sends one summary email per workspace whose batched period has elapsed,
 * covering every successful payment since its previous digest. A workspace
 * with nothing new still has its clock advanced, so the next digest covers
 * exactly one period.
 */
export async function flushPaymentDigests(now = new Date()): Promise<DigestRunResult> {
  const result: DigestRunResult = { flushed: 0, skipped: 0, failed: 0 };

  const due = await db
    .select({
      id: merchants.id,
      userId: merchants.userId,
      displayName: merchants.displayName,
      period: merchants.emailNotificationPeriod,
      last: merchants.lastNotificationDigestAt,
    })
    .from(merchants)
    .where(
      and(
        eq(merchants.emailNotificationForTransactions, true),
        ne(merchants.emailNotificationPeriod, "immediate"),
        inArray(merchants.status, ["approved", "pending"]),
      ),
    );

  for (const merchant of due) {
    const periodMs = PERIOD_MS[merchant.period as keyof typeof PERIOD_MS];
    if (!periodMs) continue;
    const since = merchant.last ?? new Date(now.getTime() - periodMs);
    if (merchant.last && now.getTime() - merchant.last.getTime() < periodMs) {
      result.skipped += 1;
      continue;
    }

    try {
      const paid = await db
        .select({
          amount: transactions.amount,
          currency: transactions.currency,
          collectionName: collections.name,
        })
        .from(transactions)
        .innerJoin(collections, eq(collections.id, transactions.collectionId))
        .where(
          and(
            eq(transactions.merchantId, merchant.id),
            eq(transactions.status, "success"),
            gt(transactions.paidAt, since),
            lte(transactions.paidAt, now),
          ),
        );

      const to = paid.length > 0 ? await ownerEmail(merchant.userId) : null;
      if (to) {
        const byCollection = new Map<string, { count: number; total: number; currency: string }>();
        for (const tx of paid) {
          const entry = byCollection.get(tx.collectionName) ?? { count: 0, total: 0, currency: tx.currency };
          entry.count += 1;
          entry.total += Number(tx.amount);
          byCollection.set(tx.collectionName, entry);
        }
        const total = paid.reduce((sum, tx) => sum + Number(tx.amount), 0);
        const currency = paid[0]!.currency;
        const rows = [...byCollection.entries()]
          .map(
            ([name, entry]) =>
              `<tr><td style="padding:4px 12px 4px 0">${escapeHtml(name)}</td><td style="padding:4px 12px 4px 0">${entry.count}</td><td style="padding:4px 0">${escapeHtml(money(entry.total, entry.currency))}</td></tr>`,
          )
          .join("");

        await sendEmail({
          to,
          subject: `${paid.length} payment${paid.length === 1 ? "" : "s"} received — ${money(total, currency)}`,
          html: `
            <p>Here is what came in for <strong>${escapeHtml(merchant.displayName ?? "your workspace")}</strong>
            since ${since.toUTCString()}.</p>
            <table style="border-collapse:collapse;font-size:14px">
              <tr><th align="left">Collection</th><th align="left">Payments</th><th align="left">Total</th></tr>
              ${rows}
            </table>
            <p><a href="${env.APP_PUBLIC_URL}/transactions">Open your dashboard</a></p>
          `,
        });
        result.flushed += 1;
      }

      await db
        .update(merchants)
        .set({ lastNotificationDigestAt: now })
        .where(eq(merchants.id, merchant.id));
    } catch (err) {
      result.failed += 1;
      console.error(`[merchant-notify] digest for ${merchant.id} failed:`, err);
    }
  }

  return result;
}
