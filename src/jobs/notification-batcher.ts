import { flushPaymentDigests } from "../modules/merchants/notify.js";

export interface NotificationBatcherResult {
  flushed: number;
  message: string;
}

/**
 * Emails each workspace on an hourly / 6-hourly / 12-hourly / daily period a
 * summary of the payments since its last digest. Immediate emails are sent
 * from the payment webhook instead.
 */
export async function runNotificationBatcher(): Promise<NotificationBatcherResult> {
  const { flushed, skipped, failed } = await flushPaymentDigests();
  return {
    flushed,
    message: `${flushed} digest(s) sent, ${skipped} not yet due, ${failed} failed`,
  };
}
