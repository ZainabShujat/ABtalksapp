/**
 * Deterministic checks for the interview platform's config layer (plan 103).
 *
 * Covers only pure modules — packs, rubrics, domains, the question strategy and
 * the planner. No database, no network, no model. That is the point: the whole
 * config layer is authored data plus assertions, so it can be verified in a
 * plain script and a bad pack never reaches a candidate.
 *
 * Most of the integrity rules are enforced at MODULE LOAD by
 * `packs/index.ts:assertPackIntegrity`, `rubrics.ts` and `domains.ts`, so
 * importing them at all is itself a large part of the test. What this script
 * adds is the checks that need a built plan, plus negative cases proving the
 * assertions actually fire.
 *
 * Run: npx tsx scripts/verify-interview-packs.ts
 */
import assert from "node:assert/strict";

import {
  allPacks,
  assertPackIntegrity,
  getPack,
} from "../src/features/interview/platform/packs";
import { getRubric } from "../src/features/interview/platform/rubrics";
import {
  getDomain,
  getStartableDomain,
  listDomains,
  listLiveDomains,
  toDomainSummary,
} from "../src/features/interview/platform/domains";
import {
  buildPlatformPlan,
  platformContextOf,
  platformOpeningLine,
} from "../src/features/interview/platform/planner";
import { resolveStrategy } from "../src/features/interview/platform/question-strategy";
import type { InterviewPack } from "../src/features/interview/platform/types";

let checks = 0;
function check(label: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

function expectThrows(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert.equal(threw, true, `expected "${label}" to throw`);
  checks += 1;
  console.log(`  ok  rejects ${label}`);
}

console.log("\nplatform packs");

check("both packs are registered", () => {
  const ids = allPacks().map((p) => `${p.id}@${p.version}`).sort();
  assert.deepEqual(ids, ["ai-fluency@1", "behavioral@1"]);
});

check("every question id is unique across all packs", () => {
  const seen = new Set<string>();
  for (const pack of allPacks()) {
    for (const q of pack.questions) {
      assert.equal(
        seen.has(q.id),
        false,
        `question id ${q.id} is reused across packs; evidence keys would collide`,
      );
      seen.add(q.id);
    }
  }
});

check("every pack question maps to a real rubric competency", () => {
  for (const pack of allPacks()) {
    const ids = new Set(getRubric(pack.rubricId).competencies.map((c) => c.id));
    for (const q of pack.questions) {
      assert.equal(
        ids.has(q.platformCompetencyId),
        true,
        `${pack.id}:${q.id} → ${q.platformCompetencyId}`,
      );
    }
  }
});

check("every scored rubric competency is assessed by a question", () => {
  for (const pack of allPacks()) {
    const assessed = new Set(pack.questions.map((q) => q.platformCompetencyId));
    for (const c of getRubric(pack.rubricId).competencies) {
      if (c.observedAcrossAnswers) continue;
      assert.equal(assessed.has(c.id), true, `${pack.rubricId}:${c.id} unassessed`);
    }
  }
});

check("rubric weights total 100", () => {
  for (const pack of allPacks()) {
    const total = getRubric(pack.rubricId).competencies.reduce(
      (sum, c) => sum + c.weight,
      0,
    );
    assert.equal(total, 100, `${pack.rubricId} totals ${total}`);
  }
});

check("the two live rubrics share no competency ids", () => {
  const a = new Set(getRubric("ai-fluency-v1").competencies.map((c) => c.id));
  const b = getRubric("behavioral-v1").competencies.map((c) => c.id);
  const overlap = b.filter((id) => a.has(id));
  assert.deepEqual(
    overlap,
    [],
    "the two Phase 1 rubrics must differ, so that any hidden assumption of a " +
      "fixed competency set fails now rather than at the eighth domain",
  );
});

check("every scaffold targets a real expected-evidence item", () => {
  for (const pack of allPacks()) {
    for (const q of pack.questions) {
      for (const s of q.scaffoldProbes ?? []) {
        assert.equal(
          q.expectedEvidence.includes(s.targets),
          true,
          `${pack.id}:${q.id} scaffold → "${s.targets}"`,
        );
      }
    }
  }
});

check("deep probes ascend and declare their own evidence", () => {
  for (const pack of allPacks()) {
    for (const q of pack.questions) {
      let previous = 1;
      for (const probe of q.deepProbes ?? []) {
        assert.equal(probe.level > previous, true, `${pack.id}:${q.id}`);
        assert.equal(probe.expectedEvidence.length > 0, true, `${pack.id}:${q.id}`);
        previous = probe.level;
      }
    }
  }
});

check("minEvidence is satisfiable for every question", () => {
  for (const pack of allPacks()) {
    for (const q of pack.questions) {
      assert.equal(q.minEvidence >= 1, true, `${pack.id}:${q.id}`);
      assert.equal(
        q.minEvidence <= q.expectedEvidence.length,
        true,
        `${pack.id}:${q.id}`,
      );
    }
  }
});

/* ------------------------------------------------ negative cases (the point) */

console.log("\nintegrity assertions actually fire");

const base = getPack({ packId: "ai-fluency", version: 1 });

function mutated(patch: (p: InterviewPack) => InterviewPack): InterviewPack {
  return patch(JSON.parse(JSON.stringify(base)) as InterviewPack);
}

expectThrows("a scaffold targeting a non-existent evidence item", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.scaffoldProbes = [
        { text: "x", targets: "not an evidence item" },
      ];
      return p;
    }),
  ),
);

expectThrows("minEvidence above the checklist length", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.minEvidence = 99;
      return p;
    }),
  ),
);

expectThrows("a duplicate question id", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[1]!.id = p.questions[0]!.id;
      return p;
    }),
  ),
);

expectThrows("a question pointing at an unknown section", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.sectionId = "no-such-section";
      return p;
    }),
  ),
);

expectThrows("a question scoring against a competency outside its rubric", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.platformCompetencyId = "not-in-rubric";
      return p;
    }),
  ),
);

expectThrows("non-ascending deep probe levels", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.deepProbes = [
        { level: 3, mode: "CONCEPTUAL", text: "a", expectedEvidence: ["x"] },
        { level: 2, mode: "CONCEPTUAL", text: "b", expectedEvidence: ["y"] },
      ];
      return p;
    }),
  ),
);

expectThrows("follow-ups allowed with no followUpPrompt", () =>
  assertPackIntegrity(
    mutated((p) => {
      p.questions[0]!.maxFollowUps = 2;
      p.questions[0]!.followUpPrompt = null;
      return p;
    }),
  ),
);

/* ---------------------------------------------------------------- domains */

console.log("\ndomains");

check("eight domains are registered", () => {
  assert.equal(listDomains().length, 8);
});

check("exactly two are LIVE", () => {
  const live = listLiveDomains().map((d) => d.slug).sort();
  assert.deepEqual(live, ["ai-fluency", "behavioral"]);
});

check("six are COMING_SOON", () => {
  assert.equal(listDomains().filter((d) => d.status === "COMING_SOON").length, 6);
});

check("every LIVE domain is startable, no COMING_SOON one is", () => {
  for (const domain of listDomains()) {
    const startable = getStartableDomain(domain.slug);
    assert.equal(
      startable !== null,
      domain.status === "LIVE",
      `${domain.slug} startable=${startable !== null} status=${domain.status}`,
    );
  }
});

check("COMING_SOON domains claim no rubric and no pack", () => {
  for (const domain of listDomains()) {
    if (domain.status === "LIVE") continue;
    assert.equal(
      domain.rubricId,
      null,
      `${domain.slug} names rubric "${domain.rubricId}" it does not actually ` +
        `use. A borrowed rubric reads as a decision to the next person.`,
    );
    assert.equal(domain.packRef, null, domain.slug);
  }
});

check("LIVE domains declare a rubric their pack was authored against", () => {
  for (const domain of listLiveDomains()) {
    assert.notEqual(domain.rubricId, null, domain.slug);
    assert.equal(getPack(domain.packRef!).rubricId, domain.rubricId, domain.slug);
  }
});

check("an unknown slug resolves to null rather than throwing", () => {
  assert.equal(getDomain("../../etc/passwd"), null);
  assert.equal(getStartableDomain("nope"), null);
});

check("no LIVE domain declares an unserved capability", () => {
  for (const domain of listLiveDomains()) {
    assert.deepEqual([...domain.capabilities], ["VOICE"], domain.slug);
  }
});

check("the unimplemented SCENARIO strategy throws if resolved", () => {
  let threw = false;
  try {
    resolveStrategy("SCENARIO");
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "SCENARIO must not silently resolve");
});

check("toDomainSummary emits plain serialisable data only", () => {
  for (const domain of listDomains()) {
    const summary = toDomainSummary(domain);
    assert.equal(JSON.parse(JSON.stringify(summary)).slug, domain.slug);
    assert.equal(
      summary.questionCount > 0,
      domain.status === "LIVE",
      `${domain.slug} questionCount=${summary.questionCount}`,
    );
  }
});

/* ------------------------------------------------------------------ plans */

console.log("\nplans");

for (const domain of listLiveDomains()) {
  check(`${domain.slug}: plan builds and is internally consistent`, () => {
    const plan = buildPlatformPlan(domain, { candidateFirstName: "Zainab" });
    const ctx = platformContextOf(plan);

    assert.notEqual(ctx, null, "context kind must be PLATFORM");
    assert.equal(ctx!.domainSlug, domain.slug);
    assert.equal(ctx!.questionCount, plan.questions.length);
    assert.deepEqual(ctx!.capabilities, ["VOICE"]);

    // Sections in the context must match the sections the questions use.
    const declared = new Set(ctx!.sections.map((s) => s.id));
    for (const q of plan.questions) {
      assert.equal(declared.has(q.sectionId!), true, `${q.id} → ${q.sectionId}`);
    }

    // Order is 1..n and dense: the engine reads questions by index.
    plan.questions.forEach((q, i) => assert.equal(q.order, i + 1, q.id));

    // No cohort leakage.
    for (const q of plan.questions) {
      assert.equal(q.sourceRef.source, "PLATFORM_PACK", q.id);
      assert.deepEqual(q.sourceRef.sourceDays, [], q.id);
      assert.equal(q.sourceRef.dayNumber, undefined, q.id);
      assert.equal(q.llmPhrased, false, q.id);
      assert.equal(q.spokenText, undefined, `${q.id} must be spoken as authored`);
      assert.equal(q.tier, "CORE", q.id);
    }
  });

  check(`${domain.slug}: questions are grouped in declared section order`, () => {
    const plan = buildPlatformPlan(domain);
    const ctx = platformContextOf(plan)!;
    const order = ctx.sections.map((s) => s.id);
    const seenAt = plan.questions.map((q) => order.indexOf(q.sectionId!));
    const sorted = [...seenAt].sort((a, b) => a - b);
    assert.deepEqual(seenAt, sorted, "sections must not interleave");
  });

  check(`${domain.slug}: opening line is seeded and reproducible`, () => {
    const a = platformOpeningLine({ domain, firstName: "Zainab", seed: "s1" });
    const b = platformOpeningLine({ domain, firstName: "Zainab", seed: "s1" });
    assert.equal(a, b, "same seed must reproduce the same opening");
    assert.equal(a.includes("Zainab"), true);
    assert.equal(a.includes("undefined"), false);
    assert.equal(a.includes("NaN"), false);

    const nameless = platformOpeningLine({ domain, firstName: null, seed: "s1" });
    assert.equal(nameless.length > 0, true, "a missing name must degrade, not fail");
    assert.equal(nameless.includes("null"), false);

    // Varies across seeds — otherwise every candidate hears one script.
    const seeds = new Set(
      Array.from({ length: 24 }, (_, i) =>
        platformOpeningLine({ domain, firstName: "Zainab", seed: `s${i}` }),
      ),
    );
    assert.equal(seeds.size > 1, true, "opening must vary across attempts");
  });
}

check("a domain with no packRef cannot be planned", () => {
  const comingSoon = listDomains().find((d) => d.status === "COMING_SOON")!;
  let threw = false;
  try {
    buildPlatformPlan(comingSoon);
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

console.log(`\n${checks} checks passed.\n`);
