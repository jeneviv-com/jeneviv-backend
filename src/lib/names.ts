const TITLES = new Set([
  "MR",
  "MRS",
  "MISS",
  "MS",
  "DR",
  "PROF",
  "CHIEF",
  "ALHAJI",
  "ALHAJA",
  "PASTOR",
  "REV",
]);

export function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 1 && !TITLES.has(part))
    .join(" ")
    .trim();
}

export function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(/\s+/)
    .filter((part) => part.length > 1);
}

/**
 * Bank records routinely reorder or drop a middle name, so require the smaller
 * name to be almost fully contained in the larger one instead of an exact
 * string match. Short/one-token names must match exactly.
 */
export function namesMatch(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left.length === 1 || right.length === 1) {
    return left[0] === right[0];
  }
  const [small, large] =
    left.length <= right.length
      ? [left, new Set(right)]
      : [right, new Set(left)];
  const hits = small.filter((token) => large.has(token)).length;
  return hits / small.length >= 0.8 && hits >= 2;
}
