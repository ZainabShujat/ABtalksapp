/**
 * Sample cards + adaptive chips — run with:
 *   npm run test:sample
 *
 * `--conditions=react-server` is what lets this import `server-only` modules
 * (`scout-tools`) the way an RSC build does. No network, no database.
 */
import { buildSampleCards } from "@/features/hire/sample-card";
import { decodeCandidateRef } from "@/features/hire/candidate-ref";
import { isKnownTrack } from "@/features/hire/track-registry";
import { suggestChips } from "@/features/hire/scout-chips";
import {
  applyObviousAnswers,
  briefDelta,
  extractStatedStack,
} from "@/features/hire/spec-fields";
import {
  createScoutToolContext,
  __test as tools,
} from "@/features/hire/scout-tools";
import { __test as agent } from "@/features/hire/scout-agent";
import { runScoutTurn } from "@/features/hire/scout-conversation";
import { guestCartProgramIds } from "@/components/hire/guest-cart";
import type { GuestCartItem } from "@/components/hire/guest-cart";
import type { JobSpec } from "@/lib/validations/hire";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

const pythonSpec: JobSpec = {
  title: "Python developer",
  mustHaveStack: ["python", "ml"],
  minExperience: 8,
};

console.log("\nsample cards");

suite("an empty spec produces no card", () => {
  assert(buildSampleCards({}).length === 0, "empty object");
  assert(buildSampleCards({ salaryMin: 500000 }).length === 0, "money only");
});

suite("a python + ml + 8 years spec produces one card from that spec", () => {
  const cards = buildSampleCards(pythonSpec);
  assert(cards.length === 1, `1 card, got ${cards.length}`);
  const card = cards[0]!;
  assert(card.jobRole === "Python developer", card.jobRole);
  assert(
    JSON.stringify(card.evidence.skills) === JSON.stringify(["python", "ml"]),
    `skills ${JSON.stringify(card.evidence.skills)}`,
  );
  assert(card.evidence.yearsExperience === 8, "years from the spec");
});

suite("every sample ref is SAMPLE:", () => {
  const cards = buildSampleCards(pythonSpec, 3);
  assert(cards.length > 0, "some cards");
  for (const card of cards) {
    assert(/^SAMPLE:/.test(card.candidateRef), card.candidateRef);
  }
});

suite("SAMPLE: is not a candidate the whitelist will resolve", () => {
  const card = buildSampleCards(pythonSpec)[0]!;
  assert(decodeCandidateRef(card.candidateRef) === null, "decode rejects it");
  assert(!isKnownTrack("SAMPLE"), "SAMPLE is not a track");
  assert(
    decodeCandidateRef("PROGRAM:abc")?.source === "PROGRAM",
    "real refs still work",
  );
});

suite("a sample cart item cannot enter a guest-cart merge", () => {
  const card = buildSampleCards(pythonSpec)[0]!;
  const item: GuestCartItem = {
    candidateRef: card.candidateRef,
    jobRole: card.jobRole,
    totalScore: card.score,
  };
  assert(guestCartProgramIds([item]).length === 0, "no program ids");
});

suite("a sample card invents no person and no ranking", () => {
  const cards = buildSampleCards(pythonSpec, 3);
  for (const card of cards) {
    assert(card.score === 0, `score ${card.score}`);
    assert(card.tier === "NONE", `tier ${card.tier}`);
    assert(card.programMemberId === null, "no member id");
    assert(card.evidence.missionsPassed === undefined, "no missions");
    assert(card.evidence.commitDayCount === undefined, "no commits");
    assert(card.evidence.projectScores === undefined, "no projects");
    assert(card.rationale === null, "no rationale");
    assert(card.gaps.length === 0, "no gaps");
  }
});

suite("count is capped at 3", () => {
  const cards = buildSampleCards(pythonSpec, 5);
  assert(cards.length === 3, `capped at 3, got ${cards.length}`);
});

suite("a stack with no title still names a role, never Candidate", () => {
  const cards = buildSampleCards({ mustHaveStack: ["python"] });
  assert(cards.length === 1, "one card");
  assert(cards[0]!.jobRole === "Python developer", cards[0]!.jobRole);
  assert(!/candidate/i.test(cards[0]!.jobRole), "not Candidate");
});

suite("count > 1 only rotates the stated skills", () => {
  const cards = buildSampleCards(pythonSpec, 2);
  assert(cards.length === 2, "two");
  assert(
    JSON.stringify(cards[0]!.evidence.skills) ===
      JSON.stringify(["python", "ml"]),
    "first keeps order",
  );
  assert(
    JSON.stringify(cards[1]!.evidence.skills) ===
      JSON.stringify(["ml", "python"]),
    "second rotates",
  );
  assert(cards[0]!.jobRole === cards[1]!.jobRole, "same role");
});

console.log("\noffer_options");

suite("offer_options rejects 1 option", () => {
  const ctx = createScoutToolContext("which evidence", {});
  const r = tools.applyOfferOptions(ctx, {
    options: [{ label: "Missions", value: "missions" }],
  });
  assert(r.offered === false, "rejected");
  assert(ctx.offeredChips === null, "nothing stored");
});

suite("offer_options rejects 5 options", () => {
  const ctx = createScoutToolContext("which evidence", {});
  const r = tools.applyOfferOptions(ctx, {
    options: [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
      { label: "C", value: "c" },
      { label: "D", value: "d" },
      { label: "E", value: "e" },
    ],
  });
  assert(r.offered === false, "rejected");
});

suite("offer_options rejects a protocol value", () => {
  const ctx = createScoutToolContext("search now?", {});
  const r = tools.applyOfferOptions(ctx, {
    options: [
      { label: "Search", value: "action:search" },
      { label: "Skip", value: "skip:salary" },
      { label: "Edit", value: "edit:mustHaveStack" },
    ],
  });
  assert(r.offered === false, "rejected");
  assert(ctx.offeredChips === null, "nothing stored");
});

suite("offer_options accepts 3 valid options", () => {
  const ctx = createScoutToolContext("which evidence", {});
  const r = tools.applyOfferOptions(ctx, {
    options: [
      { label: "Code correctness", value: "missions" },
      { label: "Projects", value: "projects" },
      { label: "Communication", value: "interview" },
    ],
  });
  assert(r.offered === true, "accepted");
  assert(ctx.offeredChips?.length === 3, "three stored");
  assert(ctx.offeredChips?.[0]?.value === "missions", "first value");
});

console.log("\nchips");

suite("agent chips win when present", () => {
  const agent = [
    { label: "Code correctness", value: "missions" },
    { label: "Projects", value: "projects" },
  ];
  const chips = suggestChips(pythonSpec, false, agent);
  assert(chips.length === 2, `got ${chips.length}`);
  assert(chips[0]?.value === "missions", "agent first");
  assert(!chips.some((c) => c.value === "action:search"), "not the ladder");
});

suite("fixed set is used when the agent offered nothing", () => {
  const chips = suggestChips({ title: "backend engineer" }, false);
  assert(chips.some((c) => /Python/.test(c.label)), "stack ladder");
  assert(
    chips.some((c) => c.value === "skip:mustHaveStack"),
    "exit still there",
  );
});

suite("a ready brief keeps change-stack when the agent also offered chips", () => {
  const agent = [
    { label: "Missions", value: "missions" },
    { label: "Projects", value: "projects" },
  ];
  const chips = suggestChips(pythonSpec, true, agent);
  assert(chips.some((c) => c.value === "missions"), "agent chips");
  assert(chips.some((c) => c.value === "edit:mustHaveStack"), "change stack");
  assert(chips.some((c) => c.value === "edit:salary"), "change budget");
  assert(!chips.some((c) => c.value === "action:search"), "search stays a button");
});

suite("a ready brief still asking seniority does not jump to Change the stack", () => {
  const chips = suggestChips(
    { title: "full stack developer", mustHaveStack: ["mern"] },
    true,
  );
  assert(chips.some((c) => c.value === "MID"), "seniority chips");
  assert(chips.some((c) => c.value === "edit:mustHaveStack"), "change stack stays");
  assert(chips.some((c) => c.value === "action:search"), "search still offered");
});

suite("mid + remote is captured without the model", () => {
  const prior: JobSpec = {
    title: "full stack developer",
    mustHaveStack: ["mern"],
    minExperience: 2,
  };
  const next = applyObviousAnswers(
    prior,
    "mid, work mode will be remote",
  );
  assert(next.seniority === "MID", `seniority ${next.seniority}`);
  assert(next.workMode === "REMOTE", `workMode ${next.workMode}`);
  const noted = briefDelta(prior, next);
  assert(noted.includes("Mid"), `${noted.join(",")}`);
  assert(noted.includes("Remote"), `${noted.join(",")}`);
});

suite("obvious answers do not guess through a negation", () => {
  const next = applyObviousAnswers({}, "not senior, maybe junior later");
  assert(next.seniority == null, "left alone");
});

suite("off-topic trivia is not a seniority", () => {
  const next = applyObviousAnswers({}, "who is prime minister of india");
  assert(next.seniority == null, "no seniority");
  assert(next.workMode == null, "no work mode");
});

suite("a mern full-stack sentence fills title, stack, years and seniority", () => {
  const next = applyObviousAnswers(
    {},
    "i want a full stack devloper with 2 years of experience, mid level of engineer, in mern stack",
  );
  assert(next.title === "Full-stack developer", `title ${next.title}`);
  assert(next.seniority === "MID", `seniority ${next.seniority}`);
  assert(next.mustHaveStack?.[0] === "mern", `stack ${next.mustHaveStack}`);
  assert(next.minExperience === 2, `years ${next.minExperience}`);
});

suite("langchain-only replaces a previous mern stack", () => {
  const prior: JobSpec = {
    title: "Full-stack developer",
    mustHaveStack: ["mern"],
    seniority: "MID",
  };
  const next = applyObviousAnswers(
    prior,
    "i want a candidate who know lagnchain only and should be expert in langchain only and nothing else",
  );
  assert(
    (next.mustHaveStack ?? []).some((s) => /langchain/i.test(s)),
    `stack ${JSON.stringify(next.mustHaveStack)}`,
  );
  assert(
    !(next.mustHaveStack ?? []).includes("mern"),
    "mern is gone",
  );
  assert(
    !(next.mustHaveStack ?? []).some((s) => /\bonly\b/i.test(s)),
    "only is not a skill",
  );
  assert(/langchain/i.test(next.title ?? ""), `title ${next.title}`);
  const sample = buildSampleCards(next);
  assert(sample.length === 1, "one sample card");
  assert(
    (sample[0]!.evidence.skills ?? []).some((s) => /langchain/i.test(s)),
    "sample card carries langchain",
  );
});

suite("only 3 candidates is not a stack token", () => {
  assert(extractStatedStack("i want only 3 candidates").length === 0, "empty");
});

suite("stating a role is not asking to see cards", () => {
  assert(
    !agent.wantsToSeeCards(
      "i want a full stack developer with 2 years of experience",
    ),
    "want a developer is a brief, not a search",
  );
  assert(
    agent.wantsToSeeCards("now give me the list of candidate"),
    "give me the list is a search",
  );
  assert(
    agent.wantsToSeeCards("ok now give me"),
    "bare give-me is a search once a brief exists",
  );
  assert(
    agent.wantsCandidates("now give me the list of candidate"),
    "existing people-request still matches",
  );
});

suite("only ai engineer drops a leftover MERN stack", () => {
  const prior: JobSpec = {
    title: "Full-stack developer",
    mustHaveStack: ["MongoDB", "Express", "React", "Node.js"],
    seniority: "MID",
  };
  const next = applyObviousAnswers(prior, "only ai engineer");
  assert(/ai engineer/i.test(next.title ?? ""), `title ${next.title}`);
  assert((next.mustHaveStack ?? []).length === 0, "mern does not ride along");
});

suite("only 3 candidates does not wipe the stack", () => {
  const prior: JobSpec = {
    title: "Full-stack developer",
    mustHaveStack: ["mern"],
  };
  const next = applyObviousAnswers(prior, "i want only 3 candidates");
  assert(next.mustHaveStack?.[0] === "mern", "stack kept");
});

async function replayUserChat() {
  console.log("\nuser transcript replay");
  agent.resetGroqCooling();
  const ready: JobSpec = {
    title: "Full-stack developer",
    mustHaveStack: ["mern"],
    seniority: "MID",
    minExperience: 2,
    salaryMin: 500_000,
    salaryMax: 1_000_000,
  };
  try {
    const turn = await runScoutTurn({
      priorSpec: ready,
      history: [
        { role: "user", content: "i want a full stack developer" },
        { role: "assistant", content: "Noted: Mid." },
      ],
      userMessage: "now give me the list of candidate",
    });
    assert(turn.action === "search", `action ${turn.action}`);
    assert(
      !/capacity/i.test(turn.nextQuestion ?? ""),
      `must not say capacity: ${turn.nextQuestion}`,
    );
    passed++;
    console.log("  ✓ give-me-the-list searches even when Groq is at capacity");
  } catch (e) {
    failed++;
    console.log(
      `  ✗ give-me-the-list searches even when Groq is at capacity\n      ${(e as Error).message}`,
    );
  }

  try {
    agent.markGroqCooling();
    const turn = await runScoutTurn({
      priorSpec: ready,
      history: [],
      userMessage: "why at capacity",
    });
    assert(turn.action !== "search", "not a search");
    assert(
      /rate limit/i.test(turn.nextQuestion ?? ""),
      `should explain the limit: ${turn.nextQuestion}`,
    );
    assert(
      !/give it a few seconds and send that again/i.test(turn.nextQuestion ?? ""),
      "must not repeat the stuck retry line",
    );
    passed++;
    console.log("  ✓ a follow-up during cooldown does not hit Groq again");
  } catch (e) {
    failed++;
    console.log(
      `  ✗ a follow-up during cooldown does not hit Groq again\n      ${(e as Error).message}`,
    );
  }

  try {
    agent.resetGroqCooling();
    const turn = await runScoutTurn({
      priorSpec: ready,
      history: [],
      userMessage: "ok now give me",
    });
    assert(turn.action === "search", `action ${turn.action}`);
    assert(
      !/capacity/i.test(turn.nextQuestion ?? ""),
      `must not say capacity: ${turn.nextQuestion}`,
    );
    passed++;
    console.log("  ✓ ok-now-give-me searches a ready brief without Groq");
  } catch (e) {
    failed++;
    console.log(
      `  ✗ ok-now-give-me searches a ready brief without Groq\n      ${(e as Error).message}`,
    );
  } finally {
    agent.resetGroqCooling();
  }
}

replayUserChat().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
