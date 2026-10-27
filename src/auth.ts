import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins"; // FIX: new import
import { db } from "./db/index.js";
import { accounts, sessions, users, verifications } from "./db/schema.js";
import { env } from "./env.js";

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