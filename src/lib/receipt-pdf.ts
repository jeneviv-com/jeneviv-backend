import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface ReceiptPdfData {
  reference: string;
  schoolName: string;
  logoUrl: string | null;
  studentName: string;
  collectionName: string;
  payerName: string;
  amount: number;
  currency: string;
  paidAt: Date;
  ninVerified: boolean;
  bankVerified: boolean;
  verifyUrl: string;
  details: Array<{ label: string; value: string }>;
}

const INK = rgb(0.08, 0.09, 0.1);
const MUTED = rgb(0.42, 0.44, 0.47);
const BRAND = rgb(0.94, 0.45, 0.12);
const GREEN = rgb(0.09, 0.55, 0.34);
const LINE = rgb(0.88, 0.89, 0.9);

/*
 * Amounts are stored in naira, not kobo: a ₦2,500 collection is 2500. Dividing
 * by 100 here used to print every receipt at one hundredth of what was paid.
 */
function money(amount: number, currency: string): string {
  return `${currency} ${Number(amount ?? 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/*
 * The standard PDF fonts only encode WinAnsi. A payer field containing an emoji
 * or any other non-WinAnsi character would make drawText throw, taking the whole
 * receipt down, so unsupported characters are replaced instead.
 */
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

/** Trims a string with an ellipsis so it never runs off the page. */
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
  while (
    out.length > 0 &&
    font.widthOfTextAtSize(`${out}\u2026`, size) > maxWidth
  ) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}\u2026`;
}

async function fetchImage(url: string): Promise<{
  bytes: Uint8Array;
  type: "png" | "jpg";
} | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 4_000_000) return null;
    return {
      bytes,
      type: contentType.includes("png") ? "png" : "jpg",
    };
  } catch {
    return null;
  }
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: BRAND });
  page.drawText("OFFICIAL PAYMENT RECEIPT", {
    x: 48,
    y: height - 72,
    size: 10,
    font: bold,
    color: BRAND,
  });

  let logoWidth = 0;
  if (data.logoUrl) {
    const image = await fetchImage(data.logoUrl);
    if (image) {
      try {
        const embedded =
          image.type === "png"
            ? await pdf.embedPng(image.bytes)
            : await pdf.embedJpg(image.bytes);
        const scale = Math.min(64 / embedded.width, 64 / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        page.drawImage(embedded, { x: 48, y: height - 160, width: w, height: h });
        logoWidth = w + 14;
      } catch {
        logoWidth = 0;
      }
    }
  }

  const headingWidth = width - 96 - logoWidth;
  page.drawText(fit(data.schoolName, bold, 22, headingWidth), {
    x: 48 + logoWidth,
    y: height - 118,
    size: 22,
    font: bold,
    color: INK,
  });
  page.drawText(fit(data.collectionName, regular, 11, headingWidth), {
    x: 48 + logoWidth,
    y: height - 138,
    size: 11,
    font: regular,
    color: MUTED,
  });

  page.drawRectangle({
    x: 48,
    y: height - 205,
    width: width - 96,
    height: 1,
    color: LINE,
  });

  page.drawText("AMOUNT PAID", {
    x: 48,
    y: height - 235,
    size: 9,
    font: bold,
    color: MUTED,
  });
  page.drawText(money(data.amount, data.currency), {
    x: 48,
    y: height - 265,
    size: 28,
    font: bold,
    color: INK,
  });

  const rows: Array<[string, string]> = [
    ["Student", data.studentName],
    ["Paid by", data.payerName],
    ["Paid on", data.paidAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })],
    ["Reference", data.reference],
    ...data.details.slice(0, 6).map(
      (d) => [d.label, d.value] as [string, string],
    ),
  ];

  const labelWidth = 130;
  const valueX = 48 + 142;
  const valueWidth = width - 48 - valueX;

  let y = height - 315;
  for (const [label, value] of rows) {
    page.drawText(fit(label.toUpperCase(), bold, 8, labelWidth), {
      x: 48,
      y,
      size: 8,
      font: bold,
      color: MUTED,
    });
    page.drawText(fit(value, label === "Reference" ? mono : regular, 11, valueWidth), {
      x: valueX,
      y,
      size: 11,
      font: label === "Reference" ? mono : regular,
      color: INK,
    });
    page.drawRectangle({
      x: 48,
      y: y - 14,
      width: width - 96,
      height: 0.6,
      color: LINE,
    });
    y -= 34;
  }

  y -= 8;
  if (data.ninVerified) {
    page.drawRectangle({
      x: 48,
      y: y - 4,
      width: 104,
      height: 20,
      color: rgb(0.9, 0.97, 0.93),
      borderColor: GREEN,
      borderWidth: 0.8,
    });
    page.drawText("NIN VERIFIED", {
      x: 58,
      y: y + 2,
      size: 8,
      font: bold,
      color: GREEN,
    });
  }
  if (data.bankVerified) {
    page.drawRectangle({
      x: 160,
      y: y - 4,
      width: 116,
      height: 20,
      color: rgb(0.9, 0.97, 0.93),
      borderColor: GREEN,
      borderWidth: 0.8,
    });
    page.drawText("BANK VERIFIED", {
      x: 170,
      y: y + 2,
      size: 8,
      font: bold,
      color: GREEN,
    });
  }

  page.drawRectangle({
    x: 48,
    y: 80,
    width: width - 96,
    height: 1,
    color: LINE,
  });
  page.drawText("Verify this receipt", {
    x: 48,
    y: 58,
    size: 9,
    font: bold,
    color: MUTED,
  });
  page.drawText(fit(data.verifyUrl, regular, 9, width - 96), {
    x: 48,
    y: 43,
    size: 9,
    font: regular,
    color: BRAND,
  });
  page.drawText(
    fit(
      "This receipt is issued electronically. Its validity can be checked at the URL above.",
      regular,
      7.5,
      width - 96,
    ),
    {
      x: 48,
      y: 24,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );

  return pdf.save();
}
