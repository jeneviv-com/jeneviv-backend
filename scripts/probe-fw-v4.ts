import { fwRequest } from "../src/gateways/flutterwave/client.js";

async function main(): Promise<void> {
  console.log("[probe] creating customer...");
  const customerRes = await fwRequest<{
    status?: string;
    data: { id: string; email: string };
  }>({
    method: "POST",
    path: "/customers",
    body: { email: `probe-${Date.now()}@example.com` },
  });
  console.log("  customer:", customerRes.data);
  const customerId = customerRes.data.data.id;

  console.log("\n[probe] creating virtual account (using env bank_code)...");
  const reference = `probe${Date.now()}`;
  try {
    const vaRes = await fwRequest<unknown>({
      method: "POST",
      path: "/virtual-accounts",
      body: {
        currency: "NGN",
        account_type: "dynamic",
        reference,
        amount: 100,
        customer_id: customerId,
        narration: "Jeneviv probe",
        expiry: 1200,
        bank_code: process.env.FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE,
      },
    });
    console.log("  virtual_account:", JSON.stringify(vaRes.data, null, 2));
  } catch (err) {
    console.log("  ERROR:", err);
    if (err && typeof err === "object" && "raw" in err) {
      console.log("  RAW:", JSON.stringify((err as { raw: unknown }).raw, null, 2));
    }
  }
}

main().catch((err) => {
  console.error("[probe] failed:", err);
  process.exit(1);
});
