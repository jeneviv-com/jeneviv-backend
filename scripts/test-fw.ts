import { getDefaultGateway } from "../src/gateways/registry.js";

async function main(): Promise<void> {
  const gateway = getDefaultGateway();
  console.log(`[test-fw] using gateway: ${gateway.name}`);

  const banks = await gateway.listBanks("NG");
  console.log(`[test-fw] received ${banks.length} banks`);
  for (const b of banks.slice(0, 10)) {
    console.log(`  ${b.code}\t${b.name}`);
  }
  if (banks.length > 10) console.log(`  ... +${banks.length - 10} more`);
}

main().catch((err) => {
  console.error("[test-fw] failed:", err);
  process.exit(1);
});
