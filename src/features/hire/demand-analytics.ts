import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * What the demand we could not answer adds up to.
 *
 * Every row behind these numbers is a recruiter who asked for someone we did
 * not have. That makes this the most direct statement the platform has about
 * who it should be onboarding next — `demand-board.ts` answers the same
 * question from the requests we *could* serve; this one answers it from the
 * ones we could not.
 *
 * Deliberately all-time with no date filter yet. The table is new, the volumes
 * are small, and a window would mostly hide the signal. Add one when the counts
 * stop fitting on a screen.
 */

export type DemandAnalytics = {
  /** Requirements distinct enough to have their own profile. */
  virtualCandidatesGenerated: number;
  /** How many recruiters have asked us to source one. */
  totalRequests: number;
  /** Requests still open, by status. */
  byStatus: { status: string; count: number }[];
  /** Reached SOURCING or beyond, over everything asked. */
  sourcingConversionRate: number;
  /** Reached FULFILLED, over everything asked. */
  fulfilmentRate: number;
  /** Mean days from ask to fulfilled, over fulfilled requests only. */
  averageFulfilmentDays: number | null;
  /** Requirements nobody has been found for and nobody has cancelled. */
  unfulfilledRequirements: number;
  mostRequestedSkills: { skill: string; count: number }[];
  /** Whole stacks, i.e. the exact skill set asked for together. */
  mostRequestedStacks: { stack: string; count: number }[];
  byRole: { roleFamily: string; count: number }[];
  byLocation: { location: string; count: number }[];
  byExperience: { band: string; count: number }[];
};

const OPEN = ["REQUESTED", "SOURCING", "CANDIDATE_FOUND", "CANDIDATE_SHARED"] as const;
const REACHED_SOURCING = [
  "SOURCING",
  "CANDIDATE_FOUND",
  "CANDIDATE_SHARED",
  "FULFILLED",
] as const;

function rate(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function tally<T>(rows: T[], key: (r: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function top(m: Map<string, number>, n: number): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Band a raw min/max the same way the fingerprint does, for one vocabulary. */
function band(min: number | null, max: number | null): string {
  const lo = min ?? max;
  if (lo === null) return "not specified";
  if (lo <= 1) return "0-1 yrs";
  if (lo <= 3) return "2-3 yrs";
  if (lo <= 6) return "4-6 yrs";
  if (lo <= 10) return "7-10 yrs";
  return "10+ yrs";
}

export async function getDemandAnalytics(): Promise<
  { ok: true; data: DemandAnalytics } | { ok: false; message: string }
> {
  try {
    const [profiles, requests] = await Promise.all([
      prisma.virtualCandidate.findMany({
        select: {
          id: true,
          roleFamily: true,
          requiredSkills: true,
          locationLabel: true,
          experienceMin: true,
          experienceMax: true,
          status: true,
          _count: { select: { requests: true } },
        },
        take: 5000,
      }),
      prisma.virtualCandidateRequest.findMany({
        select: {
          status: true,
          createdAt: true,
          fulfilledAt: true,
          virtualCandidateId: true,
        },
        take: 20000,
      }),
    ]);

    const totalRequests = requests.length;

    const byStatusMap = tally(requests, (r) => r.status);
    const reachedSourcing = requests.filter((r) =>
      (REACHED_SOURCING as readonly string[]).includes(r.status),
    ).length;
    const fulfilled = requests.filter((r) => r.status === "FULFILLED");

    // Only fulfilled requests carry both ends of the interval, so the mean is
    // over those and says so — averaging in the ones still open would report a
    // fulfilment time for work that has not finished.
    const spans = fulfilled
      .filter((r) => r.fulfilledAt)
      .map((r) => (r.fulfilledAt!.getTime() - r.createdAt.getTime()) / 86_400_000);
    const averageFulfilmentDays =
      spans.length > 0
        ? Number((spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(1))
        : null;

    // A requirement is unfulfilled while at least one recruiter is still
    // waiting on it. Cancelled asks do not count — nobody is waiting.
    const openByProfile = new Set(
      requests
        .filter((r) => (OPEN as readonly string[]).includes(r.status))
        .map((r) => r.virtualCandidateId),
    );

    // Skills and stacks are weighted by how many recruiters asked, not by how
    // many profiles exist: one requirement three people want is three times the
    // signal of one nobody has asked for twice.
    const skillCounts = new Map<string, number>();
    const stackCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    const locationCounts = new Map<string, number>();
    const expCounts = new Map<string, number>();

    for (const p of profiles) {
      const weight = Math.max(1, p._count.requests);
      for (const s of p.requiredSkills) {
        skillCounts.set(s, (skillCounts.get(s) ?? 0) + weight);
      }
      if (p.requiredSkills.length > 0) {
        const stack = [...p.requiredSkills].sort().join(" + ");
        stackCounts.set(stack, (stackCounts.get(stack) ?? 0) + weight);
      }
      roleCounts.set(p.roleFamily, (roleCounts.get(p.roleFamily) ?? 0) + weight);
      const loc = p.locationLabel?.trim() || "not specified";
      locationCounts.set(loc, (locationCounts.get(loc) ?? 0) + weight);
      const b = band(p.experienceMin, p.experienceMax);
      expCounts.set(b, (expCounts.get(b) ?? 0) + weight);
    }

    return {
      ok: true,
      data: {
        virtualCandidatesGenerated: profiles.length,
        totalRequests,
        byStatus: [...byStatusMap.entries()]
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
        sourcingConversionRate: rate(reachedSourcing, totalRequests),
        fulfilmentRate: rate(fulfilled.length, totalRequests),
        averageFulfilmentDays,
        unfulfilledRequirements: openByProfile.size,
        mostRequestedSkills: top(skillCounts, 15).map(([skill, count]) => ({
          skill,
          count,
        })),
        mostRequestedStacks: top(stackCounts, 10).map(([stack, count]) => ({
          stack,
          count,
        })),
        byRole: top(roleCounts, 10).map(([roleFamily, count]) => ({
          roleFamily,
          count,
        })),
        byLocation: top(locationCounts, 10).map(([location, count]) => ({
          location,
          count,
        })),
        byExperience: top(expCounts, 10).map(([b, count]) => ({ band: b, count })),
      },
    };
  } catch (error) {
    logger.error("[hire] getDemandAnalytics", { error: String(error) });
    return { ok: false, message: "Could not load demand analytics." };
  }
}

/**
 * Searches that found nobody.
 *
 * Counted from the profiles themselves rather than from a search log: a
 * requirement only gets a `VirtualCandidate` row because a search came back
 * without a sufficient match, so the row *is* the record of that search. This
 * avoids logging every search just to count the empty ones.
 */
export async function countEmptySearches(): Promise<number> {
  try {
    return await prisma.virtualCandidate.count();
  } catch (error) {
    logger.error("[hire] countEmptySearches", { error: String(error) });
    return 0;
  }
}
