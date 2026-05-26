import { refreshBanks } from "../modules/banks/service.js";

export interface RefreshBanksResult {
  country: string;
  total: number;
}

export async function runRefreshBanks(): Promise<RefreshBanksResult[]> {
  const countries = ["NG"];
  const results: RefreshBanksResult[] = [];
  for (const country of countries) {
    const total = await refreshBanks(country);
    results.push({ country, total });
  }
  return results;
}
