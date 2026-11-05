import ExcelJS from "exceljs";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import {
  collectionGroups,
  collections,
} from "../../db/schema/collections.js";
import { merchants } from "../../db/schema/merchants.js";
import type { Merchant } from "../../db/schema/merchants.js";
import {
  transactionFields,
  transactions,
} from "../../db/schema/transactions.js";
import { HttpError } from "../../middleware/error.js";

export type ExportStatus = "paid" | "unpaid";

const UNPAID_STATUSES = [
  "pending",
  "processing",
  "failed",
  "cancelled",
  "expired",
] as const;

export type ExportCell = string | number;

export interface ExportColumn {
  /** Stable key, used by the dashboard to pick columns and by the PDF builder. */
  key: string;
  header: string;
  width: number;
}

export interface CollectionExport {
  collectionName: string;
  groupName: string | null;
  groupLogoUrl: string | null;
  workspaceName: string;
  status: ExportStatus;
  /** File name without extension: code-collection-status. */
  filenameBase: string;
  columns: ExportColumn[];
  rows: Array<Record<string, ExportCell>>;
}

/**
 * One loader shared by the spreadsheet and the PDF, so both exports always
 * describe the same rows in the same order.
 */
export async function loadCollectionExport(
  merchant: Merchant,
  collectionId: string,
  status: ExportStatus,
): Promise<CollectionExport> {
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

  // A collection filed under a group is exported under that group, so the sheet
  // header names the entity the payers recognise.
  const group = collection.groupId
    ? await db.query.collectionGroups.findFirst({
        where: eq(collectionGroups.id, collection.groupId),
      })
    : null;

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

  const columns: ExportColumn[] = [
    { key: "reference", header: "Reference", width: 30 },
    ...fieldNames.map((name) => ({
      key: `field:${name}`,
      header: name,
      width: 24,
    })),
    { key: "payer", header: "Payer", width: 24 },
    { key: "amount", header: "Amount (NGN)", width: 16 },
    { key: "fees", header: "Fees (NGN)", width: 14 },
    { key: "status", header: "Status", width: 14 },
    { key: "paid_at", header: "Paid at", width: 22 },
    { key: "created_at", header: "Created at", width: 22 },
  ];

  const data = rows.map((row) => {
    const values: Record<string, ExportCell> = {
      reference: row.reference,
      payer: payerNames.get(row.customerId) ?? "",
      // Transactions are stored in whole naira, the same unit the dashboard
      // and collections use, so no minor-unit conversion is needed here.
      amount: row.amount,
      fees: row.platformFee + row.gatewayFee,
      status: row.status,
      paid_at: row.paidAt?.toISOString() ?? "",
      created_at: row.createdAt.toISOString(),
    };
    for (const name of fieldNames) {
      values[`field:${name}`] = byTransaction.get(row.id)?.get(name) ?? "";
    }
    return values;
  });

  const safeName = collection.name.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 50);

  return {
    collectionName: collection.name,
    groupName: group?.name ?? null,
    groupLogoUrl: group?.logoUrl ?? null,
    workspaceName:
      merchantRow?.displayName ?? merchantRow?.merchantCode ?? "Workspace",
    status,
    filenameBase: `${merchantRow?.merchantCode ?? "collection"}-${safeName}-${status}`,
    columns,
    rows: data,
  };
}

/** Keeps only the columns the dashboard asked for, in the order it listed them. */
export function pickExportColumns(
  data: CollectionExport,
  keys?: string[],
): ExportColumn[] {
  if (!keys || keys.length === 0) return data.columns;
  const wanted = keys
    .map((key) => data.columns.find((column) => column.key === key))
    .filter((column): column is ExportColumn => Boolean(column));
  return wanted.length ? wanted : data.columns;
}

export async function buildCollectionExport(
  merchant: Merchant,
  collectionId: string,
  status: ExportStatus,
): Promise<{ buffer: Buffer; filename: string }> {
  const data = await loadCollectionExport(merchant, collectionId, status);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jeneviv";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(status === "paid" ? "Paid" : "Unpaid");

  sheet.columns = data.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3E7DC" },
  };

  for (const row of data.rows) {
    sheet.addRow(row);
  }

  sheet.getColumn("amount").numFmt = "#,##0.00";
  sheet.getColumn("fees").numFmt = "#,##0.00";
  sheet.autoFilter = { from: "A1", to: `${sheet.columnCount}1` };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `${data.filenameBase}.xlsx`,
  };
}
