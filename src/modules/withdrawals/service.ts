import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { withdrawals, type Withdrawal } from "../../db/schema/withdrawals.js";
import { recordAudit } from "../../lib/audit.js";

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

import type { Merchant } from "../../db/schema/merchants.js";
import type { User } from "../../db/schema/auth.js";
import { HttpError } from "../../middleware/error.js";
import type { CreateWithdrawalInput } from "./schemas.js";

/**
 * Creates a new withdrawal request for a merchant.
 * The withdrawal stays pending until the treasurer approves it.
 */
export async function createWithdrawal(
  merchant: Merchant,
  _user: User,
  _input: CreateWithdrawalInput,
): Promise<Withdrawal> {
  if (!merchant.escrowEnabled) {
    throw new HttpError(403, "escrow_disabled", "Escrow withdrawals are not enabled for this workspace");
  }
  throw new HttpError(501, "not_implemented", "Withdrawal creation not yet implemented");
}

/**
 * Gets a withdrawal for a merchant by ID.
 */
export async function getWithdrawal(
  merchant: Merchant,
  withdrawalId: string,
): Promise<Withdrawal> {
  const withdrawal = await db.query.withdrawals.findFirst({
    where: and(
      eq(withdrawals.id, withdrawalId),
      eq(withdrawals.merchantId, merchant.id),
    ),
  });
  
  if (!withdrawal) {
    throw new HttpError(404, "not_found", "Withdrawal not found");
  }
  
  return withdrawal;
}

/**
 * Lists withdrawals for a merchant.
 */
export async function listWithdrawals(
  merchant: Merchant,
  limit: number = 50,
): Promise<Withdrawal[]> {
  return db.query.withdrawals.findMany({
    where: eq(withdrawals.merchantId, merchant.id),
    orderBy: (w, { desc }) => [desc(w.createdAt)],
    limit: Math.min(limit, 100),
  });
}

/**
 * Gets the approval summary for a withdrawal by approval token.
 */
export async function getApprovalSummary(
  _approvalToken: string,
): Promise<{
  id: string;
  merchant_name: string;
  amount: string;
  currency: string;
  source: string;
  treasurer_name: string;
  requested_at: Date;
  status: string;
}> {
  throw new HttpError(501, "not_implemented", "Approval summary not yet implemented");
}

/**
 * Approves a withdrawal with the OTP sent to the treasurer.
 */
export async function approveWithdrawal(
  _approvalToken: string,
  _otp: string,
): Promise<{ success: true; withdrawal_id: string }> {
  throw new HttpError(501, "not_implemented", "Withdrawal approval not yet implemented");
}

/**
 * Rejects a withdrawal request.
 */
export async function rejectWithdrawal(
  approvalToken: string,
  reason?: string,
): Promise<{ success: true }> {
  throw new HttpError(501, "not_implemented", "Withdrawal rejection not yet implemented");
}