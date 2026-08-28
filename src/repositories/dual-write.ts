import {
  AttemptLateness,
  AttemptStatus,
  CandidatePersona,
  CertificateStatus,
  CertificateType,
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  EnrollmentStatus,
  EnrollmentStatusV2,
  EvaluatorType,
  PointsSourceType,
  Prisma,
  ProgramMemberStatus,
  UserType,
} from "@prisma/client";
import { logger } from "@/lib/logger";
import { isDualWriteEnabled } from "@/lib/feature-flags";
import {
  activityIdForDailyTask,
  activityIdForProgramDay,
  attemptIdForMission,
  attemptIdForSubmission,
  cohortSlugForDomain,
  cohortSlugForProgramCohort,
  peIdForEnrollment,
  peIdForMember,
} from "@/repositories/ids";

type Tx = Prisma.TransactionClient;

function savepointName(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `dw_${cleaned || "x"}`;
}

export async function runDualWrite(
  tx: Tx,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  // SAVEPOINT needs a session that supports interactive transactions.
  // Neon transaction-mode pooler can drop the tx; app call sites already set
  // maxWait/timeout. Probe with the direct (non-pooler) child URL.
  const sp = savepointName(label);
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
    try {
      await fn();
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
      try {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
      } catch (rollbackErr) {
        logger.error("[078 dual-write] savepoint rollback failed", {
          label,
          error: String(rollbackErr),
        });
      }
      logger.error("[078 dual-write] new write failed; legacy kept", {
        label,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      });
    }
  } catch (err) {
    logger.error("[078 dual-write] new write failed; legacy kept", {
      label,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
  }
}

async function ensureCandidateVisibility(tx: Tx, userId: string): Promise<void> {
  const existing = await tx.candidateVisibility.findUnique({
    where: { userId },
    select: { withdrawnAt: true },
  });
  if (existing?.withdrawnAt) return;
  if (existing) return;
  await tx.candidateVisibility.create({
    data: {
      userId,
      searchableByRecruiters: true,
      consentSource: "platform_default",
      consentedAt: new Date(),
    },
  });
}

function mapChallengeStatus(status: EnrollmentStatus): EnrollmentStatusV2 {
  if (status === EnrollmentStatus.COMPLETED) return EnrollmentStatusV2.COMPLETED;
  if (status === EnrollmentStatus.ABANDONED) return EnrollmentStatusV2.DROPPED;
  return EnrollmentStatusV2.ACTIVE;
}

function mapMemberStatus(status: ProgramMemberStatus): EnrollmentStatusV2 {
  switch (status) {
    case ProgramMemberStatus.APPLIED:
      return EnrollmentStatusV2.APPLIED;
    case ProgramMemberStatus.WAITLISTED:
      return EnrollmentStatusV2.WAITLISTED;
    case ProgramMemberStatus.ENROLLED:
      return EnrollmentStatusV2.ACTIVE;
    case ProgramMemberStatus.COMPLETED:
      return EnrollmentStatusV2.COMPLETED;
    case ProgramMemberStatus.DROPPED:
      return EnrollmentStatusV2.DROPPED;
    default:
      return EnrollmentStatusV2.ACTIVE;
  }
}

export async function dualWriteChallengeEnrollment(
  tx: Tx,
  enrollment: {
    id: string;
    userId: string;
    domain: string;
    status: EnrollmentStatus;
    startedAt: Date;
    completedAt: Date | null;
  },
): Promise<void> {
  await runDualWrite(tx, "enrollment", async () => {
    const cohort = await tx.cohort.findUnique({
      where: { slug: cohortSlugForDomain(enrollment.domain) },
      select: { id: true },
    });
    if (!cohort) throw new Error(`Missing cohort ${cohortSlugForDomain(enrollment.domain)}`);
    await tx.programEnrollment.upsert({
      where: { id: peIdForEnrollment(enrollment.id) },
      create: {
        id: peIdForEnrollment(enrollment.id),
        userId: enrollment.userId,
        cohortId: cohort.id,
        status: mapChallengeStatus(enrollment.status),
        startedAt: enrollment.startedAt,
        enrolledAt: enrollment.startedAt,
        completedAt: enrollment.completedAt,
      },
      update: {
        status: mapChallengeStatus(enrollment.status),
        completedAt: enrollment.completedAt,
      },
    });
    await ensureCandidateVisibility(tx, enrollment.userId);
  });
}

export async function dualWriteProgramMember(
  tx: Tx,
  memberId: string,
): Promise<void> {
  await runDualWrite(tx, "programMember", async () => {
    const member = await tx.programMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        userId: true,
        cohortId: true,
        status: true,
        enrolledAt: true,
        completedAt: true,
        createdAt: true,
        githubRepoUrl: true,
        highestUnlockedDay: true,
        skipTokensUsed: true,
      },
    });
    if (!member) throw new Error(`Missing ProgramMember ${memberId}`);
    const cohort = await tx.cohort.findUnique({
      where: { slug: cohortSlugForProgramCohort(member.cohortId) },
      select: { id: true },
    });
    if (!cohort) {
      throw new Error(`Missing cohort ${cohortSlugForProgramCohort(member.cohortId)}`);
    }
    await tx.programEnrollment.upsert({
      where: { id: peIdForMember(member.id) },
      create: {
        id: peIdForMember(member.id),
        userId: member.userId,
        cohortId: cohort.id,
        status: mapMemberStatus(member.status),
        startedAt: member.enrolledAt ?? member.createdAt,
        enrolledAt: member.enrolledAt,
        completedAt: member.completedAt,
        githubRepoUrl: member.githubRepoUrl,
        unlockFloorDay: member.highestUnlockedDay,
        skipTokensUsed: member.skipTokensUsed,
      },
      update: {
        status: mapMemberStatus(member.status),
        enrolledAt: member.enrolledAt,
        completedAt: member.completedAt,
        githubRepoUrl: member.githubRepoUrl,
        unlockFloorDay: member.highestUnlockedDay,
        skipTokensUsed: member.skipTokensUsed,
      },
    });
    await ensureCandidateVisibility(tx, member.userId);
  });
}

export async function dualWriteSubmissionAttempt(
  tx: Tx,
  submission: {
    id: string;
    enrollmentId: string;
    dailyTaskId: string;
    githubUrl: string | null;
    linkedinUrl: string | null;
    status: string;
    submittedAt: Date;
    pointsAwarded: number;
  },
): Promise<void> {
  await runDualWrite(tx, "submitDay", async () => {
    const attemptId = attemptIdForSubmission(submission.id);
    await tx.activityAttempt.upsert({
      where: { id: attemptId },
      create: {
        id: attemptId,
        enrollmentId: peIdForEnrollment(submission.enrollmentId),
        activityId: activityIdForDailyTask(submission.dailyTaskId),
        attemptNumber: 1,
        status: AttemptStatus.EVALUATED,
        lateness:
          submission.status === "LATE"
            ? AttemptLateness.LATE
            : AttemptLateness.ON_TIME,
        payload: {
          githubUrl: submission.githubUrl,
          linkedinUrl: submission.linkedinUrl,
          legacySubmissionId: submission.id,
        },
        passed: true,
        pointsAwarded: submission.pointsAwarded,
        startedAt: submission.submittedAt,
        submittedAt: submission.submittedAt,
      },
      update: {
        payload: {
          githubUrl: submission.githubUrl,
          linkedinUrl: submission.linkedinUrl,
          legacySubmissionId: submission.id,
        },
        submittedAt: submission.submittedAt,
        ...(submission.pointsAwarded > 0
          ? { pointsAwarded: submission.pointsAwarded }
          : {}),
      },
    });
    await tx.activityEvaluation.upsert({
      where: { id: `ev_sub_${submission.id}` },
      create: {
        id: `ev_sub_${submission.id}`,
        attemptId,
        evaluatorType: EvaluatorType.AUTO,
        passed: true,
        score: 100,
        maxScore: 100,
        isAuthoritative: true,
        createdAt: submission.submittedAt,
      },
      update: { passed: true },
    });
  });
}

export async function dualWriteMissionAttempt(
  tx: Tx,
  row: {
    id: string;
    memberId: string;
    programDayId: string;
    attemptNumber: number;
    payload: Prisma.InputJsonValue;
    verdict: Prisma.InputJsonValue;
    passed: boolean;
    pointsAwarded: number;
    createdAt: Date;
  },
): Promise<void> {
  await runDualWrite(tx, "verifyMission", async () => {
    const attemptId = attemptIdForMission(row.id);
    await tx.activityAttempt.upsert({
      where: { id: attemptId },
      create: {
        id: attemptId,
        enrollmentId: peIdForMember(row.memberId),
        activityId: activityIdForProgramDay(row.programDayId),
        attemptNumber: row.attemptNumber,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.NOT_APPLICABLE,
        payload: {
          ...(typeof row.payload === "object" && row.payload && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {}),
          legacyMissionSubmissionId: row.id,
        } as Prisma.InputJsonValue,
        passed: row.passed,
        pointsAwarded: row.pointsAwarded,
        startedAt: row.createdAt,
        submittedAt: row.createdAt,
      },
      update: {
        passed: row.passed,
        pointsAwarded: row.pointsAwarded,
      },
    });
    await tx.activityEvaluation.upsert({
      where: { id: `ev_ms_${row.id}` },
      create: {
        id: `ev_ms_${row.id}`,
        attemptId,
        evaluatorType: EvaluatorType.AUTO,
        passed: row.passed,
        score: row.passed ? 100 : 0,
        maxScore: 100,
        detailJson: row.verdict,
        isAuthoritative: true,
        createdAt: row.createdAt,
      },
      update: { passed: row.passed, detailJson: row.verdict },
    });
  });
}

export async function dualWritePoints(
  tx: Tx,
  event: {
    userId: string;
    amount: number;
    sourceType: PointsSourceType;
    sourceId?: string | null;
    idempotencyKey: string;
    reason?: string | null;
    createdByUserId?: string | null;
  },
): Promise<void> {
  await runDualWrite(tx, "points", async () => {
    const user = await tx.user.findUnique({
      where: { id: event.userId },
      select: { synergyPoints: true },
    });
    const balance = user?.synergyPoints ?? 0;
    const earned = event.amount > 0 ? event.amount : 0;
    const spent = event.amount < 0 ? -event.amount : 0;
    await tx.pointsAccount.upsert({
      where: { userId: event.userId },
      create: {
        userId: event.userId,
        balance,
        lifetimeEarned: earned,
        lifetimeSpent: spent,
        reconciledAt: new Date(),
      },
      update: {
        balance,
        lifetimeEarned: { increment: earned },
        lifetimeSpent: { increment: spent },
        reconciledAt: new Date(),
      },
    });
    await tx.pointsTransaction.upsert({
      where: { idempotencyKey: event.idempotencyKey },
      create: {
        userId: event.userId,
        amount: event.amount,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        idempotencyKey: event.idempotencyKey,
        reason: event.reason,
        createdByUserId: event.createdByUserId,
      },
      update: { amount: event.amount, reason: event.reason },
    });
  });
}

export function personaFromUserType(userType: UserType): CandidatePersona {
  return userType === UserType.PROFESSIONAL
    ? CandidatePersona.PROFESSIONAL
    : CandidatePersona.STUDENT;
}

export function educationIdForStudentProfile(userId: string): string {
  return `edu_sp_${userId}`;
}

export function experienceIdForStudentProfile(userId: string): string {
  return `exp_sp_${userId}`;
}

function hackathonVariant(
  metadata: Prisma.JsonValue | null,
): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const v = (metadata as { hackathonVariant?: unknown }).hackathonVariant;
  return typeof v === "string" ? v : undefined;
}

export function mapCertificateToCredential(cert: {
  id: string;
  certificateId: string;
  userId: string;
  type: CertificateType;
  status: CertificateStatus;
  recipientName: string;
  enrollmentId: string | null;
  issuedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  metadata: Prisma.JsonValue | null;
}): {
  id: string;
  credentialId: string;
  userId: string;
  type: CredentialType;
  sourceType: CredentialSourceType;
  sourceKey: string;
  status: CredentialStatus;
  title: string;
  recipientName: string;
  metadata: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  issuedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
} {
  let type: CredentialType = CredentialType.COMPLETION;
  if (cert.type === CertificateType.HACKATHON) {
    type = hackathonVariant(cert.metadata)
      ? CredentialType.PLACEMENT
      : CredentialType.PARTICIPATION;
  } else if (cert.type === CertificateType.WORKSHOP) {
    type = CredentialType.PARTICIPATION;
  }

  let sourceType: CredentialSourceType = CredentialSourceType.PROGRAM_ENROLLMENT;
  let sourceKey = cert.enrollmentId
    ? peIdForEnrollment(cert.enrollmentId)
    : cert.id;
  if (cert.type === CertificateType.HACKATHON) {
    const meta = cert.metadata;
    const teamId =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as { teamId?: unknown }).teamId
        : null;
    sourceType = CredentialSourceType.HACKATHON_TEAM;
    sourceKey = typeof teamId === "string" ? `${teamId}:${cert.id}` : cert.id;
  } else if (cert.type === CertificateType.WORKSHOP) {
    sourceType = CredentialSourceType.WORKSHOP_REGISTRATION;
    sourceKey = cert.id;
  } else if (cert.type === CertificateType.COHORT) {
    sourceType = CredentialSourceType.COHORT;
    sourceKey = cert.id;
  }

  return {
    id: `cred_${cert.id}`,
    credentialId: cert.certificateId,
    userId: cert.userId,
    type,
    sourceType,
    sourceKey,
    status:
      cert.status === CertificateStatus.REVOKED
        ? CredentialStatus.REVOKED
        : CredentialStatus.ISSUED,
    title: cert.type,
    recipientName: cert.recipientName,
    metadata:
      cert.metadata === null
        ? Prisma.JsonNull
        : (cert.metadata as Prisma.InputJsonValue),
    issuedAt: cert.issuedAt,
    revokedAt: cert.revokedAt,
    revokedReason: cert.revokedReason,
  };
}

/**
 * Upsert CandidateProfile (+ registration-owned education/experience) from the
 * legacy StudentProfile already written in this transaction. Does not touch
 * CandidateVisibility. Does not copy challenge domain.
 */
export async function dualWriteCandidateIdentity(
  tx: Tx,
  userId: string,
): Promise<void> {
  await runDualWrite(tx, "candidateIdentity", async () => {
    const sp = await tx.studentProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
        fullName: true,
        userType: true,
        college: true,
        collegeId: true,
        graduationYear: true,
        organization: true,
        role: true,
        yearsExperience: true,
        phone: true,
        phoneVerified: true,
        phoneVerifiedAt: true,
        linkedinUrl: true,
        githubUsername: true,
        resumeUrl: true,
        referralCode: true,
        isReadyForInterview: true,
        isCampusAmbassadorCandidate: true,
        ambassadorAppliedAt: true,
        ambassadorDismissedAt: true,
      },
    });
    if (!sp) {
      throw new Error(`Missing StudentProfile for ${userId}`);
    }

    const existing = await tx.candidateProfile.findUnique({
      where: { userId },
      select: { referralCode: true, phoneVerifiedAt: true },
    });

    const phoneVerifiedAt =
      sp.phoneVerifiedAt ??
      existing?.phoneVerifiedAt ??
      (sp.phoneVerified ? new Date() : null);
    const referralCode = existing?.referralCode ?? sp.referralCode;
    const persona = personaFromUserType(sp.userType);

    await tx.candidateProfile.upsert({
      where: { userId },
      create: {
        id: `cp_${userId}`,
        userId,
        fullName: sp.fullName,
        primaryPersona: persona,
        phone: sp.phone,
        phoneVerified: sp.phoneVerified,
        phoneVerifiedAt,
        linkedinUrl: sp.linkedinUrl,
        githubUsername: sp.githubUsername,
        resumeUrl: sp.resumeUrl,
        referralCode,
        isReadyForInterview: sp.isReadyForInterview,
        isCampusAmbassadorCandidate: sp.isCampusAmbassadorCandidate,
        ambassadorAppliedAt: sp.ambassadorAppliedAt,
        ambassadorDismissedAt: sp.ambassadorDismissedAt,
      },
      update: {
        fullName: sp.fullName,
        primaryPersona: persona,
        phone: sp.phone,
        phoneVerified: sp.phoneVerified,
        phoneVerifiedAt,
        linkedinUrl: sp.linkedinUrl,
        githubUsername: sp.githubUsername,
        resumeUrl: sp.resumeUrl,
        isReadyForInterview: sp.isReadyForInterview,
        isCampusAmbassadorCandidate: sp.isCampusAmbassadorCandidate,
        ambassadorAppliedAt: sp.ambassadorAppliedAt,
        ambassadorDismissedAt: sp.ambassadorDismissedAt,
      },
    });

    if (sp.college || sp.collegeId || sp.graduationYear != null) {
      await tx.candidateEducation.upsert({
        where: { id: educationIdForStudentProfile(userId) },
        create: {
          id: educationIdForStudentProfile(userId),
          userId,
          institutionName: sp.college?.trim() || "Not specified",
          collegeId: sp.collegeId,
          graduationYear: sp.graduationYear,
          sortOrder: 0,
        },
        update: {
          institutionName: sp.college?.trim() || "Not specified",
          collegeId: sp.collegeId,
          graduationYear: sp.graduationYear,
        },
      });
    }

    if (sp.organization || sp.role || sp.yearsExperience != null) {
      const years = sp.yearsExperience ?? 0;
      await tx.candidateExperience.upsert({
        where: { id: experienceIdForStudentProfile(userId) },
        create: {
          id: experienceIdForStudentProfile(userId),
          userId,
          companyName: sp.organization?.trim() || "Not specified",
          title: sp.role?.trim() || "Not specified",
          startedOn: new Date(
            Date.UTC(new Date().getUTCFullYear() - Math.max(years, 0), 0, 1),
          ),
          isCurrent: true,
          totalMonths: Math.max(0, years) * 12,
        },
        update: {
          companyName: sp.organization?.trim() || "Not specified",
          title: sp.role?.trim() || "Not specified",
          startedOn: new Date(
            Date.UTC(new Date().getUTCFullYear() - Math.max(years, 0), 0, 1),
          ),
          isCurrent: true,
          totalMonths: Math.max(0, years) * 12,
        },
      });
    }
  });
}

/**
 * Upsert Credential from a legacy Certificate already written in this
 * transaction. Public id is reused verbatim. Mapping matches Phase 2g.
 */
export async function dualWriteCredential(
  tx: Tx,
  certificateId: string,
): Promise<void> {
  await runDualWrite(tx, "credential", async () => {
    const cert = await tx.certificate.findUnique({
      where: { certificateId },
      select: {
        id: true,
        certificateId: true,
        userId: true,
        type: true,
        status: true,
        recipientName: true,
        enrollmentId: true,
        issuedAt: true,
        revokedAt: true,
        revokedReason: true,
        metadata: true,
      },
    });
    if (!cert) {
      throw new Error(`Missing Certificate ${certificateId}`);
    }
    const row = mapCertificateToCredential(cert);
    await tx.credential.upsert({
      where: { credentialId: row.credentialId },
      create: row,
      update: {
        status: row.status,
        recipientName: row.recipientName,
        metadata: row.metadata,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
      },
    });
  });
}
