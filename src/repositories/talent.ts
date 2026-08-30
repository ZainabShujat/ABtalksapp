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

/** Recruiter-safe identity. No email, phone, or resume URL. */
export type RecruiterPublicIdentity = {
  fullName: string;
  role: string | null;
  yearsExperience: number | null;
  graduationYear: number | null;
  education: string | null;
  university: string | null;
  skills: string[];
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasResume: boolean;
  showInterviewResults: boolean;
  showAssessmentScores: boolean;
  showCurrentEmployer: boolean;
};

/**
 * Overlay for `/hire` and `/talent` list/detail. Does not select email, phone,
 * or resume URL — resume presence is an existence check only.
 */
export async function loadRecruiterIdentities(
  userIds: string[],
): Promise<Map<string, RecruiterPublicIdentity>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, RecruiterPublicIdentity>();
  if (ids.length === 0) return out;

  const [profiles, withResume] = await Promise.all([
    prisma.candidateProfile.findMany({
      where: { userId: { in: ids } },
      select: {
        userId: true,
        fullName: true,
        headline: true,
        linkedinUrl: true,
        githubUsername: true,
        skills: {
          orderBy: { evidenceScore: "desc" },
          select: { skill: { select: { name: true } } },
        },
        education: {
          orderBy: { graduationYear: "desc" },
          take: 1,
          select: {
            degree: true,
            institutionName: true,
            graduationYear: true,
          },
        },
        experience: {
          select: { totalMonths: true },
        },
        user: {
          select: {
            visibility: {
              select: {
                showLinkedin: true,
                showGithub: true,
                showResume: true,
                showInterviewResults: true,
                showAssessmentScores: true,
                showCurrentEmployer: true,
              },
            },
          },
        },
      },
    }),
    prisma.candidateProfile.findMany({
      where: { userId: { in: ids }, resumeUrl: { not: null } },
      select: { userId: true },
    }),
  ]);
  const resumeSet = new Set(withResume.map((r) => r.userId));

  for (const p of profiles) {
    const vis = p.user.visibility;
    const months = p.experience.reduce((sum, e) => sum + (e.totalMonths ?? 0), 0);
    const edu = p.education[0];
    out.set(p.userId, {
      fullName: p.fullName,
      role: p.headline,
      yearsExperience: months > 0 ? Math.round(months / 12) : null,
      graduationYear: edu?.graduationYear ?? null,
      education: edu?.degree ?? null,
      university: edu?.institutionName ?? null,
      skills: p.skills.map((s) => s.skill.name).filter(Boolean),
      hasLinkedin: Boolean((vis?.showLinkedin ?? true) && p.linkedinUrl),
      hasGithub: Boolean((vis?.showGithub ?? true) && p.githubUsername),
      hasResume: Boolean(vis?.showResume === true && resumeSet.has(p.userId)),
      showInterviewResults: vis?.showInterviewResults === true,
      showAssessmentScores: vis?.showAssessmentScores === true,
      showCurrentEmployer: vis?.showCurrentEmployer ?? true,
    });
  }
  return out;
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
 * Legacy `/talent` fragment. The live gate is {@link searchableUserWhere}.
 * Kept as a single-key fragment so tests can catch it growing a second job.
 */
export function visibleProgramMemberWhere(): Prisma.ProgramMemberWhereInput {
  return { recruiterVisibilityConsentAt: { not: null } };
}

function buildUserGate(f: CandidateSearchFilters): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    visibility: {
      is: {
        searchableByRecruiters: true,
        withdrawnAt: null,
        ...(f.minAssessmentScore && { showAssessmentScores: true }),
      },
    },
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

function preferenceFilter(
  f: CandidateSearchFilters,
): Prisma.CandidatePreferenceWhereInput | null {
  const pref: Prisma.CandidatePreferenceWhereInput = {};
  if (f.openToWork === true) pref.openToWork = true;
  if (f.availableBefore) {
    pref.openToWork = true;
    pref.availableFrom = { lte: f.availableBefore };
  }
  if (f.workMode && f.workMode !== "FLEXIBLE") {
    pref.remotePreference = f.workMode;
  }
  if (f.noticePeriodDaysMax != null) {
    pref.noticePeriodDays = { lte: f.noticePeriodDaysMax };
  }
  return Object.keys(pref).length > 0 ? pref : null;
}

export async function searchCandidates(
  _ctx: RecruiterContext,
  f: CandidateSearchFilters,
) {
  const pageSize = Math.min(f.pageSize ?? 25, 50);
  const skip = ((f.page ?? 1) - 1) * pageSize;

  if (isNewTalentRepoEnabled()) {
    const clauses: Prisma.CandidateProfileWhereInput[] = [
      { user: buildUserGate(f) },
    ];
    if (f.q) {
      clauses.push({
        OR: [
          { fullName: { contains: f.q, mode: "insensitive" } },
          { headline: { contains: f.q, mode: "insensitive" } },
        ],
      });
    }
    if (f.skillIds?.length) {
      clauses.push({
        skills: {
          some: {
            skillId: { in: f.skillIds },
            evidenceScore: { gte: f.minEvidenceScore ?? 0 },
          },
        },
      });
    }
    if (f.graduationYearFrom || f.graduationYearTo) {
      clauses.push({
        education: {
          some: {
            graduationYear: {
              ...(f.graduationYearFrom && { gte: f.graduationYearFrom }),
              ...(f.graduationYearTo && { lte: f.graduationYearTo }),
            },
          },
        },
      });
    }
    if (f.minExperienceMonths) {
      clauses.push({
        experience: { some: { totalMonths: { gte: f.minExperienceMonths } } },
      });
    }
    const pref = preferenceFilter(f);
    if (pref) clauses.push({ preference: { is: pref } });
    if (f.locationCity) {
      clauses.push({
        OR: [
          { locationCity: { equals: f.locationCity, mode: "insensitive" } },
          {
            preference: {
              is: { preferredLocations: { has: f.locationCity } },
            },
          },
        ],
      });
    }
    if (f.countryCode) clauses.push({ countryCode: f.countryCode });

    const where: Prisma.CandidateProfileWhereInput = { AND: clauses };

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
                  showResume: true,
                  showLinkedin: true,
                  showGithub: true,
                  showAssessmentScores: true,
                  showInterviewResults: true,
                  showCurrentEmployer: true,
                },
              },
            },
          },
          skills: {
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
      rows: rows.map((row) => {
        const vis = row.user.visibility;
        const showEmployer = vis?.showCurrentEmployer ?? true;
        return {
          userId: row.userId,
          fullName: row.fullName,
          headline: row.headline,
          locationCity: row.locationCity,
          countryCode: row.countryCode,
          hasLinkedin: vis?.showLinkedin ?? true,
          hasGithub: vis?.showGithub ?? true,
          hasResume: vis?.showResume === true,
          skills: row.skills,
          education: row.education,
          experience: row.experience.map((e) => ({
            title: e.title,
            companyName: showEmployer ? e.companyName : null,
            totalMonths: e.totalMonths,
          })),
        };
      }),
    };
  }

  const where: Prisma.ProgramMemberWhereInput = {
    user: searchableUserWhere(),
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
