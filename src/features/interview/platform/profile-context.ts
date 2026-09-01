import type { CandidateContext } from "@/features/interview/types";

/**
 * What the interviewer knows about the person before they say anything.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
 *
 *   Profile CONTEXTUALISES questioning. It NEVER establishes evidence.
 *
 * A profile that says "built a RAG chatbot" earns a better opening question. It
 * does not earn a mark for understanding retrieval. Only an answer does that.
 * The separation is structural rather than a matter of prompt discipline: this
 * function returns a STRING that is handed to the model as conversation
 * context, and nothing in the scoring path can read it. Evidence enters the
 * system through exactly one door — `matchedEvidence` on an answer — and that
 * door is nowhere near here.
 *
 * NOTHING IS INVENTED. Every line is a field the user filled in themselves. A
 * missing field produces no line at all rather than a hedge, for the same
 * reason `cohort/grounding.ts` drops a clause when the artifact is absent: an
 * interviewer who refers to work you did not do destroys your trust in every
 * question that follows.
 *
 * Pure module — no `server-only`, no Prisma. It formats a context object that
 * `candidate-context.ts` already built.
 */

/** Skills listed, capped. A wall of tags is not context, it is noise. */
const MAX_SKILLS = 12;
/** Projects/experience lines carried. Enough to be specific, few enough to fit. */
const MAX_PROJECTS = 4;
const MAX_LINE_CHARS = 160;

function trim(text: string, limit = MAX_LINE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * A compact, labelled description of the candidate.
 *
 * Returns an empty string when there is genuinely nothing to say, which is the
 * common case for a brand-new account and must produce a perfectly sensible
 * interview rather than a degraded one.
 */
export function formatProfileContext(
  context: CandidateContext | null,
): string {
  if (!context) return "";

  const lines: string[] = [];

  /* --- who they are ----------------------------------------------------- */

  const role = [context.role, context.organization]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" at ");
  if (role) lines.push(`Role: ${trim(role)}`);

  if (typeof context.yearsExperience === "number" && context.yearsExperience > 0) {
    lines.push(
      `Experience: ${context.yearsExperience} year${
        context.yearsExperience === 1 ? "" : "s"
      }`,
    );
  }
  if (context.college?.trim()) lines.push(`Studied at: ${trim(context.college)}`);
  if (context.domain?.trim()) lines.push(`Track: ${trim(context.domain)}`);

  /* --- what they say they can do ---------------------------------------- */

  const skills = context.resume.skills
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SKILLS);
  if (skills.length > 0) lines.push(`Lists these skills: ${skills.join(", ")}`);

  if (context.resume.headline?.trim()) {
    lines.push(`Describes themselves as: ${trim(context.resume.headline)}`);
  }

  /* --- what they say they have built ------------------------------------ */

  const projects = context.resume.projects
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_PROJECTS);
  if (projects.length > 0) {
    lines.push(
      `Says they have built: ${projects.map((p) => trim(p, 100)).join("; ")}`,
    );
  }

  for (const job of context.resume.experience.slice(0, MAX_PROJECTS)) {
    const where = [job.title, job.company].filter(Boolean).join(" at ");
    if (!where) continue;
    const first = job.highlights.find((h) => h.trim());
    lines.push(
      first ? `Worked as ${trim(where, 80)}: ${trim(first, 120)}` : `Worked as ${trim(where, 80)}`,
    );
  }

  /* --- what they have actually completed on ABTalks --------------------- */

  // Completed challenge days are the one item here that is closer to a fact
  // than a claim, because a submission exists. It is still NOT evidence of
  // understanding — it says they shipped something, not that they can explain
  // it — so it is phrased as history rather than as capability.
  const days = context.challenge.totalCompletedDays;
  if (days > 0) {
    const recent = context.challenge.tasks
      .slice(0, MAX_PROJECTS)
      .map((t) => trim(t.title, 70));
    lines.push(
      `Has completed ${days} day${days === 1 ? "" : "s"} of ABTalks challenge work` +
        (recent.length > 0 ? `, most recently: ${recent.join("; ")}` : ""),
    );
  }

  if (lines.length === 0) return "";

  return lines.join("\n");
}

/**
 * True when there is enough here to open the interview with a specific
 * reference rather than a generic greeting.
 *
 * Deliberately strict: one lonely field ("Track: AI") is not enough to make an
 * opening sound informed, and an interviewer straining to personalise from
 * nothing is worse than one that simply gets on with it.
 */
export function hasUsableProfile(context: CandidateContext | null): boolean {
  if (!context) return false;
  return (
    context.resume.skills.length > 0 ||
    context.resume.projects.length > 0 ||
    context.resume.experience.length > 0 ||
    context.challenge.totalCompletedDays > 0 ||
    Boolean(context.role?.trim())
  );
}
