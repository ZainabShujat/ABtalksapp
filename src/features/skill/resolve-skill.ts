import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { SkillOption } from "@/features/skill/search-skills";

const SELECT = {
  id: true,
  name: true,
  slug: true,
  category: { select: { name: true } },
} as const;

export function skillSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function shape(row: {
  id: string;
  name: string;
  slug: string;
  category: { name: string } | null;
}): SkillOption {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    categoryName: row.category?.name ?? null,
  };
}

/**
 * Fold a typed skill name onto the canonical `Skill` row (slug, then name /
 * alias). Creates a row only when none exists — same fold as dual-write, kept
 * here so `/profile` does not import that module.
 */
export async function resolveOrCreateSkill(
  raw: string,
): Promise<SkillOption | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slug = skillSlug(trimmed);
  if (!slug) return null;
  const key = trimmed.toLowerCase();

  const bySlug = await prisma.skill.findUnique({
    where: { slug },
    select: SELECT,
  });
  if (bySlug) return shape(bySlug);

  const byNameOrAlias = await prisma.skill.findFirst({
    where: {
      OR: [
        { name: { equals: trimmed, mode: "insensitive" } },
        { aliases: { has: key } },
        { aliases: { has: trimmed } },
      ],
    },
    select: SELECT,
  });
  if (byNameOrAlias) return shape(byNameOrAlias);

  try {
    const created = await prisma.skill.create({
      data: { slug, name: trimmed },
      select: SELECT,
    });
    return shape(created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = await prisma.skill.findUnique({
        where: { slug },
        select: SELECT,
      });
      if (again) return shape(again);
    }
    logger.error("[skill] resolve-or-create failed", { error: String(error) });
    return null;
  }
}
