/**
 * Seed 078 LearningProgram "ds-architect" from prisma/content/Data-Sol-Architect JSON.
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
const CONTENT_DIR = path.join(
  process.cwd(),
  "prisma",
  "content",
  "Data-Sol-Architect",
);
const PROGRAM_SLUG = "ds-architect";
const COHORT_SLUG = "ds-architect-open";
const DEFAULT_MISSION_POINTS = 15;

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
  console.log(`[ds-architect-seed] targeting host: ${host}`);
}

function loadJsonFile<T>(filename: string): T {
  const full = path.join(CONTENT_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`[ds-architect-seed] ${filename} not found at ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

function activityIdForDay(dayNumber: number): string {
  return `act_dsa_day_${String(dayNumber).padStart(2, "0")}`;
}

function activityIdForVideo(dayNumber: number, order: number): string {
  return `act_dsa_vid_${String(dayNumber).padStart(2, "0")}_${String(order).padStart(2, "0")}`;
}

type VideoJson = {
  dayNumber: number;
  videos: {
    order: number;
    title: string;
    youtubeId: string;
    durationMin?: number | null;
  }[];
};

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
    const videoDays = loadJsonFile<VideoJson[]>("videos.json");

    const category = await prisma.programCategory.upsert({
      where: { slug: PROGRAM_SLUG },
      create: {
        slug: PROGRAM_SLUG,
        name: "Data Solutions Architect",
        description: "10-Day Data Solutions Architect Cohort.",
        colorToken: "ds-architect",
        sortOrder: 30,
        isActive: true,
      },
      update: {
        name: "Data Solutions Architect",
        description: "10-Day Data Solutions Architect Cohort.",
        colorToken: "ds-architect",
        sortOrder: 30,
        isActive: true,
      },
    });

    const program = await prisma.learningProgram.upsert({
      where: { slug: PROGRAM_SLUG },
      create: {
        slug: PROGRAM_SLUG,
        title: "10-Day Data Solutions Architect Cohort",
        subtitle: "AWS-first Data + AI platform for senior architects",
        description:
          "AWS-first Data + AI platform for senior architects.",
        categoryId: category.id,
        format: ProgramFormat.COHORT,
        isPublished: true,
        sortOrder: 30,
      },
      update: {
        title: "10-Day Data Solutions Architect Cohort",
        subtitle: "AWS-first Data + AI platform for senior architects",
        description:
          "AWS-first Data + AI platform for senior architects.",
        isPublished: true,
        sortOrder: 30,
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
        plannedDurationDays: 10,
        publishedAt: new Date(),
      },
      update: {
        plannedDurationDays: 10,
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
          `[ds-architect-seed] day ${d.dayNumber}: module ${d.moduleNumber} not found`,
        );
      }
      const actId = activityIdForDay(d.dayNumber);
      const type = missionActivityType(d.missionType, d.isProjectDay === true);
      const points = d.missionPoints ?? DEFAULT_MISSION_POINTS;
      await prisma.activity.upsert({
        where: { id: actId },
        create: {
          id: actId,
          moduleId,
          position: d.dayNumber,
          type,
          title: d.title,
          dayNumber: d.dayNumber,
          points,
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
          points,
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

    let videoCount = 0;
    for (const entry of videoDays) {
      const dayMeta = days.find((d) => d.dayNumber === entry.dayNumber);
      if (!dayMeta) {
        throw new Error(
          `[ds-architect-seed] videos: day ${entry.dayNumber} not in days.json`,
        );
      }
      const moduleId = moduleIdByNumber.get(dayMeta.moduleNumber);
      if (!moduleId) {
        throw new Error(
          `[ds-architect-seed] videos: module ${dayMeta.moduleNumber} not found`,
        );
      }
      for (const v of entry.videos) {
        const vidId = activityIdForVideo(entry.dayNumber, v.order);
        await prisma.activity.upsert({
          where: { id: vidId },
          create: {
            id: vidId,
            moduleId,
            position: 2000 + entry.dayNumber * 10 + v.order,
            type: ActivityType.VIDEO,
            title: v.title,
            dayNumber: entry.dayNumber,
            points: 0,
            isRequired: false,
            unlockRule: ActivityUnlockRule.SCHEDULED,
            estimatedMinutes: v.durationMin ?? undefined,
          },
          update: {
            moduleId,
            title: v.title,
            dayNumber: entry.dayNumber,
            estimatedMinutes: v.durationMin ?? undefined,
          },
        });
        await prisma.contentActivityConfig.upsert({
          where: { activityId: vidId },
          create: {
            activityId: vidId,
            videoProvider: "YOUTUBE",
            videoRef: v.youtubeId,
            videoDurationMin: v.durationMin ?? null,
          },
          update: {
            videoProvider: "YOUTUBE",
            videoRef: v.youtubeId,
            videoDurationMin: v.durationMin ?? null,
          },
        });
        videoCount += 1;
      }
    }

    await prisma.programVersion.update({
      where: { id: version.id },
      data: {
        totalPoints: days.reduce(
          (sum, d) => sum + (d.missionPoints ?? DEFAULT_MISSION_POINTS),
          0,
        ),
        requiredActivityCount: days.length,
      },
    });

    await prisma.cohort.upsert({
      where: { slug: COHORT_SLUG },
      create: {
        programVersionId: version.id,
        slug: COHORT_SLUG,
        name: "Data Solutions Architect",
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
        name: "Data Solutions Architect",
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
      `[ds-architect-seed] upserted program=${PROGRAM_SLUG} modules=${modules.length} days=${days.length} videos=${videoCount} cohort=${COHORT_SLUG}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
