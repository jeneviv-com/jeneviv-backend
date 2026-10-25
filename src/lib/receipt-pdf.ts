import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

  page.drawText(data.schoolName.slice(0, 60), {
    x: 48 + logoWidth,
    y: height - 118,
    size: 22,
    font: bold,
    color: INK,
  });
  page.drawText(data.collectionName.slice(0, 70), {
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

  let y = height - 315;
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase().slice(0, 28), {
      x: 48,
      y,
      size: 8,
      font: bold,
      color: MUTED,
    });
    page.drawText(value.slice(0, 72), {
      x: 190,
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
  page.drawText(data.verifyUrl, {
    x: 48,
    y: 43,
    size: 9,
    font: regular,
    color: BRAND,
  });
  page.drawText(
    "This receipt is issued electronically. Its validity can be checked at the URL above.",
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
