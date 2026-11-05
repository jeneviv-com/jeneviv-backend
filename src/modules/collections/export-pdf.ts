import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { Merchant } from "../../db/schema/merchants.js";
import {
  loadCollectionExport,
  pickExportColumns,
  type CollectionExport,
  type ExportStatus,
} from "./export.js";

const INK = rgb(0.06, 0.06, 0.06);
const MUTED = rgb(0.42, 0.44, 0.47);
const BRAND = rgb(0.94, 0.45, 0.12);
const LINE = rgb(0.86, 0.87, 0.88);
const CREAM = rgb(0.99, 0.97, 0.95);

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 40;

/* Standard PDF fonts encode WinAnsi only, so anything else is replaced. */
const WIN_ANSI_EXTRAS = new Set(
  Array.from(
    "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178",
  ),
);

function sanitize(text: string): string {
  return Array.from(text.replace(/[\r\n\t]+/g, " "))
    .map((char) => {
      const code = char.codePointAt(0) ?? 32;
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
        return char;
      }
      return WIN_ANSI_EXTRAS.has(char) ? char : "?";
    })
    .join("");
}

/** Trims text with an ellipsis so a long value never runs into its neighbour. */
function fit(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const clean = sanitize(text ?? "").trim();
  if (!clean) return "";
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 0 && font.widthOfTextAtSize(`${out}\u2026`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}\u2026`;
}

async function fetchImage(
  url: string,
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    if (!url.startsWith("http")) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 4_000_000) return null;
    return { bytes, type: contentType.includes("png") ? "png" : "jpg" };
  } catch {
    return null;
  }
}

async function embedJenevivLogo(pdf: PDFDocument) {
  try {
    const bytes = await readFile(
      resolve(process.cwd(), "public/assets/images/jeneviv.png"),
    );
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function columnWidths(data: CollectionExport, keys?: string[]) {
  const columns = pickExportColumns(data, keys);
  const weights = columns.map((column) => Math.max(8, column.width));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const available = PAGE_W - MARGIN * 2;
  const widths = weights.map((weight) => (weight / total) * available);
  return { columns, widths };
}

/**
 * A landscape A4 sheet: Jeneviv mark and scope at the top, then the group, the
 * workspace and the collection name above the table of selected columns.
 */
export async function buildCollectionPdf(
  merchant: Merchant,
  collectionId: string,
  status: ExportStatus,
  keys?: string[],
): Promise<{ buffer: Buffer; filename: string }> {
  const data = await loadCollectionExport(merchant, collectionId, status);
  const { columns, widths } = columnWidths(data, keys);

  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentWidth = right - left;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  const pages: PDFPage[] = [page];

  const brandBar = (target: PDFPage) =>
    target.drawRectangle({
      x: 0,
      y: PAGE_H - 8,
      width: PAGE_W,
      height: 8,
      color: BRAND,
    });

  const tableHeader = (target: PDFPage, atY: number) => {
    target.drawRectangle({
      x: left,
      y: atY - 5,
      width: contentWidth,
      height: 20,
      color: CREAM,
    });
    let x = left + 6;
    columns.forEach((column, index) => {
      target.drawText(fit(column.header.toUpperCase(), bold, 7.5, widths[index] - 10), {
        x,
        y: atY + 1,
        size: 7.5,
        font: bold,
        color: MUTED,
      });
      x += widths[index];
    });
    return atY - 22;
  };

  brandBar(page);

  // header: Jeneviv mark on the left, group logo on the right
  const logo = await embedJenevivLogo(pdf);
  let wordmarkX = left;
  if (logo) {
    const height = 24;
    const width = (logo.width / logo.height) * height;
    page.drawImage(logo, { x: left, y: PAGE_H - 56, width, height });
    wordmarkX = left + width + 8;
  }
  page.drawText("jeneviv", {
    x: wordmarkX,
    y: PAGE_H - 49,
    size: 15,
    font: bold,
    color: INK,
  });
  page.drawText("OFFICIAL EXPORT", {
    x: right - 92,
    y: PAGE_H - 48,
    size: 8,
    font: bold,
    color: BRAND,
  });

  let metaWidth = contentWidth;
  if (data.groupLogoUrl) {
    const image = await fetchImage(data.groupLogoUrl);
    if (image) {
      try {
        const embedded =
          image.type === "png"
            ? await pdf.embedPng(image.bytes)
            : await pdf.embedJpg(image.bytes);
        const height = 30;
        const width = (embedded.width / embedded.height) * height;
        page.drawImage(embedded, {
          x: right - width,
          y: PAGE_H - 92,
          width,
          height,
        });
        metaWidth = contentWidth - width - 16;
      } catch {
        metaWidth = contentWidth;
      }
    }
  }

  page.drawText(fit(data.collectionName, bold, 19, metaWidth), {
    x: left,
    y: PAGE_H - 86,
    size: 19,
    font: bold,
    color: INK,
  });

  const meta = [
    data.groupName ? `Group: ${data.groupName}` : null,
    `Workspace: ${data.workspaceName}`,
    `${data.status === "paid" ? "Paid" : "Unpaid"}: ${data.rows.length} row${data.rows.length === 1 ? "" : "s"}`,
    `Generated ${new Date().toLocaleString("en-NG", { dateStyle: "medium" })}`,
  ]
    .filter(Boolean)
    .join("   \u00b7   ");

  page.drawText(fit(meta, regular, 8.5, metaWidth), {
    x: left,
    y: PAGE_H - 103,
    size: 8.5,
    font: regular,
    color: MUTED,
  });

  let y = tableHeader(page, PAGE_H - 138);

  for (const row of data.rows) {
    if (y < 74) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      brandBar(page);
      y = tableHeader(page, PAGE_H - 56);
    }
    let x = left + 6;
    columns.forEach((column, index) => {
      const raw = row[column.key];
      const value =
        typeof raw === "number"
          ? raw.toLocaleString("en-NG", { maximumFractionDigits: 2 })
          : String(raw ?? "");
      page.drawText(fit(value, regular, 8.5, widths[index] - 10), {
        x,
        y,
        size: 8.5,
        font: regular,
        color: INK,
      });
      x += widths[index];
    });
    page.drawRectangle({
      x: left,
      y: y - 5,
      width: contentWidth,
      height: 0.5,
      color: LINE,
    });
    y -= 16;
  }

  pages.forEach((target, index) => {
    target.drawRectangle({
      x: left,
      y: 46,
      width: contentWidth,
      height: 0.6,
      color: LINE,
    });
    target.drawText("Generated by Jeneviv \u00b7 payments settle straight to the workspace bank account.", {
      x: left,
      y: 32,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    target.drawText(label, {
      x: right - regular.widthOfTextAtSize(label, 7.5),
      y: 32,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return {
    buffer: Buffer.from(await pdf.save()),
    filename: `${data.filenameBase}.pdf`,
  };
}
