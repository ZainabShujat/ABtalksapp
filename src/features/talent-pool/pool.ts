import "server-only";
import type { ProgramMissionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMissionHeatmap, type MissionHeatmapCell } from "@/features/program/progression";
import {
  getInterviewSignal,
  getInterviewSignals,
} from "@/features/interview/read-model";

const PAGE_SIZE = 30;

export type TalentPoolFilters = {
  q?: string;
  skills?: string[];
  minYears?: number;
  minScore?: number;
  page?: number;
};

export type TalentPoolRow = {
  rank: number;
  memberId: string;
  fullName: string;
  jobRole: string;
  company: string;
  yearsExperience: number;
  skills: string[];
  totalScore: number;
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
  cleanPassPct: number;
  interviewOverall: number | null;
  shortlisted: boolean;
};

export type TalentPoolResult = {
  cohortName: string;
  members: TalentPoolRow[];
  total: number;
  page: number;
  pageSize: number;
};

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
  jobRole: string;
  company: string;
  yearsExperience: number;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  email: string;
  linkedinUrl: string | null;
  resumeUrl: string | null;
  githubUsername: string;
  githubRepoUrl: string;
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
  fullName: string;
  jobRole: string;
  company: string;
  totalScore: number;
  note: string | null;
  shortlistedAt: string;
};

async function assertPoolAccess(recruiterUserId: string) {
  const profile = await prisma.recruiterProfile.findUnique({
    where: { userId: recruiterUserId },
    select: { approved: true },
  });
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

export async function getTalentPool(
  recruiterUserId: string,
  filters: TalentPoolFilters,
): Promise<
  | { ok: true; data: TalentPoolResult }
  | { ok: false; message: string }
> {
  const access = await assertPoolAccess(recruiterUserId);
  if (!access.ok) return access;

  const page = filters.page ?? 1;
  const skills = filters.skills?.filter(Boolean) ?? [];

  const where = {
    cohortId: access.cohort.id,
    status: { in: ["ENROLLED", "COMPLETED"] as ("ENROLLED" | "COMPLETED")[] },
    recruiterVisibilityConsentAt: { not: null },
    ...(filters.minYears !== undefined
      ? { yearsExperience: { gte: filters.minYears } }
      : {}),
    ...(filters.minScore !== undefined
      ? { totalScore: { gte: filters.minScore } }
      : {}),
    ...(skills.length > 0 ? { skills: { hasSome: skills } } : {}),
    ...(filters.q
      ? {
          OR: [
            { fullName: { contains: filters.q, mode: "insensitive" as const } },
            { company: { contains: filters.q, mode: "insensitive" as const } },
            { jobRole: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [allMembers, shortlistIds] = await Promise.all([
    prisma.programMember.findMany({
      where,
      orderBy: [
        { totalScore: "desc" },
        { projectPoints: "desc" },
        { missionPoints: "desc" },
        { enrolledAt: "asc" },
      ],
      select: {
        id: true,
        fullName: true,
        jobRole: true,
        company: true,
        yearsExperience: true,
        skills: true,
        missionPoints: true,
        conceptPoints: true,
        commitPoints: true,
        projectPoints: true,
        totalScore: true,
        cleanPassCount: true,
      },
    }),
    prisma.recruiterShortlistItem.findMany({
      where: { recruiterUserId },
      select: { memberId: true },
    }),
  ]);

  const shortlistSet = new Set(shortlistIds.map((s) => s.memberId));
  const total = allMembers.length;
  const offset = (page - 1) * PAGE_SIZE;
  const pageMembers = allMembers.slice(offset, offset + PAGE_SIZE);

  // Resolved through the interview read model: DAY_31 → DAY_15 → legacy
  // ProgramInterview. Batched to the visible page only — one query, no N+1.
  const signals = await getInterviewSignals(pageMembers.map((m) => m.id));

  const members: TalentPoolRow[] = pageMembers.map((m, i) => ({
    rank: offset + i + 1,
    memberId: m.id,
    fullName: m.fullName,
    jobRole: m.jobRole,
    company: m.company,
    yearsExperience: m.yearsExperience,
    skills: m.skills,
    totalScore: m.totalScore,
    missionPoints: m.missionPoints,
    conceptPoints: m.conceptPoints,
    commitPoints: m.commitPoints,
    projectPoints: m.projectPoints,
    cleanPassPct: computeCleanPassPct(m.missionPoints, m.cleanPassCount),
    interviewOverall: signals.get(m.id)?.overallScore ?? null,
    shortlisted: shortlistSet.has(m.id),
  }));

  return {
    ok: true,
    data: {
      cohortName: access.cohort.name,
      members,
      total,
      page,
      pageSize: PAGE_SIZE,
    },
  };
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

  const member = await prisma.programMember.findFirst({
    where: {
      id: memberId,
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
      recruiterVisibilityConsentAt: { not: null },
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
      linkedinUrl: true,
      resumeUrl: true,
      githubUsername: true,
      githubRepoUrl: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      highestUnlockedDay: true,
      aiRecommendation: true,
      enrolledAt: true,
      user: { select: { email: true } },
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
    },
  });

  if (!member) return { ok: false, message: "Member not found." };

  const ranked = await prisma.programMember.findMany({
    where: {
      cohortId: access.cohort.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
      recruiterVisibilityConsentAt: { not: null },
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

  const [missionHeatmap, missionPortfolio, shortlistItem, interviewSignal] =
    await Promise.all([
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
    getInterviewSignal(memberId),
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
      email: member.user.email,
      linkedinUrl: member.linkedinUrl,
      resumeUrl: member.resumeUrl,
      githubUsername: member.githubUsername,
      githubRepoUrl: member.githubRepoUrl,
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
      // Payload keys deliberately unchanged so the recruiter profile UI needs no
      // edit: comm/tech/problem now come from the new competency fields, or from
      // the legacy row while it is still the only result a member has.
      interview: interviewSignal
        ? {
            status: interviewSignal.status,
            overallScore: interviewSignal.overallScore,
            commScore: interviewSignal.communicationScore,
            techScore: interviewSignal.technicalDepthScore,
            problemScore: interviewSignal.problemSolvingScore,
            summary: interviewSignal.summary,
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
          fullName: true,
          jobRole: true,
          company: true,
          totalScore: true,
          cohortId: true,
          status: true,
        },
      },
    },
  });

  return {
    ok: true,
    data: items
      .filter(
        (i) =>
          i.member.cohortId === access.cohort.id &&
          (i.member.status === "ENROLLED" || i.member.status === "COMPLETED"),
      )
      .map((i) => ({
        memberId: i.member.id,
        fullName: i.member.fullName,
        jobRole: i.member.jobRole,
        company: i.member.company,
        totalScore: i.member.totalScore,
        note: i.note,
        shortlistedAt: i.createdAt.toISOString(),
      })),
  };
}

export async function getShortlistedMemberIds(
  recruiterUserId: string,
): Promise<Set<string>> {
  const items = await prisma.recruiterShortlistItem.findMany({
    where: { recruiterUserId },
    select: { memberId: true },
  });
  return new Set(items.map((i) => i.memberId));
}
