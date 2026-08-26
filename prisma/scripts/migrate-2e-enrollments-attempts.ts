/**
 * 078 Phase 2e — ProgramEnrollment, ActivityAttempt, ActivityEvaluation,
 * EnrollmentDayActivity, EnrollmentProgress.
 */
import { config } from "dotenv";
import {
  AttemptLateness,
  AttemptStatus,
  EnrollmentStatus,
  EnrollmentStatusV2,
  EvaluatorType,
  DayActivitySource,
  Prisma,
  PrismaClient,
  ProgramMemberStatus,
} from "@prisma/client";
import {
  activityIdForDailyTask,
  activityIdForEntry,
  activityIdForInterview,
  activityIdForProgramDay,
  activityIdForQuiz,
  assertChildBranch,
  attemptIdForEntry,
  attemptIdForInterview,
  attemptIdForMission,
  attemptIdForProject,
  attemptIdForQuizAttempt,
  attemptIdForSubmission,
  chunked,
  cohortSlugForDomain,
  peIdForEnrollment,
  peIdForMember,
  resolveSampleUserIds,
  runStep,
  SAMPLE_DAY_CAP,
  whereUserId,
} from "./migrate-078-shared";
import { bulkUpsertBatched } from "./migrate-078-bulk";

const prisma = new PrismaClient();

function mapEnrollmentStatus(s: EnrollmentStatus): EnrollmentStatusV2 {
  if (s === EnrollmentStatus.COMPLETED) return EnrollmentStatusV2.COMPLETED;
  if (s === EnrollmentStatus.ABANDONED) return EnrollmentStatusV2.DROPPED;
  return EnrollmentStatusV2.ACTIVE;
}

function mapMemberStatus(s: ProgramMemberStatus): EnrollmentStatusV2 {
  switch (s) {
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

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2e-enrollments-attempts", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const uw = whereUserId(sample);
    const cohorts = await ctx.prisma.cohort.findMany({
      select: { id: true, slug: true, programVersionId: true },
    });
    const cohortBySlug = new Map(cohorts.map((c) => [c.slug, c]));

    const enrollments = await ctx.prisma.enrollment.findMany({ where: uw });
    const peRows = enrollments.map((e) => {
      const cohort = cohortBySlug.get(cohortSlugForDomain(e.domain));
      if (!cohort) throw new Error(`Missing cohort ${cohortSlugForDomain(e.domain)}`);
      return {
        id: peIdForEnrollment(e.id),
        userId: e.userId,
        cohortId: cohort.id,
        status: mapEnrollmentStatus(e.status),
        startedAt: e.startedAt,
        enrolledAt: e.startedAt,
        completedAt: e.completedAt,
        droppedAt: e.status === EnrollmentStatus.ABANDONED ? e.updatedAt : null,
      };
    });
    const now = new Date();
    await bulkUpsertBatched(ctx.prisma, {
      label: "2e-pe-enrollments",
      table: "ProgramEnrollment",
      cursorField: "id",
      rows: peRows.map((row) => ({ ...row, updatedAt: now })),
      conflict: ["id"],
      update: [
        "status",
        "startedAt",
        "enrolledAt",
        "completedAt",
        "droppedAt",
        "updatedAt",
      ],
      casts: { status: '"EnrollmentStatusV2"' },
    });
    let peCreated = peRows.length;

    const members = await ctx.prisma.programMember.findMany({ where: uw });
    const memberPe = members.map((m) => {
      const cohort = cohortBySlug.get(`legacy-program-${m.cohortId}`);
      if (!cohort) throw new Error(`Missing program cohort for ${m.cohortId}`);
      return {
        id: peIdForMember(m.id),
        userId: m.userId,
        cohortId: cohort.id,
        status: mapMemberStatus(m.status),
        startedAt: m.enrolledAt ?? m.createdAt,
        enrolledAt: m.enrolledAt,
        completedAt: m.completedAt,
        droppedAt: m.status === ProgramMemberStatus.DROPPED ? m.updatedAt : null,
        githubRepoUrl: m.githubRepoUrl,
        unlockFloorDay: m.highestUnlockedDay,
        skipTokensUsed: m.skipTokensUsed,
      };
    });
    await bulkUpsertBatched(ctx.prisma, {
      label: "2e-pe-members",
      table: "ProgramEnrollment",
      cursorField: "id",
      rows: memberPe.map((row) => ({ ...row, updatedAt: now })),
      conflict: ["id"],
      update: [
        "status",
        "startedAt",
        "enrolledAt",
        "completedAt",
        "droppedAt",
        "githubRepoUrl",
        "unlockFloorDay",
        "skipTokensUsed",
        "updatedAt",
      ],
      casts: { status: '"EnrollmentStatusV2"' },
    });
    peCreated += memberPe.length;

    const submissions = await ctx.prisma.submission.findMany({
      where: sample ? { ...uw, dayNumber: { lte: SAMPLE_DAY_CAP } } : uw,
      include: { dailyTask: { select: { id: true } }, enrollment: { select: { id: true } } },
    });
    const subAttempts = submissions.map((s) => ({
      id: attemptIdForSubmission(s.id),
      enrollmentId: peIdForEnrollment(s.enrollmentId),
      activityId: activityIdForDailyTask(s.dailyTaskId),
      attemptNumber: 1,
      status: AttemptStatus.EVALUATED,
      lateness:
        s.status === "LATE" ? AttemptLateness.LATE : AttemptLateness.ON_TIME,
      payload: {
        githubUrl: s.githubUrl,
        linkedinUrl: s.linkedinUrl,
        legacySubmissionId: s.id,
      } as Prisma.InputJsonValue,
      passed: true,
      pointsAwarded: 10,
      startedAt: s.submittedAt,
      submittedAt: s.submittedAt,
    }));
    let attempts = subAttempts.length;
    await bulkUpsertBatched(ctx.prisma, {
      label: "2e-attempts-submissions",
      table: "ActivityAttempt",
      cursorField: "id",
      rows: subAttempts.map((row) => ({ ...row, updatedAt: now })),
      conflict: ["id"],
      update: [
        "payload",
        "passed",
        "lateness",
        "pointsAwarded",
        "submittedAt",
        "updatedAt",
      ],
      casts: {
        status: '"AttemptStatus"',
        lateness: '"AttemptLateness"',
        payload: "jsonb",
      },
    });
    const subEvals = submissions.map((s) => ({
      id: `ev_sub_${s.id}`,
      attemptId: attemptIdForSubmission(s.id),
      evaluatorType: EvaluatorType.AUTO,
      passed: true,
      score: 100,
      maxScore: 100,
      isAuthoritative: true,
      createdAt: s.submittedAt,
    }));
    let evals = 0;
    await chunked(subEvals, 200, async (chunk) => {
      const r = await ctx.prisma.activityEvaluation.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      evals += r.count;
    });

    const quizzes = await ctx.prisma.quiz.findMany({
      select: { id: true, challengeId: true },
    });
    const quizChallenge = new Map(quizzes.map((q) => [q.id, q.challengeId]));
    const enrollByUserChallenge = new Map(
      enrollments.map((e) => [`${e.userId}|${e.challengeId}`, e.id]),
    );
    const quizAttempts = await ctx.prisma.quizAttempt.findMany({
      where: sample ? { ...uw, quiz: { weekNumber: { lte: 1 } } } : uw,
    });
    const qaRows = [];
    const qaEvals = [];
    for (const qa of quizAttempts) {
      const challengeId = quizChallenge.get(qa.quizId);
      if (!challengeId) continue;
      const enrId = enrollByUserChallenge.get(`${qa.userId}|${challengeId}`);
      if (!enrId) continue;
      qaRows.push({
        id: attemptIdForQuizAttempt(qa.id),
        enrollmentId: peIdForEnrollment(enrId),
        activityId: activityIdForQuiz(qa.quizId),
        attemptNumber: 1,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.NOT_APPLICABLE,
        payload: { answers: qa.answers, legacyQuizAttemptId: qa.id } as Prisma.InputJsonValue,
        passed: qa.score >= 60,
        score: qa.score,
        pointsAwarded: qa.score,
        startedAt: qa.attemptedAt,
        submittedAt: qa.attemptedAt,
      });
      qaEvals.push({
        id: `ev_qa_${qa.id}`,
        attemptId: attemptIdForQuizAttempt(qa.id),
        evaluatorType: EvaluatorType.AUTO,
        passed: qa.score >= 60,
        score: qa.score,
        maxScore: 100,
        isAuthoritative: true,
        createdAt: qa.attemptedAt,
      });
    }
    await chunked(qaRows, 200, async (chunk) => {
      const r = await ctx.prisma.activityAttempt.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      attempts += r.count;
    });
    await chunked(qaEvals, 200, async (chunk) => {
      const r = await ctx.prisma.activityEvaluation.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      evals += r.count;
    });

    const days = await ctx.prisma.programDay.findMany({
      select: { id: true, dayNumber: true, isProjectDay: true, module: { select: { number: true } } },
    });
    const dayIdByNumber = new Map(days.map((d) => [d.dayNumber, d.id]));
    const projectDayByModule = new Map<number, string>();
    for (const d of days) {
      if (d.isProjectDay) projectDayByModule.set(d.module.number, d.id);
    }

    const memberIds = members.map((m) => m.id);
    const memberWhere = sample
      ? { memberId: { in: memberIds.length > 0 ? memberIds : ["__none__"] } }
      : undefined;

    const missions = await ctx.prisma.programMissionSubmission.findMany({
      where: sample
        ? { ...memberWhere, dayNumber: { lte: SAMPLE_DAY_CAP } }
        : memberWhere,
    });
    const msAttempts = [];
    const msEvals = [];
    for (const m of missions) {
      const dayId = dayIdByNumber.get(m.dayNumber);
      if (!dayId) continue;
      msAttempts.push({
        id: attemptIdForMission(m.id),
        enrollmentId: peIdForMember(m.memberId),
        activityId: activityIdForProgramDay(dayId),
        attemptNumber: m.attemptNumber,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.NOT_APPLICABLE,
        payload: {
          ...(typeof m.payload === "object" && m.payload ? m.payload : {}),
          legacyMissionSubmissionId: m.id,
        } as Prisma.InputJsonValue,
        passed: m.passed,
        pointsAwarded: m.pointsAwarded,
        startedAt: m.createdAt,
        submittedAt: m.createdAt,
      });
      msEvals.push({
        id: `ev_ms_${m.id}`,
        attemptId: attemptIdForMission(m.id),
        evaluatorType: EvaluatorType.AUTO,
        passed: m.passed,
        score: m.passed ? 100 : 0,
        maxScore: 100,
        detailJson: m.verdict as Prisma.InputJsonValue,
        isAuthoritative: true,
        createdAt: m.createdAt,
      });
      if (m.aiFeedback) {
        msEvals.push({
          id: `ev_ms_ai_${m.id}`,
          attemptId: attemptIdForMission(m.id),
          evaluatorType: EvaluatorType.AI,
          passed: m.passed,
          feedback: m.aiFeedback,
          isAuthoritative: false,
          createdAt: m.createdAt,
        });
      }
    }
    await bulkUpsertBatched(ctx.prisma, {
      label: "2e-attempts-missions",
      table: "ActivityAttempt",
      cursorField: "id",
      rows: msAttempts.map((row) => ({ ...row, updatedAt: now })),
      conflict: ["id"],
      update: [
        "payload",
        "passed",
        "pointsAwarded",
        "submittedAt",
        "updatedAt",
      ],
      casts: {
        status: '"AttemptStatus"',
        lateness: '"AttemptLateness"',
        payload: "jsonb",
      },
    });
    attempts += msAttempts.length;
    await chunked(msEvals, 200, async (chunk) => {
      const r = await ctx.prisma.activityEvaluation.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      evals += r.count;
    });

    const projects = await ctx.prisma.programProject.findMany({ where: memberWhere });
    const projAttempts = [];
    const projEvals = [];
    for (const p of projects) {
      const dayId = projectDayByModule.get(p.moduleNumber);
      if (!dayId) continue;
      const hasHuman = p.adminScore != null;
      projAttempts.push({
        id: attemptIdForProject(p.id),
        enrollmentId: peIdForMember(p.memberId),
        activityId: activityIdForProgramDay(dayId),
        attemptNumber: 1,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.NOT_APPLICABLE,
        payload: {
          repoUrl: p.repoUrl,
          writeup: p.writeup,
          legacyProjectId: p.id,
        } as Prisma.InputJsonValue,
        passed: (p.adminScore ?? p.aiScore ?? 0) >= 50,
        score: p.adminScore ?? p.aiScore,
        pointsAwarded: p.adminScore ?? p.aiScore ?? 0,
        startedAt: p.submittedAt,
        submittedAt: p.submittedAt,
      });
      if (p.aiScore != null) {
        projEvals.push({
          id: `ev_proj_ai_${p.id}`,
          attemptId: attemptIdForProject(p.id),
          evaluatorType: EvaluatorType.AI,
          passed: p.aiScore >= 50,
          score: p.aiScore,
          maxScore: 100,
          feedback: p.aiFeedback,
          detailJson: (p.aiRubricJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          isAuthoritative: !hasHuman,
          createdAt: p.gradedAt ?? p.submittedAt,
        });
      }
      if (hasHuman) {
        projEvals.push({
          id: `ev_proj_hu_${p.id}`,
          attemptId: attemptIdForProject(p.id),
          evaluatorType: EvaluatorType.HUMAN,
          passed: (p.adminScore ?? 0) >= 50,
          score: p.adminScore,
          maxScore: 100,
          isAuthoritative: true,
          createdAt: p.gradedAt ?? p.submittedAt,
        });
      }
    }
    await chunked(projAttempts, 100, async (chunk) => {
      const r = await ctx.prisma.activityAttempt.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      attempts += r.count;
    });
    await chunked(projEvals, 100, async (chunk) => {
      const r = await ctx.prisma.activityEvaluation.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      evals += r.count;
    });

    const aiProgram = await ctx.prisma.learningProgram.findUnique({
      where: { slug: "ai-cohort-program" },
      select: { versions: { where: { versionNumber: 1 }, select: { id: true } } },
    });
    const versionId = aiProgram?.versions[0]?.id;
    const interviews = await ctx.prisma.programInterview.findMany({ where: memberWhere });
    if (versionId) {
      const ivAct = activityIdForInterview(versionId);
      const ivAttempts = [];
      const ivEvals = [];
      for (const iv of interviews) {
        if (iv.status === "NOT_STARTED") continue;
        ivAttempts.push({
          id: attemptIdForInterview(iv.id),
          enrollmentId: peIdForMember(iv.memberId),
          activityId: ivAct,
          attemptNumber: Math.max(1, iv.resetCount + 1),
          status:
            iv.status === "COMPLETED" ? AttemptStatus.EVALUATED : AttemptStatus.IN_PROGRESS,
          lateness: AttemptLateness.NOT_APPLICABLE,
          payload: {
            transcript: iv.transcript,
            legacyInterviewId: iv.id,
          } as Prisma.InputJsonValue,
          passed: iv.status === "COMPLETED",
          score: iv.overallScore,
          startedAt: iv.startedAt ?? iv.endedAt ?? new Date(),
          submittedAt: iv.endedAt,
        });
        if (iv.overallScore != null) {
          ivEvals.push({
            id: `ev_iv_${iv.id}`,
            attemptId: attemptIdForInterview(iv.id),
            evaluatorType: EvaluatorType.AI,
            passed: iv.status === "COMPLETED",
            score: iv.overallScore,
            maxScore: 100,
            feedback: iv.summary,
            isAuthoritative: true,
            createdAt: iv.evaluatedAt ?? iv.endedAt ?? new Date(),
          });
        }
      }
      await chunked(ivAttempts, 100, async (chunk) => {
        const r = await ctx.prisma.activityAttempt.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        attempts += r.count;
      });
      await chunked(ivEvals, 100, async (chunk) => {
        const r = await ctx.prisma.activityEvaluation.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        evals += r.count;
      });

      const entryAttempts = await ctx.prisma.programEntryAttempt.findMany({ where: uw });
      const entryAct = activityIdForEntry(versionId);
      const entryRows = [];
      const entryEvals = [];
      for (const ea of entryAttempts) {
        const member = members.find(
          (m) => m.userId === ea.userId && m.cohortId === ea.cohortId,
        );
        if (!member) continue;
        entryRows.push({
          id: attemptIdForEntry(ea.id),
          enrollmentId: peIdForMember(member.id),
          activityId: entryAct,
          attemptNumber: ea.attemptNumber,
          status: ea.submittedAt ? AttemptStatus.EVALUATED : AttemptStatus.IN_PROGRESS,
          lateness: AttemptLateness.NOT_APPLICABLE,
          payload: {
            answers: ea.answers,
            questionIds: ea.questionIds,
            legacyEntryAttemptId: ea.id,
          } as Prisma.InputJsonValue,
          passed: ea.passed,
          score: ea.aptitudeScore + ea.technicalScore,
          startedAt: ea.startedAt,
          submittedAt: ea.submittedAt,
        });
        if (ea.submittedAt) {
          entryEvals.push({
            id: `ev_entry_${ea.id}`,
            attemptId: attemptIdForEntry(ea.id),
            evaluatorType: EvaluatorType.AUTO,
            passed: ea.passed,
            score: ea.aptitudeScore + ea.technicalScore,
            isAuthoritative: true,
            createdAt: ea.submittedAt,
          });
        }
      }
      await chunked(entryRows, 100, async (chunk) => {
        const r = await ctx.prisma.activityAttempt.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        attempts += r.count;
      });
      await chunked(entryEvals, 100, async (chunk) => {
        const r = await ctx.prisma.activityEvaluation.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        evals += r.count;
      });
    }

    const commitDays = await ctx.prisma.programCommitDay.findMany({ where: memberWhere });
    let daysCopied = 0;
    await chunked(
      commitDays.map((d) => ({
        id: `eda_${d.id}`,
        enrollmentId: peIdForMember(d.memberId),
        activityDate: d.date,
        source: DayActivitySource.GITHUB_COMMIT,
        activityCount: d.commitCount,
        pointsEarned: d.commitCount > 0 ? 5 : 0,
      })),
      200,
      async (chunk) => {
        const r = await ctx.prisma.enrollmentDayActivity.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        daysCopied += r.count;
      },
    );

    const allPe = await ctx.prisma.programEnrollment.findMany({
      where: uw,
      select: {
        id: true,
        cohortId: true,
        status: true,
        cohort: { select: { programVersionId: true } },
      },
    });
    const requiredByVersion = new Map<string, { total: number; ids: string[] }>();
    for (const c of cohorts) {
      if (requiredByVersion.has(c.programVersionId)) continue;
      const acts = await ctx.prisma.activity.findMany({
        where: { isRequired: true, module: { programVersionId: c.programVersionId } },
        select: { id: true, dayNumber: true, module: { select: { position: true } } },
        orderBy: [{ dayNumber: "asc" }, { position: "asc" }],
      });
      requiredByVersion.set(c.programVersionId, {
        total: acts.length,
        ids: acts.map((a) => a.id),
      });
    }

    const passed = await ctx.prisma.activityAttempt.findMany({
      where: {
        passed: true,
        enrollmentId: { in: allPe.length > 0 ? allPe.map((p) => p.id) : ["__none__"] },
      },
      select: {
        enrollmentId: true,
        activityId: true,
        pointsAwarded: true,
        submittedAt: true,
      },
    });
    const passedByEnr = new Map<
      string,
      { activities: Set<string>; points: number; last: Date | null }
    >();
    for (const p of passed) {
      const cur = passedByEnr.get(p.enrollmentId) ?? {
        activities: new Set<string>(),
        points: 0,
        last: null,
      };
      cur.activities.add(p.activityId);
      cur.points += p.pointsAwarded;
      if (p.submittedAt && (!cur.last || p.submittedAt > cur.last)) cur.last = p.submittedAt;
      passedByEnr.set(p.enrollmentId, cur);
    }

    const streakByEnr = new Map(
      enrollments.map((e) => [
        peIdForEnrollment(e.id),
        { current: e.currentStreak, longest: e.longestStreak },
      ]),
    );
    const scoreByMember = new Map(members.map((m) => [peIdForMember(m.id), m.totalScore]));

    const progressRows = allPe.map((pe) => {
      const req = requiredByVersion.get(pe.cohort.programVersionId) ?? {
        total: 0,
        ids: [],
      };
      const got = passedByEnr.get(pe.id);
      const completed = req.ids.filter((id) => got?.activities.has(id)).length;
      const total = req.total;
      const percent = total === 0 ? 0 : Math.min(10000, Math.floor((completed / total) * 10000));
      const streak = streakByEnr.get(pe.id);
      const memberScore = scoreByMember.get(pe.id);
      const nextId = req.ids.find((id) => !got?.activities.has(id)) ?? null;
      const currentId =
        [...(got?.activities ?? [])].reverse()[0] ?? req.ids[0] ?? null;
      return {
        enrollmentId: pe.id,
        cohortId: pe.cohortId,
        completedActivities: completed,
        totalActivities: total,
        percentCompleteBp: percent,
        pointsEarned: memberScore ?? got?.points ?? 0,
        pointsPossible: total * 10,
        currentStreak: streak?.current ?? 0,
        longestStreak: streak?.longest ?? 0,
        lastActivityAt: got?.last ?? null,
        currentActivityId: currentId,
        nextActivityId: nextId,
        recomputedAt: new Date(),
      };
    });

    const progress = progressRows.length;
    await bulkUpsertBatched(ctx.prisma, {
      label: "2e-progress",
      table: "EnrollmentProgress",
      cursorField: "enrollmentId",
      rows: progressRows.map((row) => ({
        id: `ep_${row.enrollmentId}`,
        ...row,
        updatedAt: now,
      })),
      conflict: ["enrollmentId"],
      update: [
        "cohortId",
        "completedActivities",
        "totalActivities",
        "percentCompleteBp",
        "pointsEarned",
        "pointsPossible",
        "currentStreak",
        "longestStreak",
        "lastActivityAt",
        "currentActivityId",
        "nextActivityId",
        "recomputedAt",
        "updatedAt",
      ],
    });

    return {
      programEnrollments: peCreated,
      attempts,
      evaluations: evals,
      commitDays: daysCopied,
      progress,
    };
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
