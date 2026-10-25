import { env } from "../env.js";

export interface SmsResult {
  delivered: boolean;
  provider: "termii" | "mock" | "none";
  error?: string;
}

/**
 * Termii is the delivery channel for treasurer OTPs. Without it, local dev can
 * still exercise the flow by logging the message when provider mocks are on.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  if (!env.TERMII_API_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      console.log(`[sms:mock] to=${to} ${message}`);
      return { delivered: true, provider: "mock" };
    }
    return {
      delivered: false,
      provider: "none",
      error:
        "SMS is not configured. Set TERMII_API_KEY to deliver treasurer OTPs.",
    };
  }

  try {
    const response = await fetch(
      new URL("/api/sms/send", env.TERMII_BASE_URL),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          api_key: env.TERMII_API_KEY,
          to,
          from: env.TERMII_SENDER_ID,
          sms: message,
          type: "plain",
          channel: "generic",
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!response.ok) {
      return {
        delivered: false,
        provider: "termii",
        error: body.message ?? `SMS provider returned ${response.status}`,
      };
    }
    return { delivered: true, provider: "termii" };
  } catch {
    return {
      delivered: false,
      provider: "termii",
      error: "Could not reach the SMS provider.",
    };
  }
}
