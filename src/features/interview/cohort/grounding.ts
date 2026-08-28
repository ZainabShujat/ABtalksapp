import type {
  CohortCandidateContext,
  SubmittedDay,
  SubmittedProject,
} from "@/features/interview/cohort/candidate-context";
import type { GroundsOn } from "@/features/interview/cohort/question-bank";

/**
 * Turns a stored fact into one spoken clause in front of a bank question.
 *
 * This is the whole of "the AI knows what I worked on". It is deliberately the
 * dumbest possible implementation: a template over a database row. No model is
 * involved, so the interviewer structurally cannot invent a repo, a date or a
 * project that does not exist.
 *
 * Three invariants:
 *   1. The bank question text is NEVER rewritten. The graded question is
 *      byte-identical for every candidate; only the pointer in front of it is
 *      personal. That is what keeps two candidates' scores comparable.
 *   2. Missing data means NO clause, not a vaguer clause. A question with no
 *      matching artifact is spoken exactly as banked.
 *   3. The clause states a fact and stops. It never characterises the work
 *      ("your excellent retrieval engine") — that would leak assessment.
 *
 * Pure module: `import type` only from the server-only context module, so this
 * stays importable from a plain test script.
 */

/** Type-only projection of the context, so this module needs no database. */
export type GroundingFacts = Pick<
  CohortCandidateContext,
  "submissions" | "projects"
>;

export type GroundedQuestion = {
  /** What the interviewer says: optional clause + verbatim bank text. */
  spoken: string;
  /** True when a real artifact was found and referenced. */
  grounded: boolean;
  /** Human-readable note for the plan/report audit trail. */
  groundingNote: string | null;
};

function findSubmission(
  facts: GroundingFacts,
  day: number,
): SubmittedDay | null {
  return facts.submissions.find((s) => s.dayNumber === day) ?? null;
}

function findProject(
  facts: GroundingFacts,
  moduleNumber: number,
): SubmittedProject | null {
  return facts.projects.find((p) => p.moduleNumber === moduleNumber) ?? null;
}

/**
 * Builds the clause for one grounding slot, or null when the artifact is absent.
 *
 * Each branch requires the specific field it names to exist. A submission with
 * no `repoRef` yields no "repo" clause — it does not fall back to a vaguer
 * sentence, because a hedge is how a grounded interview starts sounding
 * generated.
 */
function buildClause(
  facts: GroundingFacts,
  groundsOn: GroundsOn,
): string | null {
  if (groundsOn.artifact === "project") {
    const project = findProject(facts, groundsOn.moduleNumber ?? 0);
    if (!project) return null;
    return `In your Module ${project.moduleNumber} project, "${project.title}" —`;
  }

  const day = groundsOn.day;
  if (day === undefined) return null;
  const submission = findSubmission(facts, day);
  if (!submission) return null;

  // THE DAY IS A LOOKUP KEY, NEVER A SPOKEN FACT.
  //
  // These clauses used to read "You pushed rag.py for Day 11 —" and "You
  // submitted Day 11 (RAG End-to-End) on 14 August —", which made the calendar
  // the subject of the question: the candidate heard themselves being examined
  // on when they learned something rather than on whether they understand it.
  //
  // `submission.title` is the CURRICULUM TITLE for that day ("Building the
  // Knowledge Base", "Retrieval Engine"), so naming the topic instead of the
  // number keeps the clause just as concrete and just as verifiable — it is
  // still a template over a database row, and still cannot invent anything —
  // while pointing at the work rather than at the schedule. `groundsOn.day`
  // stays exactly as it was for provenance and for finding the artifact.
  if (groundsOn.artifact === "repo") {
    if (!submission.repoRef) return null;
    return `In your ${submission.title} work you pushed ${submission.repoRef} —`;
  }

  // "submission": the always-available form, since the day is known to exist.
  // The date goes with the day number, for the same reason.
  return `When you worked through ${submission.title} —`;
}

/**
 * Grounds a question against real cohort work.
 *
 * `questionText` is passed verbatim and returned verbatim; only a prefix may be
 * added. Callers must never feed this function a model-generated question.
 */
export function groundQuestion(
  questionText: string,
  groundsOn: GroundsOn | undefined,
  facts: GroundingFacts,
): GroundedQuestion {
  if (!groundsOn) {
    return { spoken: questionText, grounded: false, groundingNote: null };
  }

  const clause = buildClause(facts, groundsOn);
  if (!clause) {
    return { spoken: questionText, grounded: false, groundingNote: null };
  }

  // Lowercase the first letter of the bank text only when the clause ends in a
  // dash, so "— You split the policy documents" reads as one sentence. The
  // words themselves are untouched.
  const joined = `${clause} ${questionText}`;

  return {
    spoken: joined,
    grounded: true,
    groundingNote: clause.replace(/\s+—$/, ""),
  };
}
