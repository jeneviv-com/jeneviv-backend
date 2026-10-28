import { runNotificationBatcher } from "./notification-batcher.js";
import { runRefreshBanks } from "./refresh-banks.js";
import { runScheduledPayouts } from "./scheduled-payouts.js";
import { runSettleWallet } from "./settle-wallet.js";

export interface JobDefinition {
  name: string;
  description: string;
  /** Crontab expression to set in Railway's cron job UI (UTC). */
  cron: string;
  run: () => Promise<unknown>;
}

const payoutJobs: Record<string, JobDefinition> = {
  "settle-wallet": {
    name: "settle-wallet",
    description:
      "Promote successful transactions older than 24h from wallet_balance to payouts_balance.",
    cron: "0 2 * * *",
    run: () => runSettleWallet(),
  },
  "scheduled-payouts-daily": {
    name: "scheduled-payouts-daily",
    description:
      "Initiate payouts for merchants on payout_mode='auto_daily' with payouts_balance above the minimum.",
    cron: "0 4 * * *",
    run: () => runScheduledPayouts("auto_daily"),
  },
  "scheduled-payouts-weekly": {
    name: "scheduled-payouts-weekly",
    description:
      "Initiate payouts for merchants on payout_mode='auto_weekly' with payouts_balance above the minimum.",
    cron: "0 4 * * MON",
    run: () => runScheduledPayouts("auto_weekly"),
  },
};

export function getJobs(defaultGatewayName: string): Record<string, JobDefinition> {
  const sharedJobs: Record<string, JobDefinition> = {
    "refresh-banks": {
      name: "refresh-banks",
      description: "Refresh cached bank_codes from the default gateway.",
      cron: "0 3 * * *",
      run: () => runRefreshBanks(),
    },
    "notification-batcher": {
      name: "notification-batcher",
      description:
        "Flush queued merchant email notifications per email_notification_period (Phase 10).",
      cron: "*/15 * * * *",
      run: () => runNotificationBatcher(),
    },
  };
  return defaultGatewayName === "paystack"
    ? sharedJobs
    : { ...sharedJobs, ...payoutJobs };
}

export const jobs = getJobs(process.env.DEFAULT_GATEWAY ?? "flutterwave");

export function listJobs(): Array<{name: string; description: string; cron: string}> {
  return Object.values(jobs).map(({ name, description, cron }) => ({
    name,
    description,
    cron,
  }));
}
