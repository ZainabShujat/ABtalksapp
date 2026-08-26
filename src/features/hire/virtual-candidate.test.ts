/**
 * Virtual candidates, fingerprints and the match threshold — run with:
 *   npm run test:virtual
 *
 * No network, no database. Everything under test here is pure by design: the
 * fingerprint has to produce the same string in a test, on the server and in
 * next week's admin report, or the deduplication it exists for is worthless.
 */
import {
  generateVirtualCandidate,
  virtualCandidateToCard,
  isVirtualRef,
  VIRTUAL_REF_PREFIX,
} from "@/features/hire/virtual-candidate";
import {
  requirementFingerprint,
  fingerprintSimilarity,
  normaliseSkills,
  normaliseLocation,
  experienceBand,
} from "@/features/hire/requirement-fingerprint";
import {
  hasSufficientRealMatches,
  matchConfig,
  DEFAULT_MATCH_THRESHOLD,
} from "@/features/hire/match-config";
import { canTransition } from "@/features/hire/virtual-candidate-store";
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

const mern: JobSpec = {
  title: "Full Stack Developer",
  mustHaveStack: ["Python", "Flask", "MERN"],
  minExperience: 3,
  locationCity: "Delhi NCR",
  noticePeriodDays: 15,
};

console.log("\nrequirement fingerprint");

suite("skill order does not change the fingerprint", () => {
  const a = requirementFingerprint({ ...mern, mustHaveStack: ["Python", "Flask", "MERN"] });
  const b = requirementFingerprint({ ...mern, mustHaveStack: ["MERN", "python", "FLASK"] });
  assert(a.key === b.key, `order or case changed the key:\n      ${a.key}\n      ${b.key}`);
});

suite("MERN expands so its members compare", () => {
  const skills = normaliseSkills(["MERN"]);
  for (const part of ["mongodb", "express", "react", "nodejs"]) {
    assert(skills.includes(part), `MERN should expand to include ${part}`);
  }
});

suite("aliases collapse: JS/TS/Node/Postgres", () => {
  const s = normaliseSkills(["JS", "TS", "Node.js", "Postgres", "K8s"]);
  for (const want of ["javascript", "typescript", "nodejs", "postgresql", "kubernetes"]) {
    assert(s.includes(want), `expected ${want} in ${s.join(",")}`);
  }
});

suite("the metros normalise to one spelling each", () => {
  for (const raw of ["Delhi", "New Delhi", "NCR", "Gurgaon", "Noida", "delhi ncr"]) {
    assert(
      normaliseLocation(raw) === "delhi-ncr",
      `${raw} should normalise to delhi-ncr, got ${normaliseLocation(raw)}`,
    );
  }
  assert(normaliseLocation("Bangalore") === normaliseLocation("Bengaluru"), "blr");
  assert(normaliseLocation(null) === "any", "absent location is 'any'");
});

suite("experience becomes a band, so 3+ and 3-5 agree", () => {
  assert(experienceBand(3, null) === experienceBand(3, 5), "3+ and 3-5 must band together");
  assert(experienceBand(null, null) === "any", "no experience stated is 'any'");
  assert(experienceBand(12) === "10+", "12 years lands in 10+");
});

suite("salary is not part of the signature", () => {
  const a = requirementFingerprint({ ...mern, salaryMin: 1_000_000 });
  const b = requirementFingerprint({ ...mern, salaryMin: 4_000_000 });
  assert(a.key === b.key, "paying more does not change who has to be found");
});

suite("two recruiters asking the same thing match at 1.0", () => {
  const a = requirementFingerprint(mern);
  const b = requirementFingerprint({
    title: "full stack developer",
    mustHaveStack: ["mern", "flask", "python"],
    minExperience: 3,
    locationCity: "Gurgaon",
  });
  assert(
    fingerprintSimilarity(a, b) === 1,
    `expected identical, got ${fingerprintSimilarity(a, b)} for\n      ${a.key}\n      ${b.key}`,
  );
});

suite("a different role family never counts as similar", () => {
  const a = requirementFingerprint(mern);
  const b = requirementFingerprint({
    title: "Data Scientist",
    mustHaveStack: ["Python", "Flask", "MERN"],
    minExperience: 3,
    locationCity: "Delhi NCR",
  });
  if (a.roleFamily !== b.roleFamily) {
    assert(fingerprintSimilarity(a, b) === 0, "different role families must score 0");
  }
});

suite("partial skill overlap lands strictly between 0 and 1", () => {
  const a = requirementFingerprint({ ...mern, mustHaveStack: ["python", "flask"] });
  const b = requirementFingerprint({ ...mern, mustHaveStack: ["python", "django"] });
  const s = fingerprintSimilarity(a, b);
  assert(s > 0 && s < 1, `expected a partial score, got ${s}`);
});

console.log("\nvirtual candidate generation");

suite("the title is the requirement, never a person", () => {
  const p = generateVirtualCandidate(mern)!;
  assert(p !== null, "should generate for a stated requirement");
  assert(
    p.title.includes("Full Stack Developer"),
    `title should carry the stated role, got ${p.title}`,
  );
  assert(/python/i.test(p.title), `title should lead with the stack, got ${p.title}`);
});

suite("no identity is fabricated anywhere in the profile", () => {
  const p = generateVirtualCandidate(mern)!;
  const blob = JSON.stringify(p);
  // Nothing that could be read as a person, an inbox, a phone or a profile.
  assert(!/@/.test(blob), "a virtual profile must contain no email-like value");
  assert(!/\d{3}\D*\d{3}/.test(blob), "must contain no digit run that reads as a phone");
  assert(!/linkedin|github\.com|twitter/i.test(blob), "must carry no social profile");
  assert(!("displayName" in (p as object)), "must not carry a displayName at all");
  const card = virtualCandidateToCard(p);
  assert(card.displayName == null, "the card must render with no name");
  assert(card.isVirtual === true, "the card must declare itself virtual");
});

suite("nothing is claimed to be measured", () => {
  const card = virtualCandidateToCard(generateVirtualCandidate(mern)!);
  assert(card.score === 0, "a requirement has no score");
  assert(card.tier === "NONE", "a requirement has no tier");
  assert(card.rationale === null, "a requirement has no evidence to explain");
});

suite("the ref stays inside the SAMPLE whitelist bypass", () => {
  const p = generateVirtualCandidate(mern)!;
  assert(p.ref.startsWith("SAMPLE:"), "must keep the SAMPLE: prefix the whitelist refuses");
  assert(p.ref.startsWith(VIRTUAL_REF_PREFIX), "must be identifiable as a virtual ref");
  assert(isVirtualRef(p.ref), "isVirtualRef must recognise its own output");
  assert(!isVirtualRef("PROGRAM:abc"), "a real ref is not virtual");
});

suite("the same requirement always produces the same ref", () => {
  const a = generateVirtualCandidate(mern)!;
  const b = generateVirtualCandidate({
    ...mern,
    mustHaveStack: ["MERN", "Python", "Flask"],
  })!;
  assert(a.ref === b.ref, `refs must be stable:\n      ${a.ref}\n      ${b.ref}`);
});

suite("a requirement that says nothing produces no card", () => {
  assert(generateVirtualCandidate({}) === null, "empty spec must not produce a card");
  assert(
    generateVirtualCandidate({ mustHaveStack: [] }) === null,
    "an empty stack with no title must not produce a card",
  );
});

suite("one skill is enough, and many do not break it", () => {
  const one = generateVirtualCandidate({ mustHaveStack: ["Rust"] });
  assert(one !== null, "a single skill is a valid requirement");
  assert(/Rust/i.test(one!.title), `title should name it, got ${one!.title}`);
  const many = generateVirtualCandidate({
    mustHaveStack: Array.from({ length: 20 }, (_, i) => `skill${i}`),
  });
  assert(many !== null, "many skills must still generate");
  assert(many!.requiredSkills.length === 20, "no skill is silently dropped");
});

suite("labels state the requirement, not a fact about a person", () => {
  const p = generateVirtualCandidate(mern)!;
  assert(/required/i.test(p.experienceLabel), `got ${p.experienceLabel}`);
  assert(/sourced/i.test(p.availabilityLabel), `got ${p.availabilityLabel}`);
  const noNotice = generateVirtualCandidate({ ...mern, noticePeriodDays: null })!;
  assert(noNotice.availabilityLabel === "To be sourced", "default availability wording");
});

console.log("\nmatch threshold");

suite("the threshold is configurable and defaults to 70", () => {
  assert(DEFAULT_MATCH_THRESHOLD === 70, "documented default");
  const before = process.env.HIRE_MATCH_THRESHOLD;
  process.env.HIRE_MATCH_THRESHOLD = "85";
  assert(matchConfig().threshold === 85, "env must override the default");
  process.env.HIRE_MATCH_THRESHOLD = "not-a-number";
  assert(matchConfig().threshold === 70, "garbage falls back rather than throwing");
  process.env.HIRE_MATCH_THRESHOLD = "0";
  assert(matchConfig().threshold === 70, "out-of-range falls back");
  if (before === undefined) delete process.env.HIRE_MATCH_THRESHOLD;
  else process.env.HIRE_MATCH_THRESHOLD = before;
});

suite("a strong pool suppresses the virtual card", () => {
  assert(hasSufficientRealMatches([{ score: 82 }]), "82 clears a threshold of 70");
  assert(!hasSufficientRealMatches([{ score: 55 }, { score: 60 }]), "near misses do not");
  assert(!hasSufficientRealMatches([]), "an empty pool never suffices");
});

suite("score decides, not tier", () => {
  // tierFor caps an unproven candidate at PARTIAL. That must not mean a pool of
  // genuinely close people is treated as empty.
  assert(
    hasSufficientRealMatches([{ score: 90, tier: "PARTIAL" }]),
    "a high score counts even when the tier is capped",
  );
});

console.log("\nsourcing workflow");

suite("the status machine refuses illegal moves", () => {
  assert(canTransition("REQUESTED", "SOURCING"), "the normal first step");
  assert(canTransition("SOURCING", "CANDIDATE_FOUND"), "sourcing finds someone");
  assert(canTransition("CANDIDATE_FOUND", "CANDIDATE_SHARED"), "then it is shared");
  assert(canTransition("CANDIDATE_SHARED", "FULFILLED"), "and closed");
  assert(!canTransition("REQUESTED", "FULFILLED"), "cannot fulfil without sourcing");
  assert(!canTransition("REQUESTED", "CANDIDATE_SHARED"), "cannot share nobody");
});

suite("terminal states are terminal", () => {
  for (const to of ["SOURCING", "REQUESTED", "CANDIDATE_FOUND", "FULFILLED"] as const) {
    assert(!canTransition("FULFILLED", to), `FULFILLED must not move to ${to}`);
    assert(!canTransition("CANCELLED", to), `CANCELLED must not move to ${to}`);
  }
});

suite("an expired request can be picked back up", () => {
  assert(canTransition("EXPIRED", "SOURCING"), "demand does not stop being real");
  assert(!canTransition("EXPIRED", "FULFILLED"), "but not straight to fulfilled");
});

suite("sourcing can be resumed when a lead falls through", () => {
  // Edge case 8: the linked candidate becomes unavailable.
  assert(canTransition("CANDIDATE_FOUND", "SOURCING"), "back to the search");
  assert(canTransition("CANDIDATE_SHARED", "SOURCING"), "even after sharing");
});

suite("a request can always be cancelled while it is open", () => {
  for (const from of ["REQUESTED", "SOURCING", "CANDIDATE_FOUND", "CANDIDATE_SHARED"] as const) {
    assert(canTransition(from, "CANCELLED"), `${from} must be cancellable`);
  }
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ""}\n`);
if (failed) process.exit(1);
