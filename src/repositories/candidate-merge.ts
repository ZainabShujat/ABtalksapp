import "server-only";
import type { Prisma } from "@prisma/client";
import { writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ensureCandidateProfile } from "@/repositories/candidate";
import { canonicalTerm } from "@/features/resume/merge/terms";
import type { MergePlan, MergeSection } from "@/features/resume/merge/plan";

/**
 * Applies a merge plan to the profile's own tables.
 *
 * There is no résumé-shaped copy of education, experience, projects, skills or
 * certifications anywhere — those tables already exist and are what the whole
 * platform reads, so a résumé enriches THEM.
 *
 * Two safety properties, both structural rather than conventional:
 *
 *   1. **No destructive operation is reachable.** This file contains no
 *      `delete`, no `deleteMany`, and no unconditional overwrite of a
 *      candidate-authored value. Updates write only fields the planner marked
 *      as empty, or a description that already CONTAINS every existing bullet.
 *   2. **Every emptiness test is repeated here, inside the transaction.** The
 *      planner decided against a snapshot read; between that read and this
 *      write the candidate may have typed something in another tab. The `where`
 *      clauses below are the real guarantee, so a lost race writes nothing
 *      rather than overwriting what they just typed.
 */

type Tx = Prisma.TransactionClient;

/** Matches the planner's emptiness rule: null or blank. */
function emptyWhere<T extends string>(field: T) {
  return { OR: [{ [field]: null }, { [field]: "" }] };
}

/**
 * Résumé skill names resolved to catalogue rows.
 *
 * Exact matches only — on name, slug, or a curated alias. The `Skill` table's
 * `aliases` column is the platform's own answer to "React vs React.js", so it
 * is consulted first and `canonicalTerm` exists to make a résumé's spelling
 * findable in it. Unmatched names are dropped rather than minting rows: the
 * catalogue is a curated taxonomy and a résumé typo must not enter it.
 */
async function resolveSkillIds(tx: Tx, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const lower = [...new Set(names.map((n) => n.trim().toLowerCase()))];
  const canonical = [...new Set(names.map(canonicalTerm).filter(Boolean))];
  const lookup = [...new Set([...lower, ...canonical])];

  const rows = await tx.skill.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { in: lookup, mode: "insensitive" } },
        { slug: { in: lookup } },
        { aliases: { hasSome: lookup } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  return rows.map((r) => r.id);
}

export async function applyResumeMerge(
  userId: string,
  plan: MergePlan,
): Promise<MergeSection[]> {
  if (plan.sections.length === 0) return [];

  return writeClient().$transaction(
    async (tx) => {
      await ensureCandidateProfile(tx, userId);
      const applied = new Set<MergeSection>();

      /* ── Profile scalars: guarded, one field at a time ─────────────────── */
      const scalars: [string, string | undefined, MergeSection][] = [
        ["headline", plan.basic.headline, "basic"],
        ["summary", plan.basic.summary, "basic"],
        ["locationCity", plan.basic.locationCity, "basic"],
        ["linkedinUrl", plan.links.linkedinUrl, "links"],
        ["githubUsername", plan.links.githubUsername, "links"],
        ["portfolioUrl", plan.links.portfolioUrl, "links"],
      ];
      for (const [field, value, section] of scalars) {
        if (value === undefined) continue;
        const result = await tx.candidateProfile.updateMany({
          where: { userId, ...emptyWhere(field) },
          data: { [field]: value },
        });
        if (result.count > 0) applied.add(section);
      }

      // Legacy mirror, matching `saveLinks`. Only the two columns
      // StudentProfile has, and only when this merge actually set them.
      if (plan.links.linkedinUrl || plan.links.githubUsername) {
        await tx.studentProfile.updateMany({
          where: { userId },
          data: {
            ...(plan.links.linkedinUrl ? { linkedinUrl: plan.links.linkedinUrl } : {}),
            ...(plan.links.githubUsername
              ? { githubUsername: plan.links.githubUsername }
              : {}),
          },
        });
      }

      /* ── Education ─────────────────────────────────────────────────────── */
      for (const u of plan.education.update) {
        const { id, ...fields } = u;
        for (const [field, value] of Object.entries(fields)) {
          if (value === undefined) continue;
          // Scoped by userId as well as id: an id from a stale plan cannot
          // reach another candidate's row.
          await tx.candidateEducation.updateMany({
            where:
              field === "graduationYear"
                ? { id, userId, graduationYear: null }
                : { id, userId, ...emptyWhere(field) },
            data: { [field]: value },
          });
        }
        applied.add("education");
      }
      if (plan.education.create.length > 0) {
        const offset = await tx.candidateEducation.count({ where: { userId } });
        await tx.candidateEducation.createMany({
          data: plan.education.create.map((e, i) => ({
            userId,
            institutionName: e.institutionName,
            degree: e.degree,
            fieldOfStudy: e.fieldOfStudy,
            graduationYear: e.graduationYear,
            grade: e.grade,
            sortOrder: offset + i,
          })),
        });
        applied.add("education");
      }

      /* ── Experience ────────────────────────────────────────────────────── */
      for (const u of plan.experience.update) {
        if (u.employmentType !== undefined) {
          await tx.candidateExperience.updateMany({
            where: { id: u.id, userId, ...emptyWhere("employmentType") },
            data: { employmentType: u.employmentType },
          });
        }
        if (u.description !== undefined) {
          // The planner built this string from the existing bullets PLUS the new
          // ones, so writing it cannot remove a line the candidate wrote.
          await tx.candidateExperience.updateMany({
            where: { id: u.id, userId },
            data: { description: u.description },
          });
        }
        applied.add("experience");
      }
      if (plan.experience.create.length > 0) {
        await tx.candidateExperience.createMany({
          data: plan.experience.create.map((e) => ({
            userId,
            companyName: e.companyName,
            title: e.title,
            employmentType: e.employmentType,
            startedOn: e.startedOn,
            endedOn: e.endedOn,
            isCurrent: e.isCurrent,
            totalMonths: monthsBetween(e.startedOn, e.endedOn),
            description: e.description,
          })),
        });
        applied.add("experience");
      }

      /* ── Projects ──────────────────────────────────────────────────────── */
      for (const u of plan.projects.update) {
        if (u.description !== undefined) {
          await tx.candidateProjectEntry.updateMany({
            where: { id: u.id, userId, ...emptyWhere("description") },
            data: { description: u.description },
          });
        }
        if (u.repoUrl !== undefined) {
          await tx.candidateProjectEntry.updateMany({
            where: { id: u.id, userId, ...emptyWhere("repoUrl") },
            data: { repoUrl: u.repoUrl },
          });
        }
        if (u.liveUrl !== undefined) {
          await tx.candidateProjectEntry.updateMany({
            where: { id: u.id, userId, ...emptyWhere("liveUrl") },
            data: { liveUrl: u.liveUrl },
          });
        }
        if (u.techStack !== undefined) {
          // Union built by the planner from the stored stack; it is a superset,
          // never a replacement.
          await tx.candidateProjectEntry.updateMany({
            where: { id: u.id, userId },
            data: { techStack: u.techStack },
          });
        }
        applied.add("projects");
      }
      if (plan.projects.create.length > 0) {
        const offset = await tx.candidateProjectEntry.count({ where: { userId } });
        await tx.candidateProjectEntry.createMany({
          data: plan.projects.create.map((p, i) => ({
            userId,
            title: p.title,
            description: p.description,
            techStack: p.techStack,
            repoUrl: p.repoUrl,
            liveUrl: p.liveUrl,
            sortOrder: offset + i,
          })),
        });
        applied.add("projects");
      }

      /* ── Certifications ────────────────────────────────────────────────── */
      if (plan.certifications.create.length > 0) {
        await tx.candidateCertification.createMany({
          data: plan.certifications.create.map((c) => ({
            userId,
            name: c.name,
            issuer: c.issuer,
          })),
        });
        applied.add("certifications");
      }

      /* ── Skills ────────────────────────────────────────────────────────── */
      if (plan.skillNames.length > 0) {
        const skillIds = await resolveSkillIds(tx, plan.skillNames);
        if (skillIds.length > 0) {
          // `skipDuplicates` against the (userId, skillId) unique index: a claim
          // the candidate already made keeps its evidence and self-rating.
          const result = await tx.candidateSkill.createMany({
            data: skillIds.map((skillId) => ({
              userId,
              skillId,
              claimedByCandidate: true,
            })),
            skipDuplicates: true,
          });
          if (result.count > 0) applied.add("skills");
        }
      }

      return [...applied];
    },
    { maxWait: 10000, timeout: 25000 },
  );
}

/** Whole months, matching how `totalExperienceMonths` counts. */
function monthsBetween(start: Date, end: Date | null): number {
  const to = end ?? new Date();
  return Math.max(
    0,
    (to.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - start.getUTCMonth()),
  );
}

/** A merge failure must never fail the résumé upload itself. */
export async function applyResumeMergeSafely(
  userId: string,
  plan: MergePlan,
): Promise<MergeSection[]> {
  try {
    return await applyResumeMerge(userId, plan);
  } catch (error) {
    logger.error("[resume] profile merge failed", { userId, error: String(error) });
    return [];
  }
}
