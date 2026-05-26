import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bankCodes, type BankCode } from "../../db/schema/platform.js";
import { getDefaultGateway } from "../../gateways/registry.js";

async function seedBanksForGateway(country: string): Promise<void> {
  const gateway = getDefaultGateway();
  const remote = await gateway.listBanks(country);

  const seen = new Set<string>();
  const rows = remote
    .filter((b) => {
      if (!b.code || seen.has(b.code)) return false;
      seen.add(b.code);
      return true;
    })
    .map((b) => ({
      code: b.code,
      gateway: gateway.name,
      country,
      name: b.name,
    }));

  if (rows.length === 0) return;
  await db.insert(bankCodes).values(rows).onConflictDoNothing();
}

export async function listBanks(country: string): Promise<BankCode[]> {
  const gateway = getDefaultGateway();
  const filter = and(
    eq(bankCodes.gateway, gateway.name),
    eq(bankCodes.country, country),
  );

  let rows = await db.query.bankCodes.findMany({
    where: filter,
    orderBy: asc(bankCodes.name),
  });

  if (rows.length === 0) {
    await seedBanksForGateway(country);
    rows = await db.query.bankCodes.findMany({
      where: filter,
      orderBy: asc(bankCodes.name),
    });
  }

  return rows;
}

export async function refreshBanks(country: string): Promise<number> {
  await seedBanksForGateway(country);
  const gateway = getDefaultGateway();
  const rows = await db.query.bankCodes.findMany({
    where: and(
      eq(bankCodes.gateway, gateway.name),
      eq(bankCodes.country, country),
    ),
  });
  return rows.length;
}
