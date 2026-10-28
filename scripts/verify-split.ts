import { computeCharge } from "../src/lib/fees.js";

async function main() {
  const [reference, collectionArg] = process.argv.slice(2);
  const key = process.env.PAYSTACK_SECRET_KEY ?? "";

  if (!reference || !collectionArg) {
    console.error("Usage: verify-split.ts <reference> <collectionNaira>");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_")) {
    console.error("Refusing to run: PAYSTACK_SECRET_KEY must be a test key (sk_test_...).");
    process.exit(1);
  }

  const collection = Number(collectionArg);
  const expected = computeCharge(collection, "paystack");

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = (await res.json()) as {
    status: boolean;
    message: string;
    data?: {
      status: string;
      amount: number; // kobo
      fees: number; // kobo
      fees_split?: Record<string, number> | null;
      subaccount?: { subaccount_code?: string } | null;
      split?: unknown;
    };
  };

  if (!res.ok || !body.status || !body.data) {
    console.error("Paystack verify failed:", body.message ?? res.status);
    process.exit(1);
  }

  const d = body.data;
  const kobo = (n: number) => n / 100;
  const naira = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  console.log("\n== Paystack says ==");
  console.log("status            :", d.status);
  console.log("charged to payer  :", naira(kobo(d.amount)));
  console.log("Paystack fee      :", naira(kobo(d.fees)));
  console.log("fees_split        :", JSON.stringify(d.fees_split ?? null, null, 2));

  console.log("\n== Jeneviv expects ==");
  console.log("payer total       :", naira(expected.total));
  console.log("platform fee      :", naira(expected.platformFee));
  console.log("Paystack fee      :", naira(expected.gatewayFee));
  console.log("merchant receives :", naira(expected.amount));

  const chargedNaira = kobo(d.amount);
  const diff = Math.round((chargedNaira - expected.total) * 100) / 100;
  console.log("\n== Result ==");
  if (diff === 0) {
    console.log("Payer total matches the expected total.");
  } else {
    console.log(`Payer total differs by ${naira(diff)}. Do not go live until this is explained.`);
  }
  console.log(
    "Check fees_split by hand: the subaccount should show the collection amount and the main account should show the platform fee.",
  );
}

main();