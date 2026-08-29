/**
 * Tokenisation, stemming and query expansion for the chatbot's lexical index.
 *
 * Deliberately dependency-free and free of `server-only`: the retrieval unit
 * tests import this directly, and a stemmer that can only run inside a request
 * is a stemmer nobody checks.
 *
 * The stemmer is intentionally crude. A full Porter implementation would buy
 * accuracy we cannot measure on a 200-chunk corpus, and its aggressive stem
 * classes ("registration" -> "registr") make debugging a retrieval miss much
 * harder. Suffix-stripping the five endings that actually differ between how
 * users type and how the knowledge base is written is enough.
 */

/**
 * Words that carry no retrieval signal.
 *
 * The second group matters more than it looks. Typed questions are full of
 * contractions and fillers — "whats", "im", "dont", "guys", "pls" — that the
 * knowledge base never contains, and an unknown word is charged the MAXIMUM
 * rarity by the confidence gate. So "whats your instagram" was being scored as
 * though "whats" were a rarer, more important term than "instagram", and the
 * question was refused. These are noise, and naming them as noise is the
 * honest fix; widening the gate to tolerate them would have let genuinely
 * unanswerable questions through too.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that",
  "this", "from", "have", "has", "was", "were", "can", "will", "what", "when",
  "how", "why", "who", "does", "did", "get", "got", "any", "all", "out",
  "about", "into", "than", "then", "them", "they", "there", "here", "its",
  // Contractions, fillers and chat spellings.
  "whats", "wat", "wht", "hows", "wheres", "whos", "dont", "doesnt", "cant",
  "wont", "isnt", "arent", "havent", "didnt", "ive", "im", "id", "ill", "youre",
  "theres", "thats", "lets", "guys", "actually", "really", "just", "please",
  "pls", "plz", "kindly", "sir", "maam", "hey", "hello", "want", "need",
  "know", "tell", "give", "take", "make", "some", "someone", "something",
  "anyone", "anything", "everything", "should", "would", "could", "must",
  "still", "also", "even", "much", "many", "more", "most", "very", "such",
  "like", "well", "way", "thing", "things", "stuff", "one", "two",
  // Hindi/Hinglish interrogatives and copulas. Indian users mix these into
  // otherwise-English questions ("next session kab hai"). They are function
  // words — the topic is carried by the English terms around them — so they
  // belong here rather than being scored as unknown, maximally-rare content.
  "kya", "kab", "kaise", "kahan", "kaha", "hai", "hain", "kar", "karna",
  "mujhe", "mera", "meri", "koi", "kitna", "kitne",
]);

/**
 * Strip a plural/participle suffix. Applied to documents and queries alike —
 * asymmetric stemming silently halves recall, so there is exactly one entry
 * point and both sides call it.
 */
export function stem(token: string): string {
  if (token.length < 6) return token;

  if (token.endsWith("ies") && token.length - 3 >= 4) {
    return `${token.slice(0, -3)}y`;
  }

  /**
   * Plural "-es" only drops the "e" after a sibilant (boxes -> box, matches ->
   * match). Everywhere else the "e" belongs to the stem, and taking it costs a
   * real match: the knowledge base writes "no hiring guarantees" while a user
   * types "guarantee", and stripping "es" turned those into `guarante` and
   * `guarantee` — two different terms. Same for certificates/certificate, which
   * is about as central as a term gets in this corpus.
   */
  if (token.endsWith("es") && token.length - 2 >= 4) {
    const base = token.slice(0, -2);
    if (/(?:s|x|z|ch|sh)$/.test(base)) return base;
    return token.slice(0, -1);
  }

  // "ss" is not a plural: process, access, address.
  if (token.endsWith("s") && !token.endsWith("ss") && token.length - 1 >= 4) {
    return token.slice(0, -1);
  }

  for (const suffix of ["ing", "ed", "ly"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, token.length - suffix.length);
    }
  }

  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    .map(stem);
}

/**
 * Query-time synonym expansion.
 *
 * Keys are what users type; values are what the knowledge base actually says.
 * Expansion is one-directional and query-only — expanding documents too would
 * inflate term frequencies and skew BM25's length normalisation.
 *
 * Entries earn their place by being a real observed miss, not by being a
 * plausible synonym. Every line here fixed a failing retrieval case.
 */
const SYNONYMS: Record<string, string[]> = {
  cert: ["certificate", "certification"],
  certs: ["certificate", "certification"],
  claim: ["certificate", "achievements", "issued"],
  signup: ["register", "registration", "join"],
  register: ["registration", "join", "signup"],
  joining: ["register", "registration"],
  cost: ["free", "price", "fee", "paid"],
  price: ["free", "cost", "fee", "paid"],
  fees: ["free", "cost", "price", "paid"],
  pricing: ["free", "cost", "price"],
  charge: ["free", "cost", "fee"],
  money: ["free", "cost", "fee", "price"],
  mock: ["interview", "voice"],
  practice: ["interview", "voice", "mock"],
  practise: ["interview", "voice", "mock"],
  resume: ["interview", "voice"],
  insta: ["instagram", "social"],
  ig: ["instagram", "social"],
  socials: ["instagram", "linkedin", "youtube", "discord", "social"],
  handle: ["instagram", "linkedin", "youtube", "social"],
  whatsapp: ["community", "group", "invite"],
  hackathon: ["vicodathon", "vibe"],
  vicodathon: ["hackathon", "vibe"],
  workshop: ["event", "session", "webinar"],
  webinar: ["workshop", "event", "session"],
  event: ["workshop", "session"],
  eligible: ["eligibility", "who", "participate"],
  eligibility: ["eligible", "participate"],
  tag: ["tags", "linkedin", "mention"],
  tags: ["tag", "linkedin", "mention"],
  repo: ["repository", "github"],
  cohort: ["program", "cohort"],
  hire: ["recruiter", "hiring", "scout"],
  hiring: ["recruiter", "scout", "hire"],
  job: ["recruiter", "hiring", "jobs"],
  privacy: ["data", "policy", "rights"],
  delete: ["erasure", "deletion", "rights"],
  refund: ["fee", "free", "payment"],
  retry: ["attempt", "again", "restart"],
  retake: ["attempt", "again", "restart"],
  reattempt: ["attempt", "restart"],
  attempt: ["retry", "restart"],
  course: ["program", "challenge", "cohort"],
  courses: ["program", "challenge", "cohort"],
  class: ["workshop", "session", "program"],
  classes: ["workshop", "session", "program"],
  winner: ["judging", "judge", "prize", "winners"],
  winners: ["judging", "judge", "prize"],
  judged: ["judging", "criteria"],
  laptop: ["ram", "requirement", "hardware"],
  system: ["laptop", "ram", "requirement"],
  qualify: ["eligible", "eligibility"],
  qualification: ["eligible", "eligibility"],
  upload: ["submit", "push", "github"],
  submit: ["submission", "upload", "push"],
  post: ["linkedin", "publish"],
  timing: ["time", "schedule", "date"],
  schedule: ["date", "time", "calendar"],
  duration: ["long", "minute", "day"],
  deadline: ["close", "closes", "last"],
  contact: ["email", "reach", "support"],
  email: ["contact", "support"],
  community: ["whatsapp", "discord", "group"],
  connection: ["internet", "network"],
  disconnect: ["internet", "connection", "drop"],
  proof: ["evidence", "github", "linkedin", "portfolio"],
  placement: ["hiring", "recruiter", "job"],
  salary: ["compensation", "hiring"],
  account: ["login", "profile", "sign"],
  login: ["account", "sign", "signed"],
  listen: ["recorded", "transcribed", "audio", "evaluation"],
  hear: ["recorded", "transcribed", "audio"],
  recording: ["recorded", "audio", "transcribed"],
  human: ["recruiter", "team", "admin"],
  stop: ["unsubscribe", "withdraw", "opt"],
  unsubscribe: ["newsletter", "marketing", "opt"],
  spam: ["newsletter", "marketing", "email"],
};

/**
 * `SYNONYMS` is written in plain English, but lookup happens against STEMMED
 * tokens — "pricing" reaches this map as "pric", "socials" as "social". Keying
 * the map by its stem at module load is what keeps the table readable and the
 * lookups correct; writing pre-stemmed keys by hand invites silent misses that
 * only show up as a retrieval regression months later.
 */
const STEMMED_SYNONYMS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const stemmedKey = stem(key.toLowerCase());
    const stemmedValues = values.map((v) => stem(v.toLowerCase()));
    const existing = map.get(stemmedKey);
    map.set(
      stemmedKey,
      existing ? [...new Set([...existing, ...stemmedValues])] : stemmedValues,
    );
  }
  return map;
})();

/** Expansions for a single stemmed token, or an empty array. */
export function expansionsFor(token: string): string[] {
  return STEMMED_SYNONYMS.get(token) ?? [];
}

/**
 * Tokens the query implies but did not say. Returned separately from the
 * literal tokens so the caller can weight them below the user's own wording —
 * an expansion should broaden recall, never outvote what was actually typed.
 */
export function expandQuery(queryTokens: string[]): string[] {
  const literal = new Set(queryTokens);
  const expanded = new Set<string>();
  for (const token of queryTokens) {
    const hits = STEMMED_SYNONYMS.get(token);
    if (!hits) continue;
    for (const hit of hits) {
      if (!literal.has(hit)) expanded.add(hit);
    }
  }
  return [...expanded];
}
