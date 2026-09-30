/**
 * The résumé email is the pre-registration identity (plan 154): the address a
 * student's verified Google sign-in must match to claim their import. Pure.
 */
import { z } from "zod";

const emailSchema = z.email();

/** trim, strip `mailto:` / `<…>`, lowercase, validate. Null when not an email. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  if (v.toLowerCase().startsWith("mailto:")) v = v.slice("mailto:".length);
  v = v.replace(/^<+|>+$/g, "").trim().toLowerCase();
  if (v.length === 0 || v.length > 254) return null;
  return emailSchema.safeParse(v).success ? v : null;
}

export type ResolvedImportEmail =
  | { kind: "single"; email: string; source: string }
  | { kind: "none" }
  | { kind: "conflict"; candidates: string[] };

/**
 * Decide the identity email from the parser's primary `email` and its
 * `all_emails` list. Several distinct addresses is a conflict for a human —
 * never silently pick one, because picking wrong hands a profile to the wrong
 * Google account.
 */
export function resolveImportEmail(
  primary: string | null,
  all: readonly string[],
): ResolvedImportEmail {
  const seen = new Map<string, string>();
  for (const raw of [primary, ...all]) {
    const n = normalizeEmail(raw);
    if (n && !seen.has(n)) seen.set(n, (raw ?? "").trim());
  }
  if (seen.size === 0) return { kind: "none" };
  if (seen.size > 1) return { kind: "conflict", candidates: [...seen.keys()] };
  const [email, source] = [...seen.entries()][0]!;
  return { kind: "single", email, source };
}
