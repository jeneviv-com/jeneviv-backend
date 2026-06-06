import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { merchants, type Merchant } from "../db/schema/merchants.js";
import { env } from "../env.js";
import { toMinor } from "../lib/money.js";
import { initiatePayout, directSettlementActive } from "../modules/payouts/service.js";

export interface ScheduledPayoutsResult {
  mode: "auto_daily" | "auto_weekly";
  eligible: number;
  initiated: number;
  errors: number;
}

const MIN_NGN_MINOR = toMinor(env.AUTO_PAYOUT_MIN_NGN_MAJOR, "NGN");

async function listEligibleMerchants(
  mode: "auto_daily" | "auto_weekly",
): Promise<Merchant[]> {
  return db
    .select()
    .from(merchants)
    .where(
      and(
        eq(merchants.status, "approved"),
        eq(merchants.payoutMode, mode),
        isNotNull(merchants.defaultBankAccountId),
        gte(merchants.payoutsBalanceNgn, MIN_NGN_MINOR),
      ),
    );
}

export async function runScheduledPayouts(
  mode: "auto_daily" | "auto_weekly",
): Promise<ScheduledPayoutsResult> {
  // Direct-settlement gateways (Paystack) disburse to merchants automatically.
  if (directSettlementActive()) {
    return { mode, eligible: 0, initiated: 0, errors: 0 };
  }

  const eligible = await listEligibleMerchants(mode);

  let initiated = 0;
  let errors = 0;
  for (const merchant of eligible) {
    if (!merchant.defaultBankAccountId) continue;
    try {
      await initiatePayout({
        merchant,
        bankAccountId: merchant.defaultBankAccountId,
        amount: merchant.payoutsBalanceNgn,
        currency: "NGN",
        initiatedBy: "cron",
        initiatedByUid: null,
        narration: `Auto payout (${mode})`,
      });
      initiated += 1;
    } catch (err) {
      errors += 1;
      console.error(
        `[scheduled-payouts] merchant=${merchant.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    mode,
    eligible: eligible.length,
    initiated,
    errors,
  };
}
