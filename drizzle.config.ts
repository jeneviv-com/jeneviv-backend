import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();

try {
  const u = new URL(process.env.DATABASE_URL ?? "");
  console.log(`Using database ${u.hostname}:${u.port}${u.pathname} (credentials hidden)`);
} catch {
  console.log("DATABASE_URL is missing or invalid");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
