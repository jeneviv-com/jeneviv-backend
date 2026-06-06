import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema/auth.js";
import { collections } from "../src/db/schema/collections.js";
import { merchants } from "../src/db/schema/merchants.js";
import { transactions } from "../src/db/schema/transactions.js";
import { webhookEvents } from "../src/db/schema/platform.js";
import { env } from "../src/env.js";
import { paystackAdapter } from "../src/gateways/paystack/adapter.js";
import { initPayment } from "../src/modules/payments/service.js";
import { ingestPaystackWebhook } from "../src/modules/webhooks/service.js";

const ts = Date.now();
const custId = `cust_${ts}`;
const mUserId = `muser_${ts}`;
const merchantId = `m_${ts}`;
const collectionId = `col_${ts}`;
const shortCode = `ps${ts}`;

function ok(label: string, cond: boolean, extra?: unknown): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function cleanup(reference?: string): Promise<void> {
  if (reference) {
    const tx = await db.query.transactions.findFirst({
      where: eq(transactions.reference, reference),
    });
    if (tx) await db.delete(transactions).where(eq(transactions.id, tx.id));
    await db
      .delete(webhookEvents)
      .where(eq(webhookEvents.gateway, "paystack"));
  }
  await db.delete(collections).where(eq(collections.id, collectionId));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await db.delete(users).where(eq(users.id, custId));
  await db.delete(users).where(eq(users.id, mUserId));
}

async function main(): Promise<void> {
  let reference: string | undefined;
  try {
    // --- seed payer + merchant (approved, with a real Paystack subaccount) ---
    await db.insert(users).values([
      { id: custId, name: "Pay Er", email: `payer_${ts}@example.com` },
      { id: mUserId, name: "Merchant Owner", email: `merch_${ts}@example.com` },
    ]);

    const { subaccountCode } = await paystackAdapter.ensureSubaccount!({
      businessName: "E2E Test Merchant",
      bankCode: "999992",
      accountNumber: "8165620409",
      percentageCharge: 0,
    });
    console.log(`[e2e] subaccount=${subaccountCode}`);

    await db.insert(merchants).values({
      id: merchantId,
      userId: mUserId,
      merchantCode: `MCODE${ts}`.slice(0, 16),
      displayName: "E2E Test Merchant",
      status: "approved",
      gatewaySubaccountIds: { paystack: subaccountCode },
    });

    await db.insert(collections).values({
      id: collectionId,
      merchantId,
      shortCode,
      name: "E2E Collection",
      amount: 500000, // ₦5,000.00
      currency: "NGN",
      isActive: true,
    });

    // --- init payment (real Paystack virtual account) ---
    const payer = await db.query.users.findFirst({ where: eq(users.id, custId) });
    const result = await initPayment(payer!, {
      collection_short_code: shortCode,
      field_values: {},
    });
    reference = result.transaction.reference;
    console.log(
      `[e2e] init: ref=${reference} acct=${result.payment_account.accountNumber} bank=${result.payment_account.bankName}`,
    );
    console.log(`[e2e] breakdown=${JSON.stringify(result.breakdown)}`);

    ok("transaction pending", result.transaction.status === "pending");
    ok("amount = collection amount", result.transaction.amount === 500000);
    ok("platform_fee = 7500", result.breakdown.platform_fee === 7500);
    ok(
      "total_charged grossed up above amount+fee",
      result.breakdown.total_charged > 507500,
      result.breakdown.total_charged,
    );
    ok(
      "gateway_fee = total - amount - platform_fee",
      result.breakdown.gateway_fee ===
        result.breakdown.total_charged - 500000 - 7500,
    );
    ok("virtual account number present", !!result.payment_account.accountNumber);

    // --- simulate charge.success webhook ---
    const payload = {
      event: "charge.success",
      data: {
        id: ts,
        reference,
        amount: result.breakdown.total_charged,
        fees: result.breakdown.gateway_fee,
        currency: "NGN",
        status: "success",
        paid_at: new Date().toISOString(),
        gateway_response: "Approved",
      },
    };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha512", env.PAYSTACK_SECRET_KEY)
      .update(raw)
      .digest("hex");
    const wh = await ingestPaystackWebhook(Buffer.from(raw), {
      "x-paystack-signature": sig,
    });
    ok("webhook accepted", wh.result.status === "ok");

    const afterTx = await db.query.transactions.findFirst({
      where: eq(transactions.reference, reference),
    });
    ok("tx => success", afterTx?.status === "success");
    ok("tx settled_at set (direct settlement)", afterTx?.settledAt != null);
    ok("tx paid_at set", afterTx?.paidAt != null);

    const merch = await db.query.merchants.findFirst({
      where: eq(merchants.id, merchantId),
    });
    ok(
      "merchant wallet NOT credited (no held funds)",
      merch?.walletBalanceNgn === 0,
      merch?.walletBalanceNgn,
    );
    ok(
      "merchant payouts balance untouched",
      merch?.payoutsBalanceNgn === 0,
    );

    // --- replay idempotency ---
    const replay = await ingestPaystackWebhook(Buffer.from(raw), {
      "x-paystack-signature": sig,
    });
    ok("replay => duplicate", replay.result.status === "duplicate");
    const merch2 = await db.query.merchants.findFirst({
      where: eq(merchants.id, merchantId),
    });
    ok("replay did not change balances", merch2?.walletBalanceNgn === 0);
  } finally {
    await cleanup(reference);
    console.log("[e2e] cleaned up");
  }
  process.exit(process.exitCode ?? 0);
}

main().catch(async (err) => {
  console.error("[e2e] failed:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
