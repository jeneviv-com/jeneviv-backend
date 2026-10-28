import { env } from "../env.js";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file contents. */
  content: string;
}

/**
 * Sends one transactional email through Resend. When Resend isn't configured
 * the email is skipped and logged, so a missing setting never breaks a payment.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn("[email] RESEND_API_KEY or RESEND_FROM_EMAIL is not set; email skipped");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      attachments: args.attachments,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email provider responded ${res.status}`);
  }
}
