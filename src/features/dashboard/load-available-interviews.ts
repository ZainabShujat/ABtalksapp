import { cache } from "react";
import { getHistory } from "@/features/interview/platform/service";
import {
  listLiveDomains,
  toDomainSummary,
} from "@/features/interview/platform/domains";
import { getCohortInterviewState } from "@/features/interview/cohort-eligibility";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import { toProgramMemberId } from "@/features/interview/provider";
import { isProgramEnabled } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import type {
  AvailableCohortInterview,
  AvailableMockInterview,
} from "@/components/dashboard-hub/mock-interviews";

/** Copy for the two cohort milestones, matching the AI Cohort dashboard card. */
const COHORT_MILESTONES = [
  {
    key: "DAY_15",
    label: "Day 15 Checkpoint Interview",
    blurb: "Test what you've learned across Days 1–15.",
  },
  {
    key: "DAY_31",
    label: "Day 31 Final Interview",
    blurb: "Assess what you've learned across the full cohort.",
  },
] as const;

/**
 * Everything this user can open right now, across both interview systems.
 *
 * Kept out of `getHubData` because it spans two subsystems the hub data layer
 * knows nothing about, and it must not be able to take the hub down: the
 * MockInterview tables exist on demo but the migration has not been applied
 * to production, so `getHistory` throws there until it is. Each half degrades
 * independently — a broken platform must not also hide an eligible cohort
 * interview.
 *
 * Cached per request so the hub page and the site-search catalog share one load.
 */
export const loadAvailableInterviews = cache(
  async (
    userId: string,
  ): Promise<{
    mock: AvailableMockInterview[];
    cohort: AvailableCohortInterview[];
  }> => {
    // LIVE only: the catalogue page lists COMING_SOON domains because the
    // roadmap is part of what that page is for, but this section is an OFFER
    // and must contain nothing the candidate cannot open.
    //
    // One history read serves all three per-domain facts below, which is why
    // this does not call `getCatalogue`: that answers only the count, and the
    // report link would need a second pass over the same rows.
    const mock = await getHistory(userId)
      .then((r): AvailableMockInterview[] => {
        const history = r.ok ? r.data : [];
        return listLiveDomains().map((domain) => {
          const mine = history.filter((a) => a.domainSlug === domain.slug);
          const completedAttempts = mine.filter(
            (a) => a.status === "COMPLETED",
          ).length;
          const summary = toDomainSummary(domain);
          return {
            slug: summary.slug,
            label: summary.label,
            blurb: summary.blurb,
            durationSec: summary.durationSec,
            questionCount: summary.questionCount,
            completedAttempts,
            attemptsLeft:
              domain.maxAttempts === null
                ? null
                : Math.max(0, domain.maxAttempts - completedAttempts),
            // History is newest first, so the first hit is the latest report.
            latestReportAttemptId: mine.find((a) => a.hasReport)?.id ?? null,
          };
        });
      })
      .catch((e: unknown) => {
        logger.warn("[dashboard] mock interview history unavailable", {
          message: e instanceof Error ? e.message : String(e),
        });
        // The domains are static, so the offer survives a database failure --
        // only the per-candidate facts are lost.
        return listLiveDomains().map((domain) => {
          const summary = toDomainSummary(domain);
          return {
            slug: summary.slug,
            label: summary.label,
            blurb: summary.blurb,
            durationSec: summary.durationSec,
            questionCount: summary.questionCount,
            completedAttempts: 0,
            attemptsLeft: domain.maxAttempts,
            latestReportAttemptId: null,
          };
        });
      });

    const cohort = await (async (): Promise<AvailableCohortInterview[]> => {
      if (!isProgramEnabled()) return [];
      const membership = await resolveProgramMemberForUser(userId);
      if (!membership) return [];

      // `toProgramMemberId` strips the 078 `pe_pm_` prefix — the same
      // conversion the AI Cohort dashboard does. Without it the eligibility
      // query matches nothing and every milestone silently reads as locked.
      const state = await getCohortInterviewState(
        toProgramMemberId(membership.member.id),
      );
      return COHORT_MILESTONES.flatMap((m) => {
        const blueprint = state[m.key === "DAY_15" ? "day15" : "day31"];
        // A cohort interview is one-shot, so "can take" means unlocked and not
        // yet taken. A locked or completed milestone is not an offer.
        if (!blueprint.unlocked || blueprint.taken) return [];
        return [
          {
            key: m.key,
            label: m.label,
            blurb: m.blurb,
            href: `${PROGRAM_AI_COHORT_BASE}/cohort-interview/${m.key}`,
            inProgress: blueprint.inProgressId !== null,
          },
        ];
      });
    })().catch((e: unknown) => {
      logger.warn("[dashboard] cohort interview eligibility unavailable", {
        message: e instanceof Error ? e.message : String(e),
      });
      return [] as AvailableCohortInterview[];
    });

    return { mock, cohort };
  },
);
