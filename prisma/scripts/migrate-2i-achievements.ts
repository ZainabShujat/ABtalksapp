/**
 * 078 Phase 2i — CandidateAchievement + SkillEvidence + evidenceScore recompute.
 */
import { config } from "dotenv";
import {
  AchievementSourceType,
  EvidenceSourceType,
  PrismaClient,
} from "@prisma/client";
import { assertChildBranch, chunked, resolveSampleUserIds, runStep, whereUserId } from "./migrate-078-shared";

const prisma = new PrismaClient();

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2i-achievements", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const uw = whereUserId(sample);
    let achievements = 0;

    const completed = await ctx.prisma.programEnrollment.findMany({
      where: { status: "COMPLETED", ...uw },
      select: {
        id: true,
        userId: true,
        completedAt: true,
        enrolledAt: true,
        cohort: {
          select: {
            name: true,
            programVersion: { select: { program: { select: { title: true } } } },
          },
        },
      },
    });
    await chunked(completed, 100, async (chunk) => {
      for (const row of chunk) {
        await ctx.prisma.candidateAchievement.upsert({
          where: {
            sourceType_sourceId: {
              sourceType: AchievementSourceType.PROGRAM_ENROLLMENT,
              sourceId: row.id,
            },
          },
          create: {
            userId: row.userId,
            sourceType: AchievementSourceType.PROGRAM_ENROLLMENT,
            sourceId: row.id,
            title: row.cohort.programVersion.program.title,
            outcomeLabel: "Completed",
            occurredAt: row.completedAt ?? row.enrolledAt ?? new Date(),
            isPublic: true,
          },
          update: { title: row.cohort.programVersion.program.title },
        });
        achievements += 1;
      }
    });

    const creds = await ctx.prisma.credential.findMany({
      where: { status: "ISSUED", ...uw },
      select: {
        id: true,
        userId: true,
        title: true,
        issuedAt: true,
        type: true,
      },
    });
    await chunked(creds, 100, async (chunk) => {
      for (const c of chunk) {
        await ctx.prisma.candidateAchievement.upsert({
          where: {
            sourceType_sourceId: {
              sourceType: AchievementSourceType.CREDENTIAL,
              sourceId: c.id,
            },
          },
          create: {
            userId: c.userId,
            sourceType: AchievementSourceType.CREDENTIAL,
            sourceId: c.id,
            title: c.title,
            outcomeLabel: c.type,
            occurredAt: c.issuedAt,
            isPublic: true,
          },
          update: { title: c.title },
        });
        achievements += 1;
      }
    });

    const participants = await ctx.prisma.hackathonParticipant.findMany({
      where: uw,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        team: { select: { teamName: true, submission: { select: { id: true } } } },
      },
    });
    for (const p of participants) {
      if (!p.team.submission) continue;
      await ctx.prisma.candidateAchievement.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: AchievementSourceType.HACKATHON_TEAM,
            sourceId: p.id,
          },
        },
        create: {
          userId: p.userId,
          sourceType: AchievementSourceType.HACKATHON_TEAM,
          sourceId: p.id,
          title: "ViCoDathon 2026",
          outcomeLabel: p.team.teamName ?? "Participant",
          occurredAt: p.createdAt,
          isPublic: true,
        },
        update: { title: "ViCoDathon 2026" },
      });
      achievements += 1;
    }

    const interviews = await ctx.prisma.programInterview.findMany({
      where: {
        overallScore: { not: null },
        ...(sample ? { member: { userId: { in: sample } } } : {}),
      },
      select: {
        id: true,
        member: { select: { userId: true } },
        overallScore: true,
        commScore: true,
        techScore: true,
        problemScore: true,
        evaluatedAt: true,
        endedAt: true,
      },
    });
    for (const iv of interviews) {
      const report = await ctx.prisma.assessmentReport.upsert({
        where: { id: `ar_iv_${iv.id}` },
        create: {
          id: `ar_iv_${iv.id}`,
          candidateUserId: iv.member.userId,
          title: "Program interview",
          status: "PUBLISHED",
          assessedAt: iv.evaluatedAt ?? iv.endedAt,
        },
        update: {},
      });
      const dims: Array<[string, number | null]> = [
        ["communication", iv.commScore],
        ["technical", iv.techScore],
        ["problem_solving", iv.problemScore],
        ["overall", iv.overallScore],
      ];
      for (const [dim, score] of dims) {
        if (score == null) continue;
        await ctx.prisma.assessmentScore.upsert({
          where: { reportId_dimension: { reportId: report.id, dimension: dim } },
          create: { reportId: report.id, dimension: dim, score, maxScore: 100 },
          update: { score },
        });
      }
    }

    let evidence = 0;
    const scores = await ctx.prisma.assessmentScore.findMany({
      where: { skillId: { not: null } },
      select: {
        id: true,
        skillId: true,
        score: true,
        maxScore: true,
        createdAt: true,
        report: { select: { candidateUserId: true, title: true } },
      },
    });
    for (const s of scores) {
      if (!s.skillId) continue;
      const cs = await ctx.prisma.candidateSkill.upsert({
        where: {
          userId_skillId: { userId: s.report.candidateUserId, skillId: s.skillId },
        },
        create: { userId: s.report.candidateUserId, skillId: s.skillId },
        update: {},
      });
      await ctx.prisma.skillEvidence.upsert({
        where: {
          candidateSkillId_sourceType_sourceId: {
            candidateSkillId: cs.id,
            sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
            sourceId: s.id,
          },
        },
        create: {
          candidateSkillId: cs.id,
          sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
          sourceId: s.id,
          sourceLabel: s.report.title,
          score: s.score,
          maxScore: s.maxScore,
          occurredAt: s.createdAt,
        },
        update: { score: s.score },
      });
      evidence += 1;
    }

    const evals = await ctx.prisma.activityEvaluation.findMany({
      where: {
        passed: true,
        isAuthoritative: true,
        ...(sample ? { attempt: { enrollment: { userId: { in: sample } } } } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        score: true,
        maxScore: true,
        attempt: {
          select: {
            enrollment: { select: { userId: true } },
            activity: {
              select: { skills: { select: { skillId: true, weight: true } }, title: true },
            },
          },
        },
      },
    });
    for (const ev of evals) {
      for (const link of ev.attempt.activity.skills) {
        const userId = ev.attempt.enrollment.userId;
        const cs = await ctx.prisma.candidateSkill.upsert({
          where: { userId_skillId: { userId, skillId: link.skillId } },
          create: { userId, skillId: link.skillId },
          update: {},
        });
        await ctx.prisma.skillEvidence.upsert({
          where: {
            candidateSkillId_sourceType_sourceId: {
              candidateSkillId: cs.id,
              sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
              sourceId: ev.id,
            },
          },
          create: {
            candidateSkillId: cs.id,
            sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
            sourceId: ev.id,
            sourceLabel: ev.attempt.activity.title,
            score: ev.score,
            maxScore: ev.maxScore,
            weight: link.weight,
            occurredAt: ev.createdAt,
          },
          update: { score: ev.score },
        });
        evidence += 1;
      }
    }

    const allCs = await ctx.prisma.candidateSkill.findMany({
      where: uw,
      select: { id: true, evidence: { select: { score: true, maxScore: true, weight: true } } },
    });
    let recomputed = 0;
    for (const cs of allCs) {
      const count = cs.evidence.length;
      const raw = cs.evidence.reduce((acc, e) => {
        const ratio = e.maxScore && e.maxScore > 0 && e.score != null ? e.score / e.maxScore : 1;
        return acc + ratio * e.weight * 20;
      }, 0);
      await ctx.prisma.candidateSkill.update({
        where: { id: cs.id },
        data: {
          evidenceCount: count,
          verified: count > 0,
          evidenceScore: Math.min(100, Math.round(raw)),
          lastEvidenceAt: count > 0 ? new Date() : null,
        },
      });
      recomputed += 1;
    }

    return { achievements, evidence, skillsRecomputed: recomputed };
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
