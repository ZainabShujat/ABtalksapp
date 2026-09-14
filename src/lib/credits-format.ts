/**
 * Credits as a person reads them. `20000` → `"$200.00"`.
 *
 * Its own file, deliberately. The reads that produce this number live in
 * `features/hire/credits.ts`, which is `server-only` because it resolves a
 * workspace from the session — and a balance is exactly the sort of thing a
 * Client Component ends up rendering. A formatter behind a server-only import
 * is a formatter that gets quietly re-written, slightly differently, in the
 * first component that needs it, and two roundings of the same money is a bug
 * report nobody enjoys.
 *
 * Pure: no DB, no `server-only`. Safe on both sides of the boundary.
 */

/**
 * @param minor USD minor units (cents). Always an integer — the ledger has no
 * other kind of amount, and dividing only happens here, at the very last step.
 */
export function formatCreditsMinor(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * The same amount spelled as credits, for hover text. One credit is one
 * dollar, so `20000` → `"200 credits"`.
 */
export function formatCreditsSpelled(minor: number): string {
  const credits = minor / 100;
  const text = Number.isInteger(credits)
    ? credits.toLocaleString("en-US")
    : credits.toLocaleString("en-US", { minimumFractionDigits: 2 });
  return `${text} ${credits === 1 ? "credit" : "credits"}`;
}

/** T-231 warning states. Thresholds come from `PlatformConfig`, never from here. */
export type CreditLevel = "normal" | "low" | "very-low" | "empty";

export type CreditThresholds = { lowMinor: number; veryLowMinor: number };

/**
 * `empty` means the next paid unlock cannot be afforded — not merely $0 —
 * because that is the moment the recruiter is actually blocked.
 */
export function creditLevel(
  balanceMinor: number,
  thresholds: CreditThresholds,
  unlockCostMinor: number,
): CreditLevel {
  if (balanceMinor <= 0 || balanceMinor < unlockCostMinor) return "empty";
  if (balanceMinor <= thresholds.veryLowMinor) return "very-low";
  if (balanceMinor <= thresholds.lowMinor) return "low";
  return "normal";
}
