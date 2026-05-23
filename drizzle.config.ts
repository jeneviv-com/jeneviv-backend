import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();

console.log("Using DATABASE_URL:", process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
