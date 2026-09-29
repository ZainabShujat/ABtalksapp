import "server-only";
import { Domain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCandidateDetail } from "@/repositories/candidate-detail";
import { listChallengeEnrollments } from "@/repositories/learning";
import { listAiCohortMemberships } from "@/repositories/program-state";
import { getVerifiedAccomplishments } from "@/features/profile/get-verified-accomplishments";
import { getResumeView } from "@/features/resume/service";
import { getHistory } from "@/features/interview/platform/service";
import { prismaApplicationStore } from "@/features/candidate-jobs/prisma-store";
import { listMyApplications } from "@/features/candidate-jobs/service";
import { prismaJobStore } from "@/features/recruiter-jobs/prisma-store";
import { listCandidateAttempts } from "@/features/assessment-attempts/service";
import { prismaAttemptStore } from "@/features/assessment-attempts/prisma-store";
import { searchDeliveries } from "@/features/notification/delivery-diagnosis";
import { getCandidateDiscoverability } from "@/features/admin/get-candidate-discoverability";
import { getEvidenceProvenance } from "@/features/admin/get-evidence-provenance";
import {
  getStudentDetail,
  type StudentDetail,
} from "@/features/admin/get-student-detail";
import type { CandidateDiscoverability } from "@/features/admin/candidate-discoverability";
import type { EvidenceProvenance } from "@/features/admin/evidence-provenance";
import type { CandidateDetail } from "@/repositories/candidate-detail";
import type { VerifiedAccomplishment } from "@/features/profile/get-verified-accomplishments";
import type { ResumeView } from "@/features/resume/types";
import type { HistoryEntry } from "@/features/interview/platform/service";
import type { ApplicationWithJob } from "@/features/candidate-jobs/service";
import type { AttemptListRow } from "@/features/assessment-attempts/service";
import type { DeliveryRow } from "@/features/notification/delivery-diagnosis";

/**
 * Challenge enrolments are mirrored into ProgramEnrollment against a
 * `legacy-<domain>` cohort. Those rows are listed under Challenges, not
 * Programmes, so they are dropped from the programme query.
 */
const CHALLENGE_MIRROR_COHORT_SLUGS = Object.values(Domain).map(
  (d) => `legacy-${d.toLowerCase()}`,
);

export type AccountStatus = "ACTIVE" | "DISABLED" | "DELETED";

export type AdminCandidateAccount = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  joinedAt: Date;
  disabledAt: Date | null;
  disabledReason: string | null;
  deletedAt: Date | null;
  sessionInvalidatedAt: Date | null;
  anonymizedAt: Date | null;
  status: AccountStatus;
};

export type AdminProgrammeRow = {
  kind: "challenge" | "programme";
  id: string;
  title: string;
  status: string;
  enrolledAt: Date | null;
  completedAt: Date | null;
  droppedAt: Date | null;
  memberId: string | null;
};

export type AdminCandidateDetail = {
  account: AdminCandidateAccount;
  ops: StudentDetail | null;
  profile: CandidateDetail | null;
  resume: ResumeView | null;
  /**
   * Admin-scoped download href for the stored résumé file, or null when no
   * file is stored.
   *
   * NOT `resume.downloadPath` — that constant is hard-coded to the owner-only
   * `/api/profile/resume/file`, which resolves the blob from the session and
   * would serve the ADMIN their own résumé (or a 404). Wrong file, no error.
   */
  resumeDownloadHref: string | null;
  accomplishments: VerifiedAccomplishment[];
  mockInterviews: HistoryEntry[];
  applications: ApplicationWithJob[];
  assessments: AttemptListRow[];
  programmes: AdminProgrammeRow[];
  deliveries: DeliveryRow[];
  /** Why this candidate does or does not appear in recruiter search. */
  discoverability: CandidateDiscoverability | null;
  /** Every evidence badge resolved to the row that earned it, with its date. */
  evidenceProvenance: EvidenceProvenance;
};

function accountStatus(user: {
  deletedAt: Date | null;
  disabledAt: Date | null;
}): AccountStatus {
  if (user.deletedAt) return "DELETED";
  if (user.disabledAt) return "DISABLED";
  return "ACTIVE";
}

/**
 * T-264 — one privileged read of a candidate for the admin console.
 *
 * Auth is the caller's job (`requireAdmin` on the page). This function takes
 * the URL userId and loads the same records the candidate sees, plus account
 * timestamps. Soft-deleted users still return; a missing User row returns null.
 */
export async function getAdminCandidateDetail(
  userId: string,
): Promise<AdminCandidateDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true,
      deletedAt: true,
      disabledAt: true,
      disabledReason: true,
      sessionInvalidatedAt: true,
      anonymizedAt: true,
    },
  });

  if (!user) {
    return null;
  }

  const applicationDeps = {
    jobs: prismaJobStore(),
    applications: prismaApplicationStore(),
  };

  const [
    ops,
    profile,
    resume,
    accomplishments,
    mockHistory,
    applicationsResult,
    assessmentsResult,
    challenges,
    programRows,
    members,
    deliveries,
    discoverability,
    evidenceProvenance,
  ] = await Promise.all([
    getStudentDetail(userId),
    getCandidateDetail(userId),
    getResumeView(userId),
    getVerifiedAccomplishments(userId),
    getHistory(userId).catch((e: unknown) => {
      logger.warn("[admin-candidate] mock interview history unavailable", {
        message: e instanceof Error ? e.message : String(e),
      });
      return { ok: false as const, message: "unavailable" };
    }),
    listMyApplications(applicationDeps, { userId }),
    listCandidateAttempts(prismaAttemptStore(), userId),
    listChallengeEnrollments(userId),
    prisma.programEnrollment.findMany({
      where: {
        userId,
        cohort: { slug: { notIn: CHALLENGE_MIRROR_COHORT_SLUGS } },
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        enrolledAt: true,
        startedAt: true,
        completedAt: true,
        droppedAt: true,
        cohortId: true,
        cohort: {
          select: {
            programVersion: {
              select: { program: { select: { title: true } } },
            },
          },
        },
      },
    }),
    listAiCohortMemberships({ userId }),
    searchDeliveries({ recipient: userId, limit: 50 }),
    getCandidateDiscoverability(userId),
    getEvidenceProvenance(userId),
  ]);

  const memberByCohort = new Map(members.map((m) => [m.cohortId, m.id]));

  const programmes: AdminProgrammeRow[] = [
    ...challenges.map((row) => ({
      kind: "challenge" as const,
      id: row.id,
      title: row.challengeTitle,
      status: row.status,
      enrolledAt: row.startedAt,
      completedAt: null,
      droppedAt: null,
      memberId: null,
    })),
    ...programRows.map((row) => ({
      kind: "programme" as const,
      id: row.id,
      title: row.cohort.programVersion.program.title,
      status: row.status,
      enrolledAt: row.enrolledAt ?? row.startedAt,
      completedAt: row.completedAt,
      droppedAt: row.droppedAt,
      memberId: memberByCohort.get(row.cohortId) ?? null,
    })),
  ];

  const name =
    profile?.fullName?.trim() ||
    ops?.user.name?.trim() ||
    user.name?.trim() ||
    user.email;

  return {
    account: {
      userId: user.id,
      name,
      email: user.email,
      image: user.image,
      joinedAt: user.createdAt,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      deletedAt: user.deletedAt,
      sessionInvalidatedAt: user.sessionInvalidatedAt,
      anonymizedAt: user.anonymizedAt,
      status: accountStatus(user),
    },
    ops,
    profile,
    resume,
    // `downloadPath` is non-null exactly when `CandidateResume.blobPathname`
    // is set, so this is a free presence test rather than another query.
    resumeDownloadHref: resume?.downloadPath
      ? `/api/admin/candidates/${encodeURIComponent(userId)}/resume`
      : null,
    accomplishments,
    mockInterviews: mockHistory.ok ? mockHistory.data : [],
    applications: applicationsResult.ok ? applicationsResult.data : [],
    assessments: assessmentsResult.ok ? assessmentsResult.data : [],
    programmes,
    deliveries,
    discoverability,
    evidenceProvenance,
  };
}
