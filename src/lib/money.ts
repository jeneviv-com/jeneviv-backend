export const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  NGN: 100,
  USD: 100,
};

export function toMinor(amountMajor: number, currency: string): number {
  const factor = MINOR_UNITS_PER_MAJOR[currency];
  if (!factor) throw new Error(`Unsupported currency: ${currency}`);
  return Math.round(amountMajor * factor);
}

export function toMajor(amountMinor: number | bigint, currency: string): number {
  const factor = MINOR_UNITS_PER_MAJOR[currency];
  if (!factor) throw new Error(`Unsupported currency: ${currency}`);
  return Number(amountMinor) / factor;
}

export function formatMoney(amountMinor: number | bigint, currency: string): string {
  return `${currency} ${toMajor(amountMinor, currency).toFixed(2)}`;
}
