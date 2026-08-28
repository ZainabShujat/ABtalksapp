import { moduleForDay } from "@/features/interview/cohort/curriculum";
import { DEEP_PROBE_MIN_EVIDENCE } from "@/features/interview/constants";
import {
  scoreQuestion,
  type QuestionScore,
} from "@/features/interview/module-scoring";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The analytical half of the report: question assessments, skill
 * classification, agent insights, transcript selection and assessment status.
 *
 * Everything here is DERIVED from what the interview recorded — the frozen
 * plan, the runtime state, and the durable turn rows. No model is consulted and
 * no number is invented. `report.ts` may ask a model to phrase things
 * afterwards, but every fact it is allowed to state originates in this file.
 *
 * Pure module: no `server-only`, no Prisma, no network.
 */

/* ------------------------------------------------------------------ scale */

/**
 * The report speaks in /10 while the engine computes in /100.
 *
 * One conversion point, one decimal place. The 0–100 value stays the source of
 * truth on the interview row so historical scores and the talent pool keep
 * their existing scale.
 */
export function toTen(scoreOutOfHundred: number): number {
  return Math.round(scoreOutOfHundred) / 10;
}

/* ---------------------------------------------------------------- turns */

/** The turn rows the report needs. Mirrors `repository.loadTurns`. */
export type TurnRow = {
  turnIndex: number;
  questionId: string;
  tier: string;
  depthLevel: number;
  action: string;
  promptText: string;
  answerText: string;
  evidence: {
    matchedEvidence?: number[];
    relevance?: string;
    flaggedIssues?: string[];
    reasoning?: string;
  } | null;
  degraded: boolean;
};

/* ----------------------------------------------------- question assessment */

export type ProbeAssessment = {
  level: number;
  mode: string;
  question: string;
  answerExcerpt: string;
  expected: string[];
  demonstrated: string[];
  missing: string[];
  cleared: boolean;
  outcome: string;
};

export type QuestionAssessment = {
  questionId: string;
  order: number;
  question: string;
  /** What the candidate actually heard, grounding clause included. */
  askedAs: string;
  mode: string;
  competency: string;
  moduleNumber: number | null;
  moduleTitle: string | null;
  sourceDays: number[];
  /** The expected-evidence items are the skills this question tests. */
  skillsTested: string[];
  score: number;
  scoreOutOfTen: number;
  answered: boolean;
  expected: string[];
  demonstrated: string[];
  /**
   * Items surfaced only on a deeper probe. The candidate got there, but not on
   * the question as asked — a real and reportable distinction.
   */
  partiallyDemonstrated: string[];
  missing: string[];
  answerExcerpt: string;
  whyThisScore: string;
  probes: ProbeAssessment[];
  followUpCount: number;
  depthReached: number;
  /** False when the evaluator never judged this answer (provider outage). */
  judged: boolean;
  strength:
    | "STRONG"
    | "PARTIAL"
    | "WEAK"
    | "OFF_TOPIC"
    | "UNANSWERED"
    | "NOT_JUDGED";
};

const EXCERPT = 420;

function excerpt(text: string, limit = EXCERPT): string {
  const t = (text ?? "").trim();
  return t.length > limit ? `${t.slice(0, limit)}…` : t;
}

function itemsFor(
  expected: readonly string[],
  matched: number[] | undefined,
): { demonstrated: string[]; missing: string[] } {
  const set = new Set(matched ?? []);
  return {
    demonstrated: expected.filter((_, i) => set.has(i)),
    missing: expected.filter((_, i) => !set.has(i)),
  };
}

/**
 * Why a question scored what it scored, in one sentence built from the
 * evidence itself.
 *
 * Deliberately mechanical. A reader can check every clause against the lists
 * printed beside it, which is the difference between an explanation and a
 * flattering paragraph.
 */
function explainScore(
  score: QuestionScore,
  demonstrated: string[],
  missing: string[],
  probesCleared: number,
): string {
  if (!score.answered) {
    return "Not reached before the interview ended, so no evidence was recorded.";
  }

  if (!score.judged) {
    // Saying "missing" here would be a claim about the answer that nobody
    // made. The candidate answered; the evaluator was down.
    return "Not assessed — the answer was recorded but the evaluator was unavailable, so no judgement was made about which expected points it covered. This question is excluded from the scores above.";
  }

  const ten = toTen(score.score).toFixed(1);

  if (demonstrated.length === 0) {
    return `${ten}/10 — the answer addressed the question but did not establish any of the ${score.expected} expected points, including ${missing.slice(0, 2).join(" and ")}.`;
  }

  const cleared = score.cleared
    ? `cleared the bar of ${score.minEvidence} with ${demonstrated.length} of ${score.expected} points`
    : `fell short of the bar of ${score.minEvidence}, establishing ${demonstrated.length} of ${score.expected} points`;

  const gap =
    missing.length > 0
      ? ` Not covered: ${missing.join("; ")}.`
      : " Every expected point was covered.";

  const depth =
    probesCleared > 0
      ? ` Held up under ${probesCleared} deeper probe${probesCleared === 1 ? "" : "s"}, which adds to the score.`
      : "";

  return `${ten}/10 — ${cleared}: ${demonstrated.join("; ")}.${gap}${depth}`;
}

export function buildQuestionAssessments(
  plan: InterviewPlan,
  state: InterviewState,
  turns: TurnRow[],
): QuestionAssessment[] {
  return plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .map((question, index) => {
      const score = scoreQuestion(question, state);
      const expected = question.expectedEvidence ?? [];
      const core = state.evidenceByQuestionId[question.id];
      const { demonstrated, missing } = itemsFor(expected, core?.matchedEvidence);

      const probes = buildProbes(question, state, turns);

      // A point first surfaced on a probe is partial credit, not full: they
      // needed a second, narrower question to get there.
      const viaProbe = new Set<string>();
      for (const probe of probes) {
        for (const item of probe.demonstrated) {
          if (missing.includes(item)) viaProbe.add(item);
        }
      }

      const answerTurn = turns.find(
        (t) => t.questionId === question.id && t.depthLevel === 1,
      );

      const curriculumModule = moduleForDay(question.sourceRef.sourceDays?.[0] ?? 0);
      const followUps = turns.filter(
        (t) => t.questionId === question.id && t.action === "FOLLOW_UP",
      ).length;

      const offTopic =
        core?.relevance === "OFF_TOPIC" ||
        (core?.flaggedIssues ?? []).includes("off_topic");

      const strength: QuestionAssessment["strength"] = !score.answered
        ? "UNANSWERED"
        : !score.judged
          ? "NOT_JUDGED"
          : offTopic
          ? "OFF_TOPIC"
          : score.cleared
            ? "STRONG"
            : demonstrated.length > 0
              ? "PARTIAL"
              : "WEAK";

      return {
        questionId: question.id,
        order: index + 1,
        question: question.text,
        askedAs: question.spokenText ?? question.text,
        mode: question.mode ?? "CONCEPTUAL",
        competency: question.competency,
        moduleNumber: curriculumModule?.number ?? null,
        moduleTitle: curriculumModule?.title ?? null,
        sourceDays: question.sourceRef.sourceDays ?? [],
        skillsTested: [...expected],
        score: score.score,
        scoreOutOfTen: toTen(score.score),
        answered: score.answered,
        judged: score.judged,
        expected: [...expected],
        demonstrated: score.judged ? demonstrated : [],
        partiallyDemonstrated: score.judged ? [...viaProbe] : [],
        // An unjudged answer yields no "missing" list. We do not know what it
        // covered, and printing the whole checklist as missing is exactly the
        // false claim this fix removes.
        missing: score.judged ? missing.filter((m) => !viaProbe.has(m)) : [],
        answerExcerpt: excerpt(
          answerTurn?.answerText ?? answerExcerptFromState(state, question.id),
        ),
        whyThisScore: explainScore(
          score,
          demonstrated,
          missing,
          probes.filter((p) => p.cleared).length,
        ),
        probes,
        followUpCount: followUps,
        depthReached: score.depthReached,
        strength,
      };
    });
}

function answerExcerptFromState(
  state: InterviewState,
  questionId: string,
): string {
  return (
    state.transcript.find(
      (l) => l.role === "candidate" && l.questionId === questionId,
    )?.text ?? ""
  );
}

/**
 * Deep probes, nested under the question that earned them.
 *
 * A probe is never reported as its own question. It is what happened *inside*
 * one question, and flattening it would make an interview look longer and a
 * candidate look more tested than they were.
 */
function buildProbes(
  question: PlannedQuestion,
  state: InterviewState,
  turns: TurnRow[],
): ProbeAssessment[] {
  return (question.deepProbes ?? [])
    .map((probe): ProbeAssessment | null => {
      const key = `${question.id}@L${probe.level}`;
      const evidence = state.evidenceByQuestionId[key];
      if (!evidence) return null;

      const { demonstrated, missing } = itemsFor(
        probe.expectedEvidence,
        evidence.matchedEvidence,
      );
      const bar = Math.min(
        DEEP_PROBE_MIN_EVIDENCE,
        probe.expectedEvidence.length,
      );
      const cleared = demonstrated.length >= bar;

      const answer = turns.find(
        (t) => t.questionId === question.id && t.depthLevel === probe.level,
      );

      return {
        level: probe.level,
        mode: probe.mode,
        question: probe.text,
        answerExcerpt: excerpt(answer?.answerText ?? ""),
        expected: [...probe.expectedEvidence],
        demonstrated,
        missing,
        cleared,
        outcome: cleared
          ? `Handled the deeper question, adding ${demonstrated.join("; ")}.`
          : demonstrated.length > 0
            ? `Partially handled: ${demonstrated.join("; ")}. Still missing ${missing.slice(0, 2).join("; ")}.`
            : "Did not add evidence at this depth.",
      };
    })
    .filter((probe): probe is ProbeAssessment => probe !== null);
}

/* ------------------------------------------------------ skills */

export type SkillLevel =
  | "STRONG"
  | "DEVELOPING"
  | "WEAK"
  | "NOT_DEMONSTRATED"
  | "NOT_ASSESSED";

export type SkillAssessment = {
  skill: string;
  level: SkillLevel;
  evidenceRefs: string[];
  note: string;
};

/**
 * Skill classification, derived from the expected-evidence items themselves.
 *
 * The bank's expected evidence IS the skill list — every item is a thing an
 * assessment author decided this question should elicit. Nothing is invented,
 * and a skill can only be reported as absent if a question that tests it was
 * actually answered. That last rule is what separates "did not demonstrate"
 * from "was never asked", which a candidate deserves to have distinguished.
 */
export function classifySkills(
  assessments: QuestionAssessment[],
): SkillAssessment[] {
  type Acc = {
    demonstratedOn: string[];
    partialOn: string[];
    missedOnWeak: string[];
    missedOnOk: string[];
    unansweredOn: string[];
  };

  const byskill = new Map<string, Acc>();
  const get = (s: string): Acc => {
    let acc = byskill.get(s);
    if (!acc) {
      acc = {
        demonstratedOn: [],
        partialOn: [],
        missedOnWeak: [],
        missedOnOk: [],
        unansweredOn: [],
      };
      byskill.set(s, acc);
    }
    return acc;
  };

  for (const a of assessments) {
    // Unreached AND unjudged both mean "no verdict exists". Only a judged
    // answer can establish that a skill was absent.
    if (!a.answered || !a.judged) {
      for (const skill of a.skillsTested) get(skill).unansweredOn.push(a.questionId);
      continue;
    }
    for (const skill of a.demonstrated) get(skill).demonstratedOn.push(a.questionId);
    for (const skill of a.partiallyDemonstrated) get(skill).partialOn.push(a.questionId);
    for (const skill of a.missing) {
      const acc = get(skill);
      // "Weak" means they engaged with the question and still missed this;
      // "not demonstrated" means the question went fine and this simply never
      // came up. Different feedback, so different classification.
      if (a.strength === "WEAK" || a.strength === "OFF_TOPIC") acc.missedOnWeak.push(a.questionId);
      else acc.missedOnOk.push(a.questionId);
    }
  }

  const out: SkillAssessment[] = [];
  for (const [skill, acc] of byskill) {
    const answeredAnywhere =
      acc.demonstratedOn.length +
      acc.partialOn.length +
      acc.missedOnWeak.length +
      acc.missedOnOk.length;

    if (answeredAnywhere === 0) {
      out.push({
        skill,
        level: "NOT_ASSESSED",
        evidenceRefs: acc.unansweredOn,
        note: "No verdict — the question was not reached, or the evaluator was unavailable.",
      });
      continue;
    }

    if (acc.demonstratedOn.length > 0 && acc.missedOnWeak.length === 0) {
      out.push({
        skill,
        level: "STRONG",
        evidenceRefs: acc.demonstratedOn,
        note: "Stated clearly in the answer.",
      });
      continue;
    }

    if (acc.demonstratedOn.length > 0 || acc.partialOn.length > 0) {
      out.push({
        skill,
        level: "DEVELOPING",
        evidenceRefs: [...acc.demonstratedOn, ...acc.partialOn],
        note:
          acc.partialOn.length > 0
            ? "Reached only after a deeper probe."
            : "Shown on one question but missed on another.",
      });
      continue;
    }

    if (acc.missedOnWeak.length > 0) {
      out.push({
        skill,
        level: "WEAK",
        evidenceRefs: acc.missedOnWeak,
        note: "The answer engaged with the question but did not establish this.",
      });
      continue;
    }

    out.push({
      skill,
      level: "NOT_DEMONSTRATED",
      evidenceRefs: acc.missedOnOk,
      note: "Expected by the question and not mentioned.",
    });
  }

  return out;
}

/* ------------------------------------------------------- agent insights */

export type AgentInsight = { label: string; detail: string; evidenceRefs: string[] };

/**
 * The evaluator-level synthesis, computed rather than written.
 *
 * Each insight is a fact with the question ids behind it. "Candidate showed
 * great potential" is exactly what this is designed to make impossible.
 */
export function buildAgentInsights(
  assessments: QuestionAssessment[],
  skills: SkillAssessment[],
): AgentInsight[] {
  // Only judged answers carry a verdict worth synthesising.
  const answered = assessments.filter((a) => a.answered && a.judged);
  if (answered.length === 0) return [];

  const insights: AgentInsight[] = [];
  const ranked = [...answered].sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;

  insights.push({
    label: "Strongest answer",
    detail: `${best.question} — ${toTen(best.score).toFixed(1)}/10, covering ${best.demonstrated.length} of ${best.expected.length} expected points.`,
    evidenceRefs: [best.questionId],
  });

  if (worst.questionId !== best.questionId) {
    insights.push({
      label: "Weakest answer",
      detail: `${worst.question} — ${toTen(worst.score).toFixed(1)}/10${
        worst.missing.length > 0 ? `, missing ${worst.missing.slice(0, 2).join("; ")}` : ""
      }.`,
      evidenceRefs: [worst.questionId],
    });
  }

  const probed = answered.filter((a) => a.probes.length > 0);
  const probesCleared = probed.reduce(
    (n, a) => n + a.probes.filter((p) => p.cleared).length,
    0,
  );
  const probesTotal = probed.reduce((n, a) => n + a.probes.length, 0);
  if (probesTotal > 0) {
    insights.push({
      label: "Response to deeper probing",
      detail:
        probesCleared === 0
          ? `Was taken deeper ${probesTotal} time${probesTotal === 1 ? "" : "s"} and did not add evidence at that depth.`
          : `Cleared ${probesCleared} of ${probesTotal} deeper probes, so the depth is real rather than a strong first answer.`,
      evidenceRefs: probed.map((a) => a.questionId),
    });
  }

  const recovered = answered.filter(
    (a) => a.followUpCount > 0 && a.partiallyDemonstrated.length > 0,
  );
  if (recovered.length > 0) {
    insights.push({
      label: "Recovery after scaffolding",
      detail: `On ${recovered.length} question${recovered.length === 1 ? "" : "s"} a narrower follow-up unlocked evidence the first answer missed.`,
      evidenceRefs: recovered.map((a) => a.questionId),
    });
  }

  const offTopic = answered.filter((a) => a.strength === "OFF_TOPIC");
  if (offTopic.length > 0) {
    insights.push({
      label: "Focus",
      detail: `${offTopic.length} answer${offTopic.length === 1 ? "" : "s"} did not address the question and were redirected.`,
      evidenceRefs: offTopic.map((a) => a.questionId),
    });
  }

  const strongSkills = skills.filter((s) => s.level === "STRONG");
  if (strongSkills.length > 0) {
    insights.push({
      label: "Strongest technical signal",
      detail: strongSkills
        .slice(0, 3)
        .map((s) => s.skill)
        .join("; "),
      evidenceRefs: [...new Set(strongSkills.flatMap((s) => s.evidenceRefs))].slice(0, 6),
    });
  }

  const gaps = skills.filter(
    (s) => s.level === "NOT_DEMONSTRATED" || s.level === "WEAK",
  );
  if (gaps.length > 0) {
    insights.push({
      label: "Most important gap",
      detail: gaps
        .slice(0, 3)
        .map((s) => s.skill)
        .join("; "),
      evidenceRefs: [...new Set(gaps.flatMap((s) => s.evidenceRefs))].slice(0, 6),
    });
  }

  // Consistency: how far apart the best and worst answers were.
  const spread = best.score - worst.score;
  insights.push({
    label: "Consistency",
    detail:
      spread <= 20
        ? "Performance was even across questions."
        : `Uneven — ${toTen(spread).toFixed(1)} points of spread between the strongest and weakest answers.`,
    evidenceRefs: [best.questionId, worst.questionId],
  });

  return insights;
}

/* --------------------------------------------------- transcript excerpts */

export type TranscriptExcerpt = {
  questionId: string;
  reason: string;
  question: string;
  answer: string;
};

/**
 * A handful of excerpts that carry the assessment, not the whole transcript.
 *
 * A reader who checks four quotes should be able to agree or disagree with the
 * score. Dumping forty turns achieves the opposite.
 */
export function selectTranscriptExcerpts(
  assessments: QuestionAssessment[],
): TranscriptExcerpt[] {
  const answered = assessments.filter(
    (a) => a.answered && a.judged && a.answerExcerpt,
  );
  if (answered.length === 0) return [];

  const ranked = [...answered].sort((a, b) => b.score - a.score);
  const picked = new Map<string, TranscriptExcerpt>();

  const add = (a: QuestionAssessment | undefined, reason: string) => {
    if (!a || picked.has(a.questionId)) return;
    picked.set(a.questionId, {
      questionId: a.questionId,
      reason,
      question: a.question,
      answer: a.answerExcerpt,
    });
  };

  add(ranked[0], "Strongest answer");
  add(ranked[ranked.length - 1], "Weakest answer");
  add(
    answered.find((a) => a.partiallyDemonstrated.length > 0),
    "Recovered after a follow-up",
  );
  add(
    answered.find((a) => a.probes.some((p) => p.cleared)),
    "Held up under a deeper probe",
  );
  add(
    answered.find((a) => a.missing.length > 0 && a.strength !== "WEAK"),
    "Important concept not mentioned",
  );

  return [...picked.values()].slice(0, 5);
}

/* ------------------------------------------------- assessment integrity */

export type AssessmentStatus = "NORMAL" | "PARTIALLY_DEGRADED" | "DEGRADED";

export type AssessmentIntegrity = {
  status: AssessmentStatus;
  degradedTurns: number;
  totalTurns: number;
  /** Answered CORE questions the evaluator never judged. */
  unjudgedQuestions: number;
  answeredQuestions: number;
  narrativeDegraded: boolean;
  note: string;
};

/**
 * Whether this assessment can be trusted at face value.
 *
 * The distinction that matters: a LOW SCORE IS NOT DEGRADED. A candidate can
 * answer poorly and receive a clean, valid, low assessment. Degradation means
 * the *system* failed — a provider outage forced turns onto keyword heuristics,
 * so the evidence behind the number is thinner than it looks. Conflating the
 * two would let a bad interview hide behind an excuse, and a genuine outage
 * pass as a verdict.
 */
export function assessIntegrity(
  turns: TurnRow[],
  narrativeDegraded: boolean,
  assessments: QuestionAssessment[] = [],
): AssessmentIntegrity {
  const scored = turns.filter(
    (t) => t.action !== "REDIRECT" && t.action !== "REPEAT",
  );
  const degradedTurns = scored.filter((t) => t.degraded).length;

  /**
   * The authoritative signal is the EVIDENCE, not the `degraded` column.
   *
   * A turn row can say `degraded: false` and still carry no verdict — rows
   * written before that flag was persisted do exactly this. Counting answered
   * questions that were never judged catches those too, and it is the thing
   * that actually matters: how much of this assessment rests on a real
   * judgement.
   */
  const answeredQuestions = assessments.filter((a) => a.answered).length;
  const unjudgedQuestions = assessments.filter(
    (a) => a.answered && !a.judged,
  ).length;

  const unjudgedRatio =
    answeredQuestions > 0 ? unjudgedQuestions / answeredQuestions : 0;
  const turnRatio = scored.length > 0 ? degradedTurns / scored.length : 0;
  const ratio = Math.max(unjudgedRatio, turnRatio);

  let status: AssessmentStatus = "NORMAL";
  if (ratio >= 0.5) status = "DEGRADED";
  else if (unjudgedQuestions > 0 || degradedTurns > 0 || narrativeDegraded) {
    status = "PARTIALLY_DEGRADED";
  }

  const unjudgedNote =
    unjudgedQuestions > 0
      ? `${unjudgedQuestions} of ${answeredQuestions} answered questions could not be judged because the evaluator was unavailable. Those questions are excluded from every score rather than counted as failures, so the overall figure reflects only what was actually assessed.`
      : "";

  const note =
    status === "DEGRADED"
      ? unjudgedNote ||
        `${degradedTurns} of ${scored.length} answers fell back to keyword rules. Treat these scores as indicative only.`
      : status === "PARTIALLY_DEGRADED"
        ? unjudgedNote ||
          (degradedTurns > 0
            ? `${degradedTurns} of ${scored.length} answers fell back to keyword rules; the rest were judged normally.`
            : "Scores were computed normally. The written sections fell back to generated-from-evidence text because the narrative model was unavailable.")
        : "All answers were judged normally and the scores reflect the recorded evidence.";

  return {
    status,
    degradedTurns,
    totalTurns: scored.length,
    unjudgedQuestions,
    answeredQuestions,
    narrativeDegraded,
    note,
  };
}

/* ----------------------------------------------------------- readiness */

export type Readiness =
  | "Strong"
  | "Promising"
  | "Developing"
  | "Needs significant improvement";

export function readinessFor(scoreOutOfHundred: number): Readiness {
  if (scoreOutOfHundred >= 80) return "Strong";
  if (scoreOutOfHundred >= 60) return "Promising";
  if (scoreOutOfHundred >= 35) return "Developing";
  return "Needs significant improvement";
}

/* ------------------------------------------------------- module reports */

export type ModuleReport = {
  moduleNumber: number;
  title: string;
  subtitle: string;
  dayRange: { from: number; to: number };
  /** Null means NOT ASSESSED. Never rendered as zero. */
  score: number | null;
  scoreOutOfTen: number | null;
  assessed: boolean;
  questionsAsked: number;
  questionsAnswered: number;
  competencies: string[];
  evidenceRefs: string[];
  strengths: string[];
  weaknesses: string[];
  missingSkills: string[];
  note: string;
};

/**
 * Module rows enriched with the skills behind the number.
 *
 * A module score on its own tells a candidate nothing actionable. What makes it
 * useful is the three lists underneath: what they showed, where they fell
 * short, and which expected skills never appeared at all.
 */
export function buildModuleReports(
  modules: {
    moduleNumber: number;
    title: string;
    subtitle: string;
    dayRange: { from: number; to: number };
    score: number | null;
    questionsAsked: number;
    questionsAnswered: number;
    evidenceRefs: string[];
    note: string;
  }[],
  assessments: QuestionAssessment[],
): ModuleReport[] {
  return modules.map((mod) => {
    const forModule = assessments.filter(
      (a) => a.moduleNumber === mod.moduleNumber && a.answered,
    );

    const strengths = [...new Set(forModule.flatMap((a) => a.demonstrated))];
    const missingSkills = [...new Set(forModule.flatMap((a) => a.missing))];
    const weaknesses = [
      ...new Set(
        forModule
          .filter((a) => a.strength === "WEAK" || a.strength === "PARTIAL")
          .map((a) => a.question),
      ),
    ];

    return {
      moduleNumber: mod.moduleNumber,
      title: mod.title,
      subtitle: mod.subtitle,
      dayRange: mod.dayRange,
      score: mod.score,
      scoreOutOfTen: mod.score === null ? null : toTen(mod.score),
      assessed: mod.score !== null,
      questionsAsked: mod.questionsAsked,
      questionsAnswered: mod.questionsAnswered,
      competencies: [...new Set(forModule.map((a) => a.competency))],
      evidenceRefs: mod.evidenceRefs,
      strengths,
      weaknesses,
      missingSkills,
      note: mod.note,
    };
  });
}

/* ----------------------------------------------- competency enrichment */

export type CompetencyReport = {
  competency: string;
  label: string;
  weight: number;
  score: number;
  scoreOutOfTen: number;
  tier: string;
  evidenceRefs: string[];
  justification: string;
  strengths: string[];
  weaknesses: string[];
  missingEvidence: string[];
};

export function buildCompetencyReports(
  competencies: {
    competency: string;
    label: string;
    weight: number;
    score: number;
    tier: string;
    evidenceRefs: string[];
    justification: string;
  }[],
  assessments: QuestionAssessment[],
): CompetencyReport[] {
  return competencies.map((c) => {
    const forCompetency = assessments.filter(
      (a) => a.competency === c.competency && a.answered,
    );
    return {
      ...c,
      scoreOutOfTen: toTen(c.score),
      strengths: [...new Set(forCompetency.flatMap((a) => a.demonstrated))],
      weaknesses: [
        ...new Set(
          forCompetency
            .filter((a) => !a.answered || a.strength === "WEAK" || a.strength === "PARTIAL")
            .map((a) => a.question),
        ),
      ],
      missingEvidence: [...new Set(forCompetency.flatMap((a) => a.missing))],
    };
  });
}

/* ------------------------------------------------------- core progress */

/**
 * How far through the CORE spine the candidate is.
 *
 * Counted in core questions, never in turns. Adaptive follow-ups and deep
 * probes add turns without advancing the assessment, so a turn-based
 * percentage would tell someone on question three that they were nearly
 * finished — and the exit warning is written against this number.
 */
export type CoreProgress = {
  answered: number;
  total: number;
  /** 0–1. The 50% exit rule is expressed against this. */
  ratio: number;
};

export function coreProgressFor(
  plan: InterviewPlan,
  state: InterviewState,
): CoreProgress {
  const core = plan.questions.filter((q) => (q.tier ?? "CORE") === "CORE");
  const answered = core.filter(
    (q) => state.evidenceByQuestionId[q.id] !== undefined,
  ).length;
  const total = core.length;
  return { answered, total, ratio: total === 0 ? 0 : answered / total };
}
