/**
 * Seed 078 LearningProgram "databricks" from prisma/content/Databricks JSON.
 * Idempotent. Refuses the production Neon host. No legacy ProgramModule/ProgramDay writes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
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

const PRODUCTION_NEON_HOST_ID = "ep-nameless-term-ams9a5e3";
const CONTENT_DIR = path.join(process.cwd(), "prisma", "content", "Databricks");
const PROGRAM_SLUG = "databricks";
const COHORT_SLUG = "databricks-open";

type ModuleJson = {
  number: number;
  title: string;
  subtitle: string;
  color: string;
  startDay: number;
  endDay: number;
};

type DayJson = {
  dayNumber: number;
  moduleNumber: number;
  title: string;
  missionType: ProgramMissionType;
  briefMd: string;
  missionSpec: Prisma.InputJsonValue;
  objectives?: string[];
  tools?: string[];
  estimatedMin?: number;
  missionPoints?: number;
  isProjectDay?: boolean;
};

function assertNotProduction(): void {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (process.env.SEED_ALLOW_PRODUCTION === "true") {
    console.warn("SEED_ALLOW_PRODUCTION=true — production guard bypassed");
    return;
  }
  if (dbUrl.toLowerCase().includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL points at production (${PRODUCTION_NEON_HOST_ID}).`,
    );
  }
  const host = dbUrl.split("@")[1]?.split("/")[0] ?? "(unknown)";
  console.log(`[databricks-seed] targeting host: ${host}`);
}

function loadJsonFile<T>(filename: string): T {
  const full = path.join(CONTENT_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`[databricks-seed] ${filename} not found at ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

function activityIdForDay(dayNumber: number): string {
  return `act_dbx_day_${String(dayNumber).padStart(2, "0")}`;
}

function missionActivityType(
  missionType: ProgramMissionType,
  isProjectDay: boolean,
): ActivityType {
  if (isProjectDay) return ActivityType.PROJECT;
  switch (missionType) {
    case ProgramMissionType.CODE_SPRINT:
      return ActivityType.CODING;
    case ProgramMissionType.DATA_ROOM:
      return ActivityType.ASSIGNMENT;
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

async function main(): Promise<void> {
  assertNotProduction();
  const prisma = new PrismaClient();

  try {
    const modules = loadJsonFile<ModuleJson[]>("modules.json");
    const days = loadJsonFile<DayJson[]>("days.json");

    const category = await prisma.programCategory.upsert({
      where: { slug: PROGRAM_SLUG },
      create: {
        slug: PROGRAM_SLUG,
        name: "Databricks",
        description: "31-Day Databricks Data Engineering Cohort.",
        colorToken: "databricks",
        sortOrder: 20,
        isActive: true,
      },
      update: {
        name: "Databricks",
        description: "31-Day Databricks Data Engineering Cohort.",
        colorToken: "databricks",
        sortOrder: 20,
        isActive: true,
      },
    });

    const program = await prisma.learningProgram.upsert({
      where: { slug: PROGRAM_SLUG },
      create: {
        slug: PROGRAM_SLUG,
        title: "31-Day Databricks Data Engineering Cohort",
        subtitle: "Healthcare-claims Lakehouse on Databricks Free Edition",
        description:
          "Build a healthcare-claims Lakehouse on Databricks Free Edition in 31 days.",
        categoryId: category.id,
        format: ProgramFormat.COHORT,
        isPublished: true,
        sortOrder: 20,
      },
      update: {
        title: "31-Day Databricks Data Engineering Cohort",
        subtitle: "Healthcare-claims Lakehouse on Databricks Free Edition",
        description:
          "Build a healthcare-claims Lakehouse on Databricks Free Edition in 31 days.",
        isPublished: true,
        sortOrder: 20,
      },
    });

    const version = await prisma.programVersion.upsert({
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
      update: {
        plannedDurationDays: 31,
        status: ProgramVersionStatus.PUBLISHED,
      },
    });

    const moduleIdByNumber = new Map<number, string>();
    for (const m of modules) {
      const row = await prisma.module.upsert({
        where: {
          programVersionId_position: {
            programVersionId: version.id,
            position: m.number,
          },
        },
        create: {
          programVersionId: version.id,
          position: m.number,
          title: m.title,
          subtitle: m.subtitle,
          colorToken: m.color,
          startDay: m.startDay,
          endDay: m.endDay,
        },
        update: {
          title: m.title,
          subtitle: m.subtitle,
          colorToken: m.color,
          startDay: m.startDay,
          endDay: m.endDay,
        },
      });
      moduleIdByNumber.set(m.number, row.id);
    }

    for (const d of days) {
      const moduleId = moduleIdByNumber.get(d.moduleNumber);
      if (!moduleId) {
        throw new Error(
          `[databricks-seed] day ${d.dayNumber}: module ${d.moduleNumber} not found`,
        );
      }
      const actId = activityIdForDay(d.dayNumber);
      const type = missionActivityType(d.missionType, d.isProjectDay === true);
      await prisma.activity.upsert({
        where: { id: actId },
        create: {
          id: actId,
          moduleId,
          position: d.dayNumber,
          type,
          title: d.title,
          dayNumber: d.dayNumber,
          points: d.missionPoints ?? 12,
          isRequired: true,
          unlockRule: ActivityUnlockRule.SCHEDULED,
          estimatedMinutes: d.estimatedMin ?? 60,
          verificationSpec: d.missionSpec,
          tags: d.tools ?? [],
        },
        update: {
          moduleId,
          type,
          title: d.title,
          dayNumber: d.dayNumber,
          points: d.missionPoints ?? 12,
          estimatedMinutes: d.estimatedMin ?? 60,
          verificationSpec: d.missionSpec,
          tags: d.tools ?? [],
        },
      });
      await prisma.contentActivityConfig.upsert({
        where: { activityId: actId },
        create: {
          activityId: actId,
          bodyMarkdown: d.briefMd,
          objectives: d.objectives ?? [],
          missionType: d.missionType,
        },
        update: {
          bodyMarkdown: d.briefMd,
          objectives: d.objectives ?? [],
          missionType: d.missionType,
        },
      });
    }

    await prisma.programVersion.update({
      where: { id: version.id },
      data: {
        totalPoints: days.reduce((sum, d) => sum + (d.missionPoints ?? 12), 0),
        requiredActivityCount: days.length,
      },
    });

    await prisma.cohort.upsert({
      where: { slug: COHORT_SLUG },
      create: {
        programVersionId: version.id,
        slug: COHORT_SLUG,
        name: "Databricks Data Engineering",
        startMode: CohortStartMode.ROLLING,
        startsAt: null,
        endsAt: null,
        timezone: "Asia/Kolkata",
        status: CohortStatus.ENROLLING,
        capacity: null,
        requiresJoinCode: false,
        joinCode: null,
      },
      update: {
        programVersionId: version.id,
        name: "Databricks Data Engineering",
        startMode: CohortStartMode.ROLLING,
        startsAt: null,
        endsAt: null,
        timezone: "Asia/Kolkata",
        status: CohortStatus.ENROLLING,
        capacity: null,
        requiresJoinCode: false,
        joinCode: null,
      },
    });

    console.log(
      `[databricks-seed] upserted program=${PROGRAM_SLUG} modules=${modules.length} days=${days.length} cohort=${COHORT_SLUG}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
