/**
 * Live composer ticks — run with:
 *   npm run test:spoken-brief
 */
import {
  detectSpokenBrief,
  type SpokenBriefFlags,
} from "@/features/hire/spoken-brief";
import { extractPoolBrief } from "@/features/hire/pool-brief";

type Field = keyof SpokenBriefFlags;
const STRIP: Field[] = ["role", "experience", "location", "education", "skills"];

let failed = 0;
let passed = 0;

function expectFlags(
  text: string,
  on: Field[],
  off: Field[] = STRIP.filter((f) => !on.includes(f)),
) {
  const got = detectSpokenBrief(text);
  const wrong = [
    ...on.filter((f) => !got[f]).map((f) => `${f} should be ON`),
    ...off.filter((f) => got[f]).map((f) => `${f} should be OFF`),
  ];
  if (wrong.length) {
    failed++;
    console.error(`FAIL  "${text}"\n      ${wrong.join(", ")}`);
  } else {
    passed++;
  }
}

function expectOn(field: Field, texts: string[]) {
  for (const t of texts) expectFlags(t, [field], []);
}

function expectOff(field: Field, texts: string[]) {
  for (const t of texts) expectFlags(t, [], [field]);
}

// ─── Full briefs (the task's matrix) ─────────────────────────────────────────

expectFlags(
  "Backend Engineer in Chennai with Go and microservices architecture",
  ["role", "location", "skills"],
);
expectFlags(
  "AI Engineer in Bangalore with 2+ years and B.Tech, React and Python",
  ["role", "experience", "location", "education", "skills"],
);
expectFlags("SDE-2 remote with Kafka and Java", ["role", "location", "skills"], [
  "education",
]);
expectFlags("SDE-2 remote with Kafka", ["role", "location", "skills"], [
  "education",
]);
expectFlags("Engineer in Kochi with 3 yoe", ["role", "location", "experience"]);
expectFlags("Go and microservices", ["skills"], ["education", "location"]);

// ─── Role ────────────────────────────────────────────────────────────────────

expectOn("role", [
  "Backend",
  "backend",
  "SDE",
  "SWE II",
  "MLE",
  "sde 3",
  "Engineer with backend skills",
  "Need a backend person",
  "full stack developer",
  "Chennai web developer",
  "hiring a designer",
  "looking for data analyst",
  "DevOps in Pune",
  "Python developer",
  "product manager",
  "PM for our fintech app",
  "QA with selenium",
]);
expectOff("role", [
  "who is prime minister of india",
  "I'm a hiring manager",
  "call me at 5 pm",
  "Chennai",
  "2 years",
]);

// ─── Location ────────────────────────────────────────────────────────────────

expectOn("location", [
  "Kochi",
  "Ahmedabad",
  "Jaipur",
  "Coimbatore",
  "Chandigarh",
  "Indore",
  "Vizag",
  "Lucknow",
  "BLR",
  "BOM",
  "HYD",
  "Madras",
  "delhi ncr",
  "Chennai backend",
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "wfh",
  "anywhere in the country",
]);
expectOff("location", ["backend engineer", "python and react", "SDE-2"]);

// ─── Years of experience ─────────────────────────────────────────────────────

expectOn("experience", [
  "2 yoe",
  "2 YOE",
  "2yoe",
  "two years",
  "3-5 years",
  "3 to 5 yrs",
  "5+ yrs",
  "1.5 years",
  "4+ exp",
  "experience of 3",
  "fresher",
  "junior",
  "mid-level",
  "senior",
  "lead",
  "staff engineer",
  "principal",
  "intern",
  "experienced backend developers",
]);
expectOff("experience", [
  "an experienced team is waiting",
  "SDE-2",
  "backend in Chennai",
  "B.Tech",
]);

// ─── Education ───────────────────────────────────────────────────────────────

expectOn("education", [
  "BE",
  "B.E.",
  "B.E",
  "BSc",
  "B.Sc",
  "MSc",
  "PhD",
  "Ph.D",
  "BS in CS",
  "MS from a US school",
  "B.Tech",
  "btech",
  "M.Tech",
  "BCA",
  "MCA",
  "MBA",
  "bachelor's",
  "masters",
  "any degree",
  "diploma holders",
  "graduate",
  "IIT",
  "NIT",
  "IIM",
]);
expectOff("education", [
  "should be good at python",
  "must be based in Pune",
  "MS Excel",
  "scrum master",
  "backend engineer",
  "upgrade our team",
]);

// ─── Skills ──────────────────────────────────────────────────────────────────

expectOn("skills", [
  "microservices",
  "Kafka",
  "Express",
  "Vue",
  "Angular",
  ".NET",
  "C++",
  "C#",
  "Kotlin",
  "Swift",
  "Azure",
  "GCP",
  "kubernetes",
  "k8s",
  "ci/cd",
  "Next.js",
  "golang",
  "Go",
  "javascript",
  "java",
  "postgresql",
]);
expectOff("skills", [
  "who is prime minister of india",
  "ongoing hiring",
  "go ahead and search",
  "let's go",
  "I want to go with a backend engineer",
  "I mean a backend engineer",
  "Chennai",
]);

// ─── Alignment with Search's extractor (pool-brief rules stay intact) ────────

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL  ${msg}`);
  }
}

const js = extractPoolBrief("javascript developer");
assert(
  js.mustHaveStack.includes("javascript") && !js.mustHaveStack.includes("java"),
  "pool-brief: javascript must not also extract java",
);
const golang = extractPoolBrief("golang engineer");
assert(
  golang.mustHaveStack.includes("golang") && !golang.mustHaveStack.includes("go"),
  "pool-brief: golang must not also extract go",
);
const pg = extractPoolBrief("postgresql dba");
assert(
  !pg.mustHaveStack.includes("sql"),
  "pool-brief: postgresql must not also extract sql",
);
const cpp = extractPoolBrief("c++ developer");
assert(cpp.mustHaveStack.includes("c++"), "pool-brief: c++ still extracts");
// Tick-only vocabulary must not leak into Search's mustHaveStack.
const ms = extractPoolBrief("backend engineer with go and microservices");
assert(
  ms.mustHaveStack.join(",") === "go",
  `pool-brief: tick-only skills stay out of mustHaveStack (got ${ms.mustHaveStack.join(",")})`,
);

// ─── Keystroke cost ──────────────────────────────────────────────────────────

const long =
  "AI Engineer in Bangalore with 2+ years and B.Tech, React and Python ".repeat(20);
const t0 = performance.now();
for (let i = 0; i < 1000; i++) detectSpokenBrief(long);
const perCall = (performance.now() - t0) / 1000;
assert(perCall < 2, `detectSpokenBrief too slow: ${perCall.toFixed(3)}ms per call`);

console.log(`spoken-brief: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
