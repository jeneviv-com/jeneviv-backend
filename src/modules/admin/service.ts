import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  merchants,
  type Merchant,
} from "../../db/schema/merchants.js";
import type { MerchantStatus } from "../../db/schema/enums.js";
import { recordAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error.js";
import type { ListMerchantsQuery } from "./schemas.js";

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

export function approveMerchant(
  adminUid: string,
  merchantId: string,
  note?: string,
): Promise<Merchant> {
  return transitionStatus(
    adminUid,
    merchantId,
    "approved",
    "merchant.approve",
    note,
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
