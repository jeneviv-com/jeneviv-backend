import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

dotenv.config();

/**
 * Applies pending migrations from ./drizzle.
 *
 * `start` runs this before the server so a deploy that adds tables cannot serve
 * traffic against a database that does not have them — which is exactly how the
 * workspace tables went missing and every invite call returned a 500. Running it
 * against an already-migrated database is a no-op.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must be set");

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

let applied = false;
for (let attempt = 1; attempt <= ATTEMPTS && !applied; attempt += 1) {
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    applied = true;
    console.log("[migrate] database schema is up to date");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const thrownCause = (err as { cause?: unknown }).cause;
    const cause =
      thrownCause instanceof Error ? ` (${thrownCause.message})` : "";
    console.error(`[migrate] attempt ${attempt}/${ATTEMPTS} failed: ${detail}${cause}`);
    if (attempt === ATTEMPTS) process.exitCode = 1;
    else await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  } finally {
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
}

if (process.exitCode === 1) {
  console.error("[migrate] giving up; not starting the server against an unmigrated database");
}
