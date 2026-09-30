import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { addDays, subDays } from "date-fns";
import {
  AttemptLateness,
  AttemptStatus,
  CandidatePersona,
  Domain,
  EnrollmentStatus,
  EnrollmentStatusV2,
  EvaluatorType,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import {
  activityIdForDailyTask,
  activityIdForQuiz,
  attemptIdForQuizAttempt,
  attemptIdForSubmission,
  cohortSlugForDomain,
  mintProgressRowId,
  peIdForEnrollment,
} from "../src/repositories/ids";

function mapChallengeStatus(status: EnrollmentStatus): EnrollmentStatusV2 {
  if (status === EnrollmentStatus.COMPLETED) return EnrollmentStatusV2.COMPLETED;
  if (status === EnrollmentStatus.ABANDONED) return EnrollmentStatusV2.DROPPED;
  return EnrollmentStatusV2.ACTIVE;
}

const TEST_EMAIL_SUFFIX = "@abtalks.dev";

function randomReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return out;
}

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = randomReferralCode();
    const exists = await prisma.candidateProfile.findUnique({
      where: { referralCode: code },
      select: { userId: true },
    });
    if (!exists) return code;
  }
  throw new Error("Could not generate unique referral code");
}

function utcNoon(daysAgo: number): Date {
  const d = subDays(new Date(), daysAgo);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

type ProblemJson = {
  dayNumber: number;
  domain: string;
  title: string;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  difficulty: string;
  estimatedMinutes: number;
  linkedinTemplate: string;
  solutionApproach: string;
  tags: string[];
  dayContent?: unknown;
};

type QuizQuestionJson = {
  questionOrder: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
};

type QuizJson = {
  weekNumber: number;
  domain: string;
  title: string;
  questions: QuizQuestionJson[];
};

function loadJsonFile<T>(filename: string): T | null {
  const full = path.join(process.cwd(), "prisma", "content", filename);
  if (!fs.existsSync(full)) {
    console.warn(`Content file not found (skipping): ${full}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
  } catch (e) {
    console.warn(`Invalid JSON in ${filename}:`, e);
    return null;
  }
}

function buildProblemLookup(entries: ProblemJson[] | null): Map<string, ProblemJson> {
  const map = new Map<string, ProblemJson>();
  if (!entries) return map;
  for (const p of entries) {
    if (p.domain !== "SE" && p.domain !== "DS" && p.domain !== "AI") continue;
    map.set(`${p.domain}:${p.dayNumber}`, p);
  }
  return map;
}

function buildClaudeProblemLookup(entries: ProblemJson[] | null): Map<string, ProblemJson> {
  const map = new Map<string, ProblemJson>();
  if (!entries) return map;
  for (const p of entries) {
    if (p.domain !== "CLAUDE") continue;
    map.set(`CLAUDE:${p.dayNumber}`, p);
  }
  return map;
}

function placeholderDailyTaskData(domain: Domain, dayNumber: number) {
  if (domain === Domain.CLAUDE) {
    const estimatedMinutes = Math.min(60, 25 + dayNumber * 2);
    const tier =
      dayNumber <= 15 ? "Beginner" : dayNumber <= 45 ? "Intermediate" : "Advanced";
    return {
      domain,
      title: `Day ${dayNumber} — Claude Challenge (placeholder)`,
      problemStatement: `Placeholder Claude curriculum for day ${dayNumber}. Run \`npm run db:seed:content\` after adding prisma/content/claude-problems.json for full tasks.`,
      learningObjectives: [
        "Map one real workflow Claude could accelerate for you",
        "Practice structured prompting with clear success criteria",
      ],
      resources: ["https://claude.ai", "https://docs.anthropic.com"],
      difficulty: tier,
      estimatedMinutes,
      linkedinTemplate: `Day ${dayNumber}/60 #60DayClaudeChallenge #ABtalks 🚀\n\nPlaceholder update — full story template ships before June 1, 2026.`,
      solutionApproach: "Share a Claude conversation or artifact URL that reflects your work.",
      tags: ["placeholder", "claude", `day-${dayNumber}`],
    };
  }
  const difficulty = dayNumber <= 7 ? "Easy" : "Medium";
  const estimatedMinutes = Math.min(60, 5 + dayNumber * 2);
  return {
    domain,
    title: `Day ${dayNumber} — Placeholder`,
    problemStatement: `Placeholder problem statement for day ${dayNumber}. Real content coming soon.`,
    learningObjectives: ["Objective 1", "Objective 2"],
    resources: [],
    difficulty,
    estimatedMinutes,
    linkedinTemplate: `Day ${dayNumber} of my 60 Days of Code with ABtalks 🚀\n\nMade progress today. Check my work: {{github_link}}\n\n#ABtalks #60DaysOfCode`,
    solutionApproach: null,
    tags: ["placeholder", `day-${dayNumber}`],
  };
}

function dailyTaskFromJson(domain: Domain, row: ProblemJson) {
  return {
    domain,
    title: row.title,
    problemStatement: row.problemStatement,
    learningObjectives: row.learningObjectives,
    resources: row.resources ?? [],
    difficulty: row.difficulty,
    estimatedMinutes: row.estimatedMinutes,
    linkedinTemplate: row.linkedinTemplate,
    solutionApproach: row.solutionApproach,
    tags: row.tags,
    dayContent: row.dayContent
      ? (row.dayContent as Prisma.InputJsonValue)
      : Prisma.DbNull,
  };
}

async function upsertDailyTasksForChallenge(
  challengeId: string,
  domain: Domain,
  problemLookup: Map<string, ProblemJson>,
) {
  for (let dayNumber = 1; dayNumber <= 60; dayNumber++) {
    const key = `${domain}:${dayNumber}`;
    const fromJson = problemLookup.get(key);
    const body = fromJson
      ? dailyTaskFromJson(domain, fromJson)
      : {
          ...placeholderDailyTaskData(domain, dayNumber),
          dayContent: Prisma.DbNull,
        };

    await prisma.dailyTask.upsert({
      where: {
        challengeId_dayNumber: { challengeId, dayNumber },
      },
      create: {
        challengeId,
        dayNumber,
        ...body,
      },
      update: { ...body },
    });
  }
}

async function replaceQuizQuestionsFromJson(
  quizId: string,
  questions: QuizQuestionJson[],
) {
  await prisma.quizQuestion.deleteMany({ where: { quizId } });
  for (const q of questions) {
    await prisma.quizQuestion.create({
      data: {
        quizId,
        questionOrder: q.questionOrder,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      },
    });
  }
}

async function seedPlaceholderWeekQuiz(
  challengeId: string,
  domain: Domain,
  weekNumber: number,
  quizWeek1IdByDomain: Map<Domain, string>,
) {
  const title = `Week ${weekNumber} Quiz — ${domain}`;
  const quiz = await prisma.quiz.upsert({
    where: {
      challengeId_weekNumber: { challengeId, weekNumber },
    },
    create: {
      challengeId,
      domain,
      weekNumber,
      title,
    },
    update: { title },
  });
  if (weekNumber === 1) {
    quizWeek1IdByDomain.set(domain, quiz.id);
  }
  await prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id } });
  const correctCycle = ["A", "B", "C", "D"] as const;
  for (let qn = 1; qn <= 10; qn++) {
    const correctAnswer = correctCycle[(qn - 1) % 4]!;
    await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        questionOrder: qn,
        questionText: `Week ${weekNumber} Q${qn} placeholder for ${domain}?`,
        optionA: "Option A placeholder",
        optionB: "Option B placeholder",
        optionC: "Option C placeholder",
        optionD: "Option D placeholder",
        correctAnswer,
        explanation: `Placeholder explanation for Week ${weekNumber} Q${qn} — real content pending.`,
      },
    });
  }
}

const challengeSpecs: { domain: Domain; title: string; description: string }[] = [
  {
    domain: Domain.SE,
    title: "60 Days of Code — Software Engineering",
    description:
      "Placeholder SE challenge. Real curriculum content coming soon.",
  },
  {
    domain: Domain.DS,
    title: "60 Days of Code — Data Science",
    description:
      "Placeholder Data Science challenge. Real curriculum content coming soon.",
  },
  {
    domain: Domain.AI,
    title: "60 Days of Code — Artificial Intelligence",
    description:
      "Placeholder AI challenge. Real curriculum content coming soon.",
  },
];

// Cache invalidation (manual): daily-task content and the CLAUDE start date are
// cached server-side via `unstable_cache` (tags `daily-tasks:<challengeId>` and
// `challenge:CLAUDE`). This script runs outside the Next.js runtime, so it cannot
// call `revalidateTag`. After reseeding content, bust those caches by redeploying
// (a fresh deployment starts with an empty cache) so the new content is served.
export async function seedContent() {
  const problemsRaw = loadJsonFile<ProblemJson[]>("problems.json");
  const problemLookup = buildProblemLookup(
    Array.isArray(problemsRaw) ? problemsRaw : null,
  );
  const quizzesRaw = loadJsonFile<QuizJson[]>("quizzes.json");
  const quizEntries = Array.isArray(quizzesRaw) ? quizzesRaw : [];
  const challengeByDomain = new Map<Domain, { id: string }>();
  const quizWeek1IdByDomain = new Map<Domain, string>();
  const quizSeededFromJson = new Set<string>();

  for (const spec of challengeSpecs) {
    const challenge = await prisma.challenge.upsert({
      where: { domain: spec.domain },
      create: {
        domain: spec.domain,
        title: spec.title,
        description: spec.description,
        totalDays: 60,
        isActive: true,
      },
      update: {
        title: spec.title,
        description: spec.description,
        totalDays: 60,
        isActive: true,
      },
    });
    challengeByDomain.set(spec.domain, { id: challenge.id });
    await upsertDailyTasksForChallenge(
      challenge.id,
      spec.domain,
      problemLookup,
    );
  }

  const claudeChallenge = await prisma.challenge.upsert({
    where: { domain: Domain.CLAUDE },
    update: {
      title: "60-Day Claude AI Mastery Challenge",
      description:
        "Master Claude AI in 60 days — for students and working professionals.",
      totalDays: 60,
      isActive: true,
      startsAt: new Date("2026-06-01T00:00:00+05:30"),
    },
    create: {
      domain: Domain.CLAUDE,
      title: "60-Day Claude AI Mastery Challenge",
      description:
        "Master Claude AI in 60 days — for students and working professionals.",
      totalDays: 60,
      isActive: true,
      startsAt: new Date("2026-06-01T00:00:00+05:30"),
    },
  });

  const claudeProblemsRaw = loadJsonFile<ProblemJson[]>("claude-problems.json");
  const claudeProblemLookup = buildClaudeProblemLookup(
    Array.isArray(claudeProblemsRaw) ? claudeProblemsRaw : null,
  );
  await upsertDailyTasksForChallenge(
    claudeChallenge.id,
    Domain.CLAUDE,
    claudeProblemLookup,
  );

  for (const entry of quizEntries) {
    if (entry.domain !== "SE" && entry.domain !== "DS" && entry.domain !== "AI") {
      continue;
    }
    const domain = entry.domain as Domain;
    const challengeId = challengeByDomain.get(domain)!.id;
    const quiz = await prisma.quiz.upsert({
      where: {
        challengeId_weekNumber: {
          challengeId,
          weekNumber: entry.weekNumber,
        },
      },
      create: {
        challengeId,
        domain,
        weekNumber: entry.weekNumber,
        title: entry.title,
      },
      update: { title: entry.title },
    });
    quizSeededFromJson.add(`${domain}:${entry.weekNumber}`);
    if (entry.weekNumber === 1) {
      quizWeek1IdByDomain.set(domain, quiz.id);
    }
    await replaceQuizQuestionsFromJson(quiz.id, entry.questions);
  }

  const claudeQuizzesRaw = loadJsonFile<QuizJson[]>("claude-quizzes.json");
  const claudeQuizEntries = Array.isArray(claudeQuizzesRaw) ? claudeQuizzesRaw : [];
  for (const entry of claudeQuizEntries) {
    if (entry.domain !== "CLAUDE") continue;
    const quiz = await prisma.quiz.upsert({
      where: {
        challengeId_weekNumber: {
          challengeId: claudeChallenge.id,
          weekNumber: entry.weekNumber,
        },
      },
      create: {
        challengeId: claudeChallenge.id,
        domain: Domain.CLAUDE,
        weekNumber: entry.weekNumber,
        title: entry.title,
      },
      update: { title: entry.title },
    });
    await replaceQuizQuestionsFromJson(quiz.id, entry.questions);
  }

  const defaultQuizWeeks = [1];
  for (const spec of challengeSpecs) {
    const challengeId = challengeByDomain.get(spec.domain)!.id;
    for (const weekNumber of defaultQuizWeeks) {
      const key = `${spec.domain}:${weekNumber}`;
      if (quizSeededFromJson.has(key)) {
        continue;
      }
      await seedPlaceholderWeekQuiz(
        challengeId,
        spec.domain,
        weekNumber,
        quizWeek1IdByDomain,
      );
    }
  }

  await seedMarketplaceItems();
}

type MarketplaceItemJson = {
  slug: string;
  title: string;
  description: string;
  costSP: number;
  imagePath?: string;
  sortOrder: number;
  /** Omitted for items with no size, which is most of the catalog. */
  sizeOptions?: string[];
};

export async function seedMarketplaceItems() {
  const raw = loadJsonFile<MarketplaceItemJson[]>("marketplace.json");
  if (!Array.isArray(raw)) return;

  const seededSlugs = raw.map((entry) => entry.slug);

  for (const entry of raw) {
    await prisma.marketplaceItem.upsert({
      where: { slug: entry.slug },
      create: {
        slug: entry.slug,
        title: entry.title,
        description: entry.description,
        costSP: entry.costSP,
        imagePath: entry.imagePath ?? null,
        sortOrder: entry.sortOrder,
        sizeOptions: entry.sizeOptions ?? [],
        active: true,
      },
      update: {
        title: entry.title,
        description: entry.description,
        costSP: entry.costSP,
        imagePath: entry.imagePath ?? null,
        sortOrder: entry.sortOrder,
        // Set on update too, so dropping "sizeOptions" from the JSON actually
        // clears them rather than leaving a stale list on the row.
        sizeOptions: entry.sizeOptions ?? [],
        active: true,
      },
    });
  }

  // Keep redemption history: deactivate catalog rows removed from JSON.
  await prisma.marketplaceItem.updateMany({
    where: { slug: { notIn: seededSlugs } },
    data: { active: false },
  });
}

async function loadChallengeIdByDomain(): Promise<Map<Domain, { id: string }>> {
  const challengeByDomain = new Map<Domain, { id: string }>();
  for (const spec of challengeSpecs) {
    const challenge = await prisma.challenge.findUnique({
      where: { domain: spec.domain },
      select: { id: true },
    });
    if (!challenge) {
      throw new Error(
        `Missing challenge for ${spec.domain}. Run content seed first.`,
      );
    }
    challengeByDomain.set(spec.domain, { id: challenge.id });
  }
  return challengeByDomain;
}

async function loadQuizWeek1IdByDomain(
  challengeByDomain: Map<Domain, { id: string }>,
): Promise<Map<Domain, string>> {
  const quizWeek1IdByDomain = new Map<Domain, string>();
  for (const spec of challengeSpecs) {
    const challengeId = challengeByDomain.get(spec.domain)?.id;
    if (!challengeId) continue;
    const quiz = await prisma.quiz.findUnique({
      where: {
        challengeId_weekNumber: { challengeId, weekNumber: 1 },
      },
      select: { id: true },
    });
    if (quiz) {
      quizWeek1IdByDomain.set(spec.domain, quiz.id);
    }
  }
  return quizWeek1IdByDomain;
}

export async function seedTestUsers() {
  await prisma.user.deleteMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
  });

  const challengeByDomain = await loadChallengeIdByDomain();
  const quizWeek1IdByDomain = await loadQuizWeek1IdByDomain(challengeByDomain);

  type EnrollSpec = {
    daysCompleted: number;
    currentStreak: number;
    longestStreak: number;
    lastSubmittedDay: number | null;
    status: EnrollmentStatus;
    startedDaysAgo: number;
    completedAt?: Date | null;
  };

  type UserSeed = {
    email: string;
    password: string;
    name: string;
    num: number;
    domain: Domain;
    role: Role;
    isReadyForInterview?: boolean;
    enrollment?: EnrollSpec;
  };

  const users: UserSeed[] = [
    {
      email: "arjun@abtalks.dev",
      password: "test",
      name: "Arjun",
      num: 1,
      domain: Domain.SE,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 7,
        currentStreak: 7,
        longestStreak: 7,
        lastSubmittedDay: 7,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 7,
      },
    },
    {
      email: "priya@abtalks.dev",
      password: "test",
      name: "Priya",
      num: 2,
      domain: Domain.DS,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 7,
        currentStreak: 7,
        longestStreak: 7,
        lastSubmittedDay: 7,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 7,
      },
    },
    {
      email: "rohan@abtalks.dev",
      password: "test",
      name: "Rohan",
      num: 3,
      domain: Domain.AI,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 7,
        currentStreak: 7,
        longestStreak: 7,
        lastSubmittedDay: 7,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 7,
      },
    },
    {
      email: "sneha@abtalks.dev",
      password: "test",
      name: "Sneha",
      num: 4,
      domain: Domain.SE,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 7,
        currentStreak: 7,
        longestStreak: 7,
        lastSubmittedDay: 7,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 7,
      },
    },
    {
      email: "vikram@abtalks.dev",
      password: "test",
      name: "Vikram",
      num: 5,
      domain: Domain.DS,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 15,
        currentStreak: 15,
        longestStreak: 15,
        lastSubmittedDay: 15,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 15,
      },
    },
    {
      email: "anika@abtalks.dev",
      password: "test",
      name: "Anika",
      num: 6,
      domain: Domain.SE,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 30,
        currentStreak: 30,
        longestStreak: 30,
        lastSubmittedDay: 30,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 30,
      },
    },
    {
      email: "karan@abtalks.dev",
      password: "test",
      name: "Karan",
      num: 7,
      domain: Domain.AI,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 40,
        currentStreak: 3,
        longestStreak: 20,
        lastSubmittedDay: 40,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 45,
      },
    },
    {
      email: "meera@abtalks.dev",
      password: "test",
      name: "Meera",
      num: 8,
      domain: Domain.SE,
      role: Role.STUDENT,
      isReadyForInterview: true,
      enrollment: {
        daysCompleted: 60,
        currentStreak: 60,
        longestStreak: 60,
        lastSubmittedDay: 60,
        status: EnrollmentStatus.COMPLETED,
        startedDaysAgo: 60,
        completedAt: new Date(),
      },
    },
    {
      email: "dhruv@abtalks.dev",
      password: "test",
      name: "Dhruv",
      num: 9,
      domain: Domain.SE,
      role: Role.STUDENT,
      enrollment: {
        daysCompleted: 20,
        currentStreak: 20,
        longestStreak: 20,
        lastSubmittedDay: 20,
        status: EnrollmentStatus.ACTIVE,
        startedDaysAgo: 20,
      },
    },
    {
      email: "admin@abtalks.dev",
      password: "admin",
      name: "Admin",
      num: 10,
      domain: Domain.SE,
      role: Role.ADMIN,
    },
  ];

  const emailToId = new Map<string, string>();
  const emailToPeId = new Map<string, string>();

  for (const u of users) {
    const referralCode = await uniqueReferralCode();
    const startedAt = utcNoon(u.enrollment?.startedDaysAgo ?? 0);

    const created = await prisma.user.create({
      data: {
        email: u.email,
        password: await hashPassword(u.password),
        name: u.name,
        role: u.role,
        candidateProfile: {
          create: {
            id: `cp_${u.email}`,
            fullName: u.name,
            primaryPersona: CandidatePersona.STUDENT,
            referralCode,
            isReadyForInterview: u.isReadyForInterview ?? false,
          },
        },
      },
      select: { id: true },
    });

    emailToId.set(u.email, created.id);

    if (u.enrollment) {
      const slug = cohortSlugForDomain(u.domain);
      const cohort = await prisma.cohort.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!cohort) {
        throw new Error(`Missing cohort ${slug} — run 078 learning content first`);
      }
      const handle = mintProgressRowId();
      const peId = peIdForEnrollment(handle);
      await prisma.programEnrollment.create({
        data: {
          id: peId,
          userId: created.id,
          cohortId: cohort.id,
          status: mapChallengeStatus(u.enrollment.status),
          startedAt,
          enrolledAt: startedAt,
          joinedAt: startedAt,
          completedAt: u.enrollment.completedAt ?? null,
          trackCurrentStreak: u.enrollment.currentStreak,
          trackLongestStreak: u.enrollment.longestStreak,
        },
      });

      emailToPeId.set(u.email, peId);

      if (u.enrollment.daysCompleted > 0) {
        const challengeId = challengeByDomain.get(u.domain)!.id;
        for (let day = 1; day <= u.enrollment.daysCompleted; day++) {
          const dailyTask = await prisma.dailyTask.findUnique({
            where: {
              challengeId_dayNumber: { challengeId, dayNumber: day },
            },
          });
          if (!dailyTask) {
            throw new Error(`Missing DailyTask domain=${u.domain} day=${day}`);
          }
          const submittedAt = addDays(startedAt, day - 1);
          submittedAt.setUTCHours(14, 0, 0, 0);
          const activityId = activityIdForDailyTask(dailyTask.id);
          const activity = await prisma.activity.findUnique({
            where: { id: activityId },
            select: { id: true },
          });
          if (!activity) continue;
          const subId = mintProgressRowId();
          const attemptId = attemptIdForSubmission(subId);
          await prisma.activityAttempt.create({
            data: {
              id: attemptId,
              enrollmentId: peId,
              activityId,
              attemptNumber: 1,
              status: AttemptStatus.EVALUATED,
              lateness: AttemptLateness.ON_TIME,
              payload: {
                githubUrl: `https://github.com/test-user-${u.num}/abtalks-day-${day}`,
                linkedinUrl: `https://www.linkedin.com/posts/test-user-${u.num}-day-${day}`,
                legacySubmissionId: subId,
              },
              passed: true,
              pointsAwarded: 10,
              startedAt: submittedAt,
              submittedAt,
            },
          });
          await prisma.activityEvaluation.create({
            data: {
              id: `ev_sub_${subId}`,
              attemptId,
              evaluatorType: EvaluatorType.AUTO,
              passed: true,
              score: 100,
              maxScore: 100,
              isAuthoritative: true,
              createdAt: submittedAt,
            },
          });
        }
      }
    }
  }

  const dhruvId = emailToId.get("dhruv@abtalks.dev")!;
  const arjunId = emailToId.get("arjun@abtalks.dev")!;
  const priyaId = emailToId.get("priya@abtalks.dev")!;
  const rohanId = emailToId.get("rohan@abtalks.dev")!;

  await prisma.referral.createMany({
    data: [
      { referrerId: dhruvId, referredId: arjunId },
      { referrerId: dhruvId, referredId: priyaId },
      { referrerId: dhruvId, referredId: rohanId },
    ],
  });

  const snehaId = emailToId.get("sneha@abtalks.dev")!;
  const seWeek1QuizId = quizWeek1IdByDomain.get(Domain.SE)!;
  const seWeek1Questions = await prisma.quizQuestion.findMany({
    where: { quizId: seWeek1QuizId },
    orderBy: { questionOrder: "asc" },
  });
  const snehaAnswers: Record<string, string> = {};
  seWeek1Questions.forEach((q, idx) => {
    const correct = q.correctAnswer;
    const wrong = correct === "A" ? "B" : "A";
    snehaAnswers[q.id] = idx < 8 ? correct : wrong;
  });
  const snehaPeId = emailToPeId.get("sneha@abtalks.dev");
  const quizActivityId = activityIdForQuiz(seWeek1QuizId);
  const quizActivity = snehaPeId
    ? await prisma.activity.findUnique({
        where: { id: quizActivityId },
        select: { id: true },
      })
    : null;
  if (snehaPeId && quizActivity) {
    const qaId = mintProgressRowId();
    const attemptId = attemptIdForQuizAttempt(qaId);
    await prisma.activityAttempt.create({
      data: {
        id: attemptId,
        enrollmentId: snehaPeId,
        activityId: quizActivityId,
        attemptNumber: 1,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.ON_TIME,
        payload: { answers: snehaAnswers, legacyQuizAttemptId: qaId },
        passed: true,
        score: 8,
        pointsAwarded: 0,
      },
    });
    await prisma.activityEvaluation.create({
      data: {
        id: `ev_qa_${qaId}`,
        attemptId,
        evaluatorType: EvaluatorType.AUTO,
        passed: true,
        score: 8,
        maxScore: seWeek1Questions.length,
        isAuthoritative: true,
      },
    });
  }

  const meeraPeId = emailToPeId.get("meera@abtalks.dev");
  const anikaPeId = emailToPeId.get("anika@abtalks.dev");
  const meeraSubs = meeraPeId
    ? await prisma.activityAttempt.count({
        where: { enrollmentId: meeraPeId, id: { startsWith: "aa_sub_" } },
      })
    : 0;
  const anikaSubs = anikaPeId
    ? await prisma.activityAttempt.count({
        where: { enrollmentId: anikaPeId, id: { startsWith: "aa_sub_" } },
      })
    : 0;
  const dhruvRefs = await prisma.referral.count({
    where: { referrerId: dhruvId },
  });

  console.log("Seed verification:", {
    meeraSubmissions: meeraSubs,
    anikaSubmissions: anikaSubs,
    dhruvReferrals: dhruvRefs,
  });
}

async function main() {
  await seedContent();
  await seedTestUsers();
  console.log("Full seed completed");
}

const invokedScriptPath = process.argv[1];
const isDirectExecution =
  typeof invokedScriptPath === "string" &&
  import.meta.url === pathToFileURL(invokedScriptPath).href;

if (isDirectExecution) {
  main()
    .then(() => {
      console.log("Seed completed.");
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
