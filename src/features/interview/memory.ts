import type { InterviewPlan, InterviewState } from "@/features/interview/types";

/**
 * What the interviewer remembers from earlier in this conversation.
 *
 * The transcript window handed to the model is four lines — roughly two
 * exchanges — which is enough to resolve a pronoun and nothing else. By
 * question six the interviewer had no idea what the candidate committed to at
 * question two, so continuity ("you mentioned FAISS earlier") and contradiction
 * detection were structurally impossible rather than badly prompted.
 *
 * This builds a compact standing summary instead: one line per answered core
 * question, naming the topic and the specific things that answer established.
 *
 * Deterministic and free. It is assembled from evidence already stored on the
 * interview state — no second model call, no extra latency, and the same
 * interview always produces the same memory, so a replayed turn cannot drift.
 */

/** Lines kept. Enough for continuity, small enough not to crowd the prompt. */
const MAX_MEMORY_LINES = 10;

/** Characters of the candidate's own wording carried per question. */
const MAX_QUOTE_CHARS = 120;

function firstSentence(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * A short label for what a question was about.
 *
 * Taken from the authored question text rather than generated, so the memory
 * can never introduce a topic the interview did not actually cover.
 */
function topicOf(questionText: string): string {
  return firstSentence(questionText, 90);
}

export function buildInterviewMemory(
  plan: InterviewPlan,
  state: InterviewState,
): string[] {
  const lines: string[] = [];

  for (const question of plan.questions) {
    const evidence = state.evidenceByQuestionId[question.id];
    if (!evidence) continue;

    // The authored items this answer actually covered. These are the concrete
    // commitments — "chose Chroma", "500-character chunks" — and they are
    // authored strings, so nothing here is invented.
    const covered = (evidence.matchedEvidence ?? [])
      .map((i) => question.expectedEvidence?.[i])
      .filter((item): item is string => typeof item === "string" && item.length > 0);

    // Their own words, so a later question can quote them rather than
    // paraphrase. Taken from the transcript, which stores answers verbatim.
    const answer = [...state.transcript]
      .reverse()
      .find((line) => line.role === "candidate" && line.questionId === question.id);

    const parts: string[] = [`${topicOf(question.text)}`];
    if (covered.length > 0) parts.push(`established: ${covered.join("; ")}`);
    if (answer) parts.push(`said: "${firstSentence(answer.text, MAX_QUOTE_CHARS)}"`);

    lines.push(`- ${parts.join(" — ")}`);
  }

  // Keep the MOST RECENT if the interview runs long: the opening exchanges
  // matter less to continuity than what was just discussed, and an unbounded
  // memory would grow the prompt on every turn against a tokens-per-minute
  // budget a long interview can already exhaust.
  return lines.slice(-MAX_MEMORY_LINES);
}
