import "server-only";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { hireChallengePool } from "@/lib/feature-flags";
import { buildChallengeDossierSet } from "@/features/hire/challenge-dossier";
import type { JobSpec } from "@/lib/validations/hire";
import { searchCandidates } from "@/features/hire/search-candidates";
import { buildDossierSet } from "@/features/hire/dossier";
import {
  clearsEvidenceFloor,
  memberEligibilityWhere,
  resolvePoolCohorts,
} from "@/features/hire/pool-policy";
import { ROLE_FAMILY_LABEL, type RoleFamily } from "@/features/hire/role-family";

/**
 * What Scout is allowed to know about the pool.
 *
 * Every figure here comes from the same code paths the real search uses, so a
 * number the agent quotes mid-conversation cannot disagree with the shortlist
 * it produces two questions later. That is the whole design constraint: the
 * model reads facts, it does not compute them, and it certainly does not
 * query.
 */
export type PoolSnapshot = {
  hasPool: boolean;
  stage: "PUBLISHED" | "OPEN_MIDCOHORT" | null;
  cohortNames: string[];
  cohortDay: number | null;
  ofDays: number;
  /** Consenting members who clear the evidence floor — the searchable pool. */
  eligibleCount: number;
  /** Consenting members held back by the floor. */
  belowFloorCount: number;
  topSkills: { skill: string; count: number }[];
  workingLanguages: { language: string; count: number }[];
  roleFamilies: { family: string; count: number }[];
  experienceMix: { band: string; count: number }[];
  coverageNote: string;
};

const EMPTY_SNAPSHOT: PoolSnapshot = {
  hasPool: false,
  stage: null,
  cohortNames: [],
  cohortDay: null,
  ofDays: 31,
  eligibleCount: 0,
  belowFloorCount: 0,
  topSkills: [],
  workingLanguages: [],
  roleFamilies: [],
  experienceMix: [],
  coverageNote: "No cohort is open to hiring yet.",
};

/**
 * Runs on every Scout turn, so it is memoised briefly rather than re-queried
 * per message. A minute is short enough that a member opting in is reflected
 * almost immediately and long enough that a conversation costs one read.
 */
let snapshotCache: { at: number; value: PoolSnapshot } | null = null;
const SNAPSHOT_TTL_MS = 60_000;

export async function poolSnapshot(): Promise<PoolSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.value;
  }

  try {
    const gate = await resolvePoolCohorts();

    // The snapshot has to span exactly what the search spans. Counting only the
    // cohort while the shortlist returns 300 challenge candidates is the kind
    // of small lie plan 076 was written to stop — and returning early on a
    // closed cohort would have reported an empty pool while one was open.
    const flag = hireChallengePool();
    const [set, challenge] = await Promise.all([
      gate.ok
        ? buildDossierSet(memberEligibilityWhere(gate.cohorts.map((c) => c.id)))
        : null,
      flag.enabled
        ? buildChallengeDossierSet({ minDays: flag.minDays })
        : null,
    ]);

    if (!set && !challenge) {
      snapshotCache = { at: Date.now(), value: EMPTY_SNAPSHOT };
      return EMPTY_SNAPSHOT;
    }
    const programDossiers = set?.dossiers ?? [];
    const programUserIds = new Set(
      programDossiers.map((d) => d.userId).filter((id): id is string => Boolean(id)),
    );

    // Everyone the search will actually consider — the floor demotes, it does
    // not exclude (see searchCandidates). A snapshot counting fewer people than
    // the shortlist shows is the kind of small lie that costs trust.
    const eligible = [
      ...programDossiers,
      ...(challenge?.dossiers ?? []).filter(
        (d) => !d.userId || !programUserIds.has(d.userId),
      ),
    ];
    const withEvidence = programDossiers.filter((d) =>
      clearsEvidenceFloor(d.evidence.missionsPassed.value),
    );

    const skillCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    const familyCounts = new Map<RoleFamily, number>();
    const bandCounts = new Map<string, number>();

    for (const d of eligible) {
      for (const raw of d.declaredSkills.value) {
        const skill = raw.trim().toLowerCase();
        if (skill) skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
      }
      for (const lang of d.evidence.workingLanguages.value) {
        languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
      }
      const family = d.roleFamily.value;
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
      const years = d.yearsExperience.value;
      const band = years <= 1 ? "0–1 yrs" : years <= 3 ? "2–3 yrs" : years <= 6 ? "4–6 yrs" : "7+ yrs";
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
    }

    const byCountDesc = <T>(m: Map<T, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);

    const value: PoolSnapshot = {
      hasPool: eligible.length > 0,
      stage: gate.ok ? (gate.cohorts[0]?.stage ?? null) : null,
      cohortNames: [
        ...new Set([
          ...(gate.ok ? gate.cohorts.map((c) => c.name) : []),
          ...(challenge && challenge.dossiers.length > 0
            ? ["60-Day Challenge"]
            : []),
        ]),
      ],
      cohortDay: programDossiers[0]
        ? (set?.cohortDayByMember.get(programDossiers[0].programMemberId ?? "") ??
          null)
        : null,
      ofDays: programDossiers[0]?.evidence.cohortProgress.value.ofDays ?? 31,
      eligibleCount: eligible.length,
      // Program members only. Challenge candidates clear their own floor in the
      // query that loads them, so none of them is being held back.
      belowFloorCount: programDossiers.length - withEvidence.length,
      topSkills: byCountDesc(skillCounts)
        .slice(0, 12)
        .map(([skill, count]) => ({ skill, count })),
      workingLanguages: byCountDesc(languageCounts).map(([language, count]) => ({
        language,
        count,
      })),
      roleFamilies: byCountDesc(familyCounts).map(([family, count]) => ({
        family: ROLE_FAMILY_LABEL[family],
        count,
      })),
      experienceMix: byCountDesc(bandCounts).map(([band, count]) => ({
        band,
        count,
      })),
      coverageNote:
        challenge && challenge.dossiers.length > 0
          ? challenge.coverage.note
          : withEvidence.length > 0 && set
            ? set.coverage.note
            : "No candidate has cleared the evidence bar yet.",
    };

    snapshotCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    logger.error("[hire] poolSnapshot failed", { error: String(error) });
    return EMPTY_SNAPSHOT;
  }
}

export type MatchPreview = {
  strong: number;
  partial: number;
  none: number;
  /** Must-haves nobody in the pool has — the honest reason a count collapsed. */
  topMissingMustHave: string[];
};

/**
 * How many people the requirement-so-far still matches.
 *
 * Deliberately the same `searchCandidates` the final shortlist uses rather
 * than a cheaper approximation: a preview that disagrees with the result is
 * worse than no preview at all.
 */
export async function previewMatch(spec: JobSpec): Promise<MatchPreview | null> {
  try {
    const res = await searchCandidates(spec, { limit: 100 });
    if (!res.ok) return null;

    const missing = new Map<string, number>();
    for (const m of [...res.data.matches, ...res.data.nearMisses]) {
      for (const g of m.gaps) {
        const hit = /^Missing stack: (.+)$/.exec(g);
        if (hit?.[1]) missing.set(hit[1], (missing.get(hit[1]) ?? 0) + 1);
      }
    }

    return {
      strong: res.data.matches.filter((m) => m.tier === "STRONG").length,
      partial: res.data.matches.filter((m) => m.tier === "PARTIAL").length,
      none: res.data.nearMisses.length,
      topMissingMustHave: [...missing.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([skill]) => skill),
    };
  } catch (error) {
    logger.error("[hire] previewMatch failed", { error: String(error) });
    return null;
  }
}

export type ChallengeReach = {
  /** Distinct Claude-challenge enrollees with 30+ days submitted. */
  thirtyDayPlus: number;
  /** Certificates issued for the Claude challenge. */
  certified: number;
};

/**
 * How many people sit behind the consent wall on the challenge track.
 *
 * Not searchable — `StudentProfile` has no recruiter-visibility field, so none
 * of these people has agreed to be discoverable and none may be shown. The
 * count is still worth knowing: it tells a recruiter the gap is consent rather
 * than supply, and it tells the owner what a consent drive would unlock.
 *
 * Cached alongside the pool snapshot; this is a heavy aggregate over ~15k
 * submission rows and it changes by the day, not by the minute.
 */
let reachCache: { at: number; value: ChallengeReach } | null = null;

export async function challengeReach(): Promise<ChallengeReach | null> {
  if (reachCache && Date.now() - reachCache.at < 10 * 60_000) {
    return reachCache.value;
  }
  try {
    const [rows, certified] = await Promise.all([
      prisma.enrollment.findMany({
        where: { challenge: { domain: "CLAUDE" } },
        select: { _count: { select: { submissions: true } } },
      }),
      prisma.certificate.count({
        where: { type: "CLAUDE_CHALLENGE", status: "ISSUED" },
      }),
    ]);
    const value: ChallengeReach = {
      thirtyDayPlus: rows.filter((r) => r._count.submissions >= 30).length,
      certified,
    };
    reachCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    logger.error("[hire] challengeReach failed", { error: String(error) });
    return null;
  }
}
