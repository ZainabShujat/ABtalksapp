import "server-only";
import type { ProgramMissionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMissionHeatmap, type MissionHeatmapCell } from "@/features/program/progression";
import { programMember } from "@/repositories/legacy/program-member";
import { visibleProgramMemberWhere } from "@/repositories/talent";

export type MissionPortfolioDay = {
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  state: "PASSED" | "SKIPPED" | "AVAILABLE" | "LOCKED";
  runsUsed: number;
  cleanPass: boolean;
  mentorNote: string | null;
};

export type TalentProfile = {
  memberId: string;
  fullName: string;
  jobRole: string | null;
  company: string | null;
  yearsExperience: number | null;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  /**
   * Contact vectors are no longer part of this profile.
   *
   * They were: email as a mailto link, LinkedIn, GitHub and resume. Any
   * approved recruiter could reach the member directly and never place a
   * request — bypassing both the business and the member's consent, which was
   * to be *discoverable*, not to be cold-contacted. Release happens through an
   * accepted engagement request, handled by the ABTalks team.
   */
  contactReleased: false;
  rank: number;
  scoreBreakdown: {
    missionPoints: number;
    conceptPoints: number;
    commitPoints: number;
    projectPoints: number;
    totalScore: number;
  };
  cleanPassPct: number;
  missionHeatmap: MissionHeatmapCell[];
  missionPortfolio: MissionPortfolioDay[];
  projects: {
    moduleNumber: number;
    repoUrl: string;
    score: number | null;
    feedback: string | null;
  }[];
  interview: {
    status: string;
    overallScore: number | null;
    commScore: number | null;
    techScore: number | null;
    problemScore: number | null;
    summary: string | null;
    transcript: { role: string; text: string }[];
  } | null;
  aiRecommendation: string | null;
  shortlisted: boolean;
  shortlistNote: string | null;
};

export type ShortlistRow = {
  memberId: string;
  userId: string;
  jobRole: string | null;
  totalScore: number;
  note: string | null;
  shortlistedAt: string;
  displayName: string | null;
  skills: string[];
  yearsExperience: number | null;
  /**
   * The real name, and only once an engagement request for this recruiter and
   * this candidate has reached CONTACT_SHARED. Null everywhere else — the
   * shortlist page was rendering names outright, which the rest of the portal
   * had already stopped doing.
   */
  revealedName: string | null;
};

async function assertPoolAccess(recruiterUserId: string) {
  const profile = await prisma.recruiterProfile.findUnique({
    where: { userId: recruiterUserId },
    select: { approved: true },
  });
  // Same rule as the page and Server Action gates — see
  // honoured the bypass, so /hire rendered but the pool still refused.
  if (!profile?.approved) {
    return { ok: false as const, message: "Recruiter access not approved." };
  }

  const cohort = await prisma.programCohort.findFirst({
    where: { resultsPublishedAt: { not: null } },
    orderBy: { resultsPublishedAt: "desc" },
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      resultsPublishedAt: true,
    },
  });

  if (!cohort) {
    return { ok: false as const, message: "Cohort results are not published yet." };
  }

  return { ok: true as const, cohort };
}

function isSkippedPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { skipped?: unknown }).skipped === true
  );
}

function computeCleanPassPct(
  missionPoints: number,
  cleanPassCount: number,
): number {
  const missionsPassed = Math.floor(missionPoints / 12);
  return missionsPassed > 0
    ? Math.round((cleanPassCount / missionsPassed) * 100)
    : 0;
}

export async function getPublishedCohort() {
  return prisma.programCohort.findFirst({
    where: { resultsPublishedAt: { not: null } },
    orderBy: { resultsPublishedAt: "desc" },
    select: {
      id: true,
      name: true,
      resultsPublishedAt: true,
      startsAt: true,
      endsAt: true,
    },
  });
}

async function buildMissionPortfolio(
  memberId: string,
  highestUnlockedDay: number,
): Promise<MissionPortfolioDay[]> {
  const [days, submissions] = await Promise.all([
    prisma.programDay.findMany({
      orderBy: { dayNumber: "asc" },
      select: {
        dayNumber: true,
        title: true,
        missionType: true,
      },
    }),
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: {
        dayNumber: true,
        attemptNumber: true,
        passed: true,
        aiFeedback: true,
        payload: true,
      },
      orderBy: [{ dayNumber: "asc" }, { attemptNumber: "asc" }],
    }),
  ]);

  const byDay = new Map<number, typeof submissions>();
  for (const sub of submissions) {
    const list = byDay.get(sub.dayNumber) ?? [];
    list.push(sub);
    byDay.set(sub.dayNumber, list);
  }

  const passedDays = new Set<number>();
  const skippedDays = new Set<number>();
  for (const sub of submissions) {
    if (sub.passed) passedDays.add(sub.dayNumber);
    else if (isSkippedPayload(sub.payload)) skippedDays.add(sub.dayNumber);
  }

  return days.map((day) => {
    const daySubs = byDay.get(day.dayNumber) ?? [];
    const runsUsed = daySubs.length;
    const passing = daySubs.find((s) => s.passed);
    const skipped = skippedDays.has(day.dayNumber);
    const passed = passedDays.has(day.dayNumber);

    let state: MissionPortfolioDay["state"] = "LOCKED";
    if (passed) state = "PASSED";
    else if (skipped) state = "SKIPPED";
    else if (day.dayNumber <= highestUnlockedDay) state = "AVAILABLE";

    const firstPass = daySubs.find((s) => s.passed);
    const cleanPass = !!firstPass && firstPass.attemptNumber === 1;

    return {
      dayNumber: day.dayNumber,
      title: day.title,
      missionType: day.missionType,
      state,
      runsUsed,
      cleanPass: passed ? cleanPass : false,
      mentorNote: passing?.aiFeedback ?? null,
    };
  });
}

export async function getTalentProfile(
  recruiterUserId: string,
  memberId: string,
): Promise<
  | { ok: true; data: TalentProfile }
  | { ok: false; message: string }
> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const member = await programMember.findFirst({
    where: {
      id: memberId,
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
      ...visibleProgramMemberWhere(),
    },
    select: {
      id: true,
      fullName: true,
      jobRole: true,
      company: true,
      yearsExperience: true,
      education: true,
      university: true,
      graduationYear: true,
      skills: true,

      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      highestUnlockedDay: true,
      aiRecommendation: true,
      enrolledAt: true,

      projects: {
        select: {
          moduleNumber: true,
          repoUrl: true,
          aiScore: true,
          adminScore: true,
          aiFeedback: true,
          status: true,
        },
        orderBy: { moduleNumber: "asc" },
      },
      interview: {
        select: {
          status: true,
          overallScore: true,
          commScore: true,
          techScore: true,
          problemScore: true,
          summary: true,
        },
      },
    },
  });

  if (!member) return { ok: false, message: "Member not found." };

  const ranked = await programMember.findMany({
    where: {
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
      ...visibleProgramMemberWhere(),
    },
    orderBy: [
      { totalScore: "desc" },
      { projectPoints: "desc" },
      { missionPoints: "desc" },
      { enrolledAt: "asc" },
    ],
    select: { id: true },
  });
  const rank = ranked.findIndex((m) => m.id === memberId) + 1;

  const [missionHeatmap, missionPortfolio, shortlistItem] = await Promise.all([
    getMissionHeatmap(memberId),
    buildMissionPortfolio(memberId, member.highestUnlockedDay),
    prisma.recruiterShortlistItem.findUnique({
      where: {
        recruiterUserId_memberId: {
          recruiterUserId,
          memberId,
        },
      },
      select: { note: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      memberId: member.id,
      fullName: member.fullName,
      jobRole: member.jobRole,
      company: member.company,
      yearsExperience: member.yearsExperience,
      education: member.education,
      university: member.university,
      graduationYear: member.graduationYear,
      skills: member.skills,
      contactReleased: false as const,
      rank,
      scoreBreakdown: {
        missionPoints: member.missionPoints,
        conceptPoints: member.conceptPoints,
        commitPoints: member.commitPoints,
        projectPoints: member.projectPoints,
        totalScore: member.totalScore,
      },
      cleanPassPct: computeCleanPassPct(
        member.missionPoints,
        member.cleanPassCount,
      ),
      missionHeatmap,
      missionPortfolio,
      projects: member.projects.map((p) => ({
        moduleNumber: p.moduleNumber,
        repoUrl: p.repoUrl,
        score:
          p.status === "GRADED" ? (p.adminScore ?? p.aiScore) : null,
        feedback: p.aiFeedback,
      })),
      interview: member.interview
        ? {
            status: member.interview.status,
            overallScore: member.interview.overallScore,
            commScore: member.interview.commScore,
            techScore: member.interview.techScore,
            problemScore: member.interview.problemScore,
            summary: member.interview.summary,
            transcript: [] as { role: string; text: string }[],
          }
        : null,
      aiRecommendation: member.aiRecommendation,
      shortlisted: !!shortlistItem,
      shortlistNote: shortlistItem?.note ?? null,
    },
  };
}

export async function toggleShortlist(
  recruiterUserId: string,
  memberId: string,
): Promise<
  { ok: true; shortlisted: boolean } | { ok: false; message: string }
> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const member = await programMember.findFirst({
    where: {
      id: memberId,
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: { id: true },
  });
  if (!member) return { ok: false, message: "Member not found." };

  const existing = await prisma.recruiterShortlistItem.findUnique({
    where: {
      recruiterUserId_memberId: { recruiterUserId, memberId },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.recruiterShortlistItem.delete({ where: { id: existing.id } });
    return { ok: true, shortlisted: false };
  }

  await prisma.recruiterShortlistItem.create({
    data: { recruiterUserId, memberId },
  });
  return { ok: true, shortlisted: true };
}

/** Add only — never removes. Used to merge a guest cart after sign-in. */
export async function ensureShortlisted(
  recruiterUserId: string,
  memberId: string,
): Promise<{ ok: true; added: boolean } | { ok: false; message: string }> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const member = await prisma.programMember.findFirst({
    where: {
      id: memberId,
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: { id: true },
  });
  if (!member) return { ok: false, message: "Member not found." };

  const existing = await prisma.recruiterShortlistItem.findUnique({
    where: { recruiterUserId_memberId: { recruiterUserId, memberId } },
    select: { id: true },
  });
  if (existing) return { ok: true, added: false };

  await prisma.recruiterShortlistItem.create({
    data: { recruiterUserId, memberId },
  });
  return { ok: true, added: true };
}

export async function updateShortlistNote(
  recruiterUserId: string,
  memberId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const item = await prisma.recruiterShortlistItem.findUnique({
    where: {
      recruiterUserId_memberId: { recruiterUserId, memberId },
    },
    select: { id: true },
  });
  if (!item) {
    return { ok: false, message: "Add this candidate to your shortlist first." };
  }

  await prisma.recruiterShortlistItem.update({
    where: { id: item.id },
    data: { note: note.trim() || null },
  });
  return { ok: true };
}

export async function getShortlist(
  recruiterUserId: string,
): Promise<
  | { ok: true; data: ShortlistRow[] }
  | { ok: false; message: string }
> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const items = await prisma.recruiterShortlistItem.findMany({
    where: { recruiterUserId },
    orderBy: { createdAt: "desc" },
    select: {
      note: true,
      createdAt: true,
      member: {
        select: {
          id: true,
          userId: true,
          fullName: true,
          jobRole: true,
          totalScore: true,
          skills: true,
          yearsExperience: true,
          cohortId: true,
          status: true,
        },
      },
    },
  });

  const visible = items.filter(
    (i) =>
      i.member.cohortId === access.cohort.id &&
      (i.member.status === "ENROLLED" || i.member.status === "COMPLETED"),
  );

  // One query for the whole page rather than a lookup per row.
  const released = new Set(
    (
      await prisma.talentEngagementRequest.findMany({
        where: {
          recruiterUserId,
          status: "CONTACT_SHARED",
          programMemberId: { in: visible.map((i) => i.member.id) },
        },
        select: { programMemberId: true },
      })
    )
      .map((r) => r.programMemberId)
      .filter((id): id is string => id !== null),
  );

  return {
    ok: true,
    data: visible
      .map((i) => ({
        memberId: i.member.id,
        userId: i.member.userId,
        jobRole: i.member.jobRole,
        totalScore: i.member.totalScore,
        note: i.note,
        displayName: i.member.fullName.trim() ? i.member.fullName.trim() : null,
        skills: i.member.skills,
        yearsExperience: i.member.yearsExperience,
        revealedName: released.has(i.member.id) ? i.member.fullName : null,
        shortlistedAt: i.createdAt.toISOString(),
      })),
  };
}

