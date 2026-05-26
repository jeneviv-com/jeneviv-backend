import { createHmac } from "node:crypto";
import { env } from "../src/env.js";

type EventCategory = "charge" | "transfer" | "refund";
type EventOutcome = "success" | "failure";

interface Args {
  reference: string;
  amount: number;
  currency: string;
  type: EventOutcome;
  category: EventCategory;
  target: string;
}

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg) continue;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) {
      args[m[1]!] = m[2]!;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }

  if (!args.reference) throw new Error("--reference <ref> is required");
  return {
    reference: args.reference,
    amount: Number(args.amount ?? "0"),
    currency: args.currency ?? "NGN",
    type: (args.type as EventOutcome) ?? "success",
    category: (args.category as EventCategory) ?? "charge",
    target: args.target ?? "http://localhost:3300/api/webhooks/flutterwave",
  };
}

function buildPayload(a: Args): {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
} {
  const wbkId = `wbk_${Math.random().toString(36).slice(2, 14)}`;
  const success = a.type === "success";

  if (a.category === "transfer") {
    const trfId = `trf_${Math.random().toString(36).slice(2, 14)}`;
    return {
      id: wbkId,
      type: success ? "transfer.completed" : "transfer.failed",
      timestamp: Date.now(),
      data: {
        id: trfId,
        reference: a.reference,
        amount: a.amount,
        currency: a.currency,
        status: success ? "succeeded" : "failed",
        ...(success ? {} : { failure_reason: "Simulated transfer failure" }),
      },
    };
  }

  if (a.category === "refund") {
    const rfdId = `rfd_${Math.random().toString(36).slice(2, 14)}`;
    return {
      id: wbkId,
      type: success ? "refund.completed" : "refund.failed",
      timestamp: Date.now(),
      data: {
        id: rfdId,
        reference: a.reference,
        amount: a.amount,
        currency: a.currency,
        status: success ? "succeeded" : "failed",
        ...(success ? {} : { failure_reason: "Simulated refund failure" }),
      },
    };
  }

  const chargeId = `chg_${Math.random().toString(36).slice(2, 14)}`;
  return {
    id: wbkId,
    type: success ? "charge.completed" : "charge.failed",
    timestamp: Date.now(),
    data: {
      id: chargeId,
      reference: a.reference,
      amount: a.amount,
      currency: a.currency,
      status: success ? "succeeded" : "failed",
      created_datetime: new Date().toISOString(),
      processor_response: { code: "00", type: success ? "approved" : "declined" },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = buildPayload(args);
  const rawBody = JSON.stringify(payload);
  const secret = env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!secret) throw new Error("FLUTTERWAVE_WEBHOOK_SECRET is not set");

  const signature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  console.log(`[sim] POST ${args.target}`);
  console.log(`      event_id=${payload.id} type=${payload.type}`);
  console.log(
    `      reference=${args.reference} amount=${args.amount} ${args.currency}`,
  );

  const res = await fetch(args.target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "flutterwave-signature": signature,
    },
    body: rawBody,
  });
  console.log(`[sim] ${res.status} ${await res.text()}`);
}

main().catch((err) => {
  console.error("[sim] failed:", err);
  process.exit(1);
});
