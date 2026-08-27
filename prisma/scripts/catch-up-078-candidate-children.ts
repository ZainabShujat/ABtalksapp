/**
 * One-time catch-up: StudentProfile.skills → Skill + CandidateSkill, and
 * repair deterministic edu_sp_* / exp_sp_* rows from StudentProfile.
 *
 * Does not rewrite CandidateProfile scalars (preserves 2a ProgramMember extras).
 * Does not delete SkillEvidence or CandidateSkill rows. Production write
 * authorized after deploy.
 */
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertChildBranch, slugify } from "./migrate-078-shared";
import {
  educationIdForStudentProfile,
  experienceIdForStudentProfile,
} from "../../src/repositories/dual-write";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();
const PAGE = 200;

async function verify(): Promise<{
  referralMismatch: number;
  crossTableCollisions: number;
  missingSkills: number;
  extraEduSp: number;
  extraExpSp: number;
}> {
  const referralMismatch = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE sp."referralCode" IS DISTINCT FROM cp."referralCode"
  `;
  const crossTableCollisions = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."referralCode" = sp."referralCode"
    WHERE cp."userId" <> sp."userId"
  `;
  const missingSkills = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE EXISTS (
      SELECT 1
      FROM unnest(sp.skills) AS s(raw)
      WHERE length(
        regexp_replace(
          regexp_replace(lower(trim(s.raw)), '[^a-z0-9]+', '-', 'g'),
          '(^-+|-+$)',
          '',
          'g'
        )
      ) > 0
    )
      AND NOT EXISTS (
        SELECT 1 FROM "CandidateSkill" cs WHERE cs."userId" = sp."userId"
      )
  `;
  const extraEduSp = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT "userId"
      FROM "CandidateEducation"
      WHERE id LIKE 'edu_sp_%'
      GROUP BY "userId"
      HAVING COUNT(*) > 1
    ) d
  `;
  const extraExpSp = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT "userId"
      FROM "CandidateExperience"
      WHERE id LIKE 'exp_sp_%'
      GROUP BY "userId"
      HAVING COUNT(*) > 1
    ) d
  `;
  return {
    referralMismatch: referralMismatch[0]?.n ?? -1,
    crossTableCollisions: crossTableCollisions[0]?.n ?? -1,
    missingSkills: missingSkills[0]?.n ?? -1,
    extraEduSp: extraEduSp[0]?.n ?? -1,
    extraExpSp: extraExpSp[0]?.n ?? -1,
  };
}

type SkillIndex = {
  bySlug: Map<string, string>;
  byAlias: Map<string, string>;
};

async function loadSkillIndex(): Promise<SkillIndex> {
  const rows = await prisma.skill.findMany({
    select: { id: true, slug: true, name: true, aliases: true },
  });
  const bySlug = new Map<string, string>();
  const byAlias = new Map<string, string>();
  for (const s of rows) {
    bySlug.set(s.slug, s.id);
    byAlias.set(s.name.trim().toLowerCase(), s.id);
    for (const a of s.aliases) {
      const key = a.trim().toLowerCase();
      if (key) byAlias.set(key, s.id);
    }
  }
  return { bySlug, byAlias };
}

function resolveSkill(index: SkillIndex, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slug = slugify(trimmed);
  if (slug && index.bySlug.has(slug)) return index.bySlug.get(slug)!;
  const key = trimmed.toLowerCase();
  return index.byAlias.get(key) ?? index.byAlias.get(trimmed) ?? null;
}

async function ensureSkillId(
  index: SkillIndex,
  raw: string,
): Promise<string | null> {
  const existing = resolveSkill(index, raw);
  if (existing) return existing;
  const trimmed = raw.trim();
  const slug = slugify(trimmed);
  if (!slug) return null;
  try {
    const created = await prisma.skill.create({
      data: { slug, name: trimmed },
      select: { id: true },
    });
    index.bySlug.set(slug, created.id);
    index.byAlias.set(trimmed.toLowerCase(), created.id);
    return created.id;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const again = await prisma.skill.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (again) {
        index.bySlug.set(slug, again.id);
        index.byAlias.set(trimmed.toLowerCase(), again.id);
        return again.id;
      }
    }
    throw e;
  }
}

function log(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  assertChildBranch();
  const verifyOnly = process.env.CATCHUP_VERIFY_ONLY === "1";

  if (!verifyOnly) {
    const index = await loadSkillIndex();
    const cpUsers = new Set(
      (
        await prisma.candidateProfile.findMany({
          select: { userId: true },
        })
      ).map((r) => r.userId),
    );

    let processed = 0;
    let skippedNoCp = 0;
    let skillLinks = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await prisma.studentProfile.findMany({
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {}),
        orderBy: { userId: "asc" },
        select: {
          userId: true,
          college: true,
          collegeId: true,
          graduationYear: true,
          organization: true,
          role: true,
          yearsExperience: true,
          skills: true,
        },
      });
      if (batch.length === 0) break;

      const skillRows: { userId: string; skillId: string }[] = [];

      for (const sp of batch) {
        if (!cpUsers.has(sp.userId)) {
          skippedNoCp += 1;
          continue;
        }
        if (sp.college || sp.collegeId || sp.graduationYear != null) {
          await prisma.candidateEducation.upsert({
            where: { id: educationIdForStudentProfile(sp.userId) },
            create: {
              id: educationIdForStudentProfile(sp.userId),
              userId: sp.userId,
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
          await prisma.candidateExperience.upsert({
            where: { id: experienceIdForStudentProfile(sp.userId) },
            create: {
              id: experienceIdForStudentProfile(sp.userId),
              userId: sp.userId,
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
        const seen = new Set<string>();
        for (const raw of sp.skills) {
          const skillId = await ensureSkillId(index, raw);
          if (!skillId || seen.has(skillId)) continue;
          seen.add(skillId);
          skillRows.push({ userId: sp.userId, skillId });
        }
        processed += 1;
      }

      if (skillRows.length > 0) {
        const created = await prisma.candidateSkill.createMany({
          data: skillRows,
          skipDuplicates: true,
        });
        skillLinks += created.count;
      }

      cursor = batch[batch.length - 1]?.userId;
      log({ processed, skippedNoCp, skillLinks, cursor });
    }

    log({ processed, skippedNoCp, skillLinks, done: true });
  }

  const counts = await verify();
  log({ verify: counts });
  if (counts.missingSkills !== 0) {
    const missing = await prisma.$queryRaw<{ skills: string[] }[]>`
      SELECT sp.skills
      FROM "StudentProfile" sp
      JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
      WHERE cardinality(sp.skills) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "CandidateSkill" cs WHERE cs."userId" = sp."userId"
        )
    `;
    log({
      missingSkillSamples: missing.map((r) =>
        r.skills.map((s) => ({
          rawLen: s.length,
          slug: slugify(s),
        })),
      ),
    });
  }
  if (
    counts.referralMismatch !== 0 ||
    counts.crossTableCollisions !== 0 ||
    counts.missingSkills !== 0 ||
    counts.extraEduSp !== 0 ||
    counts.extraExpSp !== 0
  ) {
    throw new Error(`Catch-up verify failed: ${JSON.stringify(counts)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
