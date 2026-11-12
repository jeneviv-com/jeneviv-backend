import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

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
  /** When the payer started the payment. Shown as the first step of the timeline. */
  startedAt?: Date | null;
  ninVerified: boolean;
  bankVerified: boolean;
  verifyUrl: string;
  groupName?: string | null;
  workspaceName?: string | null;
  details: Array<{ label: string; value: string }>;
  /** How the money was split, in naira. */
  breakdown?: {
    collection: number;
    paystackFee: number;
    jenevivFee: number;
    total: number;
  } | null;
}

/* Colours match the app: ink, muted grey, the Jeneviv orange, and the cream page. */
const INK = rgb(0.063, 0.063, 0.063);
const MUTED = rgb(0.427, 0.427, 0.427);
const FAINT = rgb(0.608, 0.608, 0.608);
const BRAND = rgb(1, 0.282, 0);
const BRAND_SOFT = rgb(1, 0.949, 0.925);
const LINE = rgb(0.894, 0.894, 0.894);
const CREAM = rgb(0.969, 0.969, 0.961);
const WHITE = rgb(1, 1, 1);

/*
 * Amounts are stored in naira, not kobo: a ₦2,500 collection is 2500. The standard
 * PDF fonts have no ₦ glyph, so the currency code is printed instead.
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
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = sanitize(text ?? "").trim();
  if (!clean) return "";
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 0 && font.widthOfTextAtSize(`${out}\u2026`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}\u2026`;
}

/** Wraps on spaces, up to `maxLines`. The last line is trimmed with an ellipsis if cut. */
function wrapWords(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = sanitize(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, font, size, maxWidth);
    return kept;
  }
  return lines;
}

/** Wraps by character, for links and references that have no spaces. */
function wrapChars(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const clean = sanitize(text);
  const lines: string[] = [];
  let line = "";
  for (const char of clean) {
    if (font.widthOfTextAtSize(line + char, size) <= maxWidth) {
      line += char;
    } else {
      lines.push(line);
      line = char;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(kept[maxLines - 1] + lines.slice(maxLines).join(""), font, size, maxWidth);
    return kept;
  }
  return lines;
}

async function embedJenevivLogo(pdf: PDFDocument) {
  try {
    const bytes = await readFile(resolve(process.cwd(), "public/assets/images/jeneviv.png"));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
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

/** A rounded rectangle. `yTop` is the top edge, in PDF coordinates (y grows upward). */
function roundedRect(
  page: PDFPage,
  x: number,
  yTop: number,
  w: number,
  h: number,
  r: number,
  style: { color?: RGB; borderColor?: RGB; borderWidth?: number },
) {
  const rr = Math.min(r, w / 2, h / 2);
  const path =
    `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} Q ${w} ${h} ${w - rr} ${h} ` +
    `H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
  page.drawSvgPath(path, { x, y: yTop, ...style });
}

/** Draws a QR code as vector squares, so it stays sharp at any zoom. */
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / n;
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (qr.modules.get(row, col)) {
        page.drawRectangle({
          x: x + col * cell,
          y: y + size - (row + 1) * cell,
          width: cell + 0.15,
          height: cell + 0.15,
          color: INK,
        });
      }
    }
  }
}

/* Receipts are printed in Nigerian time, whatever the server's clock says. */
function lagos(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", ...options });
}
const shortWhen = (d: Date) =>
  lagos(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const fullWhen = (d: Date) => `${lagos(d, { dateStyle: "medium", timeStyle: "short" })} WAT`;

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Receipt ${data.reference}`);
  pdf.setAuthor("Jeneviv");
  pdf.setSubject(`Payment receipt for ${data.collectionName}`);

  const page = pdf.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const issuer = data.groupName ?? data.workspaceName ?? data.schoolName;

  /* ------------------------------------------------------------- what to print */
  type Row = { label: string; value: string; kind: "bold" | "mono" | "plain" };
  const rows: Row[] = [
    { label: "Paid by", value: data.payerName.toUpperCase(), kind: "bold" },
    ...(data.studentName && data.studentName !== data.payerName
      ? ([{ label: "For", value: data.studentName, kind: "plain" }] as Row[])
      : []),
    { label: "Collection", value: data.collectionName, kind: "plain" },
    ...data.details
      .filter((d) => d.label !== "Collection")
      .slice(0, 6)
      .map((d) => ({ label: d.label, value: d.value, kind: "plain" }) as Row),
    { label: "Payment method", value: "Bank transfer", kind: "plain" },
    { label: "Transaction date", value: fullWhen(data.paidAt), kind: "plain" },
    { label: "Transaction no.", value: data.reference, kind: "mono" },
  ];

  const tags = [
    ...(data.ninVerified ? ["NIN VERIFIED"] : []),
    ...(data.bankVerified ? ["BANK VERIFIED"] : []),
  ];

  const steps = [
    { l1: "Payment", l2: "started", time: data.startedAt ? shortWhen(data.startedAt) : "", done: true },
    { l1: "Confirmed", l2: "by Paystack", time: shortWhen(data.paidAt), done: true },
    { l1: "Settles to", l2: "their bank", time: "Next working day", done: false },
  ];

  const breakdown = data.breakdown ?? null;

  /* ------------------------------------------------------------------- layout */
  const X = 36;
  const W = width - 72;
  const GAP = 12;
  const TOP = height - 44;
  const PADX = 24;
  const innerW = W - PADX * 2;

  const noteLines = wrapWords(
    `Payments settle straight to ${issuer}'s bank account, usually the next working day. Jeneviv never holds the money.`,
    regular,
    8.5,
    innerW - 28,
    3,
  );

  // Hero card: every number below is a distance from the top edge of the card.
  const tagsOn = tags.length > 0;
  const hero = {
    logoCY: 46,
    titleBase: 85,
    amountBase: 119,
    statusBase: 140,
    tagTop: 150,
    tlCY: (tagsOn ? 167 : 140) + 26,
    lab1: 0,
    lab2: 0,
    timeBase: 0,
    noteTop: 0,
    noteH: noteLines.length * 11.5 + 18,
    h: 0,
  };
  hero.lab1 = hero.tlCY + 8 + 13;
  hero.lab2 = hero.lab1 + 10;
  hero.timeBase = hero.lab2 + 14;
  hero.noteTop = hero.timeBase + 14;
  hero.h = hero.noteTop + hero.noteH + 22;

  const SPLIT_W = breakdown ? 292 : 0;
  const VERIFY_W = breakdown ? W - SPLIT_W - GAP : W;
  const LOWER_H = 156;

  // Rows tighten, rather than running off the page, when a receipt has many fields.
  const detailsHead = 44;
  const detailsFoot = 16;
  const bottomRoom = 56;
  const rowH = Math.max(
    17,
    Math.min(22, Math.floor((TOP - bottomRoom - hero.h - GAP - detailsHead - detailsFoot - GAP - LOWER_H) / rows.length)),
  );
  const detailsH = detailsHead + rows.length * rowH + detailsFoot;

  const heroTop = TOP;
  const detailsTop = heroTop - hero.h - GAP;
  const lowerTop = detailsTop - detailsH - GAP;
  const lastBottom = lowerTop - LOWER_H;

  /* --------------------------------------------------------------- the surface */
  page.drawRectangle({ x: 0, y: 0, width, height, color: CREAM });
  const cardStyle = { color: WHITE, borderColor: LINE, borderWidth: 0.8 };
  roundedRect(page, X, heroTop, W, hero.h, 20, cardStyle);
  roundedRect(page, X, detailsTop, W, detailsH, 20, cardStyle);
  if (breakdown) roundedRect(page, X, lowerTop, SPLIT_W, LOWER_H, 20, cardStyle);
  const verifyX = breakdown ? X + SPLIT_W + GAP : X;
  roundedRect(page, verifyX, lowerTop, VERIFY_W, LOWER_H, 20, cardStyle);

  const jenevivLogo = await embedJenevivLogo(pdf);

  // One watermark: the Jeneviv mark, centred on the receipt and very faint. It sits
  // above the card backgrounds and below the text, so nothing is hidden.
  if (jenevivLogo) {
    const mark = 240;
    const scale = Math.min(mark / jenevivLogo.width, mark / jenevivLogo.height);
    const w = jenevivLogo.width * scale;
    const h = jenevivLogo.height * scale;
    page.drawImage(jenevivLogo, {
      x: (width - w) / 2,
      y: (heroTop + lastBottom) / 2 - h / 2,
      width: w,
      height: h,
      opacity: 0.05,
    });
  }

  const textAt = (text: string, x: number, y: number, font: PDFFont, size: number, color: RGB) =>
    page.drawText(text, { x, y, size, font, color });
  const centeredAt = (text: string, cx: number, y: number, font: PDFFont, size: number, color: RGB) =>
    page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
  const rightAt = (text: string, xRight: number, y: number, font: PDFFont, size: number, color: RGB) =>
    page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font, color });

  /* --------------------------------------------------------------------- hero */
  const cx = X + W / 2;
  page.drawCircle({
    x: cx,
    y: heroTop - hero.logoCY,
    size: 22,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.8,
  });
  let drewIssuerLogo = false;
  if (data.logoUrl) {
    const image = await fetchImage(data.logoUrl);
    if (image) {
      try {
        const embedded = image.type === "png" ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
        const scale = Math.min(30 / embedded.width, 30 / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        page.drawImage(embedded, { x: cx - w / 2, y: heroTop - hero.logoCY - h / 2, width: w, height: h });
        drewIssuerLogo = true;
      } catch {
        drewIssuerLogo = false;
      }
    }
  }
  if (!drewIssuerLogo && jenevivLogo) {
    const scale = Math.min(28 / jenevivLogo.width, 28 / jenevivLogo.height);
    const w = jenevivLogo.width * scale;
    const h = jenevivLogo.height * scale;
    page.drawImage(jenevivLogo, { x: cx - w / 2, y: heroTop - hero.logoCY - h / 2, width: w, height: h });
  }

  centeredAt(fit(`Payment to ${issuer}`, bold, 11.5, innerW), cx, heroTop - hero.titleBase, bold, 11.5, INK);
  centeredAt(money(data.amount, data.currency), cx, heroTop - hero.amountBase, bold, 32, INK);
  centeredAt("Successful", cx, heroTop - hero.statusBase, bold, 12.5, BRAND);

  if (tagsOn) {
    const pillH = 17;
    const widths = tags.map((t) => bold.widthOfTextAtSize(t, 7.5) + 20);
    const total = widths.reduce((a, b) => a + b, 0) + (tags.length - 1) * 6;
    let px = cx - total / 2;
    const pillTop = heroTop - hero.tagTop;
    tags.forEach((tag, i) => {
      roundedRect(page, px, pillTop, widths[i], pillH, 8.5, { color: BRAND_SOFT });
      page.drawText(tag, { x: px + 10, y: pillTop - 11.8, size: 7.5, font: bold, color: BRAND });
      px += widths[i] + 6;
    });
  }

  // Timeline: two steps done, the last one still to come.
  const colW = innerW / 3;
  const colX = [0, 1, 2].map((i) => X + PADX + colW * (i + 0.5));
  const tlY = heroTop - hero.tlCY;
  page.drawLine({ start: { x: colX[0] + 11, y: tlY }, end: { x: colX[1] - 11, y: tlY }, thickness: 1.4, color: BRAND });
  page.drawLine({
    start: { x: colX[1] + 11, y: tlY },
    end: { x: colX[2] - 11, y: tlY },
    thickness: 1.2,
    color: LINE,
    dashArray: [3, 3],
  });
  steps.forEach((step, i) => {
    if (step.done) {
      page.drawCircle({ x: colX[i], y: tlY, size: 8, color: BRAND });
      const c = { x: colX[i], y: tlY };
      page.drawLine({ start: { x: c.x - 3.3, y: c.y + 0.2 }, end: { x: c.x - 1, y: c.y - 2.4 }, thickness: 1.4, color: WHITE });
      page.drawLine({ start: { x: c.x - 1, y: c.y - 2.4 }, end: { x: c.x + 3.4, y: c.y + 2.8 }, thickness: 1.4, color: WHITE });
    } else {
      page.drawCircle({ x: colX[i], y: tlY, size: 8, color: WHITE, borderColor: LINE, borderWidth: 1.4 });
    }
    centeredAt(step.l1, colX[i], heroTop - hero.lab1, regular, 8.5, MUTED);
    centeredAt(step.l2, colX[i], heroTop - hero.lab2, regular, 8.5, MUTED);
    if (step.time) {
      centeredAt(step.time, colX[i], heroTop - hero.timeBase, bold, 8.5, step.done ? INK : MUTED);
    }
  });

  roundedRect(page, X + PADX, heroTop - hero.noteTop, innerW, hero.noteH, 12, { color: CREAM });
  noteLines.forEach((line, i) => {
    textAt(line, X + PADX + 14, heroTop - hero.noteTop - 14 - i * 11.5, regular, 8.5, MUTED);
  });

  /* ------------------------------------------------------- transaction details */
  textAt("Transaction Details", X + PADX, detailsTop - 34, bold, 12, INK);
  const labelW = 130;
  const valueMax = innerW - labelW - 14;
  rows.forEach((row, i) => {
    const font = row.kind === "mono" ? mono : row.kind === "bold" ? bold : regular;
    const size = row.kind === "mono" ? 8.5 : 10;
    const baseline = detailsTop - (detailsHead + i * rowH + rowH / 2 + 3.2);
    textAt(fit(row.label, regular, 9.5, labelW), X + PADX, baseline, regular, 9.5, MUTED);
    rightAt(fit(row.value, font, size, valueMax), X + W - PADX, baseline, font, size, INK);
  });

  /* ---------------------------------------------------------- the money split */
  if (breakdown) {
    const left = X + PADX;
    const right = X + SPLIT_W - PADX;
    textAt("How the money was split", left, lowerTop - 34, bold, 12, INK);
    const lines: Array<[string, number]> = [
      ["Collection (set by the school)", breakdown.collection],
      ["Paystack processing fee", breakdown.paystackFee],
      ["Jeneviv platform fee", breakdown.jenevivFee],
    ];
    lines.forEach(([label, value], i) => {
      const baseline = lowerTop - (44 + i * 21 + 15);
      textAt(label, left, baseline, regular, 9.5, MUTED);
      rightAt(money(value, data.currency), right, baseline, regular, 10, INK);
    });
    page.drawLine({
      start: { x: left, y: lowerTop - 112 },
      end: { x: right, y: lowerTop - 112 },
      thickness: 0.6,
      color: LINE,
    });
    textAt("Total paid", left, lowerTop - 130, bold, 11, INK);
    rightAt(money(breakdown.total, data.currency), right, lowerTop - 130, bold, 11.5, BRAND);
  }

  /* ---------------------------------------------------------- verify this receipt */
  const verifyCx = verifyX + VERIFY_W / 2;
  textAt("Verify this receipt", verifyX + PADX, lowerTop - 34, bold, 12, INK);
  const qrSize = 64;
  drawQr(page, data.verifyUrl, verifyCx - qrSize / 2, lowerTop - 44 - qrSize, qrSize);
  const urlLines = wrapChars(data.verifyUrl, regular, 7, VERIFY_W - PADX * 2, 3);
  urlLines.forEach((line, i) => {
    centeredAt(line, verifyCx, lowerTop - 122 - i * 9, regular, 7, BRAND);
  });

  /* -------------------------------------------------------- powered by, below */
  const poweredY = lastBottom - 26;
  const poweredText = "Powered by Jeneviv";
  const poweredW = bold.widthOfTextAtSize(poweredText, 8.5);
  const markSize = 14;
  const groupW = (jenevivLogo ? markSize + 6 : 0) + poweredW;
  let gx = (width - groupW) / 2;
  if (jenevivLogo) {
    const scale = Math.min(markSize / jenevivLogo.width, markSize / jenevivLogo.height);
    page.drawImage(jenevivLogo, {
      x: gx,
      y: poweredY - 3,
      width: jenevivLogo.width * scale,
      height: jenevivLogo.height * scale,
    });
    gx += markSize + 6;
  }
  textAt(poweredText, gx, poweredY, bold, 8.5, FAINT);

  return pdf.save();
}