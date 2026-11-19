/** "+234 801 234 5678" / "2348012345678" / "08012345678" -> "08012345678"; else undefined. */
export function normaliseNgPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0\d{10}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `0${digits}`;
  return undefined;
}
