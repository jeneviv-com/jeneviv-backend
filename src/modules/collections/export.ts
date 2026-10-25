import ExcelJS from "exceljs";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import { collections } from "../../db/schema/collections.js";
import { merchants } from "../../db/schema/merchants.js";
import {
  transactionFields,
  transactions,
} from "../../db/schema/transactions.js";
import type { Merchant } from "../../db/schema/merchants.js";
import { HttpError } from "../../middleware/error.js";

export type ExportStatus = "paid" | "unpaid";

const UNPAID_STATUSES = [
  "pending",
  "processing",
  "failed",
  "cancelled",
  "expired",
] as const;

export async function buildCollectionExport(
  merchant: Merchant,
  collectionId: string,
  status: ExportStatus,
): Promise<{ buffer: Buffer; filename: string }> {
  const collection = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, collectionId),
      eq(collections.merchantId, merchant.id),
    ),
  });
  if (!collection) {
    throw new HttpError(404, "not_found", "Collection not found");
  }
  const merchantRow = await db.query.merchants.findFirst({
    where: eq(merchants.id, merchant.id),
  });

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.collectionId, collectionId),
        status === "paid"
          ? eq(transactions.status, "success")
          : inArray(transactions.status, [...UNPAID_STATUSES]),
      ),
    )
    .orderBy(desc(transactions.createdAt));

  const ids = rows.map((row) => row.id);
  const customerIds = Array.from(new Set(rows.map((row) => row.customerId)));
  const customers = customerIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, customerIds) })
    : [];
  const payerNames = new Map(customers.map((user) => [user.id, user.name]));
  const fields = ids.length
    ? await db.query.transactionFields.findMany({
        where: inArray(transactionFields.transactionId, ids),
        orderBy: asc(transactionFields.fieldId),
      })
    : [];

  const fieldNames: string[] = [];
  const byTransaction = new Map<string, Map<string, string>>();
  for (const field of fields) {
    if (!fieldNames.includes(field.displayName)) fieldNames.push(field.displayName);
    const map = byTransaction.get(field.transactionId) ?? new Map<string, string>();
    map.set(field.displayName, field.value);
    byTransaction.set(field.transactionId, map);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jeneviv";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(status === "paid" ? "Paid" : "Unpaid");

  const columns: Array<{ header: string; key: string; width: number }> = [
    { header: "Reference", key: "reference", width: 30 },
    ...fieldNames.map((name, index) => ({
      header: name,
      key: `field_${index}`,
      width: 24,
    })),
    { header: "Payer", key: "payer", width: 24 },
    { header: "Amount (NGN)", key: "amount", width: 16 },
    { header: "Fees (NGN)", key: "fees", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Paid at", key: "paid_at", width: 22 },
    { header: "Created at", key: "created_at", width: 22 },
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3E7DC" },
  };

  for (const row of rows) {
    const values: Record<string, string | number> = {
      reference: row.reference,
      payer: payerNames.get(row.customerId) ?? "",
      amount: row.amount / 100,
      fees: (row.platformFee + row.gatewayFee) / 100,
      status: row.status,
      paid_at: row.paidAt?.toISOString() ?? "",
      created_at: row.createdAt.toISOString(),
    };
    fieldNames.forEach((name, index) => {
      values[`field_${index}`] = byTransaction.get(row.id)?.get(name) ?? "";
    });
    sheet.addRow(values);
  }

  sheet.getColumn("amount").numFmt = "#,##0.00";
  sheet.getColumn("fees").numFmt = "#,##0.00";
  sheet.autoFilter = { from: "A1", to: `${sheet.columnCount}1` };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const safeName = collection.name.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 50);
  return {
    buffer,
    filename: `${merchantRow?.merchantCode ?? "collection"}-${safeName}-${status}.xlsx`,
  };
}

