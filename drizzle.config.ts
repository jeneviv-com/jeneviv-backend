import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();

// Never print the full URL: it carries the database password into build logs.
const dbUrl = process.env.DATABASE_URL ?? "";
console.log("Using DATABASE_URL:", dbUrl.replace(/\/\/[^@]*@/, "//***@"));

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
