import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import { collections } from "../../db/schema/collections.js";
import {
  merchantBankAccounts,
  merchants,
  type Merchant,
} from "../../db/schema/merchants.js";
import { auditLogs, type AuditLog } from "../../db/schema/platform.js";
import { payouts } from "../../db/schema/payouts.js";
import { transactions } from "../../db/schema/transactions.js";
import type { MerchantStatus } from "../../db/schema/enums.js";
import { recordAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error.js";
import type {
  ListAuditLogsQuery,
  ListMerchantsQuery,
  ListPlatformTransactionsQuery,
} from "./schemas.js";

export async function listMerchants(
  query: ListMerchantsQuery,
): Promise<Merchant[]> {
  const statusFilter = query.status as MerchantStatus | undefined;
  return db.query.merchants.findMany({
    where: statusFilter ? eq(merchants.status, statusFilter) : undefined,
    orderBy: desc(merchants.createdAt),
    limit: query.limit,
    offset: query.offset,
  });
}

/* ------------------------------------------------------------- reporting */

export interface AdminStats {
  total_merchants: number;
  pending_merchants: number;
  total_transactions: number;
  total_volume: number;
  pending_payouts: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const [byStatus, txTotals, payoutTotals] = await Promise.all([
    db
      .select({
        status: merchants.status,
        count: sql<number>`count(*)::int`,
      })
      .from(merchants)
      .groupBy(merchants.status),
    db
      .select({
        count: sql<number>`count(*)::int`,
        // numeric sums come back as strings; cast so the API emits a number.
        volume: sql<number>`coalesce(sum(${transactions.amount}), 0)::float8`,
      })
      .from(transactions)
      .where(eq(transactions.status, "success")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payouts)
      .where(inArray(payouts.status, ["pending", "processing"])),
  ]);

  const statusCount = (status: MerchantStatus) =>
    byStatus.find((row) => row.status === status)?.count ?? 0;

  return {
    total_merchants: byStatus.reduce((sum, row) => sum + row.count, 0),
    pending_merchants: statusCount("pending"),
    total_transactions: txTotals[0]?.count ?? 0,
    total_volume: Number(txTotals[0]?.volume ?? 0),
    pending_payouts: payoutTotals[0]?.count ?? 0,
  };
}

export interface PlatformTransactionRow {
  id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  created_at: Date;
  collection_name: string | null;
  payer_name: string | null;
  payer_email: string | null;
  merchant_id: string;
}

/**
 * Every workspace's payments, newest first, with the collection and payer a
 * platform admin needs in order to decide on a refund.
 */
export async function listPlatformTransactions(
  query: ListPlatformTransactionsQuery,
): Promise<PlatformTransactionRow[]> {
  const rows = await db
    .select({
      id: transactions.id,
      reference: transactions.reference,
      status: transactions.status,
      amount: transactions.amount,
      currency: transactions.currency,
      created_at: transactions.createdAt,
      collection_name: collections.name,
      payer_name: users.name,
      payer_email: users.email,
      merchant_id: transactions.merchantId,
    })
    .from(transactions)
    .leftJoin(collections, eq(collections.id, transactions.collectionId))
    .leftJoin(users, eq(users.id, transactions.customerId))
    .where(
      and(
        query.status ? eq(transactions.status, query.status) : undefined,
        query.merchant_id
          ? eq(transactions.merchantId, query.merchant_id)
          : undefined,
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return rows;
}

export function listAuditLogs(query: ListAuditLogsQuery): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(
      query.entity_type
        ? eq(auditLogs.entityType, query.entity_type)
        : query.action
          ? eq(auditLogs.action, query.action)
          : undefined,
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit);
}

async function loadMerchant(id: string): Promise<Merchant> {
  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, id),
  });
  if (!merchant) {
    throw new HttpError(404, "not_found", "Merchant not found");
  }
  return merchant;
}

async function transitionStatus(
  adminUid: string,
  merchantId: string,
  nextStatus: MerchantStatus,
  action: string,
  note?: string,
  allowedFrom?: MerchantStatus[],
): Promise<Merchant> {
  const merchant = await loadMerchant(merchantId);
  const currentStatus = merchant.status as MerchantStatus;

  if (allowedFrom && !allowedFrom.includes(currentStatus)) {
    throw new HttpError(
      409,
      "invalid_transition",
      `Cannot ${nextStatus} merchant in status ${currentStatus}`,
    );
  }

  const [updated] = await db
    .update(merchants)
    .set({
      status: nextStatus,
      adminReviewNote: note ?? merchant.adminReviewNote,
      reviewedByUid: adminUid,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId))
    .returning();

  if (!updated) {
    throw new HttpError(500, "internal_error", "Failed to update merchant");
  }

  await recordAudit({
    actorUid: adminUid,
    action,
    entityType: "merchant",
    entityId: merchantId,
    metadata: {
      from: currentStatus,
      to: nextStatus,
      ...(note ? { note } : {}),
    },
  });

  return updated;
}

export interface DuplicateMatch {
  kind: "bank_account" | "workspace_name";
  merchant_id: string;
  display_name: string | null;
}

/**
 * Approved workspaces that share a settlement bank account or a workspace name
 * with this one. A copied collection would usually reuse one of these.
 */
async function findDuplicateIdentity(merchantId: string): Promise<DuplicateMatch[]> {
  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.id, merchantId),
  });
  if (!merchant) return [];

  const matches: DuplicateMatch[] = [];

  const accounts = await db
    .select({ accountNumber: merchantBankAccounts.accountNumber })
    .from(merchantBankAccounts)
    .where(eq(merchantBankAccounts.merchantId, merchantId));

  for (const account of accounts) {
    const sameAccount = await db
      .select({ merchantId: merchants.id, displayName: merchants.displayName })
      .from(merchantBankAccounts)
      .innerJoin(merchants, eq(merchants.id, merchantBankAccounts.merchantId))
      .where(
        and(
          eq(merchantBankAccounts.accountNumber, account.accountNumber),
          ne(merchantBankAccounts.merchantId, merchantId),
          eq(merchants.status, "approved"),
        ),
      );
    for (const row of sameAccount) {
      matches.push({ kind: "bank_account", merchant_id: row.merchantId, display_name: row.displayName });
    }
  }

  if (merchant.displayName) {
    const sameName = await db
      .select({ merchantId: merchants.id, displayName: merchants.displayName })
      .from(merchants)
      .where(
        and(
          sql`lower(${merchants.displayName}) = lower(${merchant.displayName})`,
          ne(merchants.id, merchantId),
          eq(merchants.status, "approved"),
        ),
      );
    for (const row of sameName) {
      matches.push({ kind: "workspace_name", merchant_id: row.merchantId, display_name: row.displayName });
    }
  }

  return matches;
}

export async function approveMerchant(
  adminUid: string,
  merchantId: string,
  note?: string,
  confirmDuplicate = false,
): Promise<Merchant> {
  const matches = await findDuplicateIdentity(merchantId);
  if (matches.length > 0 && !confirmDuplicate) {
    throw new HttpError(
      409,
      "possible_duplicate",
      "This workspace shares a bank account or name with an approved workspace. Review it, then approve again with confirm_duplicate set to true.",
      { matches },
    );
  }
  const approvalNote =
    matches.length > 0 ? `[duplicate reviewed] ${note ?? ""}`.trim() : note;

  return transitionStatus(
    adminUid,
    merchantId,
    "approved",
    "merchant.approve",
    approvalNote,
    ["pending", "rejected", "suspended"],
  );
}

export function rejectMerchant(
  adminUid: string,
  merchantId: string,
  note: string,
): Promise<Merchant> {
  return transitionStatus(
    adminUid,
    merchantId,
    "rejected",
    "merchant.reject",
    note,
    ["pending", "approved", "suspended"],
  );
}

export function suspendMerchant(
  adminUid: string,
  merchantId: string,
  note: string,
): Promise<Merchant> {
  return transitionStatus(
    adminUid,
    merchantId,
    "suspended",
    "merchant.suspend",
    note,
    ["approved", "pending"],
  );
}