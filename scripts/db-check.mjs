/**
 * Read-only database check for the workspace tables. Prints table presence and
 * the applied migration count, never the connection string.
 *
 *   node --env-file=.env scripts/db-check.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const [identity] = await sql`
  select current_database() as db, current_user as usr, inet_server_addr()::text as host
`;
console.log("connected:", identity);

for (const table of ["workspace_members", "workspace_invites", "merchants"]) {
  const [row] = await sql`select to_regclass(${`public.${table}`}) as reg`;
  console.log(`${table}:`, row.reg ? "present" : "MISSING");
}

try {
  const [row] = await sql`
    select count(*)::int as applied, max(created_at) as latest
    from drizzle.__drizzle_migrations
  `;
  console.log("migrations:", row);
} catch (err) {
  console.log("migrations: could not read journal —", err.message);
}

await sql.end();
