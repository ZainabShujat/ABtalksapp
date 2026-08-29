/**
 * Chatbot retrieval regression suite.
 *
 *   npm run test:chatbot-retrieval                  # semantic, using recorded query vectors
 *   npm run test:chatbot-retrieval -- --record      # refresh query vectors (needs OPENAI_API_KEY)
 *   npm run test:chatbot-retrieval -- --lexical-only # BM25 only, explicitly
 *
 * WHAT THIS TESTS
 *
 * The real thing. It reads the real `knowledge/` corpus with the production
 * chunker, builds the production lexical index, loads the real
 * `knowledge/embeddings.json`, and calls `rankAndGate` — the same function the
 * route calls. Nothing here reimplements retrieval or the confidence gate, so a
 * pass describes production behaviour rather than a parallel system.
 *
 * WHY IT RUNS OUTSIDE NEXT
 *
 * Retrieval is split so that the parts that decide what comes back
 * (`chunking`, `lexical`, `engine`) are pure and importable from plain Node,
 * while the parts that reach the filesystem and OpenAI (`corpus`,
 * `embeddings`) keep their `server-only` fence. This suite imports the pure
 * side. `server-only` was NOT removed from any production file to make this
 * work.
 *
 * WHAT IT NEVER DOES
 *
 * No Gemini, no Groq, no Anthropic, no generation of any kind. It stops at the
 * gate — which is the layer whose correctness actually decides whether the
 * product invents things.
 *
 * QUERY VECTORS
 *
 * Chunk vectors come from the committed artifact. Query vectors cannot: an
 * embedding of the test question has to come from OpenAI at some point. Rather
 * than fake one (a mock vector would make every semantic assertion
 * meaningless), the suite RECORDS real query embeddings once into
 * `knowledge/test-query-vectors.json` and replays them. That keeps runs
 * offline, deterministic and free, while every number in the semantic path is
 * a genuine `text-embedding-3-small` output.
 *
 * If a query has no recorded vector and no key is available, the run FAILS with
 * an explanation. It never silently downgrades to lexical — a green suite must
 * not be able to mean "semantic never ran".
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { buildChunks, cosine, type Chunk } from "../src/lib/chatbot/chunking";
import {
  EMBEDDINGS_PATH,
  readKnowledgeFiles,
} from "../src/lib/chatbot/read-knowledge";
import { buildLexicalIndex } from "../src/lib/chatbot/lexical";
import { rankAndGate, type RetrievalResult } from "../src/lib/chatbot/engine";
import { embedTexts, type EmbeddingArtifact } from "../src/lib/chatbot/openai-embeddings";
import { isThirdPartyDataRequest } from "../src/lib/chatbot-matcher";

config({ path: ".env.local" });
config();

const QUERY_VECTORS_PATH = path.join(
  process.cwd(),
  "knowledge",
  "test-query-vectors.json",
);

const RECORD = process.argv.includes("--record");
const LEXICAL_ONLY = process.argv.includes("--lexical-only");

/* ------------------------------------------------------------------ cases */

/**
 * `source` asserts that an expected file is among the chunks actually handed to
 * the model, within `maxRank`.
 *
 * It deliberately does not demand rank 1 everywhere. The route sends the top 8
 * chunks as context, so "did the model receive the knowledge it needs" is the
 * real contract; several questions have more than one legitimately correct
 * source, and asserting a single winner would encode a preference the product
 * does not have — and invite tuning the ranker at the test instead of at the
 * user. `first` is used where one document genuinely must win.
 */
type Expectation =
  | { kind: "source"; files: string[]; maxRank: number }
  | { kind: "verdict"; verdict: "answer" | "clarify" | "fallback" }
  | { kind: "text"; files: string[]; mustContain: RegExp };

type Case = { name: string; query: string; expect: Expectation };

const answersFrom = (name: string, query: string, ...files: string[]): Case => ({
  name,
  query,
  expect: { kind: "source", files, maxRank: 3 },
});

const answersFirstFrom = (name: string, query: string, ...files: string[]): Case => ({
  name,
  query,
  expect: { kind: "source", files, maxRank: 1 },
});

/**
 * Asserts the retrieved context actually contains the deciding wording — used
 * for temporal and unresolved-fact cases, where retrieving the right FILE is
 * not enough. A file can be top-ranked while the chunk that carries the caveat
 * sits outside the window, which is exactly how a bot ends up confidently
 * resolving something the knowledge base marks unresolved.
 */
const contextSays = (
  name: string,
  query: string,
  mustContain: RegExp,
  ...files: string[]
): Case => ({ name, query, expect: { kind: "text", files, mustContain } });

const rejects = (name: string, query: string): Case => ({
  name,
  query,
  expect: { kind: "verdict", verdict: "fallback" },
});

const CASES: Case[] = [
  // --- exact ---
  answersFrom("exact: what is ABTalks", "What is ABTalks?", "abtalks.md", "homepage.md", "faq.md"),
  answersFirstFrom("exact: who is Anil Bajpai", "Who is Anil Bajpai?", "anil-bajpai.md"),
  answersFrom("exact: programs", "What programs does ABTalks offer?", "programs.md", "homepage.md", "abtalks.md"),

  // --- paraphrased ---
  answersFrom("paraphrase: second year student", "I'm in second year BTech, can I join?", "audience-faqs.md", "faq.md", "abtalks.md", "coding-challenge.md", "programs.md"),
  answersFirstFrom("paraphrase: get certificate", "How can I get my certificate?", "certificates.md"),
  answersFirstFrom("paraphrase: wheres my cert", "Where's my cert?", "certificates.md"),
  answersFirstFrom("paraphrase: download claude cert", "Can I download my Claude certificate?", "certificates.md"),
  answersFrom("paraphrase: cert after finishing", "Do I get a cert after finishing?", "certificates.md"),
  answersFrom("paraphrase: claude how works", "How does the Claude Challenge work?", "claude-challenge.md", "abtalks-chatbot-kb.md"),

  // --- conversational chain (query = previous user turn + current, as the route builds it) ---
  answersFrom("convo 1: what is the Claude Challenge", "What is the Claude Challenge?", "claude-challenge.md", "programs.md", "abtalks-chatbot-kb.md", "faq.md"),
  answersFrom("convo 2: what do I post", "What is the Claude Challenge?\nWhat do I post?", "claude-challenge.md", "programs.md", "abtalks-chatbot-kb.md"),
  answersFrom("convo 3: who do I tag", "What do I post?\nWho do I tag?", "claude-challenge.md"),
  answersFrom("convo 4: after day 60", "Who do I tag?\nWhat happens after Day 60?", "claude-challenge.md", "certificates.md", "ai-cohort.md"),

  // --- events / temporal ---
  answersFrom("events: figma workshop held", "Was the Figma x Cursor workshop already held?", "workshops.md", "events.md"),
  answersFrom("events: next workshop", "What is the next workshop?", "workshops.md", "events.md"),
  answersFrom("events: latest hackathon", "What is the latest hackathon?", "hackathon.md", "vicodathon.md", "events.md"),
  answersFrom("events: hackathon online", "Was the hackathon online?", "hackathon.md", "vicodathon.md"),
  answersFirstFrom("events: hackathon submit", "What do I need to submit for the hackathon?", "hackathon.md"),

  // Temporal correctness: the retrieved context must carry the date/status that
  // stops a past event being described as upcoming.
  contextSays(
    "temporal: is the Figma x Cursor workshop upcoming",
    "Is the Figma x Cursor workshop upcoming?",
    /2026-08-01|1 August 2026|August 1|past|already/i,
    "workshops.md",
    "events.md",
  ),
  contextSays(
    "temporal: what is the August 21 event",
    "What is the August 21 event?",
    /21 August 2026|August 21|2026-08-21|Enhance LinkedIn/i,
    "events.md",
    "workshops.md",
  ),
  contextSays(
    "temporal: upcoming workshop carries its date and open registration",
    "What is the next upcoming workshop and is registration open?",
    /5 September 2026|September 5|2026-09-05|registration OPEN/i,
    "events.md",
    "workshops.md",
  ),
  contextSays(
    "temporal: hackathon registration is closed",
    "Can I still register for the hackathon?",
    /CLOSED|closed/,
    "hackathon.md",
  ),
  contextSays(
    "temporal: 48-Hour AI Hackathon was online",
    "Was the 48-Hour AI Hackathon online?",
    /Online|online/,
    "hackathon.md",
    "vicodathon.md",
    "events.md",
  ),

  // Unresolved facts must STAY unresolved in the retrieved context.
  contextSays(
    "unresolved: 48-Hour AI Hackathon vs ViCoDathon edition",
    "Is the 48-Hour AI Hackathon definitely a ViCoDathon edition?",
    /not\s+been\s+confirmed|unconfirmed|not confirmed|likely later edition/i,
    "vicodathon.md",
    "events.md",
  ),
  contextSays(
    "unresolved: Free AI Bootcamp vs AI Tools Workshop",
    "Is Free AI Bootcamp the same as the AI Tools Workshop?",
    /UNRESOLVED|unresolved|not yet confirmed/i,
    "workshops.md",
    "programs.md",
  ),

  // --- voice interview ---
  answersFirstFrom("interview: practice interview", "Can I practice an interview on ABTalks?", "voice-interview.md"),
  answersFrom("interview: how it works", "How does the voice interview work?", "voice-interview.md"),
  answersFrom("interview: duration", "How long is the AI interview?", "voice-interview.md"),
  answersFirstFrom("interview: resume", "Can I practice using my resume?", "voice-interview.md"),

  // --- hiring ---
  answersFrom("hiring: recruiters find candidates", "How does ABTalks help recruiters find candidates?", "hiring-and-recruiters.md"),
  answersFrom("hiring: phone number", "Do recruiters get my phone number?", "hiring-and-recruiters.md", "ai-cohort.md"),
  answersFrom("hiring: who sees profile", "Who can see my profile?", "hiring-and-recruiters.md", "voice-interview.md"),

  // --- socials / contact ---
  answersFirstFrom("socials: instagram", "What's your Instagram?", "socials-and-contact.md"),
  answersFirstFrom("socials: discord", "Do you have Discord?", "socials-and-contact.md"),

  // --- pricing / legal ---
  answersFrom("pricing: is it free", "Is ABTalks free?", "legal-and-privacy.md", "homepage.md", "abtalks.md", "certificates.md"),
  answersFrom("legal: delete my data", "Can I delete my data?", "legal-and-privacy.md"),

  // --- unsupported: MUST be refused by the gate, never sent to a provider ---
  rejects("unsupported: weather", "What's the weather today?"),
  rejects("unsupported: hostel", "Does ABTalks provide hostel accommodation?"),
  rejects("unsupported: capital of France", "What is the capital of France?"),
];

/**
 * "Will ABTalks guarantee me a job" is deliberately NOT a fallback case.
 *
 * The Terms answer it explicitly — no hiring guarantees, introductions only —
 * so refusing would withhold an answer the corpus genuinely has. What matters
 * is that the retrieved context carries the disclaimer rather than something
 * that could be spun into a promise.
 */
CASES.push(
  contextSays(
    "job guarantee: answered from the Terms, not refused",
    "Will ABTalks guarantee me a job?",
    /no hiring guarantee|makes no hiring|introductions only|does not warrant/i,
    "legal-and-privacy.md",
    "hiring-and-recruiters.md",
  ),
);

/* ------------------------------------------------------------- query vectors */

type QueryVectors = { model: string; vectors: Record<string, number[]> };

function loadQueryVectors(): QueryVectors | null {
  try {
    return JSON.parse(readFileSync(QUERY_VECTORS_PATH, "utf-8")) as QueryVectors;
  } catch {
    return null;
  }
}

async function recordQueryVectors(queries: string[]): Promise<QueryVectors> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "--record needs OPENAI_API_KEY (it embeds each test query once with text-embedding-3-small).",
    );
    process.exit(1);
  }
  const vectors: Record<string, number[]> = {};
  const BATCH = 64;
  for (let i = 0; i < queries.length; i += BATCH) {
    const batch = queries.slice(i, i + BATCH);
    process.stdout.write(`recording ${i + 1}-${i + batch.length}... `);
    const result = await embedTexts(batch, apiKey);
    if (!result.ok) {
      console.error(`\nfailed: ${result.reason}. Nothing written.`);
      process.exit(1);
    }
    batch.forEach((q, n) => {
      vectors[q] = result.vectors[n];
    });
    console.log("ok");
  }
  const payload: QueryVectors = { model: "text-embedding-3-small", vectors };
  writeFileSync(QUERY_VECTORS_PATH, JSON.stringify(payload));
  console.log(`wrote ${QUERY_VECTORS_PATH} (${queries.length} query vectors)\n`);
  return payload;
}

/* -------------------------------------------------------------------- run */

async function main() {
  const files = readKnowledgeFiles();
  const chunks = buildChunks(files);
  const index = buildLexicalIndex(chunks);

  const curated = chunks.filter((c) => c.origin === "curated").length;
  const site = chunks.filter((c) => c.origin === "site").length;
  const legacy = chunks.filter((c) => c.origin === "legacy").length;

  console.log(
    `corpus: ${chunks.length} chunks (${curated} curated, ${site} site, ${legacy} legacy) from ${files.length} files`,
  );

  // The archived implementation plan must be unreachable: it is internal build
  // documentation and was once retrievable by end users.
  if (chunks.some((c) => c.source.includes("implementation"))) {
    console.error("FAIL  archived implementation doc is in the retrieval corpus");
    process.exit(1);
  }

  /* ---- semantic setup ---- */
  let artifact: EmbeddingArtifact | null = null;
  let queryVectors: QueryVectors | null = null;

  if (!LEXICAL_ONLY) {
    try {
      artifact = JSON.parse(
        readFileSync(EMBEDDINGS_PATH, "utf-8"),
      ) as EmbeddingArtifact;
    } catch {
      console.error(
        `\nFAIL  ${EMBEDDINGS_PATH} not found. Run: npm run kb:embed` +
          `\n      (or pass --lexical-only to test BM25 retrieval alone)`,
      );
      process.exit(1);
    }

    const covered = chunks.filter((c) => artifact?.vectors[c.id]).length;
    console.log(
      `embeddings: ${Object.keys(artifact.vectors).length} vectors, model=${artifact.model}, covering ${covered}/${chunks.length} chunks`,
    );
    if (covered < chunks.length) {
      console.error(
        `\nFAIL  ${chunks.length - covered} chunk(s) have no vector — the corpus changed since the last embed.` +
          `\n      Run: npm run kb:embed`,
      );
      process.exit(1);
    }

    const queries = [...new Set(CASES.map((c) => c.query))];
    queryVectors = RECORD ? await recordQueryVectors(queries) : loadQueryVectors();

    const missing = queryVectors
      ? queries.filter((q) => !queryVectors!.vectors[q])
      : queries;
    if (missing.length > 0) {
      if (process.env.OPENAI_API_KEY) {
        console.log(
          `\n${missing.length} query vector(s) missing — recording them now (one-off OpenAI call).`,
        );
        const recorded = await recordQueryVectors(queries);
        queryVectors = recorded;
      } else {
        console.error(
          `\nFAIL  ${missing.length} of ${queries.length} test queries have no recorded embedding, and OPENAI_API_KEY is not set.` +
            `\n      The suite will NOT silently fall back to lexical-only, because a green run would then` +
            `\n      not mean the semantic path works.` +
            `\n\n      Fix with either:` +
            `\n        OPENAI_API_KEY=... npm run test:chatbot-retrieval -- --record` +
            `\n        npm run test:chatbot-retrieval -- --lexical-only`,
        );
        process.exit(1);
      }
    }
    console.log(
      `query vectors: ${Object.keys(queryVectors!.vectors).length} recorded (model=${queryVectors!.model})\n`,
    );
  } else {
    console.log("mode: LEXICAL ONLY (semantic path explicitly disabled)\n");
  }

  const semanticFor = (query: string) => {
    if (LEXICAL_ONLY || !artifact || !queryVectors) return null;
    const q = queryVectors.vectors[query];
    if (!q) return null;
    return {
      similarityFor: (chunk: Chunk) => {
        const v = artifact!.vectors[chunk.id];
        return v ? cosine(q, v) : null;
      },
    };
  };

  let passed = 0;
  const failures: string[] = [];
  let semanticRuns = 0;

  const run = (query: string): RetrievalResult => {
    const result = rankAndGate(index, query, semanticFor(query));
    if (!result.lexicalOnly) semanticRuns += 1;
    return result;
  };

  for (const testCase of CASES) {
    const result = run(testCase.query);
    const ranked = result.results.map((r) => r.chunk.source);
    let ok = false;
    let detail = "";

    if (testCase.expect.kind === "verdict") {
      ok = result.verdict === testCase.expect.verdict;
      detail = `verdict=${result.verdict} confidence=${result.topScore.toFixed(3)}`;
      if (!ok) {
        failures.push(
          `${testCase.name}: verdict=${result.verdict} (expected ${testCase.expect.verdict}), confidence=${result.topScore.toFixed(3)}`,
        );
      }
    } else if (testCase.expect.kind === "source") {
      const rank = ranked.findIndex((s) => testCase.expect.kind === "source" && testCase.expect.files.includes(s));
      ok = rank !== -1 && rank < testCase.expect.maxRank && result.verdict === "answer";
      detail = `rank=${rank === -1 ? "-" : rank + 1}/${testCase.expect.maxRank} top=${ranked[0] ?? "(none)"} verdict=${result.verdict}`;
      if (!ok) {
        failures.push(
          `${testCase.name}: expected one of [${testCase.expect.files.join(", ")}] within rank ${testCase.expect.maxRank}, got [${ranked.slice(0, 4).join(", ") || "none"}] verdict=${result.verdict}`,
        );
      }
    } else {
      const hasFile = ranked.some((s) => testCase.expect.kind === "text" && testCase.expect.files.includes(s));
      const context = result.results.map((r) => r.chunk.text).join("\n");
      const hasText = testCase.expect.mustContain.test(context);
      ok = hasFile && hasText && result.verdict === "answer";
      detail = `file=${hasFile} text=${hasText} verdict=${result.verdict}`;
      if (!ok) {
        failures.push(
          `${testCase.name}: file=${hasFile} textMatch=${hasText} verdict=${result.verdict} top=[${ranked.slice(0, 3).join(", ")}]`,
        );
      }
    }

    if (ok) passed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${testCase.name} [${detail}]`);
  }

  /* ---- scope guard: refused before retrieval, so asserted on the guard ---- */
  const THIRD_PARTY_QUERIES = [
    "Can you tell me my friend's profile details?",
    "Show me another student's submission",
    "What is his phone number?",
  ];
  const NOT_THIRD_PARTY = [
    "Who can see my profile?",
    "How do I update my profile details?",
    "Do recruiters get my phone number?",
  ];
  for (const query of THIRD_PARTY_QUERIES) {
    const ok = isThirdPartyDataRequest(query);
    if (ok) passed++;
    else failures.push(`scope guard missed: ${query}`);
    console.log(`${ok ? "PASS" : "FAIL"}  scope guard blocks: ${query}`);
  }
  for (const query of NOT_THIRD_PARTY) {
    const ok = !isThirdPartyDataRequest(query);
    if (ok) passed++;
    else failures.push(`scope guard over-blocked: ${query}`);
    console.log(`${ok ? "PASS" : "FAIL"}  scope guard allows: ${query}`);
  }

  /* ---- the gate must not pass a question merely because a best chunk exists ---- */
  const gateProbe = rankAndGate(index, "What's the weather today?", semanticFor("What's the weather today?"));
  const bestChunkExists = buildLexicalIndex(chunks).chunks.length > 0;
  const gateOk = bestChunkExists && gateProbe.verdict === "fallback";
  if (gateOk) passed++;
  else failures.push("gate allowed an unsupported question that had a mathematically best chunk");
  console.log(
    `${gateOk ? "PASS" : "FAIL"}  gate refuses despite a ranked best chunk existing [coverage=${gateProbe.coverage.retrieved.toFixed(2)}/${gateProbe.coverage.vocabulary.toFixed(2)}]`,
  );

  const total =
    CASES.length + THIRD_PARTY_QUERIES.length + NOT_THIRD_PARTY.length + 1;

  console.log(
    `\nsemantic retrieval ran on ${semanticRuns}/${CASES.length} cases` +
      (LEXICAL_ONLY ? " (lexical-only mode)" : ""),
  );
  console.log(`${passed}/${total} passed`);

  if (!LEXICAL_ONLY && semanticRuns === 0) {
    console.error(
      "\nFAIL  semantic retrieval never ran, so this result says nothing about the embedding path.",
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
