/**
 * Pure scoring tests — run with:
 *   npx tsx src/features/hire/score-candidate.test.ts
 */
import {
  scoreCandidate,
  rankCandidates,
  pickSearchMatches,
  __test,
} from "@/features/hire/score-candidate";
import type {
  EvidenceCoverage,
  ScoreableMember,
  ScoreDimension,
} from "@/features/hire/types";
import {
  applyDefaultSkipped,
  hireProgress,
  isSlotFilled,
  skippedSlots,
  type JobSpec,
} from "@/lib/validations/hire";
import {
  extractPoolBrief,
  applyPoolBrief,
  isSearchableBrief,
  resolveSources,
} from "@/features/hire/pool-brief";
import {
  guestCartWithoutMerged,
  normalizeGuestCartItem,
} from "@/components/hire/guest-cart";
import {
  labelGuestSearch,
  parseGuestMatchCollection,
} from "@/components/hire/guest-matches-store";

/**
 * `cond` accepts undefined so `spec.mustHaveStack?.includes(...)` can be
 * asserted directly — an undefined condition is a failed assertion, which is
 * exactly what a missing array should be.
 */
function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseMember(over: Partial<ScoreableMember> = {}): ScoreableMember {
  return {
    id: "m1",
    userId: "u1",
    fullName: "Ada Example",
    jobRole: "Engineer",
    company: "Acme",
    yearsExperience: 3,
    skills: ["Python", "SQL", "TypeScript"],
    missionPoints: 180,
    missionsPassed: 15,
    missionsAttempted: 17,
    cleanPassCount: 12,
    totalScore: 400,
    commitDayCount: 18,
    projectScores: [82, 90],
    interview: { overall: 80, comm: 78, tech: 85, problem: 77 },
    hasVisibilityConsent: true,
    cohortPublished: true,
    status: "ENROLLED",
    availability: null,
    cohortDay: 20,
    ...over,
  };
}

function coverage(over: Partial<Record<ScoreDimension, boolean>> = {}): EvidenceCoverage {
  return {
    dimensions: {
      stack: true,
      missions: true,
      cleanPass: true,
      projects: true,
      consistency: true,
      interview: true,
      experience: true,
      ...over,
    },
    note: "test",
  };
}

/** A cohort mid-flight: no graded projects, no completed interviews. */
const midCohort = coverage({ projects: false, interview: false });

const baseSpec: JobSpec = {
  title: "Backend engineer",
  mustHaveStack: ["Python", "SQL"],
  niceToHaveStack: ["Airflow"],
  evidencePriority: [],
  minExperience: 2,
  maxExperience: 5,
};

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log("  ✓", name);
}

console.log("score-candidate tests");

{
  const r = scoreCandidate(baseMember(), baseSpec);
  assert(!r.hardFiltered, "strong member should not hard-filter");
  assert(r.tier === "STRONG" || r.tier === "PARTIAL", `tier=${r.tier}`);
  assert(r.score >= 40, `score=${r.score}`);
  assert(r.availabilityUnknown === true, "no availability → unknown");
  ok("baseline scores and availabilityUnknown");
}

{
  const r = scoreCandidate(
    baseMember({ hasVisibilityConsent: false }),
    baseSpec,
  );
  assert(r.hardFiltered, "no consent → hard filter");
  assert(r.score === 0, "hard filter score 0");
  ok("consent hard filter");
}

{
  const r = scoreCandidate(
    baseMember({ skills: ["Java", "Go"] }),
    baseSpec,
  );
  assert(r.tier !== "STRONG", "missing must-have cannot be STRONG");
  assert(r.gaps.some((g) => /Python|SQL|stack/i.test(g)), "gap mentions stack");
  ok("missing must-have blocks STRONG");
}

{
  const a = scoreCandidate(
    baseMember({ commitDayCount: 25, projectScores: [50] }),
    { ...baseSpec, evidencePriority: ["consistency"] },
  );
  const b = scoreCandidate(
    baseMember({ commitDayCount: 25, projectScores: [50] }),
    { ...baseSpec, evidencePriority: ["projects"] },
  );
  // Same member; priority should change breakdown weights
  assert(
    a.scoreBreakdown.weights.consistency >= b.scoreBreakdown.weights.consistency,
    "consistency priority boosts weight",
  );
  ok("evidencePriority reweights");
}

{
  const blocked = scoreCandidate(
    baseMember({
      availability: {
        openToWork: false,
        expectedSalaryMin: null,
        expectedSalaryMax: null,
        salaryCurrency: "INR",
        noticePeriodDays: null,
        preferredWorkMode: null,
        preferredCities: [],
        openToRelocate: false,
      },
    }),
    baseSpec,
  );
  assert(blocked.hardFiltered, "openToWork false hard-filters");
  ok("openToWork false");
}

{
  const ranked = rankCandidates(
    [
      baseMember({ id: "strong", fullName: "Zed" }),
      baseMember({
        id: "weak",
        fullName: "Amy",
        missionPoints: 12,
        cleanPassCount: 0,
        projectScores: [],
        commitDayCount: 1,
        interview: null,
        skills: ["Python", "SQL"],
      }),
    ],
    baseSpec,
  );
  assert(ranked.length === 2, "both returned");
  assert(ranked[0]!.score >= ranked[1]!.score, "sorted desc by score");
  ok("rank order");
}

{
  assert(__test.stackTokensMatch(["TypeScript", "React"], "typescript"), "case");
  assert(__test.stackTokensMatch(["node.js"], "Node"), "fuzzy-ish include");
  ok("stack token match helpers");
}

// ─── coverage-aware scoring ────────────────────────────────────────────────

{
  // T1 — weights of an uncovered pool still add up, and none go negative.
  const w = __test.reweight([], midCohort);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 100) < 1.5, `weights sum ${sum}`);
  assert(w.projects === 0 && w.interview === 0, "uncovered dims drop to 0");
  assert(
    Object.values(w).every((v) => v >= 0),
    "no negative weight",
  );
  ok("T1 uncovered dimensions renormalise to 100");
}

{
  // T2 — the point of the whole change: a mid-cohort member is not punished
  // for milestones that have not happened.
  const m = baseMember({ projectScores: [], interview: null });
  const full = scoreCandidate(m, baseSpec, coverage());
  const partial = scoreCandidate(m, baseSpec, midCohort);
  assert(
    partial.score > full.score,
    `partial ${partial.score} should beat full ${full.score}`,
  );
  assert(partial.tier === "STRONG", `mid-cohort tier=${partial.tier}`);
  ok("T2 mid-cohort member outscores the same member judged on absent evidence");
}

{
  // T3 — regression guard: where the evidence *could* exist, its absence must
  // still cost. Otherwise T2 has quietly disabled the rubric.
  const withProjects = scoreCandidate(baseMember(), baseSpec, coverage());
  const without = scoreCandidate(
    baseMember({ projectScores: [], interview: null }),
    baseSpec,
    coverage(),
  );
  assert(
    without.score < withProjects.score,
    "missing evidence in a covered pool must still cost",
  );
  assert(
    without.gaps.some((g) => /project/i.test(g)),
    "covered pool reports the project gap",
  );
  ok("T3 covered pool still penalises missing evidence");
}

{
  // T4 — the same work reads differently on day 4 than on day 30.
  const early = __test.missionScore(3, 4);
  const late = __test.missionScore(3, 30);
  assert(early > 0.5, `day-4 score ${early}`);
  assert(late < 0.2, `day-30 score ${late}`);
  ok("T4 mission expectations scale with the cohort day");
}

{
  // T5 — priority still reorders after coverage has removed dimensions.
  const a = __test.reweight(["consistency"], midCohort);
  const b = __test.reweight(["stack"], midCohort);
  assert(a.consistency > b.consistency, "priority boost survives renormalisation");
  ok("T5 evidencePriority reweights under partial coverage");
}

{
  // T6 — coverage must not become a back door to STRONG.
  const r = scoreCandidate(
    baseMember({ skills: ["Java"] }),
    baseSpec,
    midCohort,
  );
  assert(r.tier !== "STRONG", `missing must-have tier=${r.tier}`);
  ok("T6 missing must-have never STRONG under any coverage");
}

{
  const langchain = { mustHaveStack: ["langchain"] };
  const noneOfIt = rankCandidates(
    [baseMember({ skills: ["Excel", "Sales"], jobRole: "Business Executive" })],
    langchain,
  );
  const picked = pickSearchMatches(noneOfIt, langchain);
  assert(picked.length === 0, "unmet must-have is empty, not a padded exec");
  const hasIt = rankCandidates(
    [baseMember({ skills: ["LangChain", "Python"] })],
    langchain,
  );
  const kept = pickSearchMatches(hasIt, langchain);
  assert(kept.length === 1, "the person who has it still shows");
  ok("unmet must-have stack yields no result cards");
}

{
  // T7 — an empty pool returns nothing rather than throwing.
  const ranked = rankCandidates([], baseSpec, { coverage: midCohort });
  assert(ranked.length === 0, "empty pool → empty list");
  ok("T7 empty pool");
}

{
  // T8 — the waived start days must not read as work. A member with three
  // waived days and nothing else scores as the beginner they are.
  const doneNothing = baseMember({
    missionsPassed: 0,
    missionsAttempted: 0,
    cleanPassCount: 0,
    commitDayCount: 3,
    missionPoints: 36,
    projectScores: [],
    interview: null,
    cohortDay: 14,
  });
  const r = scoreCandidate(doneNothing, baseSpec, midCohort);
  assert(r.tier !== "STRONG", `no-work tier=${r.tier}`);
  assert(r.scoreBreakdown.missions === 0, "no earned passes → 0 missions");
  assert(r.scoreBreakdown.projects === null, "uncovered dimension reports null");
  ok("T8 waived enrolment days are not evidence");
}

{
  // T9 — with the uncovered dimensions dropped, declared skills carry most of
  // the weight. Somebody who has passed nothing must not ride that to STRONG.
  const r = scoreCandidate(
    baseMember({
      missionsPassed: 0,
      missionsAttempted: 0,
      cleanPassCount: 0,
      commitDayCount: 3,
      projectScores: [],
      interview: null,
      cohortDay: 14,
    }),
    baseSpec,
    coverage({ missions: false, cleanPass: false, projects: false, interview: false }),
  );
  assert(r.tier !== "STRONG", `zero-evidence tier=${r.tier} at score ${r.score}`);
  assert(
    r.gaps.some((g) => /just started/i.test(g)),
    "zero-evidence candidate says so on the card",
  );
  ok("T9 declared skills alone never reach STRONG");
}

{
  const brief = extractPoolBrief(
    "i want students from india who has done claude challenge for atleast 30 days only 5 candidate",
  );
  assert(brief.geo === "IN", "india geo");
  assert(brief.sources.includes("CLAUDE"), "claude source");
  assert(brief.minEvidenceDays === 30, "30 days");
  assert(brief.resultLimit === 5, "only 5");
  const spec = applyPoolBrief({}, brief);
  assert(isSearchableBrief(spec), "searchable");
  assert(resolveSources(brief).includes("CLAUDE"), "resolve claude");
  const us = extractPoolBrief("us cohort professionals");
  assert(us.geo === "US", "us geo");
  assert(resolveSources(us).includes("PROGRAM"), "us → program");

  const sixty = extractPoolBrief("60 day submissions atleast 20 days only 5");
  assert(sixty.sources.includes("CHALLENGE_60"), "60-day is challenge_60");
  assert(!sixty.sources.includes("CLAUDE"), "60-day is not claude");
  assert(sixty.minEvidenceDays === 20, "20 days not the track name");

  const role = extractPoolBrief(
    "india claude challenge 30 days backend java python only 5",
  );
  assert(role.sources.includes("CLAUDE"), "claude + role");
  assert(role.minEvidenceDays === 30, "bare 30 days");
  assert(role.title === "Backend engineer", "backend title");
  assert(
    role.mustHaveStack.includes("java") && role.mustHaveStack.includes("python"),
    "java/python stack",
  );
  const roleSpec = applyPoolBrief({}, role);
  assert(roleSpec.title === "Backend engineer", "apply title");
  assert(roleSpec.mustHaveStack?.includes("java"), "apply stack");

  const usClaude = extractPoolBrief(
    "from the US, claude challenge 30 days only 5",
  );
  assert(usClaude.geo === "US", "us+claude geo");
  assert(usClaude.sources.includes("CLAUDE"), "us+claude keeps claude");
  assert(resolveSources(usClaude).includes("CLAUDE"), "explicit source wins");
  assert(!resolveSources(usClaude).includes("PROGRAM"), "do not swap to cohort");

  const follow = extractPoolBrief("backend engineer, java");
  assert(follow.title === "Backend engineer", "follow-up title");
  assert(follow.mustHaveStack.includes("java"), "follow-up java");
  assert(follow.sources.length === 0, "follow-up is not a new pool");
  const rerank = applyPoolBrief(spec, follow);
  assert(rerank.title === "Backend engineer", "rerank keeps title");
  assert(rerank.mustHaveStack?.includes("java"), "rerank stack");
  assert(
    (rerank.extra as { poolSources?: string[] })?.poolSources?.includes(
      "CLAUDE",
    ),
    "rerank keeps prior pool",
  );

  const fullstack = extractPoolBrief("us cohort, fullstack, react node, only 5");
  assert(fullstack.title === "Full-stack engineer", "fullstack title");
  assert(
    fullstack.mustHaveStack.includes("react") &&
      fullstack.mustHaveStack.includes("node"),
    "react/node stack",
  );
  ok("pool brief parser");
}

{
  const spec = applyDefaultSkipped({ title: "Backend engineer" });
  const skip = skippedSlots(spec);
  assert(skip.has("evidencePriority"), "default skip evidence");
  assert(skip.has("employmentType"), "default skip engagement");
  assert(skip.has("workMode"), "default skip work mode");
  assert(skip.has("locationCity"), "default skip city");
  assert(skip.has("noticePeriodDays"), "default skip notice");
  assert(skip.has("experience"), "default skip experience");
  assert(!skip.has("title"), "do not skip title");
  assert(!skip.has("seniority"), "do not skip seniority");
  assert(!skip.has("mustHaveStack"), "do not skip stack");
  assert(!skip.has("salary"), "do not skip salary");
  assert(isSlotFilled(spec, "title"), "filled title stays");
  const progress = hireProgress(spec);
  assert(progress.total === 4, `default walk is 4 slots, got ${progress.total}`);

  const kept = applyDefaultSkipped({ workMode: "REMOTE" });
  assert(kept.workMode === "REMOTE", "typed workMode kept");
  assert(!skippedSlots(kept).has("workMode"), "filled slot is not skipped");

  const legacy = normalizeGuestCartItem({
    memberId: "pm1",
    jobRole: "Backend",
    totalScore: 70,
  });
  assert(legacy?.candidateRef === "PROGRAM:pm1", "legacy memberId → PROGRAM ref");
  const claude = normalizeGuestCartItem({
    candidateRef: "CLAUDE:u1",
    jobRole: "Builder",
    totalScore: 80,
  });
  assert(claude?.candidateRef === "CLAUDE:u1", "keeps Claude ref");
  assert(
    normalizeGuestCartItem({ candidateRef: "NOPE:x", jobRole: "X", totalScore: 1 }) ===
      null,
    "unknown source rejected",
  );
  ok("default skip + cart ref");
}

{
  const card = { candidateRef: "CLAUDE:u1" };
  const legacy = parseGuestMatchCollection({
    matches: [card],
    overallGap: "thin",
    title: "Claude",
  });
  assert(legacy.tabs.length === 1, "legacy store is one tab");
  assert(legacy.tabs[0]!.matches[0]!.candidateRef === "CLAUDE:u1", "legacy cards");
  const two = parseGuestMatchCollection({
    activeId: "b",
    tabs: [
      { id: "a", label: "Claude · 5", title: "A", overallGap: "", matches: [card] },
      {
        id: "b",
        label: "India · 5",
        title: "B",
        overallGap: "",
        matches: [{ candidateRef: "CLAUDE:u2" }],
      },
    ],
  });
  assert(two.activeId === "b", "active tab kept");
  assert(two.tabs.length === 2, "two tabs stay separate");
  assert(two.tabs[0]!.matches[0]!.candidateRef !== two.tabs[1]!.matches[0]!.candidateRef, "no mix");
  const label = labelGuestSearch(
    { title: "Backend engineer", mustHaveStack: ["java"], extra: { resultLimit: 5, poolSources: ["CLAUDE"] } },
    5,
  );
  assert(/backend/i.test(label) && /java/i.test(label) && /5/.test(label), `label=${label}`);
  ok("search tabs stay separate");
}

{
  const five = extractPoolBrief(
    "give me five candidates from claude challenge who have completed claude challenge",
  );
  assert(five.sources.includes("CLAUDE"), "five+completed → claude");
  assert(five.resultLimit === 5, `five → 5, got ${five.resultLimit}`);
  assert(five.minEvidenceDays === 60, `completed → 60, got ${five.minEvidenceDays}`);
  assert(five.mustHaveStack.length === 0, "no invented stack");

  const typo = extractPoolBrief("give me only five candidate from cllaude challenge");
  assert(typo.sources.includes("CLAUDE"), "cllaude typo");
  assert(typo.resultLimit === 5, "only five");

  const fivce = extractPoolBrief("list of only fivce");
  assert(fivce.resultLimit === 5, "fivce → 5");

  const prior = applyPoolBrief(
    {},
    extractPoolBrief("india claude challenge 30 days backend java python only 5"),
  );
  assert(prior.mustHaveStack?.includes("java"), "setup stack");
  const switched = applyPoolBrief(
    prior,
    extractPoolBrief("give me five candidates from claude challenge who have completed"),
  );
  assert(
    !switched.mustHaveStack?.length,
    "new claude pool without stack clears old MLOps/java",
  );
  assert(
    (switched.extra as { minEvidenceDays?: number })?.minEvidenceDays === 60,
    "completed kept",
  );
  const capOnly = applyPoolBrief(prior, extractPoolBrief("only 5"));
  assert(capOnly.mustHaveStack?.includes("java"), "only-5 keeps prior stack");

  const twenty = extractPoolBrief("20 student from claude challenge");
  assert(twenty.sources.includes("CLAUDE"), "20 student → claude");
  assert(twenty.resultLimit === 20, `20 student → 20, got ${twenty.resultLimit}`);
  const fiveFrom = extractPoolBrief("5 from cohort challenge");
  assert(fiveFrom.resultLimit === 5, "5 from → 5");
  assert(resolveSources(fiveFrom).includes("PROGRAM"), "cohort → program");
  const sixtyNotCap = extractPoolBrief(
    "60 day submissions atleast 20 days only 5",
  );
  assert(sixtyNotCap.resultLimit === 5, "60-day track is not a cap of 60");
  const bumped = applyPoolBrief(
    applyPoolBrief({}, extractPoolBrief("claude challenge only 5")),
    extractPoolBrief("20 student from claude challenge"),
  );
  assert(
    (bumped.extra as { resultLimit?: number })?.resultLimit === 20,
    "20 overwrites a prior only-5",
  );
  ok("five / completed / typo / stack wipe");
}

/* ── guest cart: nothing is forgotten until the server confirms it ───────── */
{
  const item = (ref: string) => ({
    candidateRef: ref,
    jobRole: "Engineer",
    totalScore: 60,
  });
  const cart = [
    item("PROGRAM:m1"),
    item("PROGRAM:m2"),
    item("PROGRAM:m3"),
    item("CLAUDE:u9"),
  ];

  // The bug: a pending recruiter merged nothing, the action still said ok, and
  // every program candidate was dropped from the only copy that existed.
  const noneMerged = guestCartWithoutMerged(cart, []);
  assert(noneMerged.length === 4, `nothing merged → nothing dropped, got ${noneMerged.length}`);

  const partial = guestCartWithoutMerged(cart, ["m1", "m3"]);
  assert(partial.length === 2, `two merged → two kept, got ${partial.length}`);
  assert(
    partial.some((i) => i.candidateRef === "PROGRAM:m2"),
    "the member that failed to merge is still in the cart",
  );
  assert(
    partial.some((i) => i.candidateRef === "CLAUDE:u9"),
    "a non-program candidate is never touched by a program merge",
  );

  const allMerged = guestCartWithoutMerged(cart, ["m1", "m2", "m3"]);
  assert(allMerged.length === 1, "all merged → only the non-program item remains");
  assert(allMerged[0]!.candidateRef === "CLAUDE:u9", "and it is the right one");

  // An id the server names that is not in the cart must not disturb anything.
  const stray = guestCartWithoutMerged(cart, ["m1", "not-in-cart"]);
  assert(stray.length === 3, "an unknown merged id drops nothing extra");

  ok("guest cart survives a failed or partial merge");
}

console.log(`\n${passed} passed`);
