import "server-only";
import { z } from "zod";

import { cache } from "react";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/features/admin/audit";
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
   * $20,000.00 is the current *default*, not a constant: changing this row to
   * 10000 makes the next workspace start with $100 and does not touch anybody
   * already granted, because the amount is frozen into the ledger row at grant
   * time.
   */
  "credits.starting_grant_minor": {
    kind: "int",
    default: 2_000_000,
    min: 0,
    max: 10_000_000,
    description:
      "Credits granted once, when a recruiter workspace is created. USD cents. 2000000 = $20000.00.",
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
  /*
   * Workshop surface controls. Plan 163 phase 3b.
   *
   * These four are deliberately independent of each other and of the workshop
   * lifecycle: the mode does not depend on a poster, the calendar toggle does
   * not depend on the mode, and none of them feed the countdown — that comes
   * from the event's own date and time.
   */
  "workshop.mode": {
    kind: "string",
    default: "LIVE",
    description:
      "LIVE or COMING_SOON. COMING_SOON hides the workshop hero even when one is published. With no eligible published workshop the page shows Coming Soon regardless — this key can only force it ON, never off.",
  },
  "workshop.calendar_visible": {
    kind: "int",
    default: 1,
    min: 0,
    max: 1,
    description:
      "1 shows the events calendar at the bottom of /workshop, 0 hides it. Independent of the workshop lifecycle and of workshop.mode.",
  },
  "workshop.zoom_link": {
    kind: "string",
    default: "",
    description: "Joining link for the live workshop. Replaces the Supabase workshop_config row.",
  },
  "workshop.whatsapp_link": {
    kind: "string",
    default:
      "https://chat.whatsapp.com/LDUvHRIlb5dGHpDJLueR9i?s=cl&p=a&mlu=0&amv=0",
    description:
      "WhatsApp community link shown after registering. Default is the value the Supabase workshop_config row carried.",
  },
  "workshop.coming_soon_message": {
    kind: "string",
    default: "",
    description:
      "Optional line shown on the Coming Soon screen. Empty uses the built-in copy.",
  },
  /**
   * D-11: first N completed mock interviews are free. Missing row uses 3,
   * never 0, so a config outage does not silently make every mock paid.
   */
  "mock.free_allowance": {
    kind: "int",
    default: 3,
    min: 0,
    max: 100,
    description: "Completed mock interviews that cost zero Synergy Points.",
  },
  /**
   * D-11: Synergy Points for a mock after the free allowance. Missing row uses
   * 50, never 0, so a config outage does not make paid mocks free.
   */
  "mock.point_cost": {
    kind: "int",
    default: 50,
    min: 0,
    max: 1_000_000,
    description:
      "Synergy Points charged when completed mocks are at or above the free allowance. 0 means paid attempts stay free.",
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
export const MOCK_FREE_ALLOWANCE_KEY = "mock.free_allowance" satisfies IntConfigKey;
export const MOCK_POINT_COST_KEY = "mock.point_cost" satisfies IntConfigKey;
export const WORKSHOP_MODE_KEY = "workshop.mode" satisfies StringConfigKey;
export const WORKSHOP_CALENDAR_VISIBLE_KEY =
  "workshop.calendar_visible" satisfies IntConfigKey;
export const WORKSHOP_ZOOM_LINK_KEY = "workshop.zoom_link" satisfies StringConfigKey;
export const WORKSHOP_WHATSAPP_LINK_KEY =
  "workshop.whatsapp_link" satisfies StringConfigKey;
export const WORKSHOP_COMING_SOON_MESSAGE_KEY =
  "workshop.coming_soon_message" satisfies StringConfigKey;

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

export async function writeIntConfig(input: {
  key: IntConfigKey;
  intValue: number;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  const spec = PLATFORM_CONFIG_KEYS[input.key];
  if (spec.kind !== "int") {
    throw new Error(`Unknown integer config key: ${input.key}`);
  }
  const parsed = intConfigSchema(spec.min, spec.max).safeParse(input.intValue);
  if (!parsed.success) {
    throw new Error(
      `${input.key} must be an integer between ${spec.min} and ${spec.max}.`,
    );
  }

  await writeClient().$transaction(async (tx) => {
    const existing = await tx.platformConfig.findUnique({
      where: { key: input.key },
      select: { intValue: true },
    });
    const previous = resolveIntConfig(input.key, existing?.intValue);

    await tx.platformConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        intValue: parsed.data,
        description: spec.description,
        updatedByUserId: input.actorUserId,
      },
      update: {
        intValue: parsed.data,
        updatedByUserId: input.actorUserId,
      },
    });

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      adminUserId: input.actorUserId,
      targetUserId: null,
      entityType: "PlatformConfig",
      entityId: input.key,
      actionType: "PLATFORM_CONFIG_UPDATE",
      reason: input.reason,
      previousState: { intValue: previous },
      newState: { intValue: parsed.data },
    });
  });
}

/**
 * Write a string config value.
 *
 * The registry had `getStringConfig` and `resolveStringConfig` but no writer,
 * so every string key was read-only and an admin could not change one at all
 * (plan 163 §3b found this). Mirrors `writeIntConfig` exactly — validate, then
 * upsert and audit in one transaction — rather than introducing a second
 * config mechanism.
 *
 * **Empty is allowed only where the default is empty.** `stringConfigSchema`
 * is `.min(1)`, which is right for `credits.currency` — a blank currency is a
 * bug — but wrong for `workshop.coming_soon_message`, where blank is the
 * meaningful "use the built-in copy". Keying it off the spec's own default
 * keeps that judgement with the key instead of in a list someone has to
 * maintain.
 */
export async function writeStringConfig(input: {
  key: StringConfigKey;
  stringValue: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  const spec = PLATFORM_CONFIG_KEYS[input.key] as StringKeySpec;
  if (spec.kind !== "string") {
    throw new Error(`Unknown string config key: ${input.key}`);
  }

  const allowEmpty = spec.default === "";
  const schema = allowEmpty
    ? z.string().trim().max(200)
    : stringConfigSchema;
  const parsed = schema.safeParse(input.stringValue);
  if (!parsed.success) {
    throw new Error(
      allowEmpty
        ? `${input.key} must be 200 characters or fewer.`
        : `${input.key} must be between 1 and 200 characters.`,
    );
  }

  await writeClient().$transaction(async (tx) => {
    const existing = await tx.platformConfig.findUnique({
      where: { key: input.key },
      select: { stringValue: true },
    });
    const previous = resolveStringConfig(input.key, existing?.stringValue);

    await tx.platformConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        stringValue: parsed.data,
        description: spec.description,
        updatedByUserId: input.actorUserId,
      },
      update: {
        stringValue: parsed.data,
        updatedByUserId: input.actorUserId,
      },
    });

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      adminUserId: input.actorUserId,
      targetUserId: null,
      entityType: "PlatformConfig",
      entityId: input.key,
      actionType: "PLATFORM_CONFIG_UPDATE",
      reason: input.reason,
      previousState: { stringValue: previous },
      newState: { stringValue: parsed.data },
    });
  });
}
