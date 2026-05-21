import { db } from "./db";
import { insertUserSchema, users } from "./db/schema";

async function main() {
  // Validate with Zod before inserting
  const newUser = insertUserSchema.parse({
    name: "Emmanuel",
    email: "emmanuel@example.com",
  });

  // Insert
  await db.insert(users).values(newUser);

  // Query all users
  const allUsers = await db.select().from(users);
  console.log(allUsers);

  process.exit(0);
}

main();
