import "server-only";
import { ProgramMemberStatus, type Domain, type EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewLearningRepoEnabled } from "@/lib/feature-flags";
import { programMember } from "@/repositories/legacy/program-member";

export type ChallengeEnrollmentRow = {
  id: string;
  domain: Domain;
  status: EnrollmentStatus;
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
  challengeTitle: string;
  totalDays: number;
  startedAt: Date;
};

export type ProgramMembership = {
  member: {
    id: string;
    status: ProgramMemberStatus;
    fullName: string;
    highestUnlockedDay: number;
    cohortId: string;
  };
  cohort: {
    id: string;
    name: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number | null;
    resultsPublishedAt: Date | null;
    joinCode: string;
  };
};

const PROGRAM_SLUG: Record<Domain, string> = {
  SE: "software-engineering-challenge",
  DS: "data-science-challenge",
  AI: "ai-engineering-challenge",
  CLAUDE: "claude-challenge",
};

export function challengeSlugForDomain(domain: Domain): string {
  return PROGRAM_SLUG[domain];
}

export async function listChallengeEnrollments(
  userId: string,
): Promise<ChallengeEnrollmentRow[]> {
  const rows = await prisma.enrollment.findMany({
    where: { userId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      domain: true,
      status: true,
      daysCompleted: true,
      currentStreak: true,
      longestStreak: true,
      startedAt: true,
      challenge: { select: { title: true, totalDays: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    status: r.status,
    daysCompleted: r.daysCompleted,
    currentStreak: r.currentStreak,
    longestStreak: r.longestStreak,
    challengeTitle: r.challenge.title,
    totalDays: r.challenge.totalDays,
    startedAt: r.startedAt,
  }));
}

export async function findActiveMembership(
  userId: string,
): Promise<ProgramMembership | null> {
  if (isNewLearningRepoEnabled()) {
    const pe = await prisma.programEnrollment.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "COMPLETED"] },
        cohort: { programVersion: { program: { slug: "ai-cohort-program" } } },
      },
      orderBy: { enrolledAt: "desc" },
      select: {
        id: true,
        status: true,
        unlockFloorDay: true,
        cohortId: true,
        cohort: {
          select: {
            id: true,
            name: true,
            status: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            joinCode: true,
            resultsPublishedAt: true,
          },
        },
      },
    });
    if (!pe) return null;
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId },
      select: { fullName: true },
    });
    return {
      member: {
        id: pe.id,
        status: pe.status === "COMPLETED" ? ProgramMemberStatus.COMPLETED : ProgramMemberStatus.ENROLLED,
        fullName: profile?.fullName ?? "",
        highestUnlockedDay: pe.unlockFloorDay ?? 1,
        cohortId: pe.cohortId,
      },
      cohort: {
        id: pe.cohort.id,
        name: pe.cohort.name,
        status: pe.cohort.status,
        startsAt: pe.cohort.startsAt ?? new Date(0),
        endsAt: pe.cohort.endsAt ?? new Date(0),
        capacity: pe.cohort.capacity,
        resultsPublishedAt: pe.cohort.resultsPublishedAt,
        joinCode: pe.cohort.joinCode ?? "",
      },
    };
  }

  const memberships = await programMember.findMany({
    where: { userId, status: { in: ["ENROLLED", "COMPLETED"] } },
    select: {
      id: true,
      status: true,
      fullName: true,
      highestUnlockedDay: true,
      cohortId: true,
      enrolledAt: true,
      cohort: {
        select: {
          id: true,
          name: true,
          status: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          resultsPublishedAt: true,
          joinCode: true,
        },
      },
    },
  });

  if (memberships.length === 0) return null;

  memberships.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "ENROLLED" ? -1 : 1;
    }
    const at = a.enrolledAt?.getTime() ?? 0;
    const bt = b.enrolledAt?.getTime() ?? 0;
    return bt - at;
  });

  const member = memberships[0]!;
  return {
    member: {
      id: member.id,
      status: member.status,
      fullName: member.fullName,
      highestUnlockedDay: member.highestUnlockedDay,
      cohortId: member.cohortId,
    },
    cohort: member.cohort,
  };
}
