import { fwRequest } from "../src/gateways/flutterwave/client.js";

async function probe(body: Record<string, unknown>): Promise<void> {
  console.log("\n--- POST /refunds with body:", JSON.stringify(body));
  try {
    const res = await fwRequest({
      method: "POST",
      path: "/refunds",
      headers: { "X-Idempotency-Key": "probe" + Date.now() + Math.random().toString(16).slice(2, 4) },
      body,
    });
    console.log("OK", JSON.stringify(res.data, null, 2));
  } catch (e) {
    const err = e as { status?: number; message?: string; raw?: unknown };
    console.log("ERR", err.status, err.message);
    if (err.raw) console.log("RAW", JSON.stringify(err.raw, null, 2));
  }
}

await probe({ charge_id: "chg_bh7iiietxk9", amount: 1500, currency: "NGN" });
await probe({ charge_id: "chg_bh7iiietxk9", amount: 1500, currency: "NGN", reason: "requested_by_customer" });
await probe({ charge_id: "chg_bh7iiietxk9", amount: 1500, currency: "NGN", reason: "duplicate" });
