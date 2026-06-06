import { createHmac } from "node:crypto";
import { env } from "../src/env.js";

type EventCategory = "charge" | "refund";
type EventOutcome = "success" | "failure";

interface Args {
  reference: string;
  amount: number;
  fees: number;
  currency: string;
  type: EventOutcome;
  category: EventCategory;
  id: string;
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
    fees: Number(args.fees ?? "0"),
    currency: args.currency ?? "NGN",
    type: (args.type as EventOutcome) ?? "success",
    category: (args.category as EventCategory) ?? "charge",
    id: args.id ?? String(Math.floor(Math.random() * 1_000_000_000)),
    target: args.target ?? "http://localhost:3300/api/webhooks/paystack",
  };
}

function buildPayload(a: Args): { event: string; data: Record<string, unknown> } {
  const success = a.type === "success";

  if (a.category === "refund") {
    return {
      event: success ? "refund.processed" : "refund.failed",
      data: {
        id: Number(a.id),
        transaction_reference: a.reference,
        reference: a.reference,
        amount: a.amount,
        currency: a.currency,
        status: success ? "processed" : "failed",
        ...(success ? {} : { merchant_note: "Simulated refund failure" }),
      },
    };
  }

  return {
    event: success ? "charge.success" : "charge.failed",
    data: {
      id: Number(a.id),
      reference: a.reference,
      amount: a.amount,
      fees: a.fees,
      currency: a.currency,
      status: success ? "success" : "failed",
      paid_at: new Date().toISOString(),
      gateway_response: success ? "Approved" : "Declined",
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = buildPayload(args);
  const rawBody = JSON.stringify(payload);
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set");

  const signature = createHmac("sha512", secret).update(rawBody).digest("hex");

  console.log(`[sim] POST ${args.target}`);
  console.log(`      event=${payload.event} id=${args.id}`);
  console.log(
    `      reference=${args.reference} amount=${args.amount} fees=${args.fees} ${args.currency}`,
  );

  const res = await fetch(args.target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
    body: rawBody,
  });
  console.log(`[sim] ${res.status} ${await res.text()}`);
}

main().catch((err) => {
  console.error("[sim] failed:", err);
  process.exit(1);
});
