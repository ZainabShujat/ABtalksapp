import "server-only";
import {
  ActivityType,
  EnrollmentStatus,
  EnrollmentStatusV2,
  ProgramLanguage,
  ProgramMemberStatus,
  ProgramMissionType,
  type Domain,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewLearningRepoEnabled } from "@/lib/feature-flags";
import { programMember } from "@/repositories/legacy/program-member";
import {
  getProgramUnlockFloor,
  overlayChallengeProgressFields,
} from "@/repositories/progress";
import {
  cohortSlugForDomain,
  dailyTaskIdFromActivity,
  enrollmentIdFromPe,
  memberIdFromPe,
  programCohortIdFromSlug,
  programDayIdFromActivity,
  quizIdFromActivity,
  videoIdFromActivity,
} from "@/repositories/ids";

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

export type ChallengeCatalog = {
  id: string;
  domain: Domain;
  title: string;
  description: string;
  totalDays: number;
  isActive: boolean;
  startsAt: Date | null;
};

export type SessionEnrollment = {
  id: string;
  userId: string;
  challengeId: string;
  domain: Domain;
  startedAt: Date;
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastSubmittedDay: number | null;
  status: EnrollmentStatus;
  challenge: {
    id: string;
    domain: Domain;
    title: string;
    totalDays: number;
    startsAt: Date | null;
  };
};

export type DailyTaskRow = {
  id: string;
  challengeId: string;
  dayNumber: number;
  domain: Domain;
  title: string;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  difficulty: string;
  estimatedMinutes: number;
  linkedinTemplate: string;
  solutionApproach: string | null;
  tags: string[];
  dayContent: Prisma.JsonValue | null;
  createdAt: Date;
};

export type CachedDailyTaskRow = {
  id: string;
  dayNumber: number;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  tags: string[];
  difficulty: string;
  estimatedMinutes: number;
};

export type ProgramCohortCatalog = {
  id: string;
  name: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  resultsPublishedAt: Date | null;
  joinCode: string;
  requiresJoinCode: boolean;
};

export type OpenEnrollmentCohort = {
  id: string;
  name: string;
  status: string;
  joinCode: string;
};

export type AppliedMembership = {
  id: string;
  status: ProgramMemberStatus;
  cohortId: string;
  fullName: string;
  jobRole: string | null;
  company: string | null;
  yearsExperience: number | null;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  linkedinUrl: string | null;
  resumeUrl: string | null;
  phone: string | null;
  githubUsername: string;
  githubRepoUrl: string;
  cohort: {
    id: string;
    name: string;
    status: string;
    capacity: number | null;
    joinCode: string;
  };
};

export type ProgramModuleRow = {
  number: number;
  title: string;
  subtitle: string;
  color: string;
  startDay: number;
  endDay: number;
};

export type ProgramDayCatalog = {
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  isProjectDay: boolean;
  moduleNumber: number;
};

export type DayVideoRow = {
  id: string;
  order: number;
  title: string;
  youtubeId: string;
  durationMin: number | null;
};

export type ProgramDayShellRow = {
  id: string;
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  briefMd: string;
  assetsJson: Prisma.JsonValue | null;
  starterCode: string | null;
  language: ProgramLanguage | null;
  objectives: string[];
  tools: string[];
  estimatedMin: number;
  missionPoints: number;
  isProjectDay: boolean;
  module: { number: number; title: string; color: string };
  videos: DayVideoRow[];
};

export type QuizCatalogRow = {
  id: string;
  weekNumber: number;
  title: string;
  domain: Domain;
  questionCount: number;
};

export type QuizDefinitionQuestion = {
  id: string;
  questionOrder: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
};

export type QuizDefinition = {
  id: string;
  weekNumber: number;
  title: string;
  domain: Domain;
  challengeId: string;
  questions: QuizDefinitionQuestion[];
};

const PROGRAM_SLUG: Record<Domain, string> = {
  SE: "software-engineering-challenge",
  DS: "data-science-challenge",
  AI: "ai-engineering-challenge",
  CLAUDE: "claude-challenge",
};

const DOMAIN_BY_SLUG: Record<string, Domain> = {
  "software-engineering-challenge": "SE",
  "data-science-challenge": "DS",
  "ai-engineering-challenge": "AI",
  "claude-challenge": "CLAUDE",
};

const AI_COHORT_SLUG = "ai-cohort-program";

const CHALLENGE_CATALOG_SELECT = {
  id: true,
  domain: true,
  title: true,
  description: true,
  totalDays: true,
  isActive: true,
  startsAt: true,
} as const;

const SESSION_ENROLLMENT_SELECT = {
  id: true,
  userId: true,
  challengeId: true,
  domain: true,
  startedAt: true,
  daysCompleted: true,
  currentStreak: true,
  longestStreak: true,
  lastSubmittedDay: true,
  status: true,
  challenge: {
    select: {
      id: true,
      domain: true,
      title: true,
      totalDays: true,
      startsAt: true,
    },
  },
} as const;

const DAILY_TASK_SELECT = {
  id: true,
  challengeId: true,
  dayNumber: true,
  domain: true,
  title: true,
  problemStatement: true,
  learningObjectives: true,
  resources: true,
  difficulty: true,
  estimatedMinutes: true,
  linkedinTemplate: true,
  solutionApproach: true,
  tags: true,
  dayContent: true,
  createdAt: true,
} as const;

export function challengeSlugForDomain(domain: Domain): string {
  return PROGRAM_SLUG[domain];
}

export function domainFromChallengeSlug(slug: string): Domain | null {
  return DOMAIN_BY_SLUG[slug] ?? null;
}

export function mapPeToEnrollmentStatus(
  status: EnrollmentStatusV2,
): EnrollmentStatus {
  if (status === EnrollmentStatusV2.COMPLETED) return EnrollmentStatus.COMPLETED;
  if (status === EnrollmentStatusV2.DROPPED) return EnrollmentStatus.ABANDONED;
  return EnrollmentStatus.ACTIVE;
}

export function mapPeToMemberStatus(
  status: EnrollmentStatusV2,
): ProgramMemberStatus {
  switch (status) {
    case EnrollmentStatusV2.APPLIED:
      return ProgramMemberStatus.APPLIED;
    case EnrollmentStatusV2.WAITLISTED:
      return ProgramMemberStatus.WAITLISTED;
    case EnrollmentStatusV2.COMPLETED:
      return ProgramMemberStatus.COMPLETED;
    case EnrollmentStatusV2.DROPPED:
      return ProgramMemberStatus.DROPPED;
    default:
      return ProgramMemberStatus.ENROLLED;
  }
}

/** Prefer ENROLLED/ACTIVE over COMPLETED, then newest enrolledAt, then id. */
export function compareMembershipRows(
  a: { status: string; enrolledAt: Date | null; id: string },
  b: { status: string; enrolledAt: Date | null; id: string },
): number {
  const rank = (status: string) => {
    if (status === "ENROLLED" || status === "ACTIVE") return 0;
    if (status === "COMPLETED") return 1;
    return 2;
  };
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  const at = a.enrolledAt?.getTime() ?? 0;
  const bt = b.enrolledAt?.getTime() ?? 0;
  if (bt !== at) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function asProgramLanguage(value: string | null | undefined): ProgramLanguage | null {
  if (
    value === "PYTHON" ||
    value === "SQL" ||
    value === "JAVASCRIPT" ||
    value === "YAML"
  ) {
    return value;
  }
  return null;
}

function optionLetter(position: number): "A" | "B" | "C" | "D" | null {
  if (position === 1) return "A";
  if (position === 2) return "B";
  if (position === 3) return "C";
  if (position === 4) return "D";
  return null;
}

async function overlayEnrollment(
  id: string,
): Promise<{
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastSubmittedDay: number | null;
  challengeId: string;
  startedAt: Date;
} | null> {
  const row = await prisma.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      daysCompleted: true,
      currentStreak: true,
      longestStreak: true,
      lastSubmittedDay: true,
      challengeId: true,
      startedAt: true,
    },
  });
  if (!row) return null;
  const [overlaid] = await overlayChallengeProgressFields([row]);
  return overlaid ?? row;
}

async function challengeIdForDomain(domain: Domain): Promise<string | null> {
  const row = await prisma.challenge.findUnique({
    where: { domain },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function domainForChallengeId(challengeId: string): Promise<Domain | null> {
  const row = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: { domain: true },
  });
  return row?.domain ?? null;
}

export async function getChallengeByDomain(
  domain: Domain,
): Promise<ChallengeCatalog | null> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.challenge.findUnique({
      where: { domain },
      select: CHALLENGE_CATALOG_SELECT,
    });
  }

  const [legacy, program, cohort] = await Promise.all([
    prisma.challenge.findUnique({
      where: { domain },
      select: { id: true },
    }),
    prisma.learningProgram.findUnique({
      where: { slug: PROGRAM_SLUG[domain] },
      select: {
        title: true,
        description: true,
        isPublished: true,
        versions: {
          where: { versionNumber: 1 },
          select: { plannedDurationDays: true },
          take: 1,
        },
      },
    }),
    prisma.cohort.findUnique({
      where: { slug: cohortSlugForDomain(domain) },
      select: { startsAt: true },
    }),
  ]);
  if (!legacy || !program) return null;
  return {
    id: legacy.id,
    domain,
    title: program.title,
    description: program.description,
    totalDays: program.versions[0]?.plannedDurationDays ?? 60,
    isActive: program.isPublished,
    startsAt: cohort?.startsAt ?? null,
  };
}

export async function listChallengeEnrollments(
  userId: string,
): Promise<ChallengeEnrollmentRow[]> {
  if (!isNewLearningRepoEnabled()) {
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
        lastSubmittedDay: true,
        startedAt: true,
        challenge: { select: { title: true, totalDays: true } },
      },
    });
    const overlaid = await overlayChallengeProgressFields(rows);
    return overlaid.map((r) => ({
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

  const pes = await prisma.programEnrollment.findMany({
    where: { userId, id: { startsWith: "pe_enr_" } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      cohort: {
        select: {
          slug: true,
          startsAt: true,
          programVersion: {
            select: {
              plannedDurationDays: true,
              program: { select: { slug: true, title: true } },
            },
          },
        },
      },
    },
  });

  const out: ChallengeEnrollmentRow[] = [];
  for (const pe of pes) {
    const enrollmentId = enrollmentIdFromPe(pe.id);
    if (!enrollmentId) continue;
    const fromSlug = DOMAIN_BY_SLUG[pe.cohort.programVersion.program.slug];
    if (!fromSlug) continue;
    const overlay = await overlayEnrollment(enrollmentId);
    if (!overlay) continue;
    out.push({
      id: enrollmentId,
      domain: fromSlug,
      status: mapPeToEnrollmentStatus(pe.status),
      daysCompleted: overlay.daysCompleted,
      currentStreak: overlay.currentStreak,
      longestStreak: overlay.longestStreak,
      challengeTitle: pe.cohort.programVersion.program.title,
      totalDays: pe.cohort.programVersion.plannedDurationDays ?? 60,
      startedAt: overlay.startedAt,
    });
  }
  return out;
}

export async function findChallengeEnrollment(
  userId: string,
  opts: {
    id?: string;
    domain?: Domain;
    excludeAbandoned?: boolean;
  } = {},
): Promise<SessionEnrollment | null> {
  if (!isNewLearningRepoEnabled()) {
    const row = await prisma.enrollment.findFirst({
      where: {
        userId,
        ...(opts.id ? { id: opts.id } : {}),
        ...(opts.domain ? { domain: opts.domain } : {}),
        ...(opts.excludeAbandoned
          ? { status: { not: EnrollmentStatus.ABANDONED } }
          : {}),
      },
      orderBy: { startedAt: "desc" },
      select: SESSION_ENROLLMENT_SELECT,
    });
    if (!row) return null;
    const [overlaid] = await overlayChallengeProgressFields([row]);
    return overlaid ?? row;
  }

  const pes = await prisma.programEnrollment.findMany({
    where: {
      userId,
      id: { startsWith: "pe_enr_" },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      cohort: {
        select: {
          startsAt: true,
          programVersion: {
            select: {
              plannedDurationDays: true,
              program: { select: { slug: true, title: true } },
            },
          },
        },
      },
    },
  });

  const mapped: SessionEnrollment[] = [];
  for (const pe of pes) {
    const enrollmentId = enrollmentIdFromPe(pe.id);
    if (!enrollmentId) continue;
    if (opts.id && enrollmentId !== opts.id) continue;
    const domain = DOMAIN_BY_SLUG[pe.cohort.programVersion.program.slug];
    if (!domain) continue;
    if (opts.domain && domain !== opts.domain) continue;
    const status = mapPeToEnrollmentStatus(pe.status);
    if (opts.excludeAbandoned && status === EnrollmentStatus.ABANDONED) continue;
    const overlay = await overlayEnrollment(enrollmentId);
    if (!overlay) continue;
    mapped.push({
      id: enrollmentId,
      userId,
      challengeId: overlay.challengeId,
      domain,
      startedAt: overlay.startedAt,
      daysCompleted: overlay.daysCompleted,
      currentStreak: overlay.currentStreak,
      longestStreak: overlay.longestStreak,
      lastSubmittedDay: overlay.lastSubmittedDay,
      status,
      challenge: {
        id: overlay.challengeId,
        domain,
        title: pe.cohort.programVersion.program.title,
        totalDays: pe.cohort.programVersion.plannedDurationDays ?? 60,
        startsAt: pe.cohort.startsAt,
      },
    });
  }

  mapped.sort((a, b) =>
    compareMembershipRows(
      { id: a.id, status: a.status, enrolledAt: a.startedAt },
      { id: b.id, status: b.status, enrolledAt: b.startedAt },
    ),
  );
  return mapped[0] ?? null;
}

export async function resolveSessionEnrollment(
  userId: string,
  enrollmentId: string | undefined,
  profileDomain: Domain | null,
): Promise<SessionEnrollment | null> {
  const trimmed = enrollmentId?.trim();
  if (trimmed) {
    return findChallengeEnrollment(userId, { id: trimmed });
  }

  const active = await listChallengeEnrollments(userId);
  const activeOnly = active.filter((e) => e.status === EnrollmentStatus.ACTIVE);
  activeOnly.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  if (activeOnly[0]) {
    return findChallengeEnrollment(userId, { id: activeOnly[0].id });
  }
  if (profileDomain) {
    const byDomain = await findChallengeEnrollment(userId, {
      domain: profileDomain,
    });
    if (byDomain) return byDomain;
  }
  const any = active
    .slice()
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  if (any[0]) return findChallengeEnrollment(userId, { id: any[0].id });
  return null;
}

export async function resolveChallengeSessionEnrollment(
  userId: string,
  enrollmentId: string | undefined,
): Promise<SessionEnrollment | null> {
  const trimmed = enrollmentId?.trim();
  if (trimmed) {
    return findChallengeEnrollment(userId, {
      id: trimmed,
      excludeAbandoned: true,
    });
  }
  const active = await listChallengeEnrollments(userId);
  const activeOnly = active
    .filter((e) => e.status === EnrollmentStatus.ACTIVE)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  if (activeOnly[0]) {
    return findChallengeEnrollment(userId, { id: activeOnly[0].id });
  }
  const rest = active
    .filter((e) => e.status !== EnrollmentStatus.ABANDONED)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  if (rest[0]) return findChallengeEnrollment(userId, { id: rest[0].id });
  return null;
}

async function membershipFromPe(
  pe: {
    id: string;
    status: EnrollmentStatusV2;
    cohort: {
      id: string;
      slug: string;
      name: string;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
      capacity: number | null;
      joinCode: string | null;
      resultsPublishedAt: Date | null;
    };
  },
): Promise<ProgramMembership | null> {
  const memberId = memberIdFromPe(pe.id);
  const cohortId = programCohortIdFromSlug(pe.cohort.slug);
  if (!memberId || !cohortId) return null;
  const overlay = await programMember.findUnique({
    where: { id: memberId },
    select: { fullName: true, highestUnlockedDay: true },
  });
  if (!overlay) return null;
  return {
    member: {
      id: memberId,
      status: mapPeToMemberStatus(pe.status),
      fullName: overlay.fullName,
      highestUnlockedDay: await getProgramUnlockFloor(
        memberId,
        overlay.highestUnlockedDay,
      ),
      cohortId,
    },
    cohort: {
      id: cohortId,
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

const PE_COHORT_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  joinCode: true,
  resultsPublishedAt: true,
} as const;

export async function findActiveMembership(
  userId: string,
): Promise<ProgramMembership | null> {
  if (isNewLearningRepoEnabled()) {
    const pes = await prisma.programEnrollment.findMany({
      where: {
        userId,
        id: { startsWith: "pe_pm_" },
        status: { in: ["ACTIVE", "COMPLETED"] },
        cohort: { programVersion: { program: { slug: AI_COHORT_SLUG } } },
      },
      select: {
        id: true,
        status: true,
        enrolledAt: true,
        cohort: { select: PE_COHORT_SELECT },
      },
    });
    if (pes.length === 0) return null;
    pes.sort(compareMembershipRows);
    return membershipFromPe(pes[0]!);
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
  memberships.sort(compareMembershipRows);
  const member = memberships[0]!;
  return {
    member: {
      id: member.id,
      status: member.status,
      fullName: member.fullName,
      highestUnlockedDay: await getProgramUnlockFloor(
        member.id,
        member.highestUnlockedDay,
      ),
      cohortId: member.cohortId,
    },
    cohort: member.cohort,
  };
}

export async function findAppliedMembership(
  userId: string,
): Promise<AppliedMembership | null> {
  if (!isNewLearningRepoEnabled()) {
    return programMember.findFirst({
      where: { userId, status: "APPLIED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        cohortId: true,
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
        phone: true,
        githubUsername: true,
        githubRepoUrl: true,
        cohort: {
          select: {
            id: true,
            name: true,
            status: true,
            capacity: true,
            joinCode: true,
          },
        },
      },
    });
  }

  const pes = await prisma.programEnrollment.findMany({
    where: {
      userId,
      id: { startsWith: "pe_pm_" },
      status: "APPLIED",
    },
    orderBy: [{ enrolledAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      createdAt: true,
      cohort: { select: PE_COHORT_SELECT },
    },
  });
  pes.sort((a, b) => {
    const at = a.enrolledAt?.getTime() ?? a.createdAt.getTime();
    const bt = b.enrolledAt?.getTime() ?? b.createdAt.getTime();
    if (bt !== at) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const pe = pes[0];
  if (!pe) return null;
  const memberId = memberIdFromPe(pe.id);
  const cohortId = programCohortIdFromSlug(pe.cohort.slug);
  if (!memberId || !cohortId) return null;
  const overlay = await programMember.findUnique({
    where: { id: memberId },
    select: {
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
      phone: true,
      githubUsername: true,
      githubRepoUrl: true,
    },
  });
  if (!overlay) return null;
  return {
    id: memberId,
    status: ProgramMemberStatus.APPLIED,
    cohortId,
    ...overlay,
    cohort: {
      id: cohortId,
      name: pe.cohort.name,
      status: pe.cohort.status,
      capacity: pe.cohort.capacity,
      joinCode: pe.cohort.joinCode ?? "",
    },
  };
}

export async function findWaitlistedMembership(
  userId: string,
): Promise<{ id: string } | null> {
  if (!isNewLearningRepoEnabled()) {
    return programMember.findFirst({
      where: { userId, status: "WAITLISTED" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
  }
  const pes = await prisma.programEnrollment.findMany({
    where: {
      userId,
      id: { startsWith: "pe_pm_" },
      status: "WAITLISTED",
    },
    select: { id: true, enrolledAt: true, createdAt: true },
  });
  pes.sort((a, b) => {
    const at = a.enrolledAt?.getTime() ?? a.createdAt.getTime();
    const bt = b.enrolledAt?.getTime() ?? b.createdAt.getTime();
    if (bt !== at) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const id = pes[0] ? memberIdFromPe(pes[0].id) : null;
  return id ? { id } : null;
}

export async function getCohortByJoinCode(
  joinCode: string,
): Promise<ProgramCohortCatalog | null> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.programCohort.findUnique({
      where: { joinCode },
      select: {
        id: true,
        name: true,
        status: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        resultsPublishedAt: true,
        joinCode: true,
        requiresJoinCode: true,
      },
    });
  }
  const cohort = await prisma.cohort.findFirst({
    where: {
      joinCode,
      programVersion: { program: { slug: AI_COHORT_SLUG } },
    },
    select: {
      slug: true,
      name: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      resultsPublishedAt: true,
      joinCode: true,
      requiresJoinCode: true,
    },
  });
  const id = cohort ? programCohortIdFromSlug(cohort.slug) : null;
  if (!cohort || !id || !cohort.joinCode) return null;
  return {
    id,
    name: cohort.name,
    status: cohort.status,
    startsAt: cohort.startsAt ?? new Date(0),
    endsAt: cohort.endsAt ?? new Date(0),
    capacity: cohort.capacity,
    resultsPublishedAt: cohort.resultsPublishedAt,
    joinCode: cohort.joinCode,
    requiresJoinCode: cohort.requiresJoinCode,
  };
}

export async function getOpenEnrollmentCohort(): Promise<OpenEnrollmentCohort | null> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.programCohort.findFirst({
      where: { status: "ENROLLING", requiresJoinCode: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, joinCode: true },
    });
  }
  const cohort = await prisma.cohort.findFirst({
    where: {
      status: "ENROLLING",
      requiresJoinCode: false,
      programVersion: { program: { slug: AI_COHORT_SLUG } },
    },
    orderBy: { createdAt: "desc" },
    select: { slug: true, name: true, status: true, joinCode: true },
  });
  const id = cohort ? programCohortIdFromSlug(cohort.slug) : null;
  if (!cohort || !id || !cohort.joinCode) return null;
  return {
    id,
    name: cohort.name,
    status: cohort.status,
    joinCode: cohort.joinCode,
  };
}

async function dailyTasksFromActivities(
  domain: Domain,
  challengeId: string,
): Promise<DailyTaskRow[]> {
  const activities = await prisma.activity.findMany({
    where: {
      id: { startsWith: "act_dt_" },
      module: {
        programVersion: { program: { slug: PROGRAM_SLUG[domain] } },
      },
    },
    orderBy: { dayNumber: "asc" },
    select: {
      id: true,
      title: true,
      dayNumber: true,
      difficulty: true,
      estimatedMinutes: true,
      tags: true,
      createdAt: true,
      contentConfig: {
        select: {
          bodyMarkdown: true,
          contentJson: true,
          resources: true,
          objectives: true,
        },
      },
      externalConfig: {
        select: { linkedinTemplate: true, solutionApproach: true },
      },
    },
  });
  return activities.flatMap((a) => {
    const id = dailyTaskIdFromActivity(a.id);
    if (!id || a.dayNumber == null) return [];
    return [
      {
        id,
        challengeId,
        dayNumber: a.dayNumber,
        domain,
        title: a.title,
        problemStatement: a.contentConfig?.bodyMarkdown ?? "",
        learningObjectives: a.contentConfig?.objectives ?? [],
        resources: a.contentConfig?.resources ?? [],
        difficulty: a.difficulty ?? "",
        estimatedMinutes: a.estimatedMinutes ?? 0,
        linkedinTemplate: a.externalConfig?.linkedinTemplate ?? "",
        solutionApproach: a.externalConfig?.solutionApproach ?? null,
        tags: a.tags,
        dayContent: a.contentConfig?.contentJson ?? null,
        createdAt: a.createdAt,
      },
    ];
  });
}

export async function listDailyTasks(
  challengeId: string,
): Promise<DailyTaskRow[]> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.dailyTask.findMany({
      where: { challengeId, dayNumber: { gte: 1, lte: 60 } },
      orderBy: { dayNumber: "asc" },
      select: DAILY_TASK_SELECT,
    });
  }
  const domain = await domainForChallengeId(challengeId);
  if (!domain) return [];
  return (await dailyTasksFromActivities(domain, challengeId)).filter(
    (t) => t.dayNumber >= 1 && t.dayNumber <= 60,
  );
}

export async function listCachedDailyTasks(
  challengeId: string,
): Promise<CachedDailyTaskRow[]> {
  const rows = await listDailyTasks(challengeId);
  return rows.map((t) => ({
    id: t.id,
    dayNumber: t.dayNumber,
    problemStatement: t.problemStatement,
    learningObjectives: t.learningObjectives,
    resources: t.resources,
    tags: t.tags,
    difficulty: t.difficulty,
    estimatedMinutes: t.estimatedMinutes,
  }));
}

export async function getDailyTaskByChallengeDay(
  challengeId: string,
  dayNumber: number,
): Promise<DailyTaskRow | null> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.dailyTask.findUnique({
      where: { challengeId_dayNumber: { challengeId, dayNumber } },
      select: DAILY_TASK_SELECT,
    });
  }
  const rows = await listDailyTasks(challengeId);
  return rows.find((t) => t.dayNumber === dayNumber) ?? null;
}

export async function listProgramModules(): Promise<ProgramModuleRow[]> {
  if (!isNewLearningRepoEnabled()) {
    return prisma.programModule.findMany({
      orderBy: { number: "asc" },
      select: {
        number: true,
        title: true,
        subtitle: true,
        color: true,
        startDay: true,
        endDay: true,
      },
    });
  }
  const modules = await prisma.module.findMany({
    where: {
      programVersion: { program: { slug: AI_COHORT_SLUG } },
      startDay: { not: null },
    },
    orderBy: { position: "asc" },
    select: {
      position: true,
      title: true,
      subtitle: true,
      colorToken: true,
      startDay: true,
      endDay: true,
    },
  });
  return modules.map((m) => ({
    number: m.position,
    title: m.title,
    subtitle: m.subtitle ?? "",
    color: m.colorToken ?? "",
    startDay: m.startDay ?? 0,
    endDay: m.endDay ?? 0,
  }));
}

async function programDayActivities() {
  return prisma.activity.findMany({
    where: {
      id: { startsWith: "act_pd_" },
      module: { programVersion: { program: { slug: AI_COHORT_SLUG } } },
    },
    orderBy: { dayNumber: "asc" },
    select: {
      id: true,
      type: true,
      title: true,
      dayNumber: true,
      points: true,
      estimatedMinutes: true,
      tags: true,
      contentConfig: {
        select: {
          bodyMarkdown: true,
          assetsJson: true,
          objectives: true,
          missionType: true,
        },
      },
      codingConfig: { select: { language: true, starterCode: true } },
      module: {
        select: {
          position: true,
          title: true,
          colorToken: true,
        },
      },
    },
  });
}

export async function listProgramDayCatalog(): Promise<ProgramDayCatalog[]> {
  if (!isNewLearningRepoEnabled()) {
    const days = await prisma.programDay.findMany({
      orderBy: { dayNumber: "asc" },
      select: {
        dayNumber: true,
        title: true,
        missionType: true,
        isProjectDay: true,
        module: { select: { number: true } },
      },
    });
    return days.map((d) => ({
      dayNumber: d.dayNumber,
      title: d.title,
      missionType: d.missionType,
      isProjectDay: d.isProjectDay,
      moduleNumber: d.module.number,
    }));
  }
  const activities = await programDayActivities();
  return activities.flatMap((a) => {
    if (a.dayNumber == null) return [];
    const missionType = a.contentConfig?.missionType;
    if (!missionType) return [];
    return [
      {
        dayNumber: a.dayNumber,
        title: a.title,
        missionType,
        isProjectDay:
          missionType === ProgramMissionType.BOSS_BUILD ||
          a.type === ActivityType.PROJECT,
        moduleNumber: a.module.position,
      },
    ];
  });
}

async function videosForDay(dayNumber: number): Promise<DayVideoRow[]> {
  const videos = await prisma.activity.findMany({
    where: {
      id: { startsWith: "act_vid_" },
      dayNumber,
      type: ActivityType.VIDEO,
      module: { programVersion: { program: { slug: AI_COHORT_SLUG } } },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      position: true,
      estimatedMinutes: true,
      contentConfig: { select: { videoRef: true, videoDurationMin: true } },
    },
  });
  return videos.flatMap((v, index) => {
    const id = videoIdFromActivity(v.id);
    const youtubeId = v.contentConfig?.videoRef;
    if (!id || !youtubeId) return [];
    return [
      {
        id,
        order: index + 1,
        title: v.title,
        youtubeId,
        durationMin: v.contentConfig?.videoDurationMin ?? v.estimatedMinutes,
      },
    ];
  });
}

export async function getProgramDayShell(
  dayNumber: number,
): Promise<ProgramDayShellRow | null> {
  if (!isNewLearningRepoEnabled()) {
    const day = await prisma.programDay.findUnique({
      where: { dayNumber },
      select: {
        id: true,
        dayNumber: true,
        title: true,
        missionType: true,
        briefMd: true,
        assetsJson: true,
        starterCode: true,
        language: true,
        objectives: true,
        tools: true,
        estimatedMin: true,
        missionPoints: true,
        isProjectDay: true,
        module: { select: { number: true, title: true, color: true } },
        videos: {
          select: {
            id: true,
            order: true,
            title: true,
            youtubeId: true,
            durationMin: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });
    return day;
  }

  const activity = await prisma.activity.findFirst({
    where: {
      id: { startsWith: "act_pd_" },
      dayNumber,
      module: { programVersion: { program: { slug: AI_COHORT_SLUG } } },
    },
    select: {
      id: true,
      type: true,
      title: true,
      dayNumber: true,
      points: true,
      estimatedMinutes: true,
      tags: true,
      contentConfig: {
        select: {
          bodyMarkdown: true,
          assetsJson: true,
          objectives: true,
          missionType: true,
        },
      },
      codingConfig: { select: { language: true, starterCode: true } },
      module: {
        select: { position: true, title: true, colorToken: true },
      },
    },
  });
  const id = activity ? programDayIdFromActivity(activity.id) : null;
  if (!activity || activity.dayNumber == null || !id) return null;
  const missionType = activity.contentConfig?.missionType;
  if (!missionType) return null;
  const videos = await videosForDay(activity.dayNumber);
  return {
    id,
    dayNumber: activity.dayNumber,
    title: activity.title,
    missionType,
    briefMd: activity.contentConfig?.bodyMarkdown ?? "",
    assetsJson: activity.contentConfig?.assetsJson ?? null,
    starterCode: activity.codingConfig?.starterCode ?? null,
    language: asProgramLanguage(activity.codingConfig?.language),
    objectives: activity.contentConfig?.objectives ?? [],
    tools: activity.tags,
    estimatedMin: activity.estimatedMinutes ?? 60,
    missionPoints: activity.points,
    isProjectDay:
      missionType === ProgramMissionType.BOSS_BUILD ||
      activity.type === ActivityType.PROJECT,
    module: {
      number: activity.module.position,
      title: activity.module.title,
      color: activity.module.colorToken ?? "",
    },
    videos,
  };
}

export async function listProgramVideos(): Promise<
  Array<{
    id: string;
    dayNumber: number;
    moduleNumber: number;
    title: string;
    youtubeId: string;
    durationMin: number | null;
  }>
> {
  if (!isNewLearningRepoEnabled()) {
    const days = await prisma.programDay.findMany({
      orderBy: { dayNumber: "asc" },
      select: {
        dayNumber: true,
        module: { select: { number: true } },
        videos: {
          select: {
            id: true,
            title: true,
            youtubeId: true,
            durationMin: true,
            order: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });
    return days.flatMap((d) =>
      d.videos.map((v) => ({
        id: v.id,
        dayNumber: d.dayNumber,
        moduleNumber: d.module.number,
        title: v.title,
        youtubeId: v.youtubeId,
        durationMin: v.durationMin,
      })),
    );
  }

  const videos = await prisma.activity.findMany({
    where: {
      id: { startsWith: "act_vid_" },
      type: ActivityType.VIDEO,
      module: { programVersion: { program: { slug: AI_COHORT_SLUG } } },
    },
    orderBy: [{ dayNumber: "asc" }, { position: "asc" }],
    select: {
      id: true,
      title: true,
      dayNumber: true,
      estimatedMinutes: true,
      module: { select: { position: true } },
      contentConfig: { select: { videoRef: true, videoDurationMin: true } },
    },
  });
  return videos.flatMap((v) => {
    const id = videoIdFromActivity(v.id);
    const youtubeId = v.contentConfig?.videoRef;
    if (!id || v.dayNumber == null || !youtubeId) return [];
    return [
      {
        id,
        dayNumber: v.dayNumber,
        moduleNumber: v.module.position,
        title: v.title,
        youtubeId,
        durationMin: v.contentConfig?.videoDurationMin ?? v.estimatedMinutes,
      },
    ];
  });
}

export async function listQuizCatalog(domain: Domain): Promise<QuizCatalogRow[]> {
  const challengeId = await challengeIdForDomain(domain);
  if (!isNewLearningRepoEnabled()) {
    if (!challengeId) return [];
    const quizzes = await prisma.quiz.findMany({
      where: { challengeId, domain },
      orderBy: { weekNumber: "asc" },
      select: {
        id: true,
        weekNumber: true,
        title: true,
        domain: true,
        _count: { select: { quizQuestions: true } },
      },
    });
    return quizzes.map((q) => ({
      id: q.id,
      weekNumber: q.weekNumber,
      title: q.title,
      domain: q.domain,
      questionCount: q._count.quizQuestions,
    }));
  }

  const activities = await prisma.activity.findMany({
    where: {
      id: { startsWith: "act_quiz_" },
      type: ActivityType.QUIZ,
      module: {
        programVersion: { program: { slug: PROGRAM_SLUG[domain] } },
      },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      position: true,
      quizConfig: { select: { _count: { select: { questions: true } } } },
    },
  });
  return activities.flatMap((a) => {
    const id = quizIdFromActivity(a.id);
    if (!id) return [];
    return [
      {
        id,
        weekNumber: a.position,
        title: a.title,
        domain,
        questionCount: a.quizConfig?._count.questions ?? 0,
      },
    ];
  });
}

/**
 * Quiz definition from Activity config when LEARNING is on.
 * Returns null when the 078 row is missing or cannot render A–D identically
 * (not exactly four options, or no marked-correct option).
 */
export async function getQuizDefinition(
  quizId: string,
): Promise<QuizDefinition | null> {
  if (!isNewLearningRepoEnabled()) {
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId },
      select: {
        id: true,
        weekNumber: true,
        title: true,
        domain: true,
        challengeId: true,
      },
    });
    if (!quiz) return null;
    const rows = await prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: { questionOrder: "asc" },
    });
    return {
      ...quiz,
      questions: rows.map((q) => ({
        id: q.id,
        questionOrder: q.questionOrder,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      })),
    };
  }

  const activity = await prisma.activity.findUnique({
    where: { id: `act_quiz_${quizId}` },
    select: {
      id: true,
      title: true,
      position: true,
      module: {
        select: {
          programVersion: { select: { program: { select: { slug: true } } } },
        },
      },
      quizConfig: {
        select: {
          questions: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              body: true,
              explanation: true,
              options: {
                orderBy: { position: "asc" },
                select: { position: true, body: true, isCorrect: true },
              },
            },
          },
        },
      },
    },
  });
  const domain = activity
    ? DOMAIN_BY_SLUG[activity.module.programVersion.program.slug]
    : undefined;
  const challengeId = domain ? await challengeIdForDomain(domain) : null;
  if (!activity || !domain || !challengeId || !activity.quizConfig) return null;

  const questions: QuizDefinitionQuestion[] = [];
  for (const q of activity.quizConfig.questions) {
    if (q.options.length !== 4) return null;
    const byPos = new Map(q.options.map((o) => [o.position, o]));
    const a = byPos.get(1);
    const b = byPos.get(2);
    const c = byPos.get(3);
    const d = byPos.get(4);
    const correct = q.options.find((o) => o.isCorrect);
    const letter = correct ? optionLetter(correct.position) : null;
    if (!a || !b || !c || !d || !letter) return null;
    questions.push({
      id: q.id,
      questionOrder: q.position,
      questionText: q.body,
      optionA: a.body,
      optionB: b.body,
      optionC: c.body,
      optionD: d.body,
      correctAnswer: letter,
      explanation: q.explanation ?? "",
    });
  }
  if (questions.length === 0) return null;

  return {
    id: quizId,
    weekNumber: activity.position,
    title: activity.title,
    domain,
    challengeId,
    questions,
  };
}
