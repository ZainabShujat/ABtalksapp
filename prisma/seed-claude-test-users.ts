import { config } from "dotenv";
import { hashPassword } from "../src/lib/password";
import {
  Domain,
  EnrollmentStatus,
  PrismaClient,
  SubmissionStatus,
  CandidatePersona,
  EnrollmentStatusV2,
  AttemptStatus,
  AttemptLateness,
  EvaluatorType,
} from "@prisma/client";
import { computeStreakStats } from "../src/features/submission/streak-utils";
import { getCurrentDayNumber } from "../src/lib/date-utils";
import {
  activityIdForDailyTask,
  attemptIdForSubmission,
  cohortSlugForDomain,
  mintProgressRowId,
  peIdForEnrollment,
} from "../src/repositories/ids";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function seedChallengeProgress(input: {
  userId: string;
  startedAt: Date;
  status: EnrollmentStatus;
  completedAt?: Date | null;
  submissions: { dayNumber: number; status: SubmissionStatus; submittedAt: Date }[];
  taskIdByDay: Map<number, string>;
}): Promise<string> {
  const slug = cohortSlugForDomain("CLAUDE");
  const cohort = await prisma.cohort.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!cohort) fail(`Missing cohort ${slug}`);
  const handle = mintProgressRowId();
  const peId = peIdForEnrollment(handle);
  await prisma.programEnrollment.create({
    data: {
      id: peId,
      userId: input.userId,
      cohortId: cohort.id,
      status:
        input.status === EnrollmentStatus.COMPLETED
          ? EnrollmentStatusV2.COMPLETED
          : EnrollmentStatusV2.ACTIVE,
      startedAt: input.startedAt,
      enrolledAt: input.startedAt,
      joinedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
    },
  });
  for (const sub of input.submissions) {
    const dailyTaskId = input.taskIdByDay.get(sub.dayNumber);
    if (!dailyTaskId) {
      fail(
        `❌ Missing DailyTask for CLAUDE day ${sub.dayNumber}. Run db:seed:content first.`,
      );
    }
    const activityId = activityIdForDailyTask(dailyTaskId);
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
        lateness:
          sub.status === SubmissionStatus.LATE
            ? AttemptLateness.LATE
            : AttemptLateness.ON_TIME,
        payload: {
          githubUrl: `https://github.com/abtalks-claude-seed/${input.userId}-day-${sub.dayNumber}`,
          linkedinUrl: `https://www.linkedin.com/posts/abtalks-claude-seed-${input.userId}-day-${sub.dayNumber}`,
          legacySubmissionId: subId,
        },
        passed: true,
        pointsAwarded: 10,
        startedAt: sub.submittedAt,
        submittedAt: sub.submittedAt,
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
        createdAt: sub.submittedAt,
      },
    });
  }
  return handle;
}

const MAX_USERS_FOR_DEV_SEED = 50;
const TEST_EMAIL_SUFFIX = "@abtalks.dev";

/** Production Neon host id (main branch). Dev uses ep-young-shadow-amawetjy. */
const PRODUCTION_DB_HOST_IDS = [
  "ep-nameless-term-ams9a5e3",
  ".main.",
] as const;

/** Explicit dev Neon endpoint — allows seed even when the DB has many users. */
const DEV_NEON_HOST_ID = "ep-young-shadow-amawetjy";

const DEV_DB_URL_MARKERS = [DEV_NEON_HOST_ID, "dev"] as const;

function isConfirmedDevDatabase(dbUrl: string): boolean {
  const lower = dbUrl.toLowerCase();
  return lower.includes(DEV_NEON_HOST_ID);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function assertNotProduction() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "";
  const allowOverride = process.env.SEED_ALLOW_PRODUCTION === "true";

  if (allowOverride) {
    console.warn("⚠️  SEED_ALLOW_PRODUCTION=true — bypassing production guard");
    console.warn("⚠️  This is dangerous. Make sure you're on dev DB.");
    return;
  }

  if (nodeEnv === "production") {
    fail("❌ NODE_ENV is production. Refusing to seed test users.");
  }

  const dbLower = dbUrl.toLowerCase();
  for (const indicator of PRODUCTION_DB_HOST_IDS) {
    if (dbLower.includes(indicator.toLowerCase())) {
      fail(
        `❌ DATABASE_URL contains production indicator: ${indicator}\n` +
          "❌ Refusing to seed test users on production database.",
      );
    }
  }

  const looksLikeDev = DEV_DB_URL_MARKERS.some((id) =>
    dbLower.includes(id.toLowerCase()),
  );
  if (!looksLikeDev) {
    const host = dbUrl.split("@")[1]?.split("/")[0] ?? "(unknown)";
    fail(
      "❌ DATABASE_URL doesn't look like dev DB.\n" +
        `   URL host: ${host}\n` +
        "   Set SEED_ALLOW_PRODUCTION=true to override (NOT RECOMMENDED)",
    );
  }
}

async function assertSafeDatabase() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const confirmedDev = isConfirmedDevDatabase(dbUrl);

  const [totalUsers, nonTestUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: { email: { not: { endsWith: TEST_EMAIL_SUFFIX } } },
    }),
  ]);

  if (!confirmedDev) {
    if (nonTestUsers > MAX_USERS_FOR_DEV_SEED) {
      fail(
        `❌ Database has ${nonTestUsers} non-test users (limit ${MAX_USERS_FOR_DEV_SEED}).\n` +
          "❌ DATABASE_URL is not the known dev Neon host. Refusing to seed.",
      );
    }

    if (totalUsers > MAX_USERS_FOR_DEV_SEED) {
      fail(
        `❌ Database has ${totalUsers} users (limit ${MAX_USERS_FOR_DEV_SEED}).\n` +
          "❌ This looks like production. Refusing to seed test users.",
      );
    }
  }

  if (nonTestUsers > 0) {
    console.log(
      `ℹ️  ${nonTestUsers} non-${TEST_EMAIL_SUFFIX} user(s) present — they will not be deleted.`,
    );
    console.log(
      "   CLAUDE challenge startsAt will be updated for all users on this DB.",
    );
  }
}

const STUDENT_USERS = [
  { firstName: "Priya", lastName: "Sharma", college: "IIT Bombay", graduationYear: 2027 },
  { firstName: "Arjun", lastName: "Patel", college: "BITS Pilani", graduationYear: 2026 },
  { firstName: "Sneha", lastName: "Reddy", college: "NIT Trichy", graduationYear: 2028 },
  { firstName: "Vikram", lastName: "Singh", college: "IIIT Hyderabad", graduationYear: 2027 },
  { firstName: "Ananya", lastName: "Gupta", college: "VIT Vellore", graduationYear: 2026 },
  { firstName: "Rohit", lastName: "Kumar", college: "Delhi Technological University", graduationYear: 2027 },
  { firstName: "Kavya", lastName: "Iyer", college: "PES University", graduationYear: 2026 },
  { firstName: "Aditya", lastName: "Joshi", college: "IIT Madras", graduationYear: 2028 },
  { firstName: "Riya", lastName: "Mehta", college: "Manipal Institute", graduationYear: 2027 },
] as const;

/** Dev logins: {name}@abtalks.dev / password "test" */
const TEAM_USERS = [
  "anil",
  "rudra",
  "shallika",
  "sohail",
  "suyash",
  "prashant",
  "suman",
  "aditi",
  "harshita",
  "priyanshi",
  "sarthak",
  "shivansh",
  "shrishti",
  "swarit",
] as const;

const DEV_TEST_PASSWORD = "test";
const COMPLETED_TEST_EMAIL = `claude.completed60${TEST_EMAIL_SUFFIX}`;

const PROFESSIONAL_USERS = [
  { firstName: "Karan", lastName: "Verma", organization: "Tata Consultancy Services", role: "Software Engineer", yearsExperience: 3 },
  { firstName: "Megha", lastName: "Bansal", organization: "Infosys", role: "Business Analyst", yearsExperience: 5 },
  { firstName: "Rahul", lastName: "Desai", organization: "Wipro", role: "Product Manager", yearsExperience: 7 },
  { firstName: "Pooja", lastName: "Nair", organization: "Accenture", role: "Scrum Master", yearsExperience: 4 },
  { firstName: "Suresh", lastName: "Rao", organization: "HCL Technologies", role: "Solutions Architect", yearsExperience: 10 },
  { firstName: "Nikita", lastName: "Khanna", organization: "Cognizant", role: "Data Analyst", yearsExperience: 2 },
] as const;

const PROGRESS_PATTERNS = {
  PERFECT: { name: "perfect", description: "10 days all ON_TIME, current streak 10" },
  STRONG: { name: "strong", description: "Mix of 8 ON_TIME + 1 LATE, current streak 8" },
  BROKEN: { name: "broken", description: "5 ON_TIME, gaps (no submission), 1 LATE — broken streak" },
  STRUGGLING: { name: "struggling", description: "3 submissions, several missed days" },
  NEW: { name: "new", description: "Just enrolled, 1-2 submissions" },
} as const;

type SubmissionSeed = {
  dayNumber: number;
  status: SubmissionStatus;
  submittedAt: Date;
};

function challengeStartDaysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayDate(startDate: Date, dayNumber: number, hourOffset = 20): Date {
  const d = new Date(startDate);
  d.setDate(d.getDate() + dayNumber - 1);
  d.setHours(hourOffset, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

function generateSubmissions(
  pattern: string,
  startDate: Date,
): SubmissionSeed[] {
  const submissions: SubmissionSeed[] = [];

  switch (pattern) {
    case "perfect":
      for (let day = 1; day <= 10; day++) {
        submissions.push({
          dayNumber: day,
          status: SubmissionStatus.ON_TIME,
          submittedAt: dayDate(startDate, day, 20),
        });
      }
      break;

    case "strong":
      for (let day = 1; day <= 9; day++) {
        submissions.push({
          dayNumber: day,
          status: day === 5 ? SubmissionStatus.LATE : SubmissionStatus.ON_TIME,
          submittedAt: dayDate(startDate, day, day === 5 ? 23 : 20),
        });
      }
      break;

    case "broken":
      submissions.push(
        { dayNumber: 1, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 1) },
        { dayNumber: 2, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 2) },
        { dayNumber: 3, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 3) },
        { dayNumber: 5, status: SubmissionStatus.LATE, submittedAt: dayDate(startDate, 5, 23) },
        { dayNumber: 6, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 6) },
        { dayNumber: 8, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 8) },
        { dayNumber: 9, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 9) },
      );
      break;

    case "struggling":
      submissions.push(
        { dayNumber: 1, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 1) },
        { dayNumber: 4, status: SubmissionStatus.LATE, submittedAt: dayDate(startDate, 4, 23) },
        { dayNumber: 7, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 7) },
      );
      break;

    case "new":
      submissions.push(
        { dayNumber: 1, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 1) },
        { dayNumber: 2, status: SubmissionStatus.ON_TIME, submittedAt: dayDate(startDate, 2) },
      );
      break;

    default:
      throw new Error(`Unknown progress pattern: ${pattern}`);
  }

  return submissions;
}

function generateCompletedSixtyDaySubmissions(startDate: Date): SubmissionSeed[] {
  const submissions: SubmissionSeed[] = [];
  for (let day = 1; day <= 60; day++) {
    submissions.push({
      dayNumber: day,
      status: SubmissionStatus.ON_TIME,
      submittedAt: dayDate(startDate, day, 20),
    });
  }
  return submissions;
}

async function seedClaudeTestUsers() {
  console.log("🌱 Starting CLAUDE test users seed...");

  assertNotProduction();
  await assertSafeDatabase();

  const claudeChallenge = await prisma.challenge.findUnique({
    where: { domain: Domain.CLAUDE },
  });

  if (!claudeChallenge) {
    fail("❌ CLAUDE challenge not found. Run db:seed:content first.");
  }

  const tenDaysAgo = challengeStartDaysAgo(10);

  await prisma.challenge.update({
    where: { id: claudeChallenge.id },
    data: { startsAt: tenDaysAgo },
  });

  console.log(
    `✅ CLAUDE challenge startsAt set to: ${tenDaysAgo.toISOString().split("T")[0]}`,
  );
  console.log("   This makes dev DB show active dashboard view for CLAUDE users.");
  console.log("   Production CLAUDE remains starts June 1, 2026.");

  const dailyTasks = await prisma.dailyTask.findMany({
    where: { challengeId: claudeChallenge.id },
    select: { id: true, dayNumber: true },
  });
  const taskIdByDay = new Map(dailyTasks.map((t) => [t.dayNumber, t.id]));

  console.log(`🧹 Cleaning existing ${TEST_EMAIL_SUFFIX} test users...`);

  const existingTestUsers = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true, email: true },
  });

  const unexpectedEmails = existingTestUsers.filter(
    (u) => !u.email.endsWith(TEST_EMAIL_SUFFIX),
  );
  if (unexpectedEmails.length > 0) {
    fail(
      "❌ Internal error: test user query returned non-test emails. Aborting.",
    );
  }

  if (existingTestUsers.length > 0) {
    const result = await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    });
    console.log(`   Cleaned ${result.count} existing test users`);
  }

  console.log("👥 Creating student test users...");

  const studentUsers = [];
  for (let i = 0; i < STUDENT_USERS.length; i++) {
    const student = STUDENT_USERS[i]!;
    const email = `${student.firstName.toLowerCase()}.${student.lastName.toLowerCase()}${TEST_EMAIL_SUFFIX}`;

    const user = await prisma.user.create({
      data: {
        email,
        name: `${student.firstName} ${student.lastName}`,
        emailVerified: new Date(),
        candidateProfile: {
          create: {
            fullName: `${student.firstName} ${student.lastName}`,
            phone: `+91${9000000000 + i}`,
            primaryPersona: CandidatePersona.STUDENT,
            linkedinUrl: `https://linkedin.com/in/${student.firstName.toLowerCase()}-${student.lastName.toLowerCase()}-test`,
            githubUsername: `${student.firstName.toLowerCase()}${student.lastName.toLowerCase()}`,
            referralCode: `TEST${i.toString().padStart(3, "0")}`,
            isReadyForInterview: i % 3 === 0,
          },
        },
      },
    });

    studentUsers.push(user);
  }

  console.log(`   Created ${studentUsers.length} student test users`);

  console.log("👔 Creating professional test users...");

  const professionalUsers = [];
  for (let i = 0; i < PROFESSIONAL_USERS.length; i++) {
    const pro = PROFESSIONAL_USERS[i]!;
    const email = `${pro.firstName.toLowerCase()}.${pro.lastName.toLowerCase()}${TEST_EMAIL_SUFFIX}`;

    const user = await prisma.user.create({
      data: {
        email,
        name: `${pro.firstName} ${pro.lastName}`,
        emailVerified: new Date(),
        candidateProfile: {
          create: {
            fullName: `${pro.firstName} ${pro.lastName}`,
            phone: `+91${9100000000 + i}`,
            primaryPersona: CandidatePersona.PROFESSIONAL,
            linkedinUrl: `https://linkedin.com/in/${pro.firstName.toLowerCase()}-${pro.lastName.toLowerCase()}-test`,
            githubUsername: `${pro.firstName.toLowerCase()}${pro.lastName.toLowerCase()}`,
            referralCode: `PRO${i.toString().padStart(3, "0")}`,
            isReadyForInterview: false,
          },
        },
      },
    });

    professionalUsers.push(user);
  }

  console.log(`   Created ${professionalUsers.length} professional test users`);

  console.log("👤 Creating team test users (password: test)...");

  const teamUsers = [];
  for (let i = 0; i < TEAM_USERS.length; i++) {
    const slug = TEAM_USERS[i]!;
    const displayName = slug.charAt(0).toUpperCase() + slug.slice(1);
    const email = `${slug}${TEST_EMAIL_SUFFIX}`;

    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(DEV_TEST_PASSWORD),
        name: displayName,
        emailVerified: new Date(),
        candidateProfile: {
          create: {
            fullName: displayName,
            phone: `+91${9200000000 + i}`,
            primaryPersona: CandidatePersona.STUDENT,
            linkedinUrl: `https://linkedin.com/in/${slug}-abtalks`,
            githubUsername: slug,
            referralCode: `TEAM${i.toString().padStart(3, "0")}`,
            isReadyForInterview: false,
          },
        },
      },
    });

    teamUsers.push(user);
    console.log(`   ${email} (${displayName})`);
  }

  console.log(`   Created ${teamUsers.length} team test users`);

  console.log("📊 Creating enrollments with varied progress patterns...");

  const allUsers = [...studentUsers, ...professionalUsers, ...teamUsers];
  const patterns = Object.values(PROGRESS_PATTERNS);
  const challengeAnchor = { startsAt: tenDaysAgo };

  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i]!;
    const pattern = patterns[i % patterns.length]!;

    const submissions = generateSubmissions(pattern.name, tenDaysAgo);
    const handle = await seedChallengeProgress({
      userId: user.id,
      startedAt: tenDaysAgo,
      status: EnrollmentStatus.ACTIVE,
      submissions,
      taskIdByDay,
    });

    const daysCompleted = submissions.length;
    const lastSubmittedDay =
      submissions.length > 0
        ? Math.max(...submissions.map((s) => s.dayNumber))
        : null;

    const statsEndDay =
      lastSubmittedDay ??
      getCurrentDayNumber({ startedAt: tenDaysAgo }, challengeAnchor);
    const { currentStreak, longestStreak } = await computeStreakStats(prisma, {
      enrollmentId: handle,
      endDay: statsEndDay,
    });

    await prisma.programEnrollment.update({
      where: { id: peIdForEnrollment(handle) },
      data: {
        trackCurrentStreak: currentStreak,
        trackLongestStreak: longestStreak,
      },
    });

    console.log(
      `   ${user.name} (${pattern.name}): ${daysCompleted} days, streak ${currentStreak}`,
    );
  }

  console.log("🏁 Creating one completed 60-day CLAUDE test user...");

  const completedStartDate = challengeStartDaysAgo(60);
  const completedUser = await prisma.user.create({
    data: {
      email: COMPLETED_TEST_EMAIL,
      password: await hashPassword(DEV_TEST_PASSWORD),
      name: "Claude Completed 60",
      emailVerified: new Date(),
      candidateProfile: {
        create: {
          fullName: "Claude Completed 60",
          phone: "+919299999999",
          primaryPersona: CandidatePersona.STUDENT,
          linkedinUrl: "https://linkedin.com/in/claude-completed-60",
          githubUsername: "claudecompleted60",
          referralCode: "TEAM060",
          isReadyForInterview: true,
        },
      },
    },
  });

  const completedSubs = generateCompletedSixtyDaySubmissions(completedStartDate);
  const completedHandle = await seedChallengeProgress({
    userId: completedUser.id,
    startedAt: completedStartDate,
    status: EnrollmentStatus.COMPLETED,
    completedAt: dayDate(completedStartDate, 60, 20),
    submissions: completedSubs,
    taskIdByDay,
  });
  await prisma.programEnrollment.update({
    where: { id: peIdForEnrollment(completedHandle) },
    data: {
      trackCurrentStreak: 60,
      trackLongestStreak: 60,
    },
  });

  console.log(`   ${COMPLETED_TEST_EMAIL} / ${DEV_TEST_PASSWORD} (60/60 completed)`);

  console.log("");
  console.log("✅ CLAUDE test seed complete!");
  console.log(
    `   ${studentUsers.length} students, ${professionalUsers.length} professionals, ${teamUsers.length} team (password: ${DEV_TEST_PASSWORD})`,
  );
  console.log(`   All emails ${TEST_EMAIL_SUFFIX}`);
  console.log(`   Challenge startsAt: ${tenDaysAgo.toISOString().split("T")[0]}`);
  console.log("");
  console.log(
    `To clean up: re-run this script (it removes existing ${TEST_EMAIL_SUFFIX} users first)`,
  );
}

seedClaudeTestUsers()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
