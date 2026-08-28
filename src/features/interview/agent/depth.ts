import type { DeepProbe, ScaffoldProbe } from "@/features/interview/cohort/question-bank";
import {
  CALIBRATION_ANSWERS,
  DEEP_PROBE_MIN_EVIDENCE,
  MAX_ESCALATIONS_PER_QUESTION,
  STRONG_ANSWERS_TO_RAISE_CEILING,
  WEAK_ANSWERS_TO_SUPPRESS,
} from "@/features/interview/constants";
import type {
  AnswerEvidence,
  Competency,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The depth ladder: how an interview responds to demonstrated competence.
 *
 * This is the module that separates an interview from a questionnaire. The
 * existing budget machine in `state.ts` answers "may we spend another turn on
 * this question"; this answers the different question "SHOULD we, and in which
 * direction" — deeper because the candidate is strong, or narrower because they
 * are struggling.
 *
 * Entirely pure and entirely deterministic. The model reports what it saw in an
 * answer; the ladder alone decides what that earns. A model cannot talk its way
 * into a harder or easier interview, and two candidates whose answers carry the
 * same evidence always travel the same path.
 */

/* ----------------------------------------------------------- active rung */

/**
 * What the interview is ACTUALLY assessing right now.
 *
 * Once a candidate has been escalated, the question on the floor is the rung,
 * not the core question — and a rung carries its own expected evidence. Judging
 * a level-2 answer against the level-1 checklist was the first bug the demo
 * exposed: a candidate who answered the harder question perfectly scored zero,
 * because they were being marked against a question nobody had asked them.
 *
 * The core question stays the unit of RECORD (it owns the competency, the
 * budget and the score); this view is the unit of JUDGMENT for one turn.
 */
export type ActiveQuestionView = {
  /** Text the candidate is answering. */
  text: string;
  expectedEvidence: readonly string[];
  minEvidence: number;
  /** Key this turn's evidence is stored under. */
  evidenceKey: string;
  /** True when a rung, not the core question, is being answered. */
  isProbe: boolean;
};

export function activeQuestionView(
  question: PlannedQuestion,
  depthLevel: number,
): ActiveQuestionView {
  const rung = question.deepProbes?.find((p) => p.level === depthLevel);

  if (!rung) {
    return {
      text: question.spokenText ?? question.text,
      expectedEvidence: question.expectedEvidence ?? [],
      minEvidence: question.minEvidence ?? 1,
      evidenceKey: question.id,
      isProbe: false,
    };
  }

  return {
    text: rung.text,
    expectedEvidence: rung.expectedEvidence,
    minEvidence: Math.min(DEEP_PROBE_MIN_EVIDENCE, rung.expectedEvidence.length),
    // A separate key: rung and core checklists are different index spaces, and
    // merging them would make `matchedEvidence: [1]` ambiguous about which
    // checklist item it refers to.
    evidenceKey: `${question.id}@L${rung.level}`,
    isProbe: true,
  };
}

/**
 * A `PlannedQuestion` as the rung currently being asked, for the evaluator and
 * the classifier. Everything not related to the checklist is passed through
 * untouched, so competency, budgets and provenance stay those of the core
 * question.
 */
export function questionAsAsked(
  question: PlannedQuestion,
  depthLevel: number,
): PlannedQuestion {
  const view = activeQuestionView(question, depthLevel);
  if (!view.isProbe) return question;

  return {
    ...question,
    text: view.text,
    spokenText: view.text,
    expectedEvidence: [...view.expectedEvidence],
    minEvidence: view.minEvidence,
  };
}

/* --------------------------------------------------------- answer strength */

export type AnswerStrength = "STRONG" | "PARTIAL" | "WEAK";

/**
 * Grades one answer against the question's OWN bar.
 *
 * `minEvidence` comes from the bank and differs per question, so "strong" means
 * "cleared the bar this question sets", not a global word count or a model's
 * impression. A question with no checklist (the general interviewer's
 * questions) falls back to the evidence axes.
 */
export function classifyAnswer(
  question: PlannedQuestion,
  evidence: AnswerEvidence,
): AnswerStrength {
  if (evidence.flaggedIssues.includes("off_topic")) return "WEAK";
  if (evidence.flaggedIssues.includes("stuck_or_evasive")) return "WEAK";

  const bar = question.minEvidence;

  // ABSENT and EMPTY are different claims, and conflating them is a real bug:
  //   - `[]`        the judge looked and found nothing  → a weak answer
  //   - `undefined` nothing judged it (degraded turn, a provider predating the
  //                 field, an old persisted attempt) → no claim was made, so
  //                 falling back to the evidence axes is the honest reading
  // Treating `undefined` as zero would silently mark every answer weak the
  // moment the model was unavailable, turning an outage into a scoring event.
  const hasChecklistJudgment =
    evidence.matchedEvidence !== undefined &&
    bar !== undefined &&
    (question.expectedEvidence?.length ?? 0) > 0;

  if (hasChecklistJudgment) {
    const matched = evidence.matchedEvidence!.length;
    if (matched >= bar!) return "STRONG";
    // One short of the bar is a real answer with a hole in it — exactly what a
    // follow-up is for. Zero or one item is not yet an attempt at the question.
    return matched >= bar! - 1 && matched > 0 ? "PARTIAL" : "WEAK";
  }

  const axes =
    Number(evidence.conceptualFound) +
    Number(evidence.practicalFound) +
    Number(evidence.tradeoffsFound);
  if (axes >= 2) return "STRONG";
  return axes === 1 ? "PARTIAL" : "WEAK";
}

/* ------------------------------------------------------ competence signal */

export type CompetenceSignal = NonNullable<InterviewState["competenceSignal"]>;

/**
 * Updates the running consecutive-strong / consecutive-weak counters.
 *
 * Only the competency just examined moves. A STRONG answer clears the weak
 * streak and vice versa — which is the mechanism behind "do not punish a
 * candidate indefinitely for one weak answer": recovery is immediate, and the
 * suppression rule below needs a *streak*, not an incident.
 */
export function updateCompetenceSignal(
  signal: CompetenceSignal | undefined,
  competency: Competency,
  strength: AnswerStrength,
): CompetenceSignal {
  const current = signal?.[competency] ?? { strong: 0, weak: 0 };
  const next =
    strength === "STRONG"
      ? { strong: current.strong + 1, weak: 0 }
      : strength === "WEAK"
        ? { strong: 0, weak: current.weak + 1 }
        : { strong: 0, weak: 0 };

  return { ...(signal ?? {}), [competency]: next };
}

export type Calibration = NonNullable<InterviewState["calibration"]>;

/**
 * Reads the candidate's level from their first few core answers, once.
 *
 * A human interviewer spends the opening minutes working out who they are
 * talking to, then pitches the rest accordingly: they push a strong candidate
 * toward their ceiling and stop pushing someone who is already struggling.
 * Without this the interview treats question ten exactly like question one.
 *
 * Only CORE answers count, and only until `CALIBRATION_ANSWERS` of them have
 * landed. After that the level is frozen: re-reading it every turn would make
 * it a rolling average, which is what `competenceSignal` already is.
 */
export function updateCalibration(
  calibration: Calibration | undefined,
  strength: AnswerStrength,
  tier: string,
): Calibration {
  const current = calibration ?? { answered: 0, strong: 0, weak: 0, level: null };

  // Extension questions sit outside the comparable spine, so they must not
  // decide how the rest of the assessed interview is pitched.
  if (current.level !== null || tier !== "CORE") return current;

  const answered = current.answered + 1;
  const strong = current.strong + (strength === "STRONG" ? 1 : 0);
  const weak = current.weak + (strength === "WEAK" ? 1 : 0);

  if (answered < CALIBRATION_ANSWERS) {
    return { answered, strong, weak, level: null };
  }

  // Majority decides. A candidate has to be mostly strong to earn the harder
  // interview, and mostly weak before the interview eases off — a single bad
  // answer in three does not relabel someone.
  const level: Calibration["level"] =
    strong > answered / 2 ? "ADVANCED" : weak > answered / 2 ? "FOUNDATIONS" : "WORKING";

  return { answered, strong, weak, level };
}

/**
 * How many escalations this competency may spend on the current question.
 *
 * Base allowance is one. A candidate on a strong streak earns the second rung —
 * the interview is actively hunting for their ceiling. A candidate on a weak
 * streak earns none until they recover, so the interview stops pushing someone
 * who is already underwater.
 */
export function escalationCeiling(
  signal: CompetenceSignal | undefined,
  competency: Competency,
  level?: Calibration["level"],
): number {
  const current = signal?.[competency] ?? { strong: 0, weak: 0 };
  if (current.weak >= WEAK_ANSWERS_TO_SUPPRESS) return 0;
  if (current.strong >= STRONG_ANSWERS_TO_RAISE_CEILING) {
    return MAX_ESCALATIONS_PER_QUESTION;
  }

  // The calibrated read shifts the STARTING posture, and is deliberately weaker
  // than the live streak above: a candidate who opened badly but is answering
  // well now still earns the full ceiling, and one who opened well but is
  // struggling now is still suppressed. Recent evidence beats an early
  // impression, which is also how a fair human interviewer behaves.
  if (level === "ADVANCED") return MAX_ESCALATIONS_PER_QUESTION;
  if (level === "FOUNDATIONS") return 0;
  return 1;
}

/* ------------------------------------------------------------- rung lookup */

/**
 * The escalation rung for the depth the interview is currently at.
 *
 * `depthLevel` 1 (the core question) resolves to the level-2 probe, and so on.
 * Rungs are looked up by their declared level rather than by array position, so
 * a bank that skips a level degrades to "no rung" instead of silently asking
 * the wrong one.
 */
export function nextDeepProbe(
  question: PlannedQuestion,
  depthLevel: number,
): DeepProbe | null {
  const target = depthLevel + 1;
  return (
    question.deepProbes?.find((probe) => probe.level === target) ?? null
  );
}

/**
 * The scaffold to offer a struggling candidate.
 *
 * Prefers one aimed at an expected item they have NOT yet covered — a scaffold
 * pointing at something they already said would read as if the interviewer were
 * not listening. Falls back to the first scaffold when everything is covered
 * but the bar is still unmet.
 */
export function nextScaffoldProbe(
  question: PlannedQuestion,
  evidence: AnswerEvidence,
): ScaffoldProbe | null {
  const scaffolds = question.scaffoldProbes ?? [];
  if (scaffolds.length === 0) return null;

  const expected = question.expectedEvidence ?? [];
  const matched = new Set(evidence.matchedEvidence ?? []);
  const uncovered = new Set(
    expected.filter((_, index) => !matched.has(index)),
  );

  return (
    scaffolds.find((s) => uncovered.has(s.targets)) ?? scaffolds[0] ?? null
  );
}

/* ------------------------------------------------------------- the ladder */

export type LadderMove =
  | { move: "ESCALATE"; probe: DeepProbe; rationale: string }
  | {
      move: "SCAFFOLD";
      probe: ScaffoldProbe | null;
      /** WEAK needs a simpler question; PARTIAL needs the specific gap probed. */
      strength: Extract<AnswerStrength, "WEAK" | "PARTIAL">;
      rationale: string;
    }
  | { move: "MOVE_ON"; rationale: string };

/**
 * The whole adaptive decision, as one pure function.
 *
 * Note what is NOT consulted: the model's proposed action. The model reports
 * evidence; the ladder decides direction. `policy.ts` then applies the budgets.
 * Keeping these three concerns in three functions is what makes the behaviour
 * testable without a network and auditable in a diff.
 */
export function decideLadderMove(
  question: PlannedQuestion,
  evidence: AnswerEvidence,
  state: InterviewState,
): LadderMove {
  const strength = classifyAnswer(question, evidence);
  const depthLevel = state.depthLevel ?? 1;
  const escalationsAsked = state.escalationsAsked ?? 0;

  if (strength === "STRONG") {
    // The ceiling is read from the signal INCLUDING the answer just given. The
    // decision is about this answer, so excluding it would mean a candidate who
    // answers strongly twice in a row on one question never reaches the second
    // rung — the streak would always be measured one answer behind the
    // conversation.
    const projected = updateCompetenceSignal(
      state.competenceSignal,
      question.competency,
      strength,
    );
    const ceiling = escalationCeiling(
      projected,
      question.competency,
      state.calibration?.level ?? null,
    );
    if (escalationsAsked >= ceiling) {
      return {
        move: "MOVE_ON",
        rationale: `Cleared the bar; escalation ceiling ${ceiling} already spent.`,
      };
    }

    const probe = nextDeepProbe(question, depthLevel);
    if (!probe) {
      return {
        move: "MOVE_ON",
        rationale: `Cleared the bar; no rung deeper than level ${depthLevel}.`,
      };
    }

    return {
      move: "ESCALATE",
      probe,
      rationale: `Cleared the bar at depth ${depthLevel}; going to level ${probe.level}.`,
    };
  }

  if (strength === "WEAK") {
    // A blank or evasive answer is never scaffolded — that is handled upstream
    // by the stuck rule, because probing someone who said "I don't know" twice
    // is not assessment, it is attrition.
    if (
      evidence.flaggedIssues.includes("stuck_or_evasive") ||
      evidence.flaggedIssues.includes("off_topic")
    ) {
      return { move: "MOVE_ON", rationale: "Stuck or off-topic; not probing." };
    }
    return {
      move: "SCAFFOLD",
      probe: nextScaffoldProbe(question, evidence),
      strength: "WEAK",
      rationale: "Below the bar; narrowing the question.",
    };
  }

  return {
    move: "SCAFFOLD",
    probe: nextScaffoldProbe(question, evidence),
    strength: "PARTIAL",
    rationale: "One evidence item short; probing the gap.",
  };
}
