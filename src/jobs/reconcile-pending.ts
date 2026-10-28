import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema/transactions.js";
import { getGateway } from "../gateways/registry.js";
import { applyVerifiedCharge } from "../modules/webhooks/service.js";

/** Only look at payments that have been pending for a while, so a live webhook can land first. */
const STALE_AFTER_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;

/**
 * Safety net for missed webhooks. Asks the gateway about old pending payments
 * and records any that it reports as successful. Never moves money itself.
 */
export async function runReconcilePending(): Promise<{
  checked: number;
  settled: number;
  unchanged: number;
  errors: number;
}> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const pending = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.status, "pending"), lt(transactions.createdAt, cutoff)))
    .limit(BATCH_SIZE);

  let settled = 0;
  let unchanged = 0;
  let errors = 0;

  for (const tx of pending) {
    try {
      const gateway = getGateway(tx.gateway);
      if (!gateway.verifyPayment) {
        unchanged += 1;
        continue;
      }
      const verified = await gateway.verifyPayment(tx.reference);
      if (verified?.status === "success") {
        await applyVerifiedCharge({
          reference: tx.reference,
          gatewayId: verified.gatewayId,
          amountPaidMinor: verified.amountPaidMinor,
          gatewayFeeMinor: verified.gatewayFeeMinor,
          currency: verified.currency,
          paidAt: verified.paidAt ?? new Date(),
        });
        settled += 1;
      } else {
        unchanged += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`[reconcile] ${tx.reference} failed:`, err);
    }
  }

  return { checked: pending.length, settled, unchanged, errors };
}
