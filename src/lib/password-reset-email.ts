import { env } from "../env.js";

/** Shown in the email copy; mirrors `resetPasswordTokenExpiresIn` in auth.ts. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * The dashboard URL the email button opens. Built from the public app origin
 * rather than better-auth's baseURL so the reader lands on the SPA, not the API.
 */
export function resetPasswordUrl(token: string): string {
  const base = env.APP_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT =
  "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Branded reset email. Table-based and inline-styled for email clients. */
export function passwordResetEmail({
  name,
  url,
}: {
  name?: string | null;
  url: string;
}): string {
  const firstName = (name ?? "").trim().split(/\s+/)[0] || "there";
  const safeUrl = escapeHtml(url);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Reset your Jeneviv password</title>
  </head>
  <body style="margin:0;padding:0;background:#f7f7f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e4;border-radius:16px;">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <div style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.04em;color:#101010;">
                  jeneviv<span style="color:#ff4800;">.</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:${FONT};">
                <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#6d6d6d;">
                  Password reset
                </p>
                <h1 style="margin:0;font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.03em;color:#101010;">
                  Hello ${escapeHtml(firstName)}
                </h1>
                <p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#3f3f3f;">
                  Someone asked to reset the password for the Jeneviv account tied to this address.
                  If that was you, choose a new password below.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border-radius:12px;background:#101010;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;">
                  Reset my password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;font-family:${FONT};">
                <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6d6d6d;">
                  This link works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes.
                  If the button does not open, paste this address into your browser:
                </p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;word-break:break-all;color:#101010;">
                  <a href="${safeUrl}" style="color:#dc3e00;text-decoration:underline;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 26px 32px;font-family:${FONT};">
                <div style="border-top:1px solid #efefef;padding-top:18px;">
                  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6d6d6d;">
                    Did not ask for this? You can ignore this email — your password stays the same
                    until someone opens the link above.
                  </p>
                  <p style="margin:14px 0 0 0;font-size:11.5px;color:#9b9b9b;">
                    Jeneviv — one link, every payer. This is an automated message.
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
