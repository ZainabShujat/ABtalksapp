/**
 * Plan 078 Phase 1 seed: ProgramCategory rows, SkillCategory set, and Skill
 * vocabulary from distinct StudentProfile.skills + ProgramMember.skills.
 *
 * Idempotent. Refuses the production Neon host. Target the plan-078-phase1
 * child branch via DATABASE_URL / DIRECT_URL.
 */
import { PrismaClient } from "@prisma/client";

const PRODUCTION_NEON_HOST_ID = "ep-nameless-term-ams9a5e3";

const PROGRAM_CATEGORIES = [
  {
    slug: "software-engineering",
    name: "Software Engineering",
    description: "60-Day Software Engineering Challenge and related programs.",
    colorToken: "se",
    sortOrder: 1,
  },
  {
    slug: "data-science",
    name: "Data Science",
    description: "60-Day Data Science Challenge and related programs.",
    colorToken: "ds",
    sortOrder: 2,
  },
  {
    slug: "ai-engineering",
    name: "AI Engineering",
    description: "60-Day AI Engineering Challenge and related programs.",
    colorToken: "ai",
    sortOrder: 3,
  },
  {
    slug: "claude",
    name: "Claude",
    description: "Claude Challenge cohort and related programs.",
    colorToken: "claude",
    sortOrder: 4,
  },
] as const;

const SKILL_CATEGORIES = [
  { slug: "programming", name: "Programming", sortOrder: 1 },
  { slug: "data", name: "Data", sortOrder: 2 },
  { slug: "ai-ml", name: "AI / ML", sortOrder: 3 },
  { slug: "cloud", name: "Cloud", sortOrder: 4 },
  { slug: "tools", name: "Tools", sortOrder: 5 },
  { slug: "professional", name: "Professional", sortOrder: 6 },
  { slug: "uncategorized", name: "Uncategorized", sortOrder: 99 },
] as const;

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
  console.log(`Seeding taxonomy on host: ${host}`);
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function displayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

async function main(): Promise<void> {
  assertNotProduction();
  const prisma = new PrismaClient();

  try {
    for (const row of PROGRAM_CATEGORIES) {
      await prisma.programCategory.upsert({
        where: { slug: row.slug },
        create: { ...row, isActive: true },
        update: {
          name: row.name,
          description: row.description,
          colorToken: row.colorToken,
          sortOrder: row.sortOrder,
          isActive: true,
        },
      });
    }
    console.log(`ProgramCategory upserted: ${PROGRAM_CATEGORIES.length}`);

    let uncategorizedId: string | null = null;
    for (const row of SKILL_CATEGORIES) {
      const saved = await prisma.skillCategory.upsert({
        where: { slug: row.slug },
        create: row,
        update: { name: row.name, sortOrder: row.sortOrder },
      });
      if (row.slug === "uncategorized") uncategorizedId = saved.id;
    }
    console.log(`SkillCategory upserted: ${SKILL_CATEGORIES.length}`);

    const rawSkills = await prisma.$queryRaw<Array<{ skill: string }>>`
      SELECT DISTINCT trim(s) AS skill
      FROM (
        SELECT unnest(skills) AS s FROM "StudentProfile"
        UNION ALL
        SELECT unnest(skills) AS s FROM "ProgramMember"
      ) x
      WHERE trim(s) <> ''
    `;

    const bySlug = new Map<string, { name: string; aliases: Set<string> }>();
    for (const row of rawSkills) {
      const name = displayName(row.skill);
      const slug = slugify(name);
      if (!slug) continue;
      const existing = bySlug.get(slug);
      if (!existing) {
        bySlug.set(slug, { name, aliases: new Set() });
        continue;
      }
      if (name !== existing.name) existing.aliases.add(name);
    }

    const existing = await prisma.skill.findMany({
      select: { slug: true, aliases: true },
    });
    const existingBySlug = new Map(existing.map((row) => [row.slug, row]));

    const toCreate: Array<{
      slug: string;
      name: string;
      categoryId: string | null;
      aliases: string[];
      isActive: boolean;
    }> = [];
    const toUpdate: Array<{ slug: string; aliases: string[] }> = [];
    for (const [slug, value] of bySlug) {
      const aliases = [...value.aliases].sort();
      const current = existingBySlug.get(slug);
      if (!current) {
        toCreate.push({
          slug,
          name: value.name,
          categoryId: uncategorizedId,
          aliases,
          isActive: true,
        });
      } else {
        const merged = [...new Set([...current.aliases, ...aliases])].sort();
        if (merged.join("\0") !== [...current.aliases].sort().join("\0")) {
          toUpdate.push({ slug, aliases: merged });
        }
      }
    }

    const BATCH = 100;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      await prisma.skill.createMany({
        data: toCreate.slice(i, i + BATCH),
        skipDuplicates: true,
      });
    }
    for (const row of toUpdate) {
      await prisma.skill.update({
        where: { slug: row.slug },
        data: { aliases: row.aliases, isActive: true },
      });
    }

    console.log(
      `Skill vocabulary: ${bySlug.size} distinct slugs (${toCreate.length} created, ${toUpdate.length} alias-updated). Review uncategorized rows before Phase 2.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
