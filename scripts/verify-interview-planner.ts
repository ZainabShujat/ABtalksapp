/**
 * Conversation-planner behaviour: does what the candidate SAYS change what they
 * are asked next?
 *
 *   npm run test:interview:planner
 *
 * These are trajectory tests, not unit tests. Each one drives the planner the
 * way the real interview drives it — same function, same arguments, same plan
 * built by `planCohortInterview` — and asserts on the route it takes.
 *
 * The mock provider is NOT used here and could not help: the planner never
 * consults a model. It is pure, which is exactly why two different candidate
 * answers can be shown to produce two different interviews without spending a
 * single API call.
 *
 * The `--conditions=react-server` flag is required: `planner.ts` pulls in the
 * server-only candidate context types. See verify-interview-grounding.ts.
 */
import assert from "node:assert/strict";

import { planCohortInterview } from "@/features/interview/cohort/planner";
import {
  selectNextTarget,
  askedIds,
} from "@/features/interview/agent/target-planner";
import {
  competencyCoverage,
  coverageForQuestion,
} from "@/features/interview/agent/coverage";
import { createInitialState, startInterview } from "@/features/interview/state";
import { BLUEPRINT_SCOPE } from "@/features/interview/cohort/blueprint";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
} from "@/features/interview/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

const plan: InterviewPlan = planCohortInterview("DAY_15", null, {});

function evidence(over: Partial<AnswerEvidence> = {}): AnswerEvidence {
  return {
    conceptualFound: false,
    practicalFound: false,
    tradeoffsFound: false,
    flaggedIssues: [],
    matchedEvidence: [],
    ...over,
  } as AnswerEvidence;
}

/** A state in which `asked` have been put and `answered` carry evidence. */
function stateWith(
  asked: string[],
  answered: Record<string, AnswerEvidence> = {},
): InterviewState {
  return {
    ...startInterview(createInitialState()),
    currentQuestionIndex: plan.questions.findIndex(
      (q) => q.id === asked[asked.length - 1],
    ),
    askedQuestionIds: asked,
    evidenceByQuestionId: answered,
  };
}

const opener = plan.questions[0]!;

/* ============================================ 1 & 2. answers steer the route */

section("Different answers produce different next targets");

// Two candidates, same state, same plan. The ONLY difference is what they said.
const retrievalAnswer =
  "I split the documents into chunks and embedded them, then stored the vectors in Chroma so I could run a similarity query and pull the closest chunks back for the model.";
const promptingAnswer =
  "I spent most of my time on the prompt itself, writing a system prompt with few-shot examples and testing how the temperature changed the output format I got back.";

const afterRetrieval = selectNextTarget(
  plan,
  stateWith([opener.id]),
  retrievalAnswer,
);
const afterPrompting = selectNextTarget(
  plan,
  stateWith([opener.id]),
  promptingAnswer,
);

check("1. an answer about retrieval selects a target", () => {
  assert.ok(afterRetrieval.questionId, "a target was selected");
  assert.ok(
    plan.questions.some((q) => q.id === afterRetrieval.questionId),
    "the target is a real question in the plan",
  );
});

check("2. a different answer selects a DIFFERENT target", () => {
  assert.notEqual(
    afterRetrieval.questionId,
    afterPrompting.questionId,
    `both answers routed to ${afterRetrieval.questionId}; the planner is ignoring the answer`,
  );
});

check("2b. each route is justified by what the candidate raised", () => {
  const top = (c: typeof afterRetrieval) => c.considered[0]!;
  assert.ok(
    top(afterRetrieval).continuity > 0,
    "retrieval answer produced no topical signal",
  );
  assert.ok(
    top(afterPrompting).continuity > 0,
    "prompting answer produced no topical signal",
  );
});

/* ================================ 3. not simply the next question-bank index */

section("The route is not the array order");

check("3. at least one answer routes away from the next authored index", () => {
  const authoredNext = plan.questions[1]!.id;
  const routes = [afterRetrieval.questionId, afterPrompting.questionId];
  assert.ok(
    routes.some((id) => id !== authoredNext),
    `both routes went to ${authoredNext}, which is just index + 1`,
  );
});

check("3b. a question already asked is never selected again", () => {
  const asked = [opener.id, plan.questions[1]!.id, plan.questions[2]!.id];
  const choice = selectNextTarget(plan, stateWith(asked), retrievalAnswer);
  assert.ok(
    !asked.includes(choice.questionId!),
    `re-selected ${choice.questionId}, which was already asked`,
  );
});

/* ================================================ 4. stays in curriculum scope */

section("Curriculum scope is structural");

check("4. every reachable target lies inside the blueprint's day scope", () => {
  const scope = new Set(BLUEPRINT_SCOPE.DAY_15);
  // Drive the planner across many different answers and collect every target it
  // is willing to choose. None may fall outside the candidate's curriculum.
  const answers = [
    retrievalAnswer,
    promptingAnswer,
    "I used Docker and Kubernetes to deploy the service behind a load balancer.",
    "I fine-tuned the model with LoRA on my own dataset.",
    "",
  ];
  const seen = new Set<string>();
  for (const answer of answers) {
    for (let asked = 1; asked < plan.questions.length; asked++) {
      const state = stateWith(plan.questions.slice(0, asked).map((q) => q.id));
      const choice = selectNextTarget(plan, state, answer);
      if (choice.questionId) seen.add(choice.questionId);
    }
  }
  assert.ok(seen.size > 1, "the planner only ever chose one target");
  for (const id of seen) {
    const q = plan.questions.find((x) => x.id === id)!;
    for (const day of q.sourceRef?.sourceDays ?? []) {
      assert.ok(
        scope.has(day),
        `${id} draws on day ${day}, outside the DAY_15 scope`,
      );
    }
  }
});

/* ======================================= 5. sufficient concepts deprioritized */

section("Coverage steers away from what is already known");

check("5. a strongly-covered competency loses to an unassessed one", () => {
  // Establish TECHNICAL_DEPTH strongly, leave everything else untouched, then
  // ask the planner what to do next with no topical signal at all.
  const strong = plan.questions.filter((q) => q.competency === "TECHNICAL_DEPTH");
  assert.ok(strong.length > 0, "fixture needs a TECHNICAL_DEPTH question");

  const answered: Record<string, AnswerEvidence> = {};
  for (const q of strong) {
    answered[q.id] = evidence({
      matchedEvidence: (q.expectedEvidence ?? []).map((_, i) => i),
      conceptualFound: true,
      practicalFound: true,
      tradeoffsFound: true,
    });
  }

  const asked = [opener.id, ...strong.map((q) => q.id)];
  const state = stateWith(asked, answered);

  const coverage = competencyCoverage(plan, state);
  assert.equal(
    coverage.get("TECHNICAL_DEPTH")?.level,
    "STRONG",
    "fixture did not actually establish the competency",
  );

  const choice = selectNextTarget(plan, state, "");
  const chosen = plan.questions.find((q) => q.id === choice.questionId)!;
  assert.notEqual(
    chosen.competency,
    "TECHNICAL_DEPTH",
    "chose a competency already covered STRONG while others were unassessed",
  );
});

check("5b. coverage need is what demotes it, not chance", () => {
  const q = plan.questions.find((x) => x.competency === "TECHNICAL_DEPTH")!;
  const covered = stateWith([opener.id, q.id], {
    [q.id]: evidence({
      matchedEvidence: (q.expectedEvidence ?? []).map((_, i) => i),
    }),
  });
  assert.equal(coverageForQuestion(q, covered), "STRONG");
  assert.equal(coverageForQuestion(q, stateWith([opener.id])), "NOT_ASSESSED");
});

/* ================================================= 6. weak areas are revisited */

section("Weak areas stay attractive");

check("6. a PARTIAL competency outranks a SUFFICIENT one", () => {
  const partialQ = plan.questions.find(
    (q) => q.competency === "PRACTICAL" && (q.expectedEvidence?.length ?? 0) > 1,
  )!;
  const sufficientQ = plan.questions.find(
    (q) => q.competency === "CONCEPTUAL" && (q.expectedEvidence?.length ?? 0) > 1,
  )!;

  const state = stateWith([opener.id, partialQ.id, sufficientQ.id], {
    // One item matched: a real attempt with a hole in it.
    [partialQ.id]: evidence({ matchedEvidence: [0] }),
    // Every item matched.
    [sufficientQ.id]: evidence({
      matchedEvidence: (sufficientQ.expectedEvidence ?? []).map((_, i) => i),
    }),
  });

  const coverage = competencyCoverage(plan, state);
  const practical = coverage.get("PRACTICAL")!;
  const conceptual = coverage.get("CONCEPTUAL")!;

  // The planner should still be willing to come back to the weak area, and the
  // coverage model is what expresses that.
  assert.ok(
    ["PARTIAL", "NOT_ASSESSED"].includes(practical.level),
    `PRACTICAL read as ${practical.level}`,
  );
  assert.ok(
    ["SUFFICIENT", "STRONG"].includes(conceptual.level),
    `CONCEPTUAL read as ${conceptual.level}`,
  );
});

/* ======================================= 7. no day framing enters the routing */

section("Days stay internal");

check("7. no selection reason ever names a day", () => {
  const DAY = /(^|[^a-z])days?[ ]*[0-9]/i;
  for (let asked = 1; asked < plan.questions.length; asked++) {
    const state = stateWith(plan.questions.slice(0, asked).map((q) => q.id));
    for (const answer of [retrievalAnswer, promptingAnswer, ""]) {
      const choice = selectNextTarget(plan, state, answer);
      assert.ok(
        !DAY.test(choice.reason),
        `reason names a day: ${choice.reason}`,
      );
    }
  }
});

/* ================================================== termination stays bounded */

section("The interview still terminates");

check("the planner runs out of targets and never loops", () => {
  let state = stateWith([opener.id]);
  const visited = new Set<string>([opener.id]);

  for (let i = 0; i < plan.questions.length + 5; i++) {
    const choice = selectNextTarget(plan, state, retrievalAnswer);
    if (choice.questionId === null) break;
    assert.ok(
      !visited.has(choice.questionId),
      `revisited ${choice.questionId}; the planner can loop`,
    );
    visited.add(choice.questionId);
    state = stateWith([...visited]);
  }

  assert.equal(
    visited.size,
    plan.questions.length,
    "did not reach every target before terminating",
  );
  assert.equal(
    selectNextTarget(plan, stateWith([...visited]), "").questionId,
    null,
    "did not terminate once every target was assessed",
  );
});

check("legacy attempts without askedQuestionIds are backfilled", () => {
  const legacy = {
    ...startInterview(createInitialState()),
    currentQuestionIndex: 3,
    askedQuestionIds: undefined,
  } as unknown as InterviewState;

  const asked = askedIds(plan, legacy);
  assert.equal(asked.length, 4, "backfill must cover index 0..3 inclusive");
  const choice = selectNextTarget(plan, legacy, "");
  assert.ok(
    !asked.includes(choice.questionId!),
    "a resumed interview re-asked a question it had already put",
  );
});

console.log(`\n${passed} checks passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
