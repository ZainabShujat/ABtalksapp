import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { skillSlug } from "@/features/skill/resolve-skill";

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
 * Resolve a curated name list against the active catalog, preserving list order.
 * Names with no row are omitted — the Skills chips still render the constant
 * and resolve on click.
 */
export async function getSkillsByNames(
  names: readonly string[],
): Promise<SkillOption[]> {
  const trimmed = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (trimmed.length === 0) return [];

  const slugs = [...new Set(trimmed.map(skillSlug).filter((s) => s.length > 0))];

  try {
    const rows = await prisma.skill.findMany({
      where: {
        isActive: true,
        OR: [
          { slug: { in: slugs } },
          ...trimmed.map((name) => ({
            name: { equals: name, mode: Prisma.QueryMode.insensitive },
          })),
        ],
      },
      select: SELECT,
    });

    const byName = new Map(rows.map((r) => [r.name.toLowerCase(), shape(r)]));
    const bySlug = new Map(rows.map((r) => [r.slug, shape(r)]));
    const out: SkillOption[] = [];
    const seen = new Set<string>();
    for (const name of trimmed) {
      const hit = byName.get(name.toLowerCase()) ?? bySlug.get(skillSlug(name));
      if (!hit || seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push(hit);
    }
    return out;
  } catch (error) {
    logger.error("[skill] name lookup failed", { error: String(error) });
    return [];
  }
}
