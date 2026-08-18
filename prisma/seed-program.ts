import { config } from "dotenv";
config({ path: ".env.local" });
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Prisma,
  ProgramEntrySection,
  ProgramLanguage,
  ProgramMissionType,
} from "@prisma/client";
import { prisma } from "../src/lib/db";

const CONTENT_DIR = path.join(process.cwd(), "prisma", "content", "program");

function loadJsonFile<T>(filename: string): T | null {
  const full = path.join(CONTENT_DIR, filename);
  if (!fs.existsSync(full)) {
    console.log(`[program-seed] ${filename} not found — skipped`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
  } catch (e) {
    console.warn(`[program-seed] invalid JSON in ${filename} — skipped:`, e);
    return null;
  }
}

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
  assetsJson?: Prisma.InputJsonValue;
  missionSpec: Prisma.InputJsonValue;
  starterCode?: string | null;
  language?: ProgramLanguage | null;
  objectives?: string[];
  tools?: string[];
  estimatedMin?: number;
  missionPoints?: number;
  isProjectDay?: boolean;
};

type ConceptQuestionsJson = {
  dayNumber: number;
  questions: {
    order: number;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }[];
};

type EntryQuestionJson = {
  section: ProgramEntrySection;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  active?: boolean;
};

type ExerciseJson = {
  slug: string;
  title: string;
  language: ProgramLanguage;
  moduleNumber: number;
  order: number;
  description: string;
  starterCode: string;
  setupSql?: string | null;
  expectedOutput?: string | null;
};

type VideosJson = {
  dayNumber: number;
  videos: {
    order: number;
    title: string;
    youtubeId: string;
    durationMin?: number | null;
  }[];
};

async function seedModules() {
  const modules = loadJsonFile<ModuleJson[]>("modules.json");
  if (!modules) return;
  for (const m of modules) {
    await prisma.programModule.upsert({
      where: { number: m.number },
      create: {
        number: m.number,
        title: m.title,
        subtitle: m.subtitle,
        color: m.color,
        startDay: m.startDay,
        endDay: m.endDay,
      },
      update: {
        title: m.title,
        subtitle: m.subtitle,
        color: m.color,
        startDay: m.startDay,
        endDay: m.endDay,
      },
    });
  }
  console.log(`[program-seed] modules: ${modules.length} upserted`);
}

async function seedDays() {
  const days = loadJsonFile<DayJson[]>("days.json");
  if (!days) return;
  const modules = await prisma.programModule.findMany({
    select: { id: true, number: true },
  });
  const moduleIdByNumber = new Map(modules.map((m) => [m.number, m.id]));
  let count = 0;
  for (const d of days) {
    const moduleId = moduleIdByNumber.get(d.moduleNumber);
    if (!moduleId) {
      console.warn(
        `[program-seed] day ${d.dayNumber}: module ${d.moduleNumber} not found — skipped`,
      );
      continue;
    }
    const body = {
      moduleId,
      title: d.title,
      missionType: d.missionType,
      briefMd: d.briefMd,
      assetsJson: d.assetsJson ?? Prisma.JsonNull,
      missionSpec: d.missionSpec,
      starterCode: d.starterCode ?? null,
      language: d.language ?? null,
      objectives: d.objectives ?? [],
      tools: d.tools ?? [],
      estimatedMin: d.estimatedMin ?? 60,
      missionPoints: d.missionPoints ?? 12,
      isProjectDay: d.isProjectDay ?? false,
    };
    await prisma.programDay.upsert({
      where: { dayNumber: d.dayNumber },
      create: { dayNumber: d.dayNumber, ...body },
      update: body,
    });
    count += 1;
  }
  console.log(`[program-seed] days: ${count} upserted`);
}

async function seedConceptQuestions() {
  const entries = loadJsonFile<ConceptQuestionsJson[]>("concept-questions.json");
  if (!entries) return;
  let count = 0;
  for (const entry of entries) {
    const day = await prisma.programDay.findUnique({
      where: { dayNumber: entry.dayNumber },
      select: { id: true },
    });
    if (!day) {
      console.warn(
        `[program-seed] concept questions: day ${entry.dayNumber} not found — skipped`,
      );
      continue;
    }
    await prisma.programConceptQuestion.deleteMany({ where: { dayId: day.id } });
    for (const q of entry.questions) {
      await prisma.programConceptQuestion.create({
        data: {
          dayId: day.id,
          order: q.order,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        },
      });
      count += 1;
    }
  }
  console.log(`[program-seed] concept questions: ${count} upserted`);
}

async function seedEntryQuestions() {
  const entries = loadJsonFile<EntryQuestionJson[]>("entry-questions.json");
  if (!entries) return;
  await prisma.programEntryQuestion.deleteMany({});
  for (const q of entries) {
    await prisma.programEntryQuestion.create({
      data: {
        section: q.section,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        active: q.active ?? true,
      },
    });
  }
  console.log(`[program-seed] entry questions: ${entries.length} replaced`);
}

async function seedExercises() {
  const entries = loadJsonFile<ExerciseJson[]>("exercises.json");
  if (!entries) return;
  for (const e of entries) {
    const body = {
      title: e.title,
      language: e.language,
      moduleNumber: e.moduleNumber,
      order: e.order,
      description: e.description,
      starterCode: e.starterCode,
      setupSql: e.setupSql ?? null,
      expectedOutput: e.expectedOutput ?? null,
    };
    await prisma.programExercise.upsert({
      where: { slug: e.slug },
      create: { slug: e.slug, ...body },
      update: body,
    });
  }
  console.log(`[program-seed] exercises: ${entries.length} upserted`);
}

async function seedVideos() {
  const entries = loadJsonFile<VideosJson[]>("videos.json");
  if (!entries) return;
  let count = 0;
  for (const entry of entries) {
    const day = await prisma.programDay.findUnique({
      where: { dayNumber: entry.dayNumber },
      select: { id: true },
    });
    if (!day) {
      console.warn(
        `[program-seed] videos: day ${entry.dayNumber} not found — skipped`,
      );
      continue;
    }
    await prisma.programVideo.deleteMany({ where: { dayId: day.id } });
    for (const v of entry.videos) {
      await prisma.programVideo.create({
        data: {
          dayId: day.id,
          order: v.order,
          title: v.title,
          youtubeId: v.youtubeId,
          durationMin: v.durationMin ?? null,
        },
      });
      count += 1;
    }
  }
  console.log(`[program-seed] videos: ${count} upserted`);
}

async function seedProgram() {
  console.log("[program-seed] starting…");
  await seedModules();
  await seedDays();
  await seedEntryQuestions();
  await seedExercises();
  await seedVideos();
  console.log("[program-seed] done");
}

seedProgram()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[program-seed] failed:", e);
    process.exit(1);
  });
