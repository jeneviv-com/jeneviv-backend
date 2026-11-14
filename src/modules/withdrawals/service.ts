import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { withdrawals, type Withdrawal } from "../../db/schema/withdrawals.js";
import { recordAudit } from "../../lib/audit.js";

/**
 * Withdrawals are not a user-facing feature yet: there is no way to request or
 * approve one, because escrow is off and the request/approval flow was never
 * implemented. These two helpers stay because the gateway webhooks still need to
 * reconcile a transfer if one ever exists in the table.
 */

/**
 * Marks a withdrawal as completed when the gateway confirms the transfer succeeded.
 * Called by webhook handlers.
 */
export async function markWithdrawalCompletedByRef(
  gatewayRef: string,
): Promise<Withdrawal | null> {
  const withdrawal = await db.query.withdrawals.findFirst({
    where: eq(withdrawals.gatewayRef, gatewayRef),
  });
  if (!withdrawal) return null;
  if (withdrawal.status === "success") return withdrawal;

  const [updated] = await db
    .update(withdrawals)
    .set({ status: "success", updatedAt: new Date() })
    .where(
      and(
        eq(withdrawals.id, withdrawal.id),
        inArray(withdrawals.status, ["processing"]),
      ),
    )
    .returning();

  if (!updated) return withdrawal;

  await recordAudit({
    actorUid: null,
    action: "withdrawal.completed",
    entityType: "withdrawal",
    entityId: withdrawal.id,
    metadata: { gateway_ref: gatewayRef, amount: withdrawal.amount },
  });

  return updated;
}

/**
 * Marks a withdrawal as failed when the gateway reports the transfer failed.
 * Called by webhook handlers.
 */
export async function markWithdrawalFailedByRef(
  gatewayRef: string,
  reason: string,
): Promise<Withdrawal | null> {
  const withdrawal = await db.query.withdrawals.findFirst({
    where: eq(withdrawals.gatewayRef, gatewayRef),
  });
  if (!withdrawal) return null;
  if (withdrawal.status === "failed" || withdrawal.status === "success") {
    return withdrawal;
  }

  const [updated] = await db
    .update(withdrawals)
    .set({
      status: "failed",
      failureReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(withdrawals.id, withdrawal.id),
        inArray(withdrawals.status, ["processing"]),
      ),
    )
    .returning();

  if (!updated) return withdrawal;

  await recordAudit({
    actorUid: null,
    action: "withdrawal.failed",
    entityType: "withdrawal",
    entityId: withdrawal.id,
    metadata: {
      gateway_ref: gatewayRef,
      amount: withdrawal.amount,
      reason,
    },
  });

  return updated;
}
