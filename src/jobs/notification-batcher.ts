export interface NotificationBatcherResult {
  flushed: number;
  message: string;
}

export async function runNotificationBatcher(): Promise<NotificationBatcherResult> {
  // Phase 10 adds the email_outbox table + Resend client and flushes
  // queued merchant notifications here according to each merchant's
  // email_notification_period (hourly / 6hourly / 12hourly / daily).
  return {
    flushed: 0,
    message: "email_outbox table not yet provisioned (Phase 10)",
  };
}
