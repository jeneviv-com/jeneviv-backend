import { createHmac } from "node:crypto";
import { env } from "../src/env.js";
import {
  assertPayoutsEnabled,
  directSettlementActive,
} from "../src/modules/payouts/service.js";
import { ingestPaystackWebhook } from "../src/modules/webhooks/service.js";

function sign(raw: string): string {
  return createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
}

function ok(label: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main(): Promise<void> {
  // 1. Payout guard active under Paystack (direct settlement).
  ok("directSettlementActive() is true for Paystack", directSettlementActive());
  let guarded = false;
  try {
    assertPayoutsEnabled();
  } catch {
    guarded = true;
  }
  ok("assertPayoutsEnabled() throws under Paystack", guarded);

  // 2. Bad signature is rejected.
  const payload = {
    event: "charge.success",
    data: {
      id: Math.floor(Math.random() * 1_000_000_000),
      reference: `verify_ps_${Date.now()}`,
      amount: 525767,
      fees: 18267,
      currency: "NGN",
      status: "success",
      paid_at: new Date().toISOString(),
      gateway_response: "Approved",
    },
  };
  const raw = JSON.stringify(payload);

  const bad = await ingestPaystackWebhook(Buffer.from(raw), {
    "x-paystack-signature": "deadbeef",
  });
  ok("bad signature => 401 invalid", bad.httpStatus === 401);

  // 3. Valid signature, unknown reference => accepted + recorded (no-op on tx).
  const headers = { "x-paystack-signature": sign(raw) };
  const first = await ingestPaystackWebhook(Buffer.from(raw), headers);
  ok("valid signature => 200 ok", first.result.status === "ok");

  // 4. Replay is idempotent.
  const replay = await ingestPaystackWebhook(Buffer.from(raw), headers);
  ok("replay => duplicate (idempotent)", replay.result.status === "duplicate");

  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("verify-ps failed:", err);
  process.exit(1);
});
