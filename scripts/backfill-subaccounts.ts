import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { merchantBankAccounts, merchants } from "../src/db/schema/merchants.js";
import { getDefaultGateway } from "../src/gateways/registry.js";
import { ensureMerchantSubaccount } from "../src/modules/merchants/service.js";
import { directSettlementActive } from "../src/modules/payouts/service.js";

/**
 * One-off migration helper: Paystack collections can only be created for a
 * merchant that has a split subaccount, and existing merchants were onboarded
 * before the switch. Create (or refresh) the subaccount for every approved
 * merchant whose default bank account is already saved.
 *
 * Run with: pnpm tsx scripts/backfill-subaccounts.ts
 */
async function main(): Promise<void> {
  if (!directSettlementActive()) {
    console.error(
      "The active gateway does not use split subaccounts. Set DEFAULT_GATEWAY=paystack first.",
    );
    process.exitCode = 1;
    return;
  }

  const gateway = getDefaultGateway();
  const approved = await db
    .select()
    .from(merchants)
    .where(
      and(
        eq(merchants.status, "approved"),
        isNotNull(merchants.defaultBankAccountId),
      ),
    );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const merchant of approved) {
    if (!merchant.defaultBankAccountId) {
      skipped += 1;
      continue;
    }

    if (merchant.gatewaySubaccountIds?.[gateway.name]) {
      skipped += 1;
      continue;
    }

    const bank = await db.query.merchantBankAccounts.findFirst({
      where: eq(merchantBankAccounts.id, merchant.defaultBankAccountId),
    });
    if (!bank?.verifiedAt) {
      skipped += 1;
      continue;
    }

    try {
      await ensureMerchantSubaccount(merchant, bank);
      created += 1;
      console.log(`created  ${merchant.id}  ${merchant.displayName ?? ""}`);
    } catch (err) {
      failed += 1;
      console.error(
        `failed   ${merchant.id}  ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `\n${created} created · ${skipped} skipped · ${failed} failed · ${approved.length} approved merchants with a default bank`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$client.end();
  });
