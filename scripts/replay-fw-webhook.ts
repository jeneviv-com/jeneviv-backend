import { createHmac } from "node:crypto";
import { env } from "../src/env.js";

const reference = process.argv[2];
const eventId = process.argv[3] ?? `wbk_dup_${Date.now()}`;
if (!reference) {
  console.error("usage: tsx scripts/replay-fw-webhook.ts <reference> [event_id]");
  process.exit(1);
}

const payload = {
  id: eventId,
  type: "charge.completed",
  timestamp: Date.now(),
  data: {
    id: `chg_replay_${Date.now()}`,
    reference,
    amount: 1575,
    currency: "NGN",
    status: "succeeded",
    created_datetime: new Date().toISOString(),
    processor_response: { code: "00", type: "approved" },
  },
};

const rawBody = JSON.stringify(payload);
const signature = createHmac("sha256", env.FLUTTERWAVE_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("base64");

async function fire(label: string): Promise<void> {
  const res = await fetch("http://localhost:3300/api/webhooks/flutterwave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "flutterwave-signature": signature,
    },
    body: rawBody,
  });
  console.log(`[${label}] ${res.status} ${await res.text()}`);
}

await fire("first");
await fire("replay");
