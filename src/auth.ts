import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins"; // FIX: new import
import { db } from "./db/index.js";
import { accounts, sessions, users, verifications } from "./db/schema.js";
import { env } from "./env.js";
import { sendEmail } from "./lib/email.js";
import { passwordResetEmail, resetPasswordUrl } from "./lib/password-reset-email.js";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = Boolean(googleClientId && googleClientSecret);

if (!googleEnabled) {
  console.warn(
    "[AUTH] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — Google sign-in disabled, email + password still available.",
  );
}

export const auth = betterAuth({
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Reset links are single-use, expire after an hour, and signing in
    // elsewhere is ended by a reset so a stolen session cannot survive it.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const url = resetPasswordUrl(token);
      try {
        await sendEmail({
          to: user.email,
          subject: "Reset your Jeneviv password",
          html: passwordResetEmail({ name: user.name, url }),
        });
      } catch (error) {
        console.error("[AUTH] Could not send the password reset email", error);
        throw new Error(
          "We could not send the reset email. Please try again in a moment.",
        );
      }
    },
  },
  user: {
    additionalFields: {
      // Without this the session user comes back without `role`, so the
      // dashboard's `isAdmin` check is never true and the admin console (and
      // the merchant approval queue behind it) is unreachable. `input: false`
      // keeps it out of sign-up payloads — only the database sets a role.
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
            prompt: "select_account",
          },
        },
      }
    : {}),
  plugins: [bearer()], // FIX: lets Authorization: Bearer <token> resolve a session
  trustedOrigins: [
    baseURL,
    ...env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
});