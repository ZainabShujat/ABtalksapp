import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  intConfigSchema,
  stringConfigSchema,
} from "@/lib/validations/platform-config";

/**
 * Runtime platform configuration (T-148 D-17, T-228).
 *
 * Everything tunable in this codebase has so far lived in `process.env` —
 * `feature-flags.ts`, `match-config.ts`, `pool-policy.ts`. That is the right
 * home for a switch that turns a route on, and the wrong home for a number the
 * business changes: an env var moves only when somebody deploys, and "we would
 * like recruiters to start with $100 instead of $200" should not be a release.
 * So these numbers are rows, and this file is the only way to read them.
 *
 * ## Why a registry rather than free-form keys
 *
 * The registry below is the single declaration of what a key is called, what
 * kind it is, what it may range over and what it means when the row is absent.
 * `PlatformConfigKey` is a union of those names, so a typo is a compile error
 * rather than a setting that silently does not exist — and a setting that does
 * not exist is a setting that does not apply. This is the same argument
 * `entitlements.ts` makes for `PlanLimitKey`.
 *
 * ## Why the fallback is the default and never zero
 *
 * A missing row, a null column and an out-of-range value are all the same kind
 * of event: the database could not tell us what this number is. The tempting
 * answer, `0`, is the one answer that must never be given for a price — a
 * configuration outage would silently make paid contact unlocks free, which is
 * a revenue failure and, because unlocking releases a candidate's contact
 * details, a privacy one too. So an unreadable value resolves to the registry
 * default and says so in the log.
 *
 * `server-only`: this decides what things cost, and a Client Component that
 * could import it is a price the browser is being asked to quote itself.
 */

type IntKeySpec = {
  kind: "int";
  default: number;
  min: number;
  max: number;
  description: string;
};

type StringKeySpec = {
  kind: "string";
  default: string;
  description: string;
};

export const PLATFORM_CONFIG_KEYS = {
  /**
   * What a recruiter workspace is granted the first time it is created.
   *
   * $200.00 is the value T-228 specifies. It is the current *default*, not a
   * constant: changing this row to 10000 makes the next workspace start with
   * $100 and does not touch anybody already granted, because the amount is
   * frozen into the ledger row at grant time.
   */
  "credits.starting_grant_minor": {
    kind: "int",
    default: 20_000,
    min: 0,
    max: 10_000_000,
    description:
      "Credits granted once, when a recruiter workspace is created. USD cents. 20000 = $200.00.",
  },
  /**
   * What one contact unlock costs.
   *
   * **This value is a placeholder, not a product decision.** T-228 does not
   * specify an unlock price, and T-148's "10 credits per unlock" was an
   * illustration against a 100-credit grant that no longer exists — inferring a
   * price from it would be inventing one. Nothing in T-228 reads this key;
   * T-229 will. The row exists now so that when T-229 arrives it finds a
   * configured, non-zero price rather than making one up, and product sets the
   * real number with a single row edit before then.
   *
   * **T-229 must not treat this value as final until product confirms the
   * price.** Reviewed and held as a placeholder on 2026-09-10.
   */
  "credits.contact_unlock_cost_minor": {
    kind: "int",
    default: 1_000,
    min: 1,
    max: 1_000_000,
    description:
      "PLACEHOLDER — product must set this before T-229 ships. Cost of one contact unlock, USD cents.",
  },
  /**
   * T-231 balance warnings. Presentation thresholds only: they change what the
   * recruiter is told, never what the server lets them spend. A balance at or
   * below the value shows the warning. $50 ≈ five unlocks, $20 ≈ two.
   */
  "credits.low_balance_threshold_minor": {
    kind: "int",
    default: 5_000,
    min: 0,
    max: 10_000_000,
    description:
      "Balance at or below which recruiters see a low-credit warning. USD cents. 5000 = $50.00.",
  },
  "credits.very_low_balance_threshold_minor": {
    kind: "int",
    default: 2_000,
    min: 0,
    max: 10_000_000,
    description:
      "Balance at or below which recruiters see a very-low-credit warning. USD cents. 2000 = $20.00.",
  },
  "credits.currency": {
    kind: "string",
    default: "USD",
    description: "ISO currency code credit amounts are denominated in.",
  },
} as const satisfies Record<string, IntKeySpec | StringKeySpec>;

type Registry = typeof PLATFORM_CONFIG_KEYS;

export type PlatformConfigKey = keyof Registry;

export type IntConfigKey = {
  [K in PlatformConfigKey]: Registry[K]["kind"] extends "int" ? K : never;
}[PlatformConfigKey];

export type StringConfigKey = {
  [K in PlatformConfigKey]: Registry[K]["kind"] extends "string" ? K : never;
}[PlatformConfigKey];

/** Named so call sites read as intent rather than as a string literal. */
export const STARTING_GRANT_KEY = "credits.starting_grant_minor" satisfies IntConfigKey;
export const CONTACT_UNLOCK_COST_KEY =
  "credits.contact_unlock_cost_minor" satisfies IntConfigKey;
export const LOW_BALANCE_THRESHOLD_KEY =
  "credits.low_balance_threshold_minor" satisfies IntConfigKey;
export const VERY_LOW_BALANCE_THRESHOLD_KEY =
  "credits.very_low_balance_threshold_minor" satisfies IntConfigKey;
export const CREDITS_CURRENCY_KEY = "credits.currency" satisfies StringConfigKey;

/**
 * The fail-closed resolution rule, separated from the database so it can be
 * tested exhaustively without one. Given whatever the row held — including
 * nothing — this returns a value the rest of the system may safely spend.
 */
export function resolveIntConfig(
  key: IntConfigKey,
  raw: number | null | undefined,
): number {
  const spec = PLATFORM_CONFIG_KEYS[key] as IntKeySpec;
  if (raw === null || raw === undefined) return spec.default;

  const parsed = intConfigSchema(spec.min, spec.max).safeParse(raw);
  if (!parsed.success) {
    logger.warn("[platform-config] value out of range; using default", {
      key,
      raw,
      min: spec.min,
      max: spec.max,
      fallback: spec.default,
    });
    return spec.default;
  }
  return parsed.data;
}

export function resolveStringConfig(
  key: StringConfigKey,
  raw: string | null | undefined,
): string {
  const spec = PLATFORM_CONFIG_KEYS[key] as StringKeySpec;
  if (raw === null || raw === undefined) return spec.default;

  const parsed = stringConfigSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("[platform-config] value invalid; using default", {
      key,
      fallback: spec.default,
    });
    return spec.default;
  }
  return parsed.data;
}

/**
 * One read per key per request. Deliberately request-scoped and not
 * process-scoped: the entire point of the table is that an edit takes effect
 * without a deployment, and a module-level cache would hold a stale price for
 * as long as the server process lived.
 */
const loadConfigRow = cache(async (key: string) => {
  try {
    return await prisma.platformConfig.findUnique({
      where: { key },
      select: { intValue: true, stringValue: true },
    });
  } catch (error) {
    logger.error("[platform-config] read failed; callers will use defaults", {
      key,
      error: String(error),
    });
    return null;
  }
});

export async function getIntConfig(key: IntConfigKey): Promise<number> {
  const row = await loadConfigRow(key);
  return resolveIntConfig(key, row?.intValue);
}

export async function getStringConfig(key: StringConfigKey): Promise<string> {
  const row = await loadConfigRow(key);
  return resolveStringConfig(key, row?.stringValue);
}
