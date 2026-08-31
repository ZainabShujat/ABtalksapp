import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Typeahead over the canonical `Skill` vocabulary.
 *
 * Search only — this never creates rows. Normalization (slug + alias folding,
 * which is what keeps "Python", "python" and "PYTHON" from becoming three
 * skills) already lives in the dual-write path, and letting a search box mint
 * catalog entries would undo it.
 */

export type SkillOption = {
  id: string;
  name: string;
  slug: string;
  categoryName: string | null;
};

const SELECT = {
  id: true,
  name: true,
  slug: true,
  category: { select: { name: true } },
} as const;

type Row = {
  id: string;
  name: string;
  slug: string;
  category: { name: string } | null;
};

const shape = (r: Row): SkillOption => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  categoryName: r.category?.name ?? null,
});

export async function searchSkills(query: string): Promise<SkillOption[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  try {
    const rows = await prisma.skill.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { slug: { contains: q.toLowerCase().replace(/\s+/g, "-") } },
          { aliases: { has: q.toLowerCase() } },
        ],
      },
      select: SELECT,
      take: 60,
    });

    const lower = q.toLowerCase();
    return rows
      .sort((a, b) => {
        // Prefix matches first, then the shortest name — "Java" should not sit
        // below "JavaServer Faces" when someone has typed "jav".
        const aPrefix = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
        const bPrefix = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map(shape);
  } catch (error) {
    logger.error("[skill] search failed", { error: String(error) });
    return [];
  }
}

/**
 * Quick-add chips: the skills most candidates on the platform already claim.
 * Popularity comes from live claims, so the list tracks what the cohort
 * actually does rather than a hard-coded guess.
 */
export async function getPopularSkills(limit = 12): Promise<SkillOption[]> {
  try {
    const grouped = await prisma.candidateSkill.groupBy({
      by: ["skillId"],
      where: { claimedByCandidate: true },
      _count: { skillId: true },
      orderBy: { _count: { skillId: "desc" } },
      take: limit,
    });

    if (grouped.length === 0) return [];

    const rows = await prisma.skill.findMany({
      where: { id: { in: grouped.map((g) => g.skillId) }, isActive: true },
      select: SELECT,
    });

    const rank = new Map(grouped.map((g, i) => [g.skillId, i]));
    return rows
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      .map(shape);
  } catch (error) {
    logger.error("[skill] popular lookup failed", { error: String(error) });
    return [];
  }
}
