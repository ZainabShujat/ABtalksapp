"use server";

import { headers } from "next/headers";
import { logger } from "@/lib/logger";
import {
  guestMatchSchema,
  guestScoutMessageSchema,
} from "@/lib/validations/hire";
import { runScoutTurn } from "@/features/hire/scout-conversation";
import { searchCandidates } from "@/features/hire/search-candidates";
import { explainMatches } from "@/features/hire/explain-matches";
import { toPublicMatch } from "@/features/hire/to-public-match";
import type { MatchCardData } from "@/components/hire/match-card";
import type { JobSpec } from "@/lib/validations/hire";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 40;
const hits = new Map<string, number[]>();

async function rateLimit(): Promise<boolean> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

/**
 * One Scout turn with no account and no TalentRequest row.
 *
 * The client holds the spec and history. Persistence starts only after an
 * approved recruiter is signed in (sendScoutMessageAction).
 */
export async function sendGuestScoutMessageAction(
  input: unknown,
): Promise<
  ActionResult<{
    assistantMessage: string;
    options: { label: string; value: string }[];
    allowFreeText: boolean;
    readyToSearch: boolean;
    summary: string;
    spec: JobSpec;
    action: "search" | "reset" | null;
  }>
> {
  if (!(await rateLimit())) {
    return { ok: false, message: "Too many questions. Try again in a few minutes." };
  }
  const parsed = guestScoutMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid message." };

  try {
    const turn = await runScoutTurn({
      priorSpec: parsed.data.spec,
      history: parsed.data.history,
      userMessage: parsed.data.message,
    });
    // Same composition as the signed-in path — the two must never drift.
    const assistantMessage = [turn.notice, turn.nextQuestion]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join("\n\n") ||
      "That's everything I need. Ready to search verified talent.";
    return {
      ok: true,
      data: {
        assistantMessage,
        options: turn.options,
        allowFreeText: turn.allowFreeText,
        readyToSearch: turn.readyToSearch,
        summary: turn.summary,
        spec: turn.spec,
        action: turn.action ?? null,
      },
    };
  } catch (error) {
    logger.error("[hire] sendGuestScoutMessageAction", { error: String(error) });
    return { ok: false, message: "Could not continue. Try again." };
  }
}

/**
 * Rank the published, consented pool. Returns anonymised cards only.
 * Nothing is written — a guest search is not demand.
 */
export async function runGuestMatchAction(
  input: unknown,
): Promise<
  ActionResult<{ matches: MatchCardData[]; overallGap: string; matchCount: number }>
> {
  if (!(await rateLimit())) {
    return { ok: false, message: "Too many searches. Try again in a few minutes." };
  }
  const parsed = guestMatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid requirement." };

  try {
    const search = await searchCandidates(parsed.data.spec, { limit: 20 });
    if (!search.ok) return search;
    const explained = await explainMatches(
      search.data.matches,
      search.data.nearMisses,
      parsed.data.spec,
      {
        totalEligible: search.data.totalEligible,
        belowEvidenceFloor: search.data.belowEvidenceFloor,
        coverageNote: search.data.coverage.note,
        stage: search.data.stage,
      },
    );
    return {
      ok: true,
      data: {
        matches: explained.matches.map((m) =>
          toPublicMatch(m, {
            coverageNote: search.data.coverage.note,
            highlightSkills: parsed.data.spec.mustHaveStack,
          }),
        ),
        overallGap: explained.overallGap,
        matchCount: explained.matches.length,
      },
    };
  } catch (error) {
    logger.error("[hire] runGuestMatchAction", { error: String(error) });
    return { ok: false, message: "Search failed. Try again." };
  }
}
