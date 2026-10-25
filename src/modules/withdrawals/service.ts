import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { User } from "../../db/schema/auth.js";
import { merchantBankAccounts, merchants, type Merchant } from "../../db/schema/merchants.js";
import type { WithdrawalStatus } from "../../db/schema/enums.js";
import type { Withdrawal } from "../../db/schema/withdrawals.js";
import { withdrawals } from "../../db/schema/withdrawals.js";
import { env } from "../../env.js";
import { monnifyAdapter } from "../../gateways/monnify/adapter.js";
import { monnifyConfigured } from "../../gateways/monnify/client.js";
import { getDefaultGateway } from "../../gateways/registry.js";
import { GatewayError } from "../../gateways/types.js";
import { recordAudit } from "../../lib/audit.js";
import { newOpaqueToken, newOtp, hashSecret, secretMatches } from "../../lib/secrets.js";
import { newId } from "../../lib/short-code.js";
import { sendSms } from "../../lib/sms.js";
import { HttpError } from "../../middleware/error.js";
import type { CreateWithdrawalInput } from "./schemas.js";

const APPROVAL_TTL_MS = 30 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const APPROVAL_SCOPE = "withdrawal-approval";
const OTP_SCOPE = "withdrawal-otp";

interface WithdrawalApproval {
  role: "rep" | "treasurer" | "system";
  label: string;
  at: string;
  detail?: string;
}

export interface WithdrawalView {
  id: string;
  merchant_id: string;
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  source: "escrow" | "payouts";
  treasurer_name: string;
  treasurer_phone: string;
  requested_at: string;
  treasurer_approved_at: string | null;
  rejected_at: string | null;
  gateway: string | null;
  gateway_ref: string | null;
  gateway_tx_id: string | null;
  failure_reason: string | null;
  otp_expires_at: string;
  approvals: WithdrawalApproval[];
  audit: Array<{
    action: string;
    role: WithdrawalApproval["role"];
    label: string;
    at: string;
    detail?: string;
  }>;
}

function approvalUrl(token: string): string {
  return `${env.APP_PUBLIC_URL.replace(/\/+$/, "")}/approve/${token}`;
}

function scope(merchantId: string): string {
  return `merchant:${merchantId}`;
}

function serialize(
  row: Withdrawal,
  repName: string,
): WithdrawalView {
  const approvals: WithdrawalApproval[] = [
    {
      role: "rep",
      label: repName || "Rep",
      at: row.requestedAt.toISOString(),
      detail: "Sweep requested",
    },
  ];
  if (row.treasurerApprovedAt) {
    approvals.push({
      role: "treasurer",
      label: row.treasurerName,
      at: row.treasurerApprovedAt.toISOString(),
      detail: "OTP approved",
    });
  }
  return {
    id: row.id,
    merchant_id: row.merchantId,
    amount: row.amount,
    currency: row.currency,
    status: row.status as WithdrawalStatus,
    source: row.source as "escrow" | "payouts",
    treasurer_name: row.treasurerName,
    treasurer_phone: row.treasurerPhone,
    requested_at: row.requestedAt.toISOString(),
    treasurer_approved_at: row.treasurerApprovedAt?.toISOString() ?? null,
    rejected_at: row.rejectedAt?.toISOString() ?? null,
    gateway: row.gateway,
    gateway_ref: row.gatewayRef,
    gateway_tx_id: row.gatewayTxId,
    failure_reason: row.failureReason,
    otp_expires_at: row.otpExpiresAt.toISOString(),
    approvals,
    audit: approvals.map((entry) => ({
      action: entry.role === "rep" ? "withdrawal.requested" : "withdrawal.approved",
      role: entry.role,
      label: entry.label,
      at: entry.at,
      detail: entry.detail,
    })),
  };
}

async function repNameFor(userId: string | null): Promise<string> {
  if (!userId) return "Rep";
  const user = await db.query.users.findFirst({
    where: (u, { eq: eqf }) => eqf(u.id, userId),
  });
  return user?.name ?? "Rep";
}

export async function createWithdrawal(
  merchant: Merchant,
  user: User,
  input: CreateWithdrawalInput,
): Promise<{ withdrawal: WithdrawalView; approval_link?: string; dev_otp?: string }> {
  if (!merchant.canWithdraw) {
    throw new HttpError(
      403,
      "kyc_incomplete",
      "Withdrawals unlock after your NIN and settlement bank account are verified.",
    );
  }
  if (!merchant.treasurerName || !merchant.treasurerPhone) {
    throw new HttpError(
      422,
      "treasurer_required",
      "Add a treasurer before sweeping funds.",
    );
  }

  const source: "escrow" | "payouts" = merchant.escrowEnabled ? "escrow" : "payouts";
  const available =
    source === "escrow" ? merchant.walletBalanceNgn : merchant.payoutsBalanceNgn;
  if (input.currency !== "NGN") {
    throw new HttpError(422, "unsupported_currency", "Only NGN sweeps are supported");
  }
  if (input.amount > available) {
    throw new HttpError(
      422,
      "insufficient_balance",
      `Only ${(available / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" })} is available to sweep.`,
    );
  }

  const pending = await db.query.withdrawals.findFirst({
    where: and(
      eq(withdrawals.merchantId, merchant.id),
      eq(withdrawals.status, "pending_treasurer"),
    ),
  });
  if (pending) {
    throw new HttpError(
      409,
      "withdrawal_pending",
      "A sweep is already waiting for treasurer approval.",
      { withdrawal_id: pending.id },
    );
  }

  const id = newId();
  const token = newOpaqueToken();
  const otp = newOtp();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
  const link = approvalUrl(token);

  const [created] = await db
    .insert(withdrawals)
    .values({
      id,
      merchantId: merchant.id,
      amount: input.amount,
      currency: "NGN",
      source,
      status: "pending_treasurer",
      requestedByUid: user.id,
      requestedAt: now,
      treasurerName: merchant.treasurerName,
      treasurerPhone: merchant.treasurerPhone,
      approvalTokenHash: hashSecret(token, APPROVAL_SCOPE),
      otpHash: hashSecret(otp, `${OTP_SCOPE}:${id}`),
      otpExpiresAt: expiresAt,
    })
    .returning();

  if (!created) {
    throw new HttpError(500, "internal_error", "Could not create the sweep request");
  }

  const sms = await sendSms(
    merchant.treasurerPhone,
    `${merchant.displayName ?? "Jeneviv"} sweep of NGN ${(input.amount / 100).toLocaleString("en-NG")} needs your approval. ${link} Code: ${otp}`,
  );
  if (!sms.delivered) {
    await db.delete(withdrawals).where(eq(withdrawals.id, id));
    throw new HttpError(
      503,
      "sms_unavailable",
      sms.error ?? "Could not send the treasurer approval message.",
    );
  }

  await recordAudit({
    actorUid: user.id,
    action: "withdrawal.requested",
    entityType: "withdrawal",
    entityId: id,
    metadata: {
      merchant_id: merchant.id,
      amount: input.amount,
      source,
      treasurer_name: merchant.treasurerName,
      treasurer_phone_last4: merchant.treasurerPhone.slice(-4),
    },
  });

  return {
    withdrawal: serialize(created, user.name),
    ...(env.ALLOW_PROVIDER_MOCKS ? { approval_link: link, dev_otp: otp } : {}),
  };
}

export async function listWithdrawals(
  merchant: Merchant,
  limit: number,
): Promise<WithdrawalView[]> {
  const rows = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.merchantId, merchant.id))
    .orderBy(desc(withdrawals.createdAt))
    .limit(limit);

  const repNames = new Map<string, string>();
  for (const row of rows) {
    if (row.requestedByUid && !repNames.has(row.requestedByUid)) {
      repNames.set(row.requestedByUid, await repNameFor(row.requestedByUid));
    }
  }
  return rows.map((row) =>
    serialize(row, repNames.get(row.requestedByUid ?? "") ?? "Rep"),
  );
}

export async function getWithdrawal(
  merchant: Merchant,
  id: string,
): Promise<WithdrawalView> {
  const row = await db.query.withdrawals.findFirst({
    where: and(eq(withdrawals.id, id), eq(withdrawals.merchantId, merchant.id)),
  });
  if (!row) throw new HttpError(404, "not_found", "Withdrawal not found");
  return serialize(row, await repNameFor(row.requestedByUid));
}

async function findByToken(token: string): Promise<Withdrawal> {
  const row = await db.query.withdrawals.findFirst({
    where: eq(withdrawals.approvalTokenHash, hashSecret(token, APPROVAL_SCOPE)),
  });
  if (!row) {
    throw new HttpError(404, "not_found", "This approval link is invalid");
  }
  return row;
}

export interface ApprovalSummary {
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  school_name: string;
  treasurer_name: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  expired: boolean;
}

export async function getApprovalSummary(
  token: string,
): Promise<ApprovalSummary> {
  const row = await findByToken(token);
  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, row.merchantId),
  });
  if (!merchant) throw new HttpError(404, "not_found", "Workspace not found");

  if (row.status === "pending_treasurer" && row.otpExpiresAt.getTime() < Date.now()) {
    await db
      .update(withdrawals)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(withdrawals.id, row.id), eq(withdrawals.status, "pending_treasurer")));
    row.status = "expired";
  }

  return {
    amount: row.amount,
    currency: row.currency,
    status: row.status as WithdrawalStatus,
    school_name: merchant.displayName ?? merchant.merchantCode,
    treasurer_name: row.treasurerName,
    requested_by: await repNameFor(row.requestedByUid),
    requested_at: row.requestedAt.toISOString(),
    expires_at: row.otpExpiresAt.toISOString(),
    expired: row.otpExpiresAt.getTime() < Date.now(),
  };
}

interface DisbursementResult {
  gateway: "monnify" | string;
  gatewayTxId: string;
  status: "success" | "pending" | "failed";
}

async function disburse(
  merchant: Merchant,
  row: Withdrawal,
  reference: string,
): Promise<DisbursementResult> {
  if (!merchant.defaultBankAccountId) {
    throw new HttpError(
      422,
      "bank_account_required",
      "No verified settlement account is on file.",
    );
  }
  const bank = await db.query.merchantBankAccounts.findFirst({
    where: and(
      eq(merchantBankAccounts.id, merchant.defaultBankAccountId),
      eq(merchantBankAccounts.merchantId, merchant.id),
    ),
  });
  if (!bank) {
    throw new HttpError(422, "bank_account_required", "Settlement account not found");
  }

  if (monnifyConfigured()) {
    const result = await monnifyAdapter.initiateTransfer({
      reference,
      amount: row.amount,
      currency: row.currency,
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      narration: bank.accountName,
      accountName: bank.accountName,
    });
    return {
      gateway: "monnify",
      gatewayTxId: result.gatewayTxId,
      status: result.status,
    };
  }

  if (env.ALLOW_PROVIDER_MOCKS) {
    return {
      gateway: "mock",
      gatewayTxId: `mock_${reference}`,
      status: "success",
    };
  }

  const gateway = getDefaultGateway();
  if (!gateway.initiateTransfer) {
    throw new HttpError(
      503,
      "disbursement_unavailable",
      "No disbursement provider is configured. Set MONNIFY_API_KEY and MONNIFY_SECRET_KEY.",
    );
  }
  const result = await gateway.initiateTransfer({
    reference,
    amount: row.amount,
    currency: row.currency,
    bankCode: bank.bankCode,
    accountNumber: bank.accountNumber,
    narration: bank.accountName,
  });
  return {
    gateway: gateway.name,
    gatewayTxId: result.gatewayTxId,
    status: result.status,
  };
}

async function debit(
  merchantId: string,
  source: "escrow" | "payouts",
  amount: number,
): Promise<boolean> {
  const column =
    source === "escrow" ? merchants.walletBalanceNgn : merchants.payoutsBalanceNgn;
  const updated = await db
    .update(merchants)
    .set({
      ...(source === "escrow"
        ? { walletBalanceNgn: sql`${merchants.walletBalanceNgn} - ${amount}` }
        : { payoutsBalanceNgn: sql`${merchants.payoutsBalanceNgn} - ${amount}` }),
      updatedAt: new Date(),
    })
    .where(and(eq(merchants.id, merchantId), gte(column, amount)))
    .returning({ id: merchants.id });
  return updated.length > 0;
}

async function credit(
  merchantId: string,
  source: "escrow" | "payouts",
  amount: number,
): Promise<void> {
  await db
    .update(merchants)
    .set({
      ...(source === "escrow"
        ? { walletBalanceNgn: sql`${merchants.walletBalanceNgn} + ${amount}` }
        : { payoutsBalanceNgn: sql`${merchants.payoutsBalanceNgn} + ${amount}` }),
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId));
}

export async function approveWithdrawal(
  token: string,
  otp: string,
): Promise<{ withdrawal: WithdrawalView }> {
  const row = await findByToken(token);
  if (row.status !== "pending_treasurer") {
    throw new HttpError(409, "not_pending", `This request is already ${row.status.replace(/_/g, " ")}.`);
  }
  if (row.otpExpiresAt.getTime() < Date.now()) {
    await db
      .update(withdrawals)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(withdrawals.id, row.id));
    throw new HttpError(410, "approval_expired", "This approval link has expired.");
  }
  if (row.otpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new HttpError(429, "too_many_attempts", "Too many incorrect codes. Ask the rep to start a new sweep.");
  }

  if (!secretMatches(row.otpHash, otp, `${OTP_SCOPE}:${row.id}`)) {
    await db
      .update(withdrawals)
      .set({ otpAttempts: row.otpAttempts + 1, updatedAt: new Date() })
      .where(eq(withdrawals.id, row.id));
    throw new HttpError(422, "invalid_otp", "That code is not correct.");
  }

  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, row.merchantId),
  });
  if (!merchant) throw new HttpError(404, "not_found", "Workspace not found");

  const reference = `wdr_${newOpaqueToken().slice(0, 24)}`;
  const now = new Date();
  const claimed = await db
    .update(withdrawals)
    .set({
      status: "processing",
      treasurerApprovedAt: now,
      gateway: monnifyConfigured() ? "monnify" : env.ALLOW_PROVIDER_MOCKS ? "mock" : getDefaultGateway().name,
      gatewayRef: reference,
      updatedAt: now,
    })
    .where(and(eq(withdrawals.id, row.id), eq(withdrawals.status, "pending_treasurer")))
    .returning();
  if (claimed.length === 0) {
    throw new HttpError(409, "not_pending", "This request was already approved.");
  }

  const debited = await debit(merchant.id, row.source as "escrow" | "payouts", row.amount);
  if (!debited) {
    await db
      .update(withdrawals)
      .set({
        status: "failed",
        failureReason: "Insufficient balance at approval time",
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, row.id));
    throw new HttpError(422, "insufficient_balance", "The balance is no longer sufficient.");
  }

  await recordAudit({
    actorUid: null,
    action: "withdrawal.approved",
    entityType: "withdrawal",
    entityId: row.id,
    metadata: {
      merchant_id: merchant.id,
      amount: row.amount,
      treasurer_name: row.treasurerName,
      treasurer_phone_last4: row.treasurerPhone.slice(-4),
      approved_at: now.toISOString(),
    },
  });

  try {
    const result = await disburse(merchant, row, reference);
    const status: WithdrawalStatus =
      result.status === "success"
        ? "success"
        : result.status === "failed"
          ? "failed"
          : "processing";

    const [updated] = await db
      .update(withdrawals)
      .set({
        status,
        gateway: result.gateway,
        gatewayTxId: result.gatewayTxId,
        failureReason: status === "failed" ? "The provider rejected the transfer" : null,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, row.id))
      .returning();

    if (status === "failed") {
      await credit(merchant.id, row.source as "escrow" | "payouts", row.amount);
    }

    await recordAudit({
      actorUid: null,
      action: status === "failed" ? "withdrawal.failed" : "withdrawal.disbursed",
      entityType: "withdrawal",
      entityId: row.id,
      metadata: {
        merchant_id: merchant.id,
        amount: row.amount,
        gateway: result.gateway,
        gateway_tx_id: result.gatewayTxId,
        provider_status: result.status,
      },
    });

    return {
      withdrawal: serialize(updated ?? { ...row, status }, await repNameFor(row.requestedByUid)),
    };
  } catch (err) {
    const message =
      err instanceof GatewayError
        ? err.message
        : err instanceof HttpError
          ? err.message
          : "The disbursement provider failed";
    await credit(merchant.id, row.source as "escrow" | "payouts", row.amount);
    await db
      .update(withdrawals)
      .set({
        status: "failed",
        failureReason: message,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, row.id));
    await recordAudit({
      actorUid: null,
      action: "withdrawal.failed",
      entityType: "withdrawal",
      entityId: row.id,
      metadata: { merchant_id: merchant.id, amount: row.amount, reason: message },
    });
    throw new HttpError(
      502,
      "disbursement_failed",
      `The sweep could not be sent: ${message}`,
    );
  }
}

export async function rejectWithdrawal(
  token: string,
  reason?: string,
): Promise<{ withdrawal: WithdrawalView }> {
  const row = await findByToken(token);
  if (row.status !== "pending_treasurer") {
    throw new HttpError(409, "not_pending", `This request is already ${row.status.replace(/_/g, " ")}.`);
  }
  const now = new Date();
  const [updated] = await db
    .update(withdrawals)
    .set({
      status: "rejected",
      rejectedAt: now,
      failureReason: reason ?? null,
      updatedAt: now,
    })
    .where(and(eq(withdrawals.id, row.id), eq(withdrawals.status, "pending_treasurer")))
    .returning();

  await recordAudit({
    actorUid: null,
    action: "withdrawal.rejected",
    entityType: "withdrawal",
    entityId: row.id,
    metadata: {
      merchant_id: row.merchantId,
      amount: row.amount,
      treasurer_name: row.treasurerName,
      reason: reason ?? null,
    },
  });

  return {
    withdrawal: serialize(updated ?? { ...row, status: "rejected" }, await repNameFor(row.requestedByUid)),
  };
}

/**
 * Webhook reconciliation. Monnify reports final transfer status asynchronously
 * when the transfer was not synchronous, so the local request must follow.
 */
export async function markWithdrawalCompletedByRef(
  reference: string,
): Promise<void> {
  const row = await db.query.withdrawals.findFirst({
    where: eq(withdrawals.gatewayRef, reference),
  });
  if (!row || row.status === "success") return;
  await db
    .update(withdrawals)
    .set({ status: "success", updatedAt: new Date() })
    .where(and(eq(withdrawals.id, row.id), inArray(withdrawals.status, ["processing"])));
  await recordAudit({
    actorUid: null,
    action: "withdrawal.disbursed",
    entityType: "withdrawal",
    entityId: row.id,
    metadata: { source: "webhook", gateway_ref: reference, amount: row.amount },
  });
}

export async function markWithdrawalFailedByRef(
  reference: string,
  reason: string,
): Promise<void> {
  const row = await db.query.withdrawals.findFirst({
    where: eq(withdrawals.gatewayRef, reference),
  });
  if (!row || row.status === "failed" || row.status === "success") return;
  await db
    .update(withdrawals)
    .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
    .where(and(eq(withdrawals.id, row.id), inArray(withdrawals.status, ["processing"])));
  await credit(row.merchantId, row.source as "escrow" | "payouts", row.amount);
  await recordAudit({
    actorUid: null,
    action: "withdrawal.failed",
    entityType: "withdrawal",
    entityId: row.id,
    metadata: { source: "webhook", gateway_ref: reference, amount: row.amount, reason },
  });
}
