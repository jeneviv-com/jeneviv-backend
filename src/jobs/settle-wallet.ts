import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { merchants } from "../db/schema/merchants.js";
import { transactions } from "../db/schema/transactions.js";
import { recordAudit } from "../lib/audit.js";
import { directSettlementActive } from "../modules/payouts/service.js";

export interface SettleWalletResult {
  settled: number;
  total_amount_ngn: number;
}

export async function runSettleWallet(): Promise<SettleWalletResult> {
  // Direct-settlement gateways (Paystack) never credit a wallet balance.
  if (directSettlementActive()) return { settled: 0, total_amount_ngn: 0 };

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const eligible = await db
    .select({
      id: transactions.id,
      merchantId: transactions.merchantId,
      amount: transactions.amount,
      currency: transactions.currency,
    })
    .from(transactions)
    .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        eq(transactions.status, "success"),
        isNull(transactions.settledAt),
        lt(transactions.paidAt, cutoff),
        eq(merchants.escrowEnabled, false),
      ),
    )
    .orderBy(asc(transactions.paidAt), asc(transactions.createdAt));

  const promotable = eligible;
  if (promotable.length === 0) return { settled: 0, total_amount_ngn: 0 };

  const now = new Date();
  let totalNgn = 0;
  let settled = 0;

  await db.transaction(async (tx) => {
    for (const row of promotable) {
      if (row.currency !== "NGN") continue;

      const debited = await tx
        .update(merchants)
        .set({
          walletBalanceNgn: sql`${merchants.walletBalanceNgn} - ${row.amount}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(merchants.id, row.merchantId),
            gte(merchants.walletBalanceNgn, row.amount),
          ),
        )
        .returning({ id: merchants.id });
      if (debited.length === 0) continue;

      const updated = await tx
        .update(transactions)
        .set({ settledAt: now, updatedAt: now })
        .where(
          and(
            eq(transactions.id, row.id),
            eq(transactions.status, "success"),
            isNull(transactions.settledAt),
          ),
        )
        .returning({ id: transactions.id });

      if (updated.length === 0) {
        await tx
          .update(merchants)
          .set({
            walletBalanceNgn: sql`${merchants.walletBalanceNgn} + ${row.amount}`,
            updatedAt: now,
          })
          .where(eq(merchants.id, row.merchantId));
        continue;
      }

      await tx
        .update(merchants)
        .set({
          payoutsBalanceNgn: sql`${merchants.payoutsBalanceNgn} + ${row.amount}`,
          updatedAt: now,
        })
        .where(eq(merchants.id, row.merchantId));

      totalNgn += row.amount;
      settled += 1;
    }
  });

  if (totalNgn > 0) {
    await recordAudit({
      actorUid: null,
      action: "job.settle_wallet",
      entityType: "system",
      entityId: "settle-wallet",
      metadata: { settled_count: settled, total_amount_ngn: totalNgn },
    });
  }

  return { settled, total_amount_ngn: totalNgn };
}
