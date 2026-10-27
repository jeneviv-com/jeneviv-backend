import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema/auth.js";

/**
 * Grant (or revoke) the platform admin role.
 *
 * Nothing in the product can create the first admin: `users.role` defaults to
 * "user" and only an existing admin can reach /api/admin. Until this runs there
 * is no account that can approve workspaces, so the merchant approval queue is
 * unreachable.
 *
 * Run with:  pnpm tsx scripts/grant-admin.ts you@example.com
 * Revoke with: pnpm tsx scripts/grant-admin.ts you@example.com --revoke
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");

  if (!email) {
    console.error(
      "Usage: pnpm tsx scripts/grant-admin.ts <email> [--revoke]",
    );
    process.exitCode = 1;
    return;
  }

  const user = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email}`,
  });
  if (!user) {
    console.error(`No account with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const role = revoke ? "user" : "admin";
  if (user.role === role) {
    console.log(`${email} is already ${role}. Nothing to do.`);
    return;
  }

  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  console.log(`${email} is now ${updated?.role ?? role}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
