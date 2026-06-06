import { getGateway } from "../src/gateways/registry.js";

async function main(): Promise<void> {
  const gateway = getGateway("paystack");
  console.log(`[test-ps] using gateway: ${gateway.name}`);

  const banks = await gateway.listBanks("nigeria");
  console.log(`[test-ps] received ${banks.length} banks`);
  for (const b of banks.slice(0, 10)) {
    console.log(`  ${b.code}\t${b.name}`);
  }
  if (banks.length > 10) console.log(`  ... +${banks.length - 10} more`);

  const resolved = await gateway.resolveAccountName({
    bankCode: "999992",
    accountNumber: "8165620409",
    currency: "NGN",
  });
  console.log(`[test-ps] resolved account name: ${resolved.accountName}`);
}

main().catch((err) => {
  console.error("[test-ps] failed:", err);
  process.exit(1);
});
