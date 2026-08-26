import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewTalentRepoEnabled } from "@/lib/feature-flags";
import { programMember } from "@/repositories/legacy/program-member";
import type {
  CandidateSearchFilters,
  RecruiterContext,
} from "@/repositories/types";

/**
 * THE recruiter-discovery gate, and the only one.
 *
 * `CandidateVisibility` hangs off `User`, so this one fragment applies
 * identically to every track — AI cohort, 60-day challenge, Claude, hackathon,
 * and whatever ships next. That is the whole point of it living here: the
 * previous arrangement gated program members on
 * `ProgramMember.recruiterVisibilityConsentAt` and gated the other three tracks
 * on nothing at all, which is not a gate, it is a gap.
 *
 * Deliberately NOT behind `ENABLE_NEW_TALENT`. That flag decides where
 * candidate *data* is read from; this decides who may be shown at all, and the
 * answer to that must not depend on a rollout switch. `CandidateVisibility` is
 * a production table today, populated by 078 Phase 2b.
 *
 * `openToWork` (`CandidatePreference`) is a DIFFERENT question — whether the
 * candidate is actively looking. Never substitute one for the other.
 */
export function searchableUserWhere(): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    visibility: { is: { searchableByRecruiters: true, withdrawnAt: null } },
  };
}

/**
 * Set-membership form of {@link searchableUserWhere}, for the paths that hold
 * candidate ids already and need to drop the ones that must not be shown.
 */
export async function filterSearchableUserIds(
  userIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids }, ...searchableUserWhere() },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Legacy `/talent` fragment. Retiring with the `/talent` pool — new surfaces use
 * {@link searchableUserWhere}. Left in place only because the legacy branch of
 * `searchCandidates` below still ranks `ProgramMember` rows.
 */
export function visibleProgramMemberWhere(): Prisma.ProgramMemberWhereInput {
  return { recruiterVisibilityConsentAt: { not: null } };
}

function buildUserGate(f: CandidateSearchFilters): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    visibility: { is: { searchableByRecruiters: true } },
    ...(f.completedProgramIds?.length && {
      programEnrollments: {
        some: {
          status: "COMPLETED",
          cohort: {
            programVersion: { programId: { in: f.completedProgramIds } },
          },
        },
      },
    }),
    ...(f.minAssessmentScore && {
      assessmentReports: {
        some: {
          status: "PUBLISHED",
          scores: {
            some: {
              dimension: f.minAssessmentScore.dimension,
              score: { gte: f.minAssessmentScore.score },
            },
          },
        },
      },
    }),
  };
}

function redactForRecruiter<T extends { user?: { visibility?: unknown } }>(
  row: T,
): T {
  return row;
}

export async function searchCandidates(
  _ctx: RecruiterContext,
  f: CandidateSearchFilters,
) {
  const pageSize = Math.min(f.pageSize ?? 25, 50);
  const skip = ((f.page ?? 1) - 1) * pageSize;

  if (isNewTalentRepoEnabled()) {
    const where: Prisma.CandidateProfileWhereInput = {
      user: buildUserGate(f),
      ...(f.q && {
        OR: [
          { fullName: { contains: f.q, mode: "insensitive" } },
          { headline: { contains: f.q, mode: "insensitive" } },
        ],
      }),
      ...(f.skillIds?.length && {
        skills: {
          some: {
            skillId: { in: f.skillIds },
            evidenceScore: { gte: f.minEvidenceScore ?? 0 },
          },
        },
      }),
      ...((f.graduationYearFrom || f.graduationYearTo) && {
        education: {
          some: {
            graduationYear: {
              ...(f.graduationYearFrom && { gte: f.graduationYearFrom }),
              ...(f.graduationYearTo && { lte: f.graduationYearTo }),
            },
          },
        },
      }),
      ...(f.minExperienceMonths && {
        experience: { some: { totalMonths: { gte: f.minExperienceMonths } } },
      }),
      ...(f.availableBefore && {
        preference: {
          is: { openToWork: true, availableFrom: { lte: f.availableBefore } },
        },
      }),
      ...(f.locationCity && {
        locationCity: { equals: f.locationCity, mode: "insensitive" },
      }),
      ...(f.countryCode && { countryCode: f.countryCode }),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.candidateProfile.count({ where }),
      prisma.candidateProfile.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          userId: true,
          fullName: true,
          headline: true,
          locationCity: true,
          countryCode: true,
          user: {
            select: {
              visibility: {
                select: {
                  showEmail: true,
                  showPhone: true,
                  showResume: true,
                  showLinkedin: true,
                  showGithub: true,
                  showAssessmentScores: true,
                },
              },
            },
          },
          skills: {
            where: { verified: true },
            orderBy: { evidenceScore: "desc" },
            take: 8,
            select: {
              evidenceScore: true,
              skill: { select: { slug: true, name: true } },
            },
          },
          education: {
            orderBy: { graduationYear: "desc" },
            take: 1,
            select: {
              institutionName: true,
              degree: true,
              graduationYear: true,
            },
          },
          experience: {
            where: { isCurrent: true },
            take: 1,
            select: { title: true, companyName: true, totalMonths: true },
          },
        },
      }),
    ]);

    return {
      total,
      page: f.page ?? 1,
      pageSize,
      rows: rows.map(redactForRecruiter),
    };
  }

  const where: Prisma.ProgramMemberWhereInput = {
    ...visibleProgramMemberWhere(),
    status: { in: ["ENROLLED", "COMPLETED"] },
    ...(f.q && {
      OR: [
        { fullName: { contains: f.q, mode: "insensitive" } },
        { company: { contains: f.q, mode: "insensitive" } },
        { jobRole: { contains: f.q, mode: "insensitive" } },
      ],
    }),
    ...(f.skillIds?.length && { skills: { hasSome: f.skillIds } }),
  };

  const [total, rows] = await prisma.$transaction([
    programMember.count({ where }),
    programMember.findMany({
      where,
      orderBy: [{ totalScore: "desc" }, { enrolledAt: "asc" }],
      skip,
      take: pageSize,
      select: {
        userId: true,
        fullName: true,
        jobRole: true,
        company: true,
        skills: true,
      },
    }),
  ]);

  return {
    total,
    page: f.page ?? 1,
    pageSize,
    rows: rows.map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      headline: r.jobRole,
      locationCity: null as string | null,
      countryCode: null as string | null,
      skills: r.skills.map((name) => ({
        evidenceScore: 0,
        skill: { slug: name, name },
      })),
    })),
  };
}
