/**
 * 078 Phase 2d — LearningProgram / ProgramVersion / Cohort / Module / Activity / configs.
 */
import { config } from "dotenv";
import {
  ActivityType,
  ActivityUnlockRule,
  CohortStartMode,
  CohortStatus,
  Prisma,
  PrismaClient,
  ProgramFormat,
  ProgramMissionType,
  ProgramVersionStatus,
} from "@prisma/client";
import {
  CATEGORY_BY_DOMAIN,
  PROGRAM_SLUG_BY_DOMAIN,
  activityIdForConceptQuiz,
  activityIdForDailyTask,
  activityIdForEntry,
  activityIdForExercise,
  activityIdForInterview,
  activityIdForProgramDay,
  activityIdForQuiz,
  activityIdForVideo,
  assertChildBranch,
  cohortSlugForDomain,
  resolveSampleUserIds,
  runStep,
  SAMPLE_DAY_CAP,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

function missionActivityType(
  missionType: ProgramMissionType,
  isProjectDay: boolean,
): ActivityType {
  if (isProjectDay) return ActivityType.PROJECT;
  switch (missionType) {
    case ProgramMissionType.CODE_SPRINT:
    case ProgramMissionType.DATA_ROOM:
      return ActivityType.CODING;
    case ProgramMissionType.SHIP_IT:
      return ActivityType.EXTERNAL_SUBMISSION;
    case ProgramMissionType.PROMPT_FORGE:
      return ActivityType.ASSIGNMENT;
    case ProgramMissionType.BOSS_BUILD:
      return ActivityType.PROJECT;
    default:
      return ActivityType.ASSIGNMENT;
  }
}

function mapCohortStatus(status: string): CohortStatus {
  switch (status) {
    case "DRAFT":
      return CohortStatus.DRAFT;
    case "ENROLLING":
      return CohortStatus.ENROLLING;
    case "ACTIVE":
      return CohortStatus.ACTIVE;
    case "COMPLETED":
      return CohortStatus.COMPLETED;
    case "ARCHIVED":
      return CohortStatus.ARCHIVED;
    default:
      return CohortStatus.DRAFT;
  }
}

async function migrate2d() {
  return runStep(prisma, "2d-learning-content", async (ctx) => {
    const categories = await ctx.prisma.programCategory.findMany({
      select: { id: true, slug: true },
    });
    const catBySlug = new Map(categories.map((c) => [c.slug, c.id]));

    const sample = await resolveSampleUserIds(ctx.prisma);
    const neededTaskIds = new Set<string>();
    const neededQuizIds = new Set<string>();
    const neededProgramDays = new Set<number>();
    const neededProjectModules = new Set<number>();
    if (sample) {
      const [subs, qas, missions, projects] = await Promise.all([
        ctx.prisma.submission.findMany({
          where: { userId: { in: sample } },
          select: { dailyTaskId: true },
        }),
        ctx.prisma.quizAttempt.findMany({
          where: { userId: { in: sample } },
          select: { quizId: true },
        }),
        ctx.prisma.programMissionSubmission.findMany({
          where: { member: { userId: { in: sample } } },
          select: { dayNumber: true },
        }),
        ctx.prisma.programProject.findMany({
          where: { member: { userId: { in: sample } } },
          select: { moduleNumber: true },
        }),
      ]);
      for (const s of subs) neededTaskIds.add(s.dailyTaskId);
      for (const q of qas) neededQuizIds.add(q.quizId);
      for (const m of missions) neededProgramDays.add(m.dayNumber);
      for (const p of projects) neededProjectModules.add(p.moduleNumber);
      console.log(
        `2d sample slice: tasks=${neededTaskIds.size} quizzes=${neededQuizIds.size} programDays=${neededProgramDays.size}`,
      );
    }

    const challenges = await ctx.prisma.challenge.findMany({
      include: { dailyTasks: true, quizzes: { include: { quizQuestions: true } } },
    });

    let programs = 0;
    let versions = 0;
    let cohorts = 0;
    let modules = 0;
    let activities = 0;

    for (const ch of challenges) {
      const catSlug = CATEGORY_BY_DOMAIN[ch.domain]!;
      const categoryId = catBySlug.get(catSlug);
      if (!categoryId) throw new Error(`Missing ProgramCategory ${catSlug}`);
      const slug = PROGRAM_SLUG_BY_DOMAIN[ch.domain]!;
      const program = await ctx.prisma.learningProgram.upsert({
        where: { slug },
        create: {
          slug,
          title: ch.title,
          description: ch.description,
          categoryId,
          format: ProgramFormat.CHALLENGE,
          isPublished: ch.isActive,
          sortOrder: ["SE", "DS", "AI", "CLAUDE"].indexOf(ch.domain),
        },
        update: {
          title: ch.title,
          description: ch.description,
          isPublished: ch.isActive,
        },
      });
      programs += 1;

      const version = await ctx.prisma.programVersion.upsert({
        where: {
          programId_versionNumber: { programId: program.id, versionNumber: 1 },
        },
        create: {
          programId: program.id,
          versionNumber: 1,
          status: ProgramVersionStatus.PUBLISHED,
          plannedDurationDays: ch.totalDays,
          publishedAt: ch.createdAt,
        },
        update: {
          plannedDurationDays: ch.totalDays,
          status: ProgramVersionStatus.PUBLISHED,
        },
      });
      versions += 1;

      const cslug = cohortSlugForDomain(ch.domain);
      await ctx.prisma.cohort.upsert({
        where: { slug: cslug },
        create: {
          programVersionId: version.id,
          slug: cslug,
          name: ch.title,
          startMode: CohortStartMode.ROLLING,
          startsAt: ch.startsAt,
          timezone: "Asia/Kolkata",
          status: ch.isActive ? CohortStatus.ACTIVE : CohortStatus.ARCHIVED,
        },
        update: {
          programVersionId: version.id,
          name: ch.title,
          startsAt: ch.startsAt,
          status: ch.isActive ? CohortStatus.ACTIVE : CohortStatus.ARCHIVED,
        },
      });
      cohorts += 1;

      const decadeModules = new Map<number, string>();
      const maxDay = ch.dailyTasks.reduce((m, t) => Math.max(m, t.dayNumber), 0);
      const decadeCount = Math.max(1, Math.ceil((maxDay || 60) / 10));
      for (let d = 0; d < decadeCount; d++) {
        const start = d * 10 + 1;
        const end = (d + 1) * 10;
        const mod = await ctx.prisma.module.upsert({
          where: {
            programVersionId_position: {
              programVersionId: version.id,
              position: d + 1,
            },
          },
          create: {
            programVersionId: version.id,
            position: d + 1,
            title: `Days ${start}–${end}`,
            startDay: start,
            endDay: end,
          },
          update: { title: `Days ${start}–${end}`, startDay: start, endDay: end },
        });
        decadeModules.set(d, mod.id);
        modules += 1;
      }

      const quizMod = await ctx.prisma.module.upsert({
        where: {
          programVersionId_position: {
            programVersionId: version.id,
            position: 100,
          },
        },
        create: {
          programVersionId: version.id,
          position: 100,
          title: "Quizzes",
        },
        update: { title: "Quizzes" },
      });
      modules += 1;

      const tasks = sample
        ? ch.dailyTasks.filter((t) => t.dayNumber <= SAMPLE_DAY_CAP)
        : ch.dailyTasks;
      console.log(`  ${ch.domain}: ${tasks.length}/${ch.dailyTasks.length} tasks`);
      for (const task of tasks) {
        const decade = Math.floor((task.dayNumber - 1) / 10);
        const moduleId = decadeModules.get(decade) ?? [...decadeModules.values()][0]!;
        const position = ((task.dayNumber - 1) % 10) + 1;
        const actId = activityIdForDailyTask(task.id);
        const dayContent = task.dayContent;
        const contentJson =
          dayContent != null && typeof dayContent === "object"
            ? (dayContent as Prisma.InputJsonValue)
            : Prisma.JsonNull;
        const bodyMarkdown =
          typeof dayContent === "string" ? dayContent : task.problemStatement;

        await ctx.prisma.activity.upsert({
          where: { id: actId },
          create: {
            id: actId,
            moduleId,
            position,
            type: ActivityType.EXTERNAL_SUBMISSION,
            title: task.title,
            dayNumber: task.dayNumber,
            points: 10,
            isRequired: true,
            unlockRule: ActivityUnlockRule.SCHEDULED,
            maxAttempts: 1,
            estimatedMinutes: task.estimatedMinutes,
            difficulty: task.difficulty,
            tags: task.tags,
          },
          update: {
            moduleId,
            position,
            title: task.title,
            dayNumber: task.dayNumber,
            estimatedMinutes: task.estimatedMinutes,
            difficulty: task.difficulty,
            tags: task.tags,
          },
        });
        await ctx.prisma.contentActivityConfig.upsert({
          where: { activityId: actId },
          create: {
            activityId: actId,
            bodyMarkdown,
            contentJson,
            resources: task.resources,
            objectives: task.learningObjectives,
          },
          update: {
            bodyMarkdown,
            contentJson,
            resources: task.resources,
            objectives: task.learningObjectives,
          },
        });
        await ctx.prisma.externalSubmissionConfig.upsert({
          where: { activityId: actId },
          create: {
            activityId: actId,
            requiresGithubUrl: true,
            requiresLinkedinUrl: true,
            enforceGlobalUrlUniqueness: true,
            linkedinTemplate: task.linkedinTemplate,
            solutionApproach: task.solutionApproach,
          },
          update: {
            linkedinTemplate: task.linkedinTemplate,
            solutionApproach: task.solutionApproach,
          },
        });
        activities += 1;
      }

      const quizzes = sample
        ? ch.quizzes.filter((q) => q.weekNumber <= 1 || neededQuizIds.has(q.id))
        : ch.quizzes;
      for (const quiz of quizzes) {
        const actId = activityIdForQuiz(quiz.id);
        await ctx.prisma.activity.upsert({
          where: { id: actId },
          create: {
            id: actId,
            moduleId: quizMod.id,
            position: quiz.weekNumber,
            type: ActivityType.QUIZ,
            title: quiz.title,
            isRequired: false,
            unlockRule: ActivityUnlockRule.SCHEDULED,
            maxAttempts: 1,
            dayNumber: quiz.weekNumber * 7,
          },
          update: { title: quiz.title, position: quiz.weekNumber },
        });
        const qcfg = await ctx.prisma.quizActivityConfig.upsert({
          where: { activityId: actId },
          create: { activityId: actId, passMark: 60, shuffle: false },
          update: {},
        });
        const questions = sample ? quiz.quizQuestions.slice(0, 3) : quiz.quizQuestions;
        for (const qq of questions) {
          const question = await ctx.prisma.question.upsert({
            where: {
              configId_position: { configId: qcfg.id, position: qq.questionOrder },
            },
            create: {
              configId: qcfg.id,
              position: qq.questionOrder,
              body: qq.questionText,
              explanation: qq.explanation,
            },
            update: {
              body: qq.questionText,
              explanation: qq.explanation,
            },
          });
          const options = [
            { position: 1, body: qq.optionA, key: "A" },
            { position: 2, body: qq.optionB, key: "B" },
            { position: 3, body: qq.optionC, key: "C" },
            { position: 4, body: qq.optionD, key: "D" },
          ];
          for (const opt of options) {
            await ctx.prisma.questionOption.upsert({
              where: {
                questionId_position: {
                  questionId: question.id,
                  position: opt.position,
                },
              },
              create: {
                questionId: question.id,
                position: opt.position,
                body: opt.body,
                isCorrect: qq.correctAnswer.toUpperCase() === opt.key,
              },
              update: {
                body: opt.body,
                isCorrect: qq.correctAnswer.toUpperCase() === opt.key,
              },
            });
          }
        }
        activities += 1;
      }
    }

    const programCatId = catBySlug.get("ai-engineering");
    if (!programCatId) throw new Error("Missing ai-engineering category");

    const program = await ctx.prisma.learningProgram.upsert({
      where: { slug: "ai-cohort-program" },
      create: {
        slug: "ai-cohort-program",
        title: "AI Cohort Program",
        description: "31-day AI cohort for working professionals.",
        categoryId: programCatId,
        format: ProgramFormat.COHORT,
        isPublished: true,
        sortOrder: 10,
      },
      update: { title: "AI Cohort Program", isPublished: true },
    });
    programs += 1;

    const version = await ctx.prisma.programVersion.upsert({
      where: {
        programId_versionNumber: { programId: program.id, versionNumber: 1 },
      },
      create: {
        programId: program.id,
        versionNumber: 1,
        status: ProgramVersionStatus.PUBLISHED,
        plannedDurationDays: 31,
        publishedAt: new Date(),
      },
      update: { plannedDurationDays: 31, status: ProgramVersionStatus.PUBLISHED },
    });
    versions += 1;

    const programCohorts = await ctx.prisma.programCohort.findMany();
    for (const pc of programCohorts) {
      const slug = `legacy-program-${pc.id}`;
      await ctx.prisma.cohort.upsert({
        where: { slug },
        create: {
          programVersionId: version.id,
          slug,
          name: pc.name,
          startMode: CohortStartMode.FIXED,
          startsAt: pc.startsAt,
          endsAt: pc.endsAt,
          timezone: "Asia/Kolkata",
          status: mapCohortStatus(pc.status),
          capacity: pc.capacity,
          joinCode: pc.joinCode,
          requiresJoinCode: pc.requiresJoinCode,
          resultsPublishedAt: pc.resultsPublishedAt,
        },
        update: {
          name: pc.name,
          startsAt: pc.startsAt,
          endsAt: pc.endsAt,
          status: mapCohortStatus(pc.status),
          capacity: pc.capacity,
          resultsPublishedAt: pc.resultsPublishedAt,
        },
      });
      cohorts += 1;
    }

    const pmodules = await ctx.prisma.programModule.findMany({
      include: {
        days: { include: { conceptQuestions: true, videos: true } },
      },
    });
    const moduleIdByNumber = new Map<number, string>();
    for (const pm of pmodules) {
      const mod = await ctx.prisma.module.upsert({
        where: {
          programVersionId_position: {
            programVersionId: version.id,
            position: pm.number,
          },
        },
        create: {
          programVersionId: version.id,
          position: pm.number,
          title: pm.title,
          subtitle: pm.subtitle,
          colorToken: pm.color,
          startDay: pm.startDay,
          endDay: pm.endDay,
        },
        update: {
          title: pm.title,
          subtitle: pm.subtitle,
          colorToken: pm.color,
          startDay: pm.startDay,
          endDay: pm.endDay,
        },
      });
      moduleIdByNumber.set(pm.number, mod.id);
      modules += 1;

      const days = sample
        ? pm.days.filter((d) => d.dayNumber <= SAMPLE_DAY_CAP)
        : pm.days;
      for (const day of days) {
        const actId = activityIdForProgramDay(day.id);
        const type = missionActivityType(day.missionType, day.isProjectDay);
        await ctx.prisma.activity.upsert({
          where: { id: actId },
          create: {
            id: actId,
            moduleId: mod.id,
            position: day.dayNumber,
            type,
            title: day.title,
            dayNumber: day.dayNumber,
            points: day.missionPoints,
            isRequired: true,
            unlockRule: ActivityUnlockRule.SCHEDULED,
            estimatedMinutes: day.estimatedMin,
            verificationSpec: day.missionSpec as Prisma.InputJsonValue,
            tags: day.tools,
          },
          update: {
            type,
            title: day.title,
            points: day.missionPoints,
            verificationSpec: day.missionSpec as Prisma.InputJsonValue,
            tags: day.tools,
          },
        });
        await ctx.prisma.contentActivityConfig.upsert({
          where: { activityId: actId },
          create: {
            activityId: actId,
            bodyMarkdown: day.briefMd,
            assetsJson: (day.assetsJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            objectives: day.objectives,
          },
          update: {
            bodyMarkdown: day.briefMd,
            assetsJson: (day.assetsJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            objectives: day.objectives,
          },
        });
        if (day.starterCode || day.language) {
          await ctx.prisma.codingActivityConfig.upsert({
            where: { activityId: actId },
            create: {
              activityId: actId,
              language: day.language ?? "PYTHON",
              starterCode: day.starterCode,
            },
            update: {
              language: day.language ?? "PYTHON",
              starterCode: day.starterCode,
            },
          });
        }
        if (day.isProjectDay) {
          await ctx.prisma.projectActivityConfig.upsert({
            where: { activityId: actId },
            create: {
              activityId: actId,
              briefMarkdown: day.briefMd,
              aiGradingEnabled: true,
            },
            update: { briefMarkdown: day.briefMd },
          });
        }
        activities += 1;

        const conceptQuestions = sample
          ? day.conceptQuestions.slice(0, 2)
          : day.conceptQuestions;
        if (conceptQuestions.length > 0) {
          const cqId = activityIdForConceptQuiz(day.id);
          await ctx.prisma.activity.upsert({
            where: { id: cqId },
            create: {
              id: cqId,
              moduleId: mod.id,
              position: 1000 + day.dayNumber,
              type: ActivityType.QUIZ,
              title: `${day.title} — concepts`,
              dayNumber: day.dayNumber,
              points: 3,
              isRequired: false,
              unlockRule: ActivityUnlockRule.SCHEDULED,
              maxAttempts: 1,
            },
            update: { title: `${day.title} — concepts` },
          });
          const qcfg = await ctx.prisma.quizActivityConfig.upsert({
            where: { activityId: cqId },
            create: { activityId: cqId, passMark: 60, shuffle: true, sampleSize: 3 },
            update: {},
          });
          for (const cq of conceptQuestions) {
            const question = await ctx.prisma.question.upsert({
              where: {
                configId_position: { configId: qcfg.id, position: cq.order },
              },
              create: {
                configId: qcfg.id,
                position: cq.order,
                body: cq.question,
                explanation: cq.explanation,
              },
              update: { body: cq.question, explanation: cq.explanation },
            });
            for (let i = 0; i < cq.options.length; i++) {
              await ctx.prisma.questionOption.upsert({
                where: {
                  questionId_position: { questionId: question.id, position: i + 1 },
                },
                create: {
                  questionId: question.id,
                  position: i + 1,
                  body: cq.options[i]!,
                  isCorrect: i === cq.correctIndex,
                },
                update: {
                  body: cq.options[i]!,
                  isCorrect: i === cq.correctIndex,
                },
              });
            }
          }
          activities += 1;
        }

        const videos = sample ? day.videos.slice(0, 1) : day.videos;
        for (const vid of videos) {
          const vidId = activityIdForVideo(vid.id);
          await ctx.prisma.activity.upsert({
            where: { id: vidId },
            create: {
              id: vidId,
              moduleId: mod.id,
              position: 2000 + day.dayNumber * 10 + vid.order,
              type: ActivityType.VIDEO,
              title: vid.title,
              dayNumber: day.dayNumber,
              isRequired: false,
              unlockRule: ActivityUnlockRule.SCHEDULED,
              estimatedMinutes: vid.durationMin ?? undefined,
            },
            update: { title: vid.title },
          });
          await ctx.prisma.contentActivityConfig.upsert({
            where: { activityId: vidId },
            create: {
              activityId: vidId,
              videoProvider: "YOUTUBE",
              videoRef: vid.youtubeId,
              videoDurationMin: vid.durationMin,
            },
            update: {
              videoProvider: "YOUTUBE",
              videoRef: vid.youtubeId,
              videoDurationMin: vid.durationMin,
            },
          });
          activities += 1;
        }
      }
    }

    const exercises = await ctx.prisma.programExercise.findMany();
    const exerciseSlice = sample ? exercises.slice(0, 2) : exercises;
    for (const ex of exerciseSlice) {
      const moduleId = moduleIdByNumber.get(ex.moduleNumber);
      if (!moduleId) continue;
      const actId = activityIdForExercise(ex.id);
      await ctx.prisma.activity.upsert({
        where: { id: actId },
        create: {
          id: actId,
          moduleId,
          position: 3000 + ex.order,
          type: ActivityType.CODING,
          title: ex.title,
          summary: ex.description,
          isRequired: false,
          unlockRule: ActivityUnlockRule.SEQUENTIAL,
        },
        update: { title: ex.title, summary: ex.description },
      });
      await ctx.prisma.codingActivityConfig.upsert({
        where: { activityId: actId },
        create: {
          activityId: actId,
          language: ex.language,
          starterCode: ex.starterCode,
          setupSql: ex.setupSql,
        },
        update: {
          language: ex.language,
          starterCode: ex.starterCode,
          setupSql: ex.setupSql,
        },
      });
      activities += 1;
    }

    const ivId = activityIdForInterview(version.id);
    const lastMod =
      [...moduleIdByNumber.entries()].sort((a, b) => b[0] - a[0])[0]?.[1] ??
      (await ctx.prisma.module.findFirst({
        where: { programVersionId: version.id },
        orderBy: { position: "desc" },
        select: { id: true },
      }))?.id;
    if (lastMod) {
      await ctx.prisma.activity.upsert({
        where: { id: ivId },
        create: {
          id: ivId,
          moduleId: lastMod,
          position: 9000,
          type: ActivityType.INTERVIEW,
          title: "Voice interview",
          isRequired: false,
          unlockRule: ActivityUnlockRule.ALWAYS,
        },
        update: { title: "Voice interview" },
      });
      activities += 1;
    }

    const entryId = activityIdForEntry(version.id);
    const firstMod = moduleIdByNumber.get(1) ?? lastMod;
    const entryQuestions = await ctx.prisma.programEntryQuestion.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
    });
    if (firstMod && entryQuestions.length > 0) {
      await ctx.prisma.activity.upsert({
        where: { id: entryId },
        create: {
          id: entryId,
          moduleId: firstMod,
          position: 0,
          type: ActivityType.QUIZ,
          title: "Entry assessment",
          tags: ["entry"],
          isRequired: false,
          unlockRule: ActivityUnlockRule.ALWAYS,
        },
        update: { title: "Entry assessment", tags: ["entry"] },
      });
      const qcfg = await ctx.prisma.quizActivityConfig.upsert({
        where: { activityId: entryId },
        create: { activityId: entryId, passMark: 60, shuffle: false },
        update: {},
      });
      const entrySlice = sample ? entryQuestions.slice(0, 3) : entryQuestions;
      for (let i = 0; i < entrySlice.length; i++) {
        const eq = entryQuestions[i]!;
        const question = await ctx.prisma.question.upsert({
          where: { configId_position: { configId: qcfg.id, position: i + 1 } },
          create: {
            configId: qcfg.id,
            position: i + 1,
            body: eq.question,
            explanation: eq.explanation,
          },
          update: { body: eq.question, explanation: eq.explanation },
        });
        for (let oi = 0; oi < eq.options.length; oi++) {
          await ctx.prisma.questionOption.upsert({
            where: {
              questionId_position: { questionId: question.id, position: oi + 1 },
            },
            create: {
              questionId: question.id,
              position: oi + 1,
              body: eq.options[oi]!,
              isCorrect: oi === eq.correctIndex,
            },
            update: {
              body: eq.options[oi]!,
              isCorrect: oi === eq.correctIndex,
            },
          });
        }
      }
      activities += 1;
    }

    const conceptAttempts = await ctx.prisma.programConceptAttempt.count();
    const exerciseCompletions = await ctx.prisma.programExerciseCompletion.count();

    const requiredCount = await ctx.prisma.activity.count({
      where: { module: { programVersionId: version.id }, isRequired: true },
    });
    await ctx.prisma.programVersion.update({
      where: { id: version.id },
      data: { requiredActivityCount: requiredCount },
    });

    return {
      programs,
      versions,
      cohorts,
      modules,
      activities,
      conceptAttemptRows: conceptAttempts,
      exerciseCompletionRows: exerciseCompletions,
    };
  });
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await migrate2d();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
