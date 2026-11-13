/**
 * Paga Collect sandbox smoke test.
 *
 * Verifies that the configured public key / secret key authenticate and that
 * the SHA-512 `hash` header is accepted, using the cheapest endpoint Paga
 * exposes (`POST /banks`). Reads credentials from the environment — nothing is
 * hard-coded here and no secret is printed.
 *
 *   node --env-file=.env scripts/paga-sandbox-check.mjs
 */
import { createHash } from "node:crypto";

const base = (process.env.PAGA_BASE_URL || "https://beta-collect.paga.com").replace(/\/+$/, "");
const publicKey = process.env.PAGA_PUBLIC_KEY || "";
const secretKey = process.env.PAGA_SECRET_KEY || "";
const hashKey = process.env.PAGA_HASH_KEY || "";

if (!publicKey || !secretKey || !hashKey) {
  console.error("Missing PAGA_PUBLIC_KEY / PAGA_SECRET_KEY / PAGA_HASH_KEY.");
  process.exit(2);
}

const reference = `jvcheck${Date.now()}`;
const hash = createHash("sha512").update(`${reference}${hashKey}`).digest("hex");
const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;

console.log(`POST ${base}/banks  (reference ${reference})`);

const response = await fetch(`${base}/banks`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authorization,
    hash,
  },
  body: JSON.stringify({ referenceNumber: reference }),
});

const text = await response.text();
let parsed = null;
try {
  parsed = JSON.parse(text);
} catch {
  /* Paga sometimes answers with plain text */
}

console.log(`HTTP ${response.status}`);
if (parsed) {
  console.log("statusCode:", parsed.statusCode ?? "-", "| message:", parsed.statusMessage ?? "-");
  const banks = parsed?.data?.banks;
  if (Array.isArray(banks)) {
    console.log(`banks: ${banks.length} returned`);
    console.log("sample:", banks.slice(0, 3).map((bank) => `${bank.name} (${bank.uuid})`).join(", "));
  } else {
    console.log("body:", JSON.stringify(parsed).slice(0, 500));
  }
} else {
  console.log("body:", text.slice(0, 500));
}

process.exit(response.ok && String(parsed?.statusCode ?? "0") === "0" ? 0 : 1);
