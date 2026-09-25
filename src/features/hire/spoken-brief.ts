/**
 * Live "which facets has the recruiter already stated?" for the `/hire` strip.
 *
 * Runs on every keystroke in a client component, so it is pure, sync and
 * deterministic: no model, no network, and every RegExp is compiled once here
 * at module scope. No `server-only` — `scout-chat.tsx` imports it.
 *
 * Role and stack vocabulary comes from `pool-brief.ts` (the words Search
 * extracts with), so a tick and the search that follows agree. Tick-only
 * vocabulary (cities, degrees, extra skills) lives here, once. It is kept out of
 * `STACK_HINTS` on purpose: that list decides `mustHaveStack` at Search time,
 * and a tick must never quietly change what Search filters on.
 */
import { ROLE_HINTS, STACK_HINTS, stackTokenRe } from "@/features/hire/pool-brief";

export type SpokenBriefFlags = {
  role: boolean;
  experience: boolean;
  location: boolean;
  education: boolean;
  skills: boolean;
  availability: boolean;
  compensation: boolean;
  abtalks: boolean;
};

// ─── Role ────────────────────────────────────────────────────────────────────

const TITLE =
  "(?:engineers?|developers?|devs?|programmers?|coders?|designers?|analysts?|architects?|scientists?|managers?|testers?|consultants?)";

/** Specialty words that are a role on their own ("need a backend person"). */
const ROLE_ALONE_RE =
  /\b(?:devops|sdet|sre|mlops|data\s+scien(?:ce|tist)|product\s+manager|ui\s*\/?\s*ux|ux\s*\/?\s*ui)\b/;

/** SDE, SDE-2, SWE II, MLE, QA, APM/TPM. */
const ROLE_ABBREV_RE =
  /\b(?:sde|swe|mle|qa|apm|tpm)(?:[-\s]?(?:i{1,3}|[1-5]))?\b/;

/** "PM" as a role, not "5 pm". */
const PM_RE = /\bpm\b/;
const CLOCK_PM_RE = /\d\s*(?:am|pm)\b/;

/** "Chennai web developer" — a specialty right before a title. */
const SPECIALTY_TITLE_RE = new RegExp(
  `\\b(?:back[-\\s]?end|front[-\\s]?end|full[-\\s]?stack|software|web|mobile|android|ios|app|cloud|platform|security|cyber\\s*security|data|ml|ai|genai|llm|nlp|qa|test|automation|embedded|firmware|blockchain|game|product|ui|ux|graphic|visual|business|devops|infra(?:structure)?|site\\s+reliability|solutions?)\\b[\\w\\s./-]{0,20}?\\b${TITLE}\\b`,
);

/** A title with hiring language before it. */
const HIRE_TITLE_RE = new RegExp(
  `\\b(?:hiring|hire|need|needs|needed|looking\\s+for|want|wanted|recruit(?:ing)?|find|search(?:ing)?|get\\s+me|show\\s+me|require[ds]?)\\b[\\s\\S]{0,40}?\\b${TITLE}\\b`,
);

/** A title that opens the brief, or is followed by a constraint. */
const LEADING_TITLE_RE = new RegExp(
  `^\\s*(?:(?:a|an|the|some)\\s+)?(?:[\\w.+#-]+\\s+){0,2}${TITLE}\\b`,
);
const TITLE_PREP_RE = new RegExp(
  `\\b${TITLE}(?:\\s+(?:in|with|for|who|having|from|at|based)\\b|\\s*[,-])`,
);
const TITLE_RE = new RegExp(`\\b${TITLE}\\b`);

/** "I'm a hiring manager" describes the recruiter, not the role. */
const NOT_A_ROLE_RE = /\bhiring\s+managers?\b/g;

// ─── Experience ──────────────────────────────────────────────────────────────

const NUMBER_WORD =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";

/** 2 years, 2+ yrs, 3-5 years, 3 to 5 yrs, 2yoe, 2 YOE, 1.5 years. */
const YEARS_RE = new RegExp(
  `(?:\\b\\d{1,2}(?:\\.\\d)?|\\b${NUMBER_WORD})\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*(?:\\d{1,2}|${NUMBER_WORD})\\s*\\+?\\s*)?(?:years?|yrs?|yr|yoe)\\b`,
);
/** "3+ exp", "experience of 4", "exp: 2". */
const EXP_NUMBER_RE =
  /\b\d{1,2}\s*\+?\s*(?:exp|experience)\b|\b(?:exp|experience)\s*(?:of|:|-)?\s*\d{1,2}\b/;
const SENIORITY_RE =
  /\b(?:freshers?|entry[-\s]?level|junior|jr\.?|mid[-\s]?(?:level|senior)?|senior|sr\.?|staff|principal|lead|intern(?:s|ship)?|graduate\s+trainee)\b/;
/** "experienced" about the candidate, not "an experienced team". */
const EXPERIENCED_RE = new RegExp(
  `\\bexperienced\\s+(?:[\\w.+#-]+\\s+){0,2}(?:${TITLE}|candidates?|people|persons?|professionals?|folks|hires?|talent)\\b`,
);

// ─── Education ───────────────────────────────────────────────────────────────

const EDUCATION_RE =
  /\b(?:b\.?\s?tech|m\.?\s?tech|b\.e\b\.?|m\.e\b\.?|bca|mca|mba|bba|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|ph\.?\s?d|b\.s\.|m\.s\.|bachelor'?s?|masters?|master's|degree|diploma|(?:under|post)?[-\s]?graduates?|grads?|iits?|nits?|iiits?|iims?|bits\s+pilani|bdes|mdes|BDes|MDes|computer\s+science)\b/;
/** Case-sensitive: "BE", "BS", "MS" only when written as degrees. */
const EDUCATION_CAPS_RE = /\b(?:BE|BS|MS)\b/;
const CAPS_FALSE_RE =
  /\b(?:SHOULD|MUST|WILL|CAN|TO|WOULD|MAY|MIGHT|NOT|COULD|WANT|NEED)\s+BE\b|\bMS\s+(?:excel|office|word|teams|sql|access|dynamics|azure|project)\b/i;
const NOT_EDUCATION_RE = /\bscrum\s+masters?\b|\bmaster\s+data\b/g;

// ─── Location ────────────────────────────────────────────────────────────────

const PLACES = [
  // metros + aliases
  "delhi", "new delhi", "ncr", "delhi ncr", "gurgaon", "gurugram", "noida",
  "greater noida", "faridabad", "ghaziabad", "mumbai", "bombay", "bom",
  "navi mumbai", "thane", "pune", "bangalore", "bengaluru", "blr", "b'?lore",
  "hyderabad", "hyd", "secunderabad", "chennai", "madras", "kolkata",
  "calcutta", "ahmedabad", "gandhinagar",
  // tier 2
  "surat", "vadodara", "baroda", "rajkot", "jaipur", "jodhpur", "udaipur",
  "kochi", "cochin", "ernakulam", "trivandrum", "thiruvananthapuram",
  "kozhikode", "calicut", "thrissur", "coimbatore", "madurai", "trichy",
  "tiruchirappalli", "vellore", "pondicherry", "puducherry", "mysore",
  "mysuru", "mangalore", "mangaluru", "manipal", "hubli", "belgaum",
  "belagavi", "chandigarh", "mohali", "panchkula", "ludhiana", "amritsar",
  "indore", "bhopal", "gwalior", "jabalpur", "lucknow", "kanpur", "agra", "varanasi", "prayagraj", "allahabad", "meerut", "dehradun",
  "shimla", "nagpur", "nashik", "aurangabad", "kolhapur", "vizag",
  "visakhapatnam", "vijayawada", "guntur", "tirupati", "warangal",
  "bhubaneswar", "cuttack", "patna", "ranchi", "jamshedpur", "raipur",
  "guwahati", "goa", "srinagar", "jammu",
  // country / region
  "india", "pan[-\\s]?india", "bharat", "usa", "united states", "abroad", "us", "uk", "united kingdom", 
  "united arab emirates", "uae", "dubai", "abu dhabi", "sharjah", "ajman", "fujairah", "ras al khaimah", "umm al quwain", "dubai", "abu dhabi", "sharjah", "ajman", "fujairah", "ras al khaimah", "umm al quwain",
  "japan", "japanese", "tokyo", "kyoto", "osaka", "nagoya", "sapporo", "hiroshima", "sendai", "fukuoka", "okinawa", "japan", "japanese", "tokyo", "kyoto", "osaka", "nagoya", "sapporo", "hiroshima", "sendai", "fukuoka", "okinawa",
  "china", "chinese", "beijing", "shanghai", "guangzhou", "shenzhen", "hangzhou", "wuhan", "chongqing", "nanjing", "chinese", "beijing", "shanghai", "guangzhou", "shenzhen", "hangzhou", "wuhan", "chongqing", "nanjing",
  "indonesia", "indonesian", "jakarta", "surabaya", "bandung", "medan", "bali", "balinese", "bali", "balinese", "jakarta", "surabaya", "bandung", "medan", "bali", "balinese",
  "malaysia", "malaysian", "kuala lumpur", "penang", "ipoh", "kuching", "malaysian", "kuala lumpur", "penang", "ipoh", "kuching",
  "thailand", "thai", "bangkok", "phuket", "pattaya", "chiang mai", "thai", "bangkok", "phuket", "pattaya", "chiang mai",
  "vietnam", "vietnamese", "ho chi minh city", "hanoi", "danang", "hue", "vietnamese", "ho chi minh city", "hanoi", "danang", "hue",
  "philippines", "filipino", "manila", "cebu", "davao", "quezon city", "filipino", "manila", "cebu", "davao", "quezon city",
  "singapore", "korea", "south korea", "north korea", "seoul", "busan", "incheon", "jeju", "daejeon", "daegu", "ulsan", "seoul", "busan", "incheon", "jeju", "daejeon", "daegu", "ulsan",
  "australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart", "darwin", "act", "nsw", "vic", "qld", "sa", "wa", "tas", "nt", "act", "nsw", "vic", "qld", "sa", "wa", "tas", "nt",
  "new zealand", "auckland", "wellington", "christchurch", "dunedin", "invercargill", "new zealand", "auckland", "wellington", "christchurch", "dunedin", "invercargill",
  "europe", "chicago","dallas","new york", "california", "texas", "florida", "illinois", "new jersey", "pennsylvania", "ohio", "michigan", "wisconsin", "minnesota", "indiana", "illinois", "new jersey", "pennsylvania", "ohio", "michigan", "wisconsin", "minnesota", "indiana", "illinois", "new jersey", "pennsylvania", "ohio", "michigan", "wisconsin", "minnesota", "indiana",

  // work-mode intent that answers "where"
  "remote", "hybrid", "on[-\\s]?site", "wfh", "wfo", "work from home", "home", "office", 
  "work from office", "anywhere", "relocat(?:e|ion|able)",
];
const LOCATION_RE = new RegExp(`\\b(?:${PLACES.join("|")})\\b`);

// ─── Skills ──────────────────────────────────────────────────────────────────

/**
 * Tick-only skills. `STACK_HINTS` is unioned in below; add a token here only if
 * it is unambiguous as a skill in a hiring brief ("mean" and "excel" alone are
 * not: "I mean", "candidates who excel").
 */
const EXTRA_SKILLS = [
  "microservices", "micro-services", "micro services", "kafka", "rabbitmq",
  "express", "expressjs", "express.js", "vue", "vuejs", "vue.js", "angular",
  "angularjs", "next.js", "nextjs", "nestjs", "nest.js", "node.js", "svelte",
  "redux", "html", "css", "tailwind", "sass", "dotnet", ".net", "asp.net",
  "c#", "flutter", "react native", "dart", "php", "laravel", "ruby",
  "rails", "scala", "elixir", "aws", "azure", "gcp", "google cloud",
  "docker", "kubernetes", "k8s", "terraform", "ansible", "jenkins", "ci/cd",
  "cicd", "linux", "git", "graphql", "rest api", "rest apis", "grpc",
  "redis", "mongodb", "mongo", "mysql", "dynamodb", "cassandra",
  "elasticsearch", "spark", "pyspark", "hadoop", "airflow", "snowflake",
  "databricks", "dbt", "pandas", "numpy", "pytorch", "tensorflow", "keras",
  "scikit-learn", "sklearn", "langchain", "langgraph", "llm", "llms",
  "genai", "gen ai", "generative ai", "nlp", "computer vision", "opencv",
  "rag", "machine learning", "deep learning", "tableau", "power bi",
  "ms excel", "advanced excel", "figma", "selenium", "cypress",
  "playwright", "jest", "mern", "mean stack", "system design", "dsa", "data structures", "solidity", "web3",
  "unity", "matlab", "bash", "salesforce", "typescript", "javascript", 
];

function escapeToken(t: string): string {
  return t.replace(/[.+#*?()[\]{}|^$\\]/g, "\\$&");
}

/** One alternation over every non-"go" skill; longest first. */
const SKILL_TOKENS = [...new Set([...STACK_HINTS, ...EXTRA_SKILLS])]
  .filter((t) => t !== "go")
  .sort((a, b) => b.length - a.length);
const SKILLS_RE = new RegExp(
  `(^|[^a-z0-9])(?:${SKILL_TOKENS.map(escapeToken).join("|")})(?![a-z0-9])`,
);

/**
 * "go" is the language only when it is not the verb. Search's own matcher
 * (`stackTokenRe("go")`) keeps it out of "golang" / "ongoing"; this also drops
 * "go ahead", "to go", "let's go", "go-to".
 */
const GO_RE = stackTokenRe("go");
const GO_VERB_RE =
  /\b(?:to|let'?s|lets|will|would|can|could|should|must|gonna|we|i|you|pls|please)\s+go\b|\bgo(?:-to|\s+(?:to|ahead|with|for|back|through|over|on|live|out|into|up|and\s+(?:find|get|search|see|look)))\b/g;

// ─── Availability / compensation / ABtalks (unchanged from the composer) ─────

const AVAILABILITY_RE =
  /\b(remote|hybrid|onsite|on-site|wfh|immediate|notice|available|full[-\s]?time|contract|intern(ship)?|part[-\s]?time)\b/;
const COMPENSATION_RE =
  /\b(\d+(\.\d+)?\s*(-\s*\d+(\.\d+)?)?\s*(lpa|lakh|ctc)|salary|budget|₹|inr|compensation|stipend)\b/;
const ABTALKS_RE =
  /\b(ab\s?talks?.{0,40}(recommend|verif|rank|approv|vett|certif|score)|platform[-\s]verified)\b/;

// ─── Detector ────────────────────────────────────────────────────────────────

function detectSkills(text: string): boolean {
  if (SKILLS_RE.test(text)) return true;
  return GO_RE.test(text.replace(GO_VERB_RE, " "));
}

function detectRole(text: string, skills: boolean): boolean {
  if (ROLE_HINTS.some((h) => h.re.test(text))) return true;
  if (ROLE_ALONE_RE.test(text) || ROLE_ABBREV_RE.test(text)) return true;
  if (PM_RE.test(text) && !CLOCK_PM_RE.test(text)) return true;
  const t = text.replace(NOT_A_ROLE_RE, " ");
  if (!TITLE_RE.test(t)) return false;
  return (
    SPECIALTY_TITLE_RE.test(t) ||
    HIRE_TITLE_RE.test(t) ||
    LEADING_TITLE_RE.test(t) ||
    TITLE_PREP_RE.test(t) ||
    // A bare title next to a named stack ("python ... engineer").
    skills
  );
}

function detectEducation(raw: string, text: string): boolean {
  if (EDUCATION_RE.test(text.replace(NOT_EDUCATION_RE, " "))) return true;
  return EDUCATION_CAPS_RE.test(raw) && !CAPS_FALSE_RE.test(raw);
}

/**
 * Which brief facets the text already states. Juicebox-style: the strip ticks
 * go green while the recruiter types, before Scout has stored a spec.
 */
export function detectSpokenBrief(raw: string): SpokenBriefFlags {
  const text = raw.toLowerCase().replace(/[’‘]/g, "'");
  const skills = detectSkills(text);
  return {
    role: detectRole(text, skills),
    experience:
      YEARS_RE.test(text) ||
      EXP_NUMBER_RE.test(text) ||
      SENIORITY_RE.test(text) ||
      EXPERIENCED_RE.test(text),
    location: LOCATION_RE.test(text),
    education: detectEducation(raw, text),
    skills,
    availability: AVAILABILITY_RE.test(text),
    compensation: COMPENSATION_RE.test(text),
    abtalks: ABTALKS_RE.test(text),
  };
}
