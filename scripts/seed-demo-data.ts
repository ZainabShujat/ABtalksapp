/**
 * LOCAL-ONLY demo data for browser-testing T-241 and T-242.
 *
 * T-241 — proven vs self-declared skills and evidence ranking.
 * T-242 — recruiter analytics and recruiter/workspace isolation.
 *
 * Everything written here is namespaced to `@demo.abtalks.dev`, so this never
 * touches data that was already in the database. Re-running is a no-op on
 * anything already present: every write is an upsert on a natural key, and the
 * few child tables that have no natural key are keyed on a deterministic
 * `sourceId` / `githubUrl` / composite unique instead.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-data.ts
 *   npx tsx scripts/seed-demo-data.ts --reset     (delete demo data, then reseed)
 *   npx tsx scripts/seed-demo-data.ts --reset-only
 *
 * --reset is EXPLICIT and only ever deletes users whose email ends in the demo
 * suffix, plus the rows that cascade off them. It never deletes anything else.
 *
 * Refuses to run against the known production hosts, the same guard
 * prisma/seed-demo-recruiter.ts and prisma/seed-hire-fixtures.ts use.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CANDIDATES ARE SHAPED THE WAY THEY ARE
 *
 * There are two *different* evidence systems in this codebase and T-241's
 * ranking only reads one of them:
 *
 *   1. `SkillEvidence` / `CandidateSkill.evidenceScore` — the T-220 evidence
 *      model. It has NO live writer (`repositories/skill-evidence.ts`
 *      `emitSkillEvidence` is a documented no-op stub), and nothing under
 *      `src/features/hire/` reads `candidateSkill` at all. It feeds the
 *      candidate profile's evidence section, NOT Scout ranking.
 *
 *   2. The dossier provenance model (`features/hire/dossier-provenance.ts`).
 *      This is what ranks. `score-candidate.ts` `tierFor()` gates STRONG on
 *      `missionsPassed > 0`, and `profile-dossier.ts` hardcodes
 *      `missionsPassed: verified(0)` for profile-only candidates — so a
 *      candidate with no platform track record can never exceed PARTIAL no
 *      matter what they declare.
 *
 * So Candidate A carries BOTH: real `SkillEvidence` rows (so the profile
 * evidence surface and the "Verified" label have something true to show) and a
 * real 60-day-challenge enrollment with submissions (so Scout can actually rank
 * A above B). Candidate B is identical in every declared respect and has
 * neither. That is the only difference between them, which is what makes the
 * A-vs-B comparison meaningful rather than incidental.
 * ---------------------------------------------------------------------------
 */
import { createRequire } from "node:module";
import Module from "node:module";
import { config } from "dotenv";
import {
  Role,
  Domain,
  EnrollmentStatusV2,
  AttemptStatus,
  AttemptLateness,
  EvaluatorType,
  ActivityType,
  ActivityUnlockRule,
  CohortStartMode,
  CohortStatus,
  ProgramVersionStatus,
  EvidenceSourceType,
  SkillProficiency,
  TalentRequestStatus,
  TalentMatchTier,
  TalentMatchDecision,
  TalentCandidateSource,
  TalentSeniority,
  JobStatus,
  JobApplicationStatus,
  PipelineStage,
  OutreachAuthor,
  AssessmentAssignmentStatus,
  RecruiterAssessmentStatus,
  OpportunityType,
} from "@prisma/client";

/**
 * `ensureRecruiterWorkspace` is `server-only`. The same neutralizer
 * prisma/seed-demo-recruiter.ts uses, so the real application provisioner can
 * be reused here instead of hand-rolling Organization + OrganizationMember +
 * credit rows (which would drift from the real one the moment it changes).
 */
function neutralizeServerOnly(): void {
  const require = createRequire(import.meta.url);
  try {
    const serverOnlyPath = require.resolve("server-only");
    require.cache[serverOnlyPath] = {
      id: serverOnlyPath,
      filename: serverOnlyPath,
      loaded: true,
      exports: {},
    } as NodeModule;
  } catch {
    // keep fallback
  }
  const mod = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = mod._load;
  mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
}

neutralizeServerOnly();

config({ path: ".env.local" });
config();

// Loaded AFTER neutralizeServerOnly(), so `provision-recruiter`'s
// `import "server-only"` resolves to the stub. Static imports would be hoisted
// above the neutralizer and throw; tsx emits CJS here, so top-level await is
// not available either. `require` is what is left, and it is synchronous.
const seedRequire = createRequire(import.meta.url);
const { prisma } = seedRequire("../src/lib/db") as typeof import("../src/lib/db");
const { ensureRecruiterWorkspace } = seedRequire(
  "../src/features/hire/provision-recruiter",
) as typeof import("../src/features/hire/provision-recruiter");
// The only permitted writer for TalentListItem (T-240), and the one that puts
// rows on the reserved list the board actually reads.
const { addToPipeline } = seedRequire(
  "../src/repositories/talent-pipeline",
) as typeof import("../src/repositories/talent-pipeline");
const {
  activityIdForDailyTask,
  attemptIdForSubmission,
  cohortSlugForDomain,
  peIdForEnrollment,
} = seedRequire("../src/repositories/ids") as typeof import("../src/repositories/ids");

const PRODUCTION_DB_HOST_IDS = ["ep-nameless-term-ams9a5e3", ".main."] as const;
const SUFFIX = "@demo.abtalks.dev";

function assertNotProductionDb(): void {
  const url = process.env.DATABASE_URL ?? "";
  for (const id of PRODUCTION_DB_HOST_IDS) {
    if (url.includes(id)) {
      throw new Error(
        `Refusing to seed: DATABASE_URL looks like production (${id}). Use a Neon branch.`,
      );
    }
  }
}

function endpoint(): string {
  return (process.env.DATABASE_URL ?? "").match(/ep-[a-z0-9-]+/)?.[0] ?? "unknown";
}

/** Fixed clock so re-runs produce identical rows. */
const T0 = new Date("2026-08-01T00:00:00.000Z");
function daysAfter(n: number): Date {
  const d = new Date(T0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/* ========================================================================== */
/* skills                                                                      */
/* ========================================================================== */

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const skillIdCache = new Map<string, string>();

/** Upsert on `Skill.slug`, the model's own unique key. Reuses any existing row. */
async function skillId(name: string): Promise<string> {
  const slug = slugify(name);
  const cached = skillIdCache.get(slug);
  if (cached) return cached;
  const row = await prisma.skill.upsert({
    where: { slug },
    create: { slug, name },
    update: {},
    select: { id: true },
  });
  skillIdCache.set(slug, row.id);
  return row.id;
}

/* ========================================================================== */
/* candidate fixtures                                                          */
/* ========================================================================== */

type EvidenceSpec = {
  skill: string;
  sourceType: EvidenceSourceType;
  /** Stable idempotency key; becomes `SkillEvidence.sourceId`. */
  sourceKey: string;
  sourceLabel: string;
  score?: number;
  maxScore?: number;
  weight?: number;
  dayOffset: number;
};

type CandidateSpec = {
  key: string;
  name: string;
  headline: string;
  city: string;
  skills: string[];
  /** Whole years; drives CandidateExperience.totalMonths. */
  years: number;
  degree: string;
  institution: string;
  graduationYear: number;
  evidence: EvidenceSpec[];
  /**
   * A 60-day-challenge enrollment with this many submissions, or null.
   * This is what makes a candidate rankable above PARTIAL — see the header.
   */
  challenge: { domain: Domain; submissions: number; streak: number } | null;
  note: string;
};

const CANDIDATES: CandidateSpec[] = [
  {
    key: "a",
    name: "Aarav Menon",
    headline: "Backend Engineer",
    city: "Pune",
    skills: ["Python", "Django", "PostgreSQL", "Docker"],
    years: 3,
    degree: "B.E. Computer Science",
    institution: "Pune Institute of Technology",
    graduationYear: 2023,
    evidence: [
      {
        skill: "Python",
        sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
        sourceKey: "demo-a-python-assessment",
        sourceLabel: "Python Backend Assessment",
        score: 88,
        maxScore: 100,
        weight: 3,
        dayOffset: 20,
      },
      {
        skill: "Python",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-a-python-activity",
        sourceLabel: "60-Day Challenge — graded mission",
        score: 92,
        maxScore: 100,
        weight: 3,
        dayOffset: 40,
      },
      {
        skill: "Django",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-a-django-activity",
        sourceLabel: "60-Day Challenge — graded mission",
        score: 84,
        maxScore: 100,
        weight: 2,
        dayOffset: 44,
      },
    ],
    challenge: { domain: Domain.SE, submissions: 52, streak: 21 },
    note: "PROVEN Python — evidence + real challenge track record.",
  },
  {
    key: "b",
    name: "Brinda Kapoor",
    headline: "Backend Engineer",
    city: "Pune",
    // Deliberately identical to A: same stack, same order, same length.
    skills: ["Python", "Django", "PostgreSQL", "Docker"],
    years: 3,
    degree: "B.E. Computer Science",
    institution: "Pune Institute of Technology",
    graduationYear: 2023,
    evidence: [],
    challenge: null,
    note: "SELF-DECLARED Python — the A/B control. No evidence, no track record.",
  },
  {
    key: "c",
    name: "Chetan Rao",
    headline: "Python Developer",
    city: "Nagpur",
    skills: ["Python", "Flask"],
    years: 2,
    degree: "B.Sc. Computer Science",
    institution: "Nagpur University",
    graduationYear: 2024,
    evidence: [],
    challenge: null,
    note: "ZERO evidence overall — must still be discoverable in a Python search.",
  },
  {
    key: "d",
    name: "Divya Nair",
    headline: "Frontend Engineer",
    city: "Bengaluru",
    skills: ["React", "TypeScript", "CSS"],
    years: 4,
    degree: "B.Tech Information Technology",
    institution: "RV College of Engineering",
    graduationYear: 2022,
    evidence: [
      {
        skill: "React",
        sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
        sourceKey: "demo-d-react-assessment",
        sourceLabel: "React Component Assessment",
        score: 90,
        maxScore: 100,
        weight: 3,
        dayOffset: 18,
      },
      {
        skill: "TypeScript",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-d-ts-activity",
        sourceLabel: "60-Day Challenge — graded mission",
        score: 86,
        maxScore: 100,
        weight: 2,
        dayOffset: 38,
      },
    ],
    challenge: { domain: Domain.SE, submissions: 48, streak: 17 },
    note: "Evidence on a DIFFERENT skill — proves evidence is not Python-only.",
  },
  {
    key: "e",
    name: "Eshan Gupta",
    headline: "Java Backend Engineer",
    city: "Hyderabad",
    skills: ["Java", "Spring Boot", "MySQL"],
    years: 5,
    degree: "M.Tech Software Engineering",
    institution: "IIIT Hyderabad",
    graduationYear: 2021,
    evidence: [],
    challenge: null,
    note: "Declared-only, different stack — pool filler / negative control.",
  },
  {
    key: "f",
    name: "Farah Sheikh",
    headline: "Python Data Engineer",
    city: "Mumbai",
    skills: ["Python", "SQL", "Airflow", "Spark"],
    years: 4,
    degree: "B.E. Information Technology",
    institution: "VJTI Mumbai",
    graduationYear: 2022,
    evidence: [
      {
        skill: "Python",
        sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
        sourceKey: "demo-f-python-assessment",
        sourceLabel: "Data Engineering Assessment",
        score: 79,
        maxScore: 100,
        weight: 2,
        dayOffset: 25,
      },
    ],
    challenge: { domain: Domain.DS, submissions: 31, streak: 11 },
    note: "Evidence-backed Python, weaker than A — gives the ranking a middle.",
  },
  {
    key: "g",
    name: "Gaurav Iyer",
    headline: "Analytics Engineer",
    city: "Chennai",
    skills: ["SQL", "dbt", "Python"],
    years: 3,
    degree: "B.Sc. Statistics",
    institution: "Loyola College",
    graduationYear: 2023,
    evidence: [],
    challenge: null,
    note: "Declared-only Python as a secondary skill.",
  },
  {
    key: "h",
    name: "Hina Desai",
    headline: "Full-stack Developer",
    city: "Ahmedabad",
    skills: ["TypeScript", "React", "Node.js"],
    years: 2,
    degree: "B.E. Computer Engineering",
    institution: "Nirma University",
    graduationYear: 2024,
    evidence: [],
    challenge: null,
    note: "Zero evidence, overlaps D's stack — D should outrank on a React search.",
  },
  {
    key: "i",
    name: "Ishan Bose",
    headline: "Machine Learning Engineer",
    city: "Kolkata",
    skills: ["Python", "PyTorch", "NumPy"],
    years: 5,
    degree: "M.Sc. Computer Science",
    institution: "Jadavpur University",
    graduationYear: 2020,
    evidence: [
      {
        skill: "Python",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-i-python-activity",
        sourceLabel: "AI Challenge — graded mission",
        score: 94,
        maxScore: 100,
        weight: 3,
        dayOffset: 35,
      },
      {
        skill: "PyTorch",
        sourceType: EvidenceSourceType.CREDENTIAL,
        sourceKey: "demo-i-pytorch-credential",
        sourceLabel: "ABTalks AI Challenge Certificate",
        weight: 2,
        dayOffset: 50,
      },
    ],
    challenge: { domain: Domain.AI, submissions: 57, streak: 28 },
    note: "Strongest overall evidence — senior Python, tops an unfiltered search.",
  },
  {
    key: "j",
    name: "Juhi Malhotra",
    headline: "Platform Engineer",
    city: "Gurugram",
    skills: ["Go", "Kubernetes", "Terraform"],
    years: 6,
    degree: "B.Tech Computer Science",
    institution: "Delhi Technological University",
    graduationYear: 2019,
    evidence: [],
    challenge: null,
    note: "Declared-only, unrelated stack — should NOT appear in a Python search.",
  },
  {
    key: "k",
    name: "Karan Johar",
    headline: "Full Stack Engineer",
    city: "Bengaluru",
    skills: ["Next.js", "React", "Node.js", "PostgreSQL", "Tailwind CSS"],
    years: 4,
    degree: "B.Tech Information Science",
    institution: "BMS College of Engineering",
    graduationYear: 2022,
    evidence: [
      {
        skill: "Next.js",
        sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
        sourceKey: "demo-k-nextjs-assessment",
        sourceLabel: "Next.js Architecture Assessment",
        score: 95,
        maxScore: 100,
        weight: 3,
        dayOffset: 15,
      },
      {
        skill: "React",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-k-react-activity",
        sourceLabel: "60-Day Challenge — full-stack mission",
        score: 91,
        maxScore: 100,
        weight: 2,
        dayOffset: 32,
      },
    ],
    challenge: { domain: Domain.SE, submissions: 55, streak: 25 },
    note: "Evidence-backed Next.js and React full-stack expert.",
  },
  {
    key: "l",
    name: "Lavanya Reddy",
    headline: "Cloud & DevOps Specialist",
    city: "Hyderabad",
    skills: ["AWS", "Docker", "Kubernetes", "Python", "CI/CD"],
    years: 5,
    degree: "B.Tech Computer Engineering",
    institution: "Osmania University",
    graduationYear: 2021,
    evidence: [
      {
        skill: "AWS",
        sourceType: EvidenceSourceType.CREDENTIAL,
        sourceKey: "demo-l-aws-credential",
        sourceLabel: "ABTalks Cloud Architect Certificate",
        weight: 3,
        dayOffset: 45,
      },
      {
        skill: "Docker",
        sourceType: EvidenceSourceType.ASSESSMENT_SCORE,
        sourceKey: "demo-l-docker-assessment",
        sourceLabel: "Containerization & DevOps Assessment",
        score: 89,
        maxScore: 100,
        weight: 2,
        dayOffset: 22,
      },
    ],
    challenge: { domain: Domain.SE, submissions: 51, streak: 20 },
    note: "Proven AWS & Docker DevOps specialist with high challenge submissions.",
  },
  {
    key: "m",
    name: "Manish Tiwari",
    headline: "Junior Python & FastAPI Developer",
    city: "Noida",
    skills: ["Python", "FastAPI", "MongoDB", "Redis"],
    years: 1,
    degree: "BCA",
    institution: "Amity University",
    graduationYear: 2025,
    evidence: [],
    challenge: null,
    note: "Entry-level fresher with declared FastAPI/Python stack.",
  },
  {
    key: "n",
    name: "Neha Sharma",
    headline: "Data Scientist & AI Researcher",
    city: "Bengaluru",
    skills: ["Python", "TensorFlow", "Pandas", "Scikit-Learn", "Machine Learning"],
    years: 3,
    degree: "M.Tech Data Science",
    institution: "PES University",
    graduationYear: 2023,
    evidence: [
      {
        skill: "Machine Learning",
        sourceType: EvidenceSourceType.ACTIVITY_EVALUATION,
        sourceKey: "demo-n-ml-activity",
        sourceLabel: "60-Day AI Challenge — graded model evaluation",
        score: 93,
        maxScore: 100,
        weight: 3,
        dayOffset: 28,
      },
    ],
    challenge: { domain: Domain.AI, submissions: 50, streak: 19 },
    note: "Proven Machine Learning/Data Science engineer.",
  },
];

function candidateEmail(key: string): string {
  return `candidate.${key}${SUFFIX}`;
}

/* ========================================================================== */
/* challenge scaffolding                                                       */
/* ========================================================================== */

/**
 * `Challenge.domain` is `@unique`, so this reuses whatever `npm run db:seed`
 * already created and only creates a domain that is missing. `DailyTask` is
 * upserted on its own `@@unique([challengeId, dayNumber])`.
 */
async function ensureChallenge(domain: Domain, days: number): Promise<string> {
  const challenge = await prisma.challenge.upsert({
    where: { domain },
    create: {
      domain,
      title: `${domain} Challenge`,
      description: `${domain} 60-day challenge.`,
      totalDays: 60,
    },
    update: {},
    select: { id: true },
  });

  const existing = await prisma.dailyTask.findMany({
    where: { challengeId: challenge.id, dayNumber: { lte: days } },
    select: { dayNumber: true },
  });
  const have = new Set(existing.map((t) => t.dayNumber));

  for (let day = 1; day <= days; day++) {
    if (have.has(day)) continue;
    await prisma.dailyTask.create({
      data: {
        challengeId: challenge.id,
        dayNumber: day,
        domain,
        title: `Day ${day}`,
        problemStatement: `Demo task for day ${day}.`,
        difficulty: "MEDIUM",
        estimatedMinutes: 60,
        linkedinTemplate: `Day ${day} of the ABTalks challenge.`,
      },
    });
  }

  const slug = cohortSlugForDomain(domain);
  let cohort = await prisma.cohort.findUnique({
    where: { slug },
    select: { id: true, programVersionId: true },
  });
  if (!cohort) {
    let category = await prisma.programCategory.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!category) {
      category = await prisma.programCategory.upsert({
        where: { slug: "engineering" },
        create: {
          slug: "engineering",
          name: "Engineering",
        },
        update: {},
        select: { id: true },
      });
    }
    const program = await prisma.learningProgram.upsert({
      where: { slug },
      create: {
        slug,
        title: `${domain} Challenge`,
        description: `${domain} 60-day challenge.`,
        categoryId: category.id,
      },
      update: {},
      select: { id: true },
    });
    const version = await prisma.programVersion.upsert({
      where: {
        programId_versionNumber: { programId: program.id, versionNumber: 1 },
      },
      create: {
        programId: program.id,
        versionNumber: 1,
        status: ProgramVersionStatus.PUBLISHED,
        plannedDurationDays: 60,
      },
      update: {},
      select: { id: true },
    });
    cohort = await prisma.cohort.upsert({
      where: { slug },
      create: {
        programVersionId: version.id,
        slug,
        name: `${domain} Challenge`,
        startMode: CohortStartMode.ROLLING,
        timezone: "Asia/Kolkata",
        status: CohortStatus.ACTIVE,
      },
      update: {},
      select: { id: true, programVersionId: true },
    });
  }

  const module = await prisma.module.upsert({
    where: {
      programVersionId_position: {
        programVersionId: cohort.programVersionId,
        position: 1,
      },
    },
    create: {
      programVersionId: cohort.programVersionId,
      position: 1,
      title: "Missions",
      startDay: 1,
      endDay: 60,
    },
    update: {},
    select: { id: true },
  });

  const allTasks = await prisma.dailyTask.findMany({
    where: { challengeId: challenge.id, dayNumber: { lte: days } },
  });
  for (const task of allTasks) {
    const actId = activityIdForDailyTask(task.id);
    await prisma.activity.upsert({
      where: { id: actId },
      create: {
        id: actId,
        moduleId: module.id,
        position: task.dayNumber,
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
      update: {},
    });
  }

  return challenge.id;
}

/* ========================================================================== */
/* candidates                                                                  */
/* ========================================================================== */

async function seedCandidate(spec: CandidateSpec): Promise<string> {
  const email = candidateEmail(spec.key);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: spec.name,
      password: "test",
      role: Role.STUDENT,
      emailVerified: T0,
    },
    update: { name: spec.name, deletedAt: null, disabledAt: null },
    select: { id: true },
  });

  // The discovery gate (repositories/talent.ts searchableUserWhere): without
  // this row the candidate is invisible to every recruiter surface. The older
  // fixtures never wrote it, which is why so few candidates are viewable.
  await prisma.candidateVisibility.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      searchableByRecruiters: true,
      consentSource: "demo-seed",
      consentedAt: T0,
    },
    update: { searchableByRecruiters: true, withdrawnAt: null },
    select: { id: true },
  });

  await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: spec.name,
      headline: spec.headline,
      summary: `${spec.headline} with ${spec.years} years of experience.`,
      locationCity: spec.city,
      countryCode: "IN",
      githubUsername: `demo-${spec.key}`,
      linkedinUrl: `https://linkedin.com/in/demo-${spec.key}`,
      referralCode: `DEMO${spec.key.toUpperCase()}`,
    },
    update: { fullName: spec.name, headline: spec.headline, locationCity: spec.city },
    select: { id: true },
  });

  await prisma.candidatePreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      openToWork: true,
      preferredLocations: [spec.city],
      opportunityTypes: [OpportunityType.FULL_TIME],
      remotePreference: "HYBRID",
      noticePeriodDays: 30,
    },
    update: { openToWork: true },
    select: { id: true },
  });

  // Education / experience have no natural unique key, so they are keyed on
  // the demo-owned (userId, institutionName) and (userId, companyName) pair.
  const eduWhere = { userId: user.id, institutionName: spec.institution };
  if (!(await prisma.candidateEducation.findFirst({ where: eduWhere, select: { id: true } }))) {
    await prisma.candidateEducation.create({
      data: {
        userId: user.id,
        institutionName: spec.institution,
        degree: spec.degree,
        fieldOfStudy: "Computer Science",
        graduationYear: spec.graduationYear,
        startYear: spec.graduationYear - 4,
      },
    });
  }

  const company = "Demo Tech Pvt Ltd";
  const expWhere = { userId: user.id, companyName: company };
  if (!(await prisma.candidateExperience.findFirst({ where: expWhere, select: { id: true } }))) {
    const started = new Date(T0);
    started.setUTCFullYear(started.getUTCFullYear() - spec.years);
    await prisma.candidateExperience.create({
      data: {
        userId: user.id,
        companyName: company,
        title: spec.headline,
        startedOn: started,
        isCurrent: true,
        // The cached column "min years experience" compares against.
        totalMonths: spec.years * 12,
        locationCity: spec.city,
      },
    });
  }

  // Declared skills. This is what the recruiter-facing skill list reads
  // (repositories/talent.ts maps `p.skills.map(s => s.skill.name)`), and
  // `listProfileCandidates` requires at least one `claimedByCandidate: true`.
  for (const name of spec.skills) {
    const sid = await skillId(name);
    await prisma.candidateSkill.upsert({
      where: { userId_skillId: { userId: user.id, skillId: sid } },
      create: {
        userId: user.id,
        skillId: sid,
        claimedByCandidate: true,
        selfRated: SkillProficiency.ADVANCED,
      },
      update: { claimedByCandidate: true },
      select: { id: true },
    });
  }

  return user.id;
}

/**
 * Writes `SkillEvidence` directly and recomputes the `CandidateSkill` caches.
 *
 * `emitSkillEvidence` (repositories/skill-evidence.ts) is a no-op stub, so
 * there is no application writer to call. `prisma/scripts/migrate-2i-achievements.ts`
 * is the reference implementation this follows: append the evidence row on its
 * `@@unique([candidateSkillId, sourceType, sourceId])` key, then recompute
 * `evidenceScore` / `verified` / `evidenceCount` / `lastEvidenceAt` from the
 * rows, because those four columns are documented caches and nothing else
 * maintains them.
 */
async function seedEvidence(userId: string, specs: EvidenceSpec[]): Promise<void> {
  const touched = new Set<string>();

  for (const e of specs) {
    const sid = await skillId(e.skill);
    const cs = await prisma.candidateSkill.findUnique({
      where: { userId_skillId: { userId, skillId: sid } },
      select: { id: true },
    });
    if (!cs) continue;

    await prisma.skillEvidence.upsert({
      where: {
        candidateSkillId_sourceType_sourceId: {
          candidateSkillId: cs.id,
          sourceType: e.sourceType,
          sourceId: e.sourceKey,
        },
      },
      create: {
        candidateSkillId: cs.id,
        sourceType: e.sourceType,
        sourceId: e.sourceKey,
        sourceLabel: e.sourceLabel,
        score: e.score ?? null,
        maxScore: e.maxScore ?? null,
        weight: e.weight ?? 1,
        occurredAt: daysAfter(e.dayOffset),
      },
      update: { sourceLabel: e.sourceLabel, weight: e.weight ?? 1 },
      select: { id: true },
    });
    touched.add(cs.id);
  }

  for (const candidateSkillId of touched) {
    const rows = await prisma.skillEvidence.findMany({
      where: { candidateSkillId },
      select: { score: true, maxScore: true, weight: true, occurredAt: true },
    });
    if (rows.length === 0) continue;

    // Weighted mean of scored rows on a 0-100 scale. Unscored rows (a
    // credential, a passed mission) still count toward verified/count but
    // carry no percentage, so they cannot drag the mean.
    let weighted = 0;
    let weight = 0;
    for (const r of rows) {
      if (r.score != null && r.maxScore != null && r.maxScore > 0) {
        weighted += (r.score / r.maxScore) * 100 * r.weight;
        weight += r.weight;
      }
    }
    const score = weight > 0 ? Math.round(weighted / weight) : 0;
    const last = rows
      .map((r) => r.occurredAt)
      .sort((a, b) => b.getTime() - a.getTime())[0]!;

    await prisma.candidateSkill.update({
      where: { id: candidateSkillId },
      data: {
        evidenceScore: score,
        // "true when at least one non-SELF evidence row exists" — every source
        // type in EvidenceSourceType is non-self, so any row qualifies.
        verified: true,
        evidenceCount: rows.length,
        lastEvidenceAt: last,
      },
      select: { id: true },
    });
  }
}

/** The challenge track record that lets a candidate exceed PARTIAL. */
async function seedChallengeTrack(
  userId: string,
  spec: NonNullable<CandidateSpec["challenge"]>,
  key: string,
): Promise<void> {
  const challengeId = await ensureChallenge(spec.domain, spec.submissions);

  const slug = cohortSlugForDomain(spec.domain);
  const cohort = await prisma.cohort.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!cohort) {
    throw new Error(`Missing cohort ${slug}`);
  }

  const existingPe = await prisma.programEnrollment.findUnique({
    where: { userId_cohortId: { userId, cohortId: cohort.id } },
    select: { id: true },
  });
  const peId = existingPe?.id ?? peIdForEnrollment(userId);

  const enrollment = await prisma.programEnrollment.upsert({
    where: { id: peId },
    create: {
      id: peId,
      userId,
      cohortId: cohort.id,
      status: EnrollmentStatusV2.ACTIVE,
      startedAt: T0,
      enrolledAt: T0,
      joinedAt: T0,
      trackCurrentStreak: Math.min(spec.streak, 7),
      trackLongestStreak: spec.streak,
    },
    update: {
      trackCurrentStreak: Math.min(spec.streak, 7),
      trackLongestStreak: spec.streak,
    },
    select: { id: true },
  });

  const tasks = await prisma.dailyTask.findMany({
    where: { challengeId, dayNumber: { lte: spec.submissions } },
    select: { id: true, dayNumber: true },
  });
  const taskByDay = new Map(tasks.map((t) => [t.dayNumber, t.id]));

  const existingAttempts = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: enrollment.id,
      id: { startsWith: "aa_sub_" },
    },
    select: { activity: { select: { dayNumber: true } } },
  });
  const have = new Set(
    existingAttempts
      .map((a) => a.activity.dayNumber)
      .filter((d): d is number => d != null),
  );

  for (let day = 1; day <= spec.submissions; day++) {
    if (have.has(day)) continue;
    const dailyTaskId = taskByDay.get(day);
    if (!dailyTaskId) continue;
    const activityId = activityIdForDailyTask(dailyTaskId);
    const subId = `${key}-d${day}`;
    const attemptId = attemptIdForSubmission(subId);
    const submittedAt = daysAfter(day);

    await prisma.activityAttempt.upsert({
      where: { id: attemptId },
      create: {
        id: attemptId,
        enrollmentId: enrollment.id,
        activityId,
        attemptNumber: 1,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.ON_TIME,
        payload: {
          githubUrl: `https://github.com/demo-${key}/challenge/day-${day}`,
          linkedinUrl: `https://linkedin.com/posts/demo-${key}-day-${day}`,
          legacySubmissionId: subId,
        },
        passed: true,
        pointsAwarded: 10,
        startedAt: submittedAt,
        submittedAt,
      },
      update: {
        submittedAt,
        passed: true,
        status: AttemptStatus.EVALUATED,
        lateness: AttemptLateness.ON_TIME,
      },
    });

    await prisma.activityEvaluation.upsert({
      where: { id: `ev_sub_${subId}` },
      create: {
        id: `ev_sub_${subId}`,
        attemptId,
        evaluatorType: EvaluatorType.AUTO,
        passed: true,
        score: 100,
        maxScore: 100,
        isAuthoritative: true,
        createdAt: submittedAt,
      },
      update: { passed: true },
    });
  }
}

/* ========================================================================== */
/* recruiters                                                                  */
/* ========================================================================== */

type RecruiterSpec = {
  key: "a" | "b" | "c";
  name: string;
  company: string;
  jobs: number;
  projects: { name: string; title: string; stack: string[] }[];
  /** Candidate keys matched per project index. */
  matches: string[][];
  viewed: number;
  shortlisted: number;
  outreach: string[];
  applications: string[];
  assessments: { title: string; assigned: string[]; submitted: number }[];
  /**
   * Candidates on the hiring board, by stage. The SHORTLISTED entries are the
   * same people this recruiter shortlisted on a project, so the board and the
   * analytics "Shortlisted" tile agree instead of telling two stories.
   */
  pipeline: Partial<Record<PipelineStage, string[]>>;
};

const RECRUITERS: RecruiterSpec[] = [
  {
    key: "a",
    name: "Anita Raghavan",
    company: "Northwind Labs",
    jobs: 3,
    projects: [
      { name: "Senior Python Backend — Pune", title: "Backend Engineer", stack: ["Python", "Django"] },
      { name: "Frontend Hire — Bengaluru", title: "Frontend Engineer", stack: ["React", "TypeScript"] },
    ],
    matches: [
      ["a", "b", "c", "f"],
      ["d", "h"],
    ],
    viewed: 4,
    shortlisted: 2,
    outreach: ["a", "f"],
    applications: ["a", "b", "d"],
    assessments: [{ title: "Python Backend Screen", assigned: ["a", "b", "f"], submitted: 1 }],
    // SHORTLISTED mirrors the two candidates A shortlisted on her projects.
    pipeline: {
      SOURCED: ["c"],
      SHORTLISTED: ["a", "d"],
      CONTACTED: ["f"],
      SCREENING: ["b"],
      INTERVIEWING: ["h"],
    },
  },
  {
    key: "b",
    name: "Bhavesh Kulkarni",
    company: "Kestrel Systems",
    jobs: 1,
    projects: [
      { name: "Java Platform Role", title: "Java Backend Engineer", stack: ["Java", "Spring Boot"] },
    ],
    // Deliberately no overlap with A's shortlist, so isolation is obvious.
    matches: [["e", "j", "g"]],
    viewed: 1,
    shortlisted: 0,
    outreach: ["e"],
    applications: ["e"],
    assessments: [],
    // B is early: one sourced candidate, nothing advanced. Deliberately sparse
    // so the three boards do not look alike.
    pipeline: { SOURCED: ["e"] },
  },
  {
    key: "c",
    name: "Chandni Verma",
    company: "Vantage Analytics",
    jobs: 2,
    projects: [
      { name: "ML Engineer — Remote", title: "Machine Learning Engineer", stack: ["Python", "PyTorch"] },
      { name: "Data Engineering — Mumbai", title: "Data Engineer", stack: ["Python", "Spark"] },
      { name: "Analytics — Chennai", title: "Analytics Engineer", stack: ["SQL", "dbt"] },
    ],
    matches: [
      ["i", "f", "a"],
      ["f", "g", "c"],
      ["g", "b"],
    ],
    viewed: 6,
    shortlisted: 4,
    outreach: [],
    applications: [],
    assessments: [
      { title: "ML Fundamentals", assigned: ["i", "f", "a"], submitted: 2 },
      { title: "SQL Screen", assigned: ["g", "c"], submitted: 1 },
    ],
    // C is furthest along — the only board reaching OFFER and HIRED, and the
    // only one with a rejection.
    pipeline: {
      SHORTLISTED: ["i", "f"],
      CONTACTED: ["g"],
      SCREENING: ["c"],
      INTERVIEWING: ["a"],
      OFFER: ["b"],
      HIRED: ["d"],
      REJECTED: ["j"],
    },
  },
];

function recruiterEmail(key: string): string {
  return `recruiter.${key}${SUFFIX}`;
}

async function seedRecruiter(
  spec: RecruiterSpec,
  candidateIds: Map<string, string>,
): Promise<void> {
  const email = recruiterEmail(spec.key);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: spec.name,
      password: "test",
      role: Role.RECRUITER,
      emailVerified: T0,
    },
    update: { name: spec.name, role: Role.RECRUITER, deletedAt: null, disabledAt: null },
    select: { id: true },
  });

  await prisma.recruiterProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: spec.name,
      company: spec.company,
      approved: true,
      approvedAt: T0,
    },
    update: { company: spec.company, approved: true },
    select: { id: true },
  });

  // The real application provisioner: Organization, OrganizationMember and the
  // starting credit grant, exactly as a live registration would create them.
  const workspace = await ensureRecruiterWorkspace(user.id);
  if (!workspace) throw new Error(`workspace provisioning failed for ${email}`);

  /* jobs --------------------------------------------------------------- */
  const jobIds: string[] = [];
  for (let i = 1; i <= spec.jobs; i++) {
    const title = `${spec.company} Role ${i}`;
    const found = await prisma.job.findFirst({
      where: { recruiterId: user.id, title },
      select: { id: true },
    });
    if (found) {
      jobIds.push(found.id);
      continue;
    }
    const job = await prisma.job.create({
      data: {
        title,
        company: spec.company,
        location: "India",
        description: `Demo job ${i} for ${spec.company}.`,
        skills: spec.projects[0]?.stack ?? ["Python"],
        status: JobStatus.PUBLISHED,
        isOpen: true,
        recruiterId: user.id,
        publishedAt: T0,
      },
      select: { id: true },
    });
    jobIds.push(job.id);
  }

  /* projects (TalentRequest) + matches ---------------------------------- */
  let viewsLeft = spec.viewed;
  let shortlistsLeft = spec.shortlisted;

  for (let p = 0; p < spec.projects.length; p++) {
    const proj = spec.projects[p]!;
    let request = await prisma.talentRequest.findFirst({
      where: { recruiterUserId: user.id, name: proj.name },
      select: { id: true },
    });
    if (!request) {
      request = await prisma.talentRequest.create({
        data: {
          recruiterUserId: user.id,
          name: proj.name,
          title: proj.title,
          status: TalentRequestStatus.MATCHED,
          seniority: TalentSeniority.MID,
          mustHaveStack: proj.stack,
          minExperience: 2,
          maxExperience: 8,
          openings: 1,
        },
        select: { id: true },
      });
    }

    for (const ck of spec.matches[p] ?? []) {
      const candidateUserId = candidateIds.get(ck);
      if (!candidateUserId) continue;

      const viewed = viewsLeft > 0;
      const shortlisted = shortlistsLeft > 0;
      if (viewed) viewsLeft--;
      if (shortlisted) shortlistsLeft--;

      await prisma.talentRequestMatch.upsert({
        where: {
          requestId_candidateUserId: { requestId: request.id, candidateUserId },
        },
        create: {
          requestId: request.id,
          candidateUserId,
          score: 60 + ((ck.charCodeAt(0) * 7) % 35),
          tier: shortlisted ? TalentMatchTier.STRONG : TalentMatchTier.PARTIAL,
          scoreBreakdown: {},
          evidence: {},
          source: TalentCandidateSource.PROFILE,
          viewedAt: viewed ? daysAfter(10) : null,
          decision: shortlisted
            ? TalentMatchDecision.SHORTLISTED
            : TalentMatchDecision.UNDECIDED,
        },
        update: {
          viewedAt: viewed ? daysAfter(10) : null,
          decision: shortlisted
            ? TalentMatchDecision.SHORTLISTED
            : TalentMatchDecision.UNDECIDED,
        },
        select: { id: true },
      });
    }
  }

  /* applications -------------------------------------------------------- */
  for (const ck of spec.applications) {
    const candidateUserId = candidateIds.get(ck);
    const jobId = jobIds[0];
    if (!candidateUserId || !jobId) continue;
    await prisma.jobApplication.upsert({
      where: { userId_jobId: { userId: candidateUserId, jobId } },
      create: {
        userId: candidateUserId,
        jobId,
        status: JobApplicationStatus.APPLIED,
        note: "Demo application.",
      },
      update: {},
      select: { id: true },
    });
  }

  /* outreach ------------------------------------------------------------ */
  for (const ck of spec.outreach) {
    const candidateUserId = candidateIds.get(ck);
    if (!candidateUserId) continue;
    const thread = await prisma.outreachThread.upsert({
      where: {
        recruiterUserId_candidateUserId: {
          recruiterUserId: user.id,
          candidateUserId,
        },
      },
      create: {
        recruiterUserId: user.id,
        organizationId: workspace.organizationId,
        candidateUserId,
        subject: `${spec.company} — opportunity`,
        lastMessageAt: daysAfter(12),
        lastMessageBy: OutreachAuthor.RECRUITER,
      },
      update: {},
      select: { id: true },
    });
    await prisma.outreachMessage.upsert({
      where: {
        threadId_clientRequestId: {
          threadId: thread.id,
          clientRequestId: `demo-${spec.key}-${ck}-1`,
        },
      },
      create: {
        threadId: thread.id,
        author: OutreachAuthor.RECRUITER,
        authorUserId: user.id,
        body: `Hi — we are hiring at ${spec.company}. Interested?`,
        clientRequestId: `demo-${spec.key}-${ck}-1`,
        createdAt: daysAfter(12),
      },
      update: {},
      select: { id: true },
    });
  }

  /* assessments --------------------------------------------------------- */
  for (const a of spec.assessments) {
    let assessment = await prisma.recruiterAssessment.findFirst({
      where: { organizationId: workspace.organizationId, title: a.title },
      select: { id: true },
    });
    if (!assessment) {
      assessment = await prisma.recruiterAssessment.create({
        data: {
          organizationId: workspace.organizationId,
          createdByUserId: user.id,
          title: a.title,
          status: RecruiterAssessmentStatus.PUBLISHED,
          publishedAt: T0,
          durationMinutes: 45,
        },
        select: { id: true },
      });
    }

    for (let i = 0; i < a.assigned.length; i++) {
      const ck = a.assigned[i]!;
      const candidateUserId = candidateIds.get(ck);
      if (!candidateUserId) continue;
      const submitted = i < a.submitted;
      await prisma.recruiterAssessmentAssignment.upsert({
        where: {
          assessmentId_candidateUserId: {
            assessmentId: assessment.id,
            candidateUserId,
          },
        },
        create: {
          assessmentId: assessment.id,
          candidateUserId,
          candidateRef: `PROFILE:${candidateUserId}`,
          status: submitted
            ? AssessmentAssignmentStatus.SUBMITTED
            : AssessmentAssignmentStatus.ASSIGNED,
          assignedAt: daysAfter(14),
          startedAt: submitted ? daysAfter(15) : null,
          submittedAt: submitted ? daysAfter(15) : null,
          scorePercent: submitted ? 70 + i * 5 : null,
          passed: submitted ? true : null,
        },
        update: {
          status: submitted
            ? AssessmentAssignmentStatus.SUBMITTED
            : AssessmentAssignmentStatus.ASSIGNED,
        },
        select: { id: true },
      });
    }
  }

  /* pipeline -------------------------------------------------------------
     Written through the T-240 repository, never with a hand-rolled
     `TalentList`. The board reads ONE list per recruiter, keyed on a reserved
     name (`pipelineListName(recruiterProfileId)`), so a list created here with
     a friendly name like "Northwind Labs Pipeline" is a list the board will
     never open — the rows exist, the analytics "Contacted" count finds them
     (it filters on owner + stage only), and the board still shows nothing.
     `addToPipeline` puts them on the list the board actually reads, and is
     idempotent on `@@unique([talentListId, candidateUserId])`. */
  for (const [stage, keys] of Object.entries(spec.pipeline) as [
    PipelineStage,
    string[],
  ][]) {
    for (const ck of keys) {
      const candidateUserId = candidateIds.get(ck);
      const cand = CANDIDATES.find((c) => c.key === ck);
      if (!candidateUserId || !cand) continue;
      const res = await addToPipeline(
        {
          userId: user.id,
          recruiterProfileId: workspace.recruiterProfileId,
          organizationId: workspace.organizationId,
        },
        { candidateUserId, label: cand.name, stage },
      );
      if (!res.ok) {
        throw new Error(`addToPipeline failed for ${ck}: ${res.message}`);
      }
    }
  }

  console.log(`  ✓ recruiter ${email} — ${spec.company} (org ${workspace.organizationId})`);
}

/* ========================================================================== */
/* reset                                                                       */
/* ========================================================================== */

/**
 * Deletes ONLY demo-suffixed users. Every table this script writes either
 * cascades off `User` or off a row that does, except `TalentRequest`,
 * `RecruiterAssessment` and `TalentList`, which hang off the recruiter's
 * organization — those are removed explicitly first.
 */
async function reset(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: SUFFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log("  nothing to reset");
    return;
  }

  const orgIds = (
    await prisma.organizationMember.findMany({
      where: { userId: { in: ids } },
      select: { organizationId: true },
    })
  ).map((m) => m.organizationId);

  await prisma.talentRequest.deleteMany({ where: { recruiterUserId: { in: ids } } });
  if (orgIds.length > 0) {
    await prisma.recruiterAssessmentAssignment.deleteMany({
      where: { assessment: { organizationId: { in: orgIds } } },
    });
    await prisma.recruiterAssessment.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.talentList.deleteMany({ where: { organizationId: { in: orgIds } } });

    // The credit ledger is `onDelete: Restrict` on BOTH User and Organization
    // — "financial history outlives the convenience of deleting a row" — so a
    // demo teardown has to clear it explicitly or the user delete is refused.
    // Safe here only because every row involved belongs to a demo workspace
    // this script created; never widen this beyond the demo org ids.
    await prisma.creditTransaction.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.creditAccount.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
  }
  await prisma.creditTransaction.deleteMany({
    where: { OR: [{ recruiterUserId: { in: ids } }, { candidateUserId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // Orgs are provisioned per demo recruiter and slugged on their user id, so a
  // reseed would otherwise leave a dead workspace behind on every run.
  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }

  console.log(`  removed ${ids.length} demo users and their owned rows`);
}

/* ========================================================================== */
/* main                                                                        */
/* ========================================================================== */

async function main(): Promise<void> {
  assertNotProductionDb();

  const doReset = process.argv.includes("--reset");
  const resetOnly = process.argv.includes("--reset-only");

  console.log("\n─── ABTalks demo data (T-241 / T-242) ───");
  console.log(`database: ${endpoint()}\n`);

  if (doReset || resetOnly) {
    console.log("RESET");
    await reset();
    if (resetOnly) {
      console.log("\nDone (reset only).\n");
      return;
    }
    console.log("");
  }

  console.log("CANDIDATES");
  const candidateIds = new Map<string, string>();
  for (const spec of CANDIDATES) {
    const id = await seedCandidate(spec);
    candidateIds.set(spec.key, id);
    if (spec.evidence.length > 0) await seedEvidence(id, spec.evidence);
    if (spec.challenge) await seedChallengeTrack(id, spec.challenge, spec.key);
    const marks = [
      spec.evidence.length > 0 ? `evidence×${spec.evidence.length}` : "no-evidence",
      spec.challenge ? `challenge×${spec.challenge.submissions}` : "no-track-record",
    ].join(", ");
    console.log(`  ✓ ${spec.key.toUpperCase()} ${spec.name} — ${marks}`);
  }

  console.log("\nRECRUITERS");
  for (const spec of RECRUITERS) {
    await seedRecruiter(spec, candidateIds);
  }

  console.log("\nLOGIN (recruiters sign in at /talent/login — email OTP,");
  console.log("shown on screen in dev when no mail provider is configured)");
  for (const r of RECRUITERS) {
    console.log(`  ${r.company.padEnd(20)} ${recruiterEmail(r.key)}`);
  }

  console.log("\nDone.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
