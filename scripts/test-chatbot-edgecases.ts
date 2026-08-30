/**
 * Adversarial / natural-language retrieval suite.
 *
 *   npm run test:chatbot-edgecases
 *   npm run test:chatbot-edgecases -- --record        # embed new queries (needs OPENAI_API_KEY)
 *   npm run test:chatbot-edgecases -- --failures      # print only failures
 *
 * WHY THIS EXISTS, SEPARATE FROM `test-chatbot-retrieval.ts`
 *
 * That suite asks whether the corpus answers well-formed questions. This one
 * asks whether it answers the questions people actually type: lowercase, no
 * punctuation, Indian conversational English, a synonym the site never uses,
 * a pronoun pointing at the previous turn. The failure that motivated it —
 * "how do i give interview" — was a terminology gap, not a knowledge gap: the
 * corpus says "take" and "sit", never "give".
 *
 * Assertions are on the PRODUCT CONTRACT, not on ranking. A case passes when
 * the expected domain appears anywhere in the context actually handed to the
 * model and the gate reached the expected verdict, because several questions
 * have more than one legitimately correct source. Demanding rank 1 would test
 * a preference the product does not have.
 *
 * Runs the production engine with real embeddings. No generation provider is
 * ever called.
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
import { embedTexts } from "../src/lib/chatbot/openai-embeddings";
import { isThirdPartyDataRequest } from "../src/lib/chatbot-matcher";

config({ path: ".env.local" });
config();

const QUERY_VECTORS_PATH = path.join(
  process.cwd(),
  "knowledge",
  "test-query-vectors.json",
);

const FAILURES_ONLY = process.argv.includes("--failures");

/** How the question is malformed, so failures can be grouped by cause. */
type Category =
  | "A-exact"
  | "B-paraphrase"
  | "C-sloppy"
  | "D-indian-english"
  | "E-indirect"
  | "F-terminology"
  | "G-followup"
  | "H-temporal"
  | "I-ambiguous"
  | "J-unsupported";

type Expect = "answer" | "clarify" | "fallback" | "answer-or-clarify";

type Case = {
  domain: string;
  category: Category;
  /** For G-followup this is already `previous turn \n current turn`, as the route builds it. */
  q: string;
  expect: Expect;
  /** Any one of these appearing in the retrieved context satisfies the case. */
  sources?: string[];
  why: string;
};

const C = (
  domain: string,
  category: Category,
  q: string,
  expect: Expect,
  sources: string[] | null,
  why: string,
): Case => ({ domain, category, q, expect, sources: sources ?? undefined, why });

/* ===================================================================== cases */

const CASES: Case[] = [
  /* ---------------------------------------------- ABTalks identity / mission */
  C("identity", "A-exact", "What is ABTalks?", "answer", ["abtalks.md", "homepage.md", "faq.md"], "canonical"),
  C("identity", "C-sloppy", "what is abtalks", "answer", ["abtalks.md", "homepage.md", "faq.md"], "no caps, no punctuation"),
  C("identity", "C-sloppy", "wat is ab talks", "answer", ["abtalks.md", "homepage.md", "faq.md"], "misspelling + brand split into two words"),
  C("identity", "B-paraphrase", "what do you guys actually do", "answer", ["abtalks.md", "homepage.md", "faq.md"], "colloquial, no site vocabulary at all"),
  C("identity", "E-indirect", "i just landed here, what is this site", "answer", ["abtalks.md", "homepage.md", "website.md", "faq.md"], "first-time visitor, zero terminology"),
  C("identity", "B-paraphrase", "why should i use abtalks", "answer", ["abtalks.md", "homepage.md", "faq.md", "testimonials.md"], "value question, not a definition question"),
  C("identity", "F-terminology", "what is build in public", "answer", ["abtalks.md", "faq.md", "homepage.md"], "philosophy phrase used across the corpus"),
  C("identity", "B-paraphrase", "how many people use abtalks", "answer", ["homepage.md", "community.md", "abtalks.md"], "stats asked as a plain question"),

  /* -------------------------------------------------------------- Anil Bajpai */
  C("founder", "A-exact", "Who is Anil Bajpai?", "answer", ["anil-bajpai.md"], "canonical"),
  C("founder", "C-sloppy", "who is anil bajpai", "answer", ["anil-bajpai.md"], "lowercase"),
  C("founder", "F-terminology", "who runs abtalks", "answer", ["anil-bajpai.md", "abtalks.md"], "role word the corpus does not use as a heading"),
  C("founder", "B-paraphrase", "who is the founder", "answer", ["anil-bajpai.md", "abtalks.md"], "no name given"),

  /* --------------------------------------------------------- programs overview */
  C("programs", "A-exact", "What programs does ABTalks offer?", "answer", ["programs.md", "homepage.md", "abtalks.md", "faq.md"], "canonical"),
  C("programs", "C-sloppy", "what all programs are there", "answer", ["programs.md", "homepage.md", "faq.md"], "Indian English 'what all'"),
  C("programs", "D-indian-english", "what all can i join here", "answer-or-clarify", ["programs.md", "homepage.md", "faq.md"], "'what all' + vague 'join'"),
  C("programs", "F-terminology", "what courses do you have", "answer", ["programs.md", "homepage.md", "faq.md", "abtalks.md"], "'courses' — a word ABTalks explicitly rejects for itself"),
  C("programs", "I-ambiguous", "which challenge is active", "answer-or-clarify", ["programs.md", "events.md", "homepage.md"], "several programs; may need clarification"),
  // Expectation widened after inspecting what retrieval actually returns:
  // `audience-faqs.md` ("Eligibility — who can join ABTalks programs") and
  // `abtalks.md` ("Identity") both answer "I want to participate, what should I
  // do" at least as directly as the program index does. The original list was
  // written from the file names rather than from their content.
  C("programs", "E-indirect", "i want to participate what should i do", "answer-or-clarify", ["programs.md", "homepage.md", "faq.md", "website.md", "audience-faqs.md", "abtalks.md"], "intent stated, no program named"),
  C("programs", "F-terminology", "tell me about the databricks cohort", "answer", ["homepage.md", "programs.md"], "waitlist-only cohort with no dates"),

  /* ------------------------------------------------- 60-Day Coding Challenge */
  C("coding-challenge", "A-exact", "What is the 60-Day Coding Challenge?", "answer", ["coding-challenge.md", "programs.md", "challenges-page.md"], "canonical"),
  C("coding-challenge", "C-sloppy", "60 day coding challenge kya hai", "answer-or-clarify", ["coding-challenge.md", "programs.md", "challenges-page.md"], "Hinglish tail — corpus has no Hindi"),
  C("coding-challenge", "B-paraphrase", "what tracks can i pick", "answer", ["coding-challenge.md", "challenges-page.md", "programs.md"], "'tracks' asked without naming the challenge"),
  C("coding-challenge", "E-indirect", "what happens if i miss a day", "answer", ["coding-challenge.md", "claude-challenge.md", "challenges-page.md"], "streak rule, spread across two challenge files"),
  C("coding-challenge", "F-terminology", "does my streak break if i post late", "answer", ["coding-challenge.md", "claude-challenge.md"], "'break' vs corpus 'reset'"),
  C("coding-challenge", "B-paraphrase", "do i have to do it every single day", "answer", ["coding-challenge.md", "claude-challenge.md", "challenges-page.md"], "commitment question"),

  /* --------------------------------------------------------- Claude Challenge */
  C("claude", "A-exact", "How does the Claude Challenge work?", "answer", ["claude-challenge.md", "programs.md"], "canonical"),
  C("claude", "C-sloppy", "how claude challenge works", "answer", ["claude-challenge.md", "programs.md"], "dropped article and auxiliary"),
  C("claude", "B-paraphrase", "what do i need to upload every day", "answer", ["claude-challenge.md", "programs.md"], "'upload' vs corpus 'push'/'submit'"),
  C("claude", "F-terminology", "who do i tag", "answer", ["claude-challenge.md"], "bare question, no program named"),
  C("claude", "D-indian-english", "which all accounts i have to tag", "answer", ["claude-challenge.md"], "Indian English 'which all', dropped auxiliary"),
  C("claude", "B-paraphrase", "what kind of github repo do i need", "answer", ["claude-challenge.md"], "repo structure question"),
  C("claude", "E-indirect", "i finished day 60 now what", "answer", ["claude-challenge.md", "certificates.md"], "answer spans challenge completion + certificate"),
  C("claude", "F-terminology", "do i need to make a post on linkedin daily", "answer", ["claude-challenge.md", "programs.md"], "'make a post' vs 'publish progress'"),

  /* ----------------------------------------------------------------- AI Cohort */
  C("cohort", "A-exact", "What is the 31-Day AI Cohort?", "answer", ["ai-cohort.md", "programs.md", "program-landing-page.md"], "canonical"),
  C("cohort", "C-sloppy", "ai cohort details", "answer", ["ai-cohort.md", "programs.md", "program-landing-page.md"], "keyword-style, not a question"),
  C("cohort", "B-paraphrase", "how many hours a day do i need to give", "answer", ["ai-cohort.md", "program-landing-page.md", "programs.md"], "'give' as time-spend verb"),
  C("cohort", "B-paraphrase", "what do i need to know before joining the cohort", "answer", ["ai-cohort.md", "program-landing-page.md"], "prerequisites without the word 'prerequisite'"),
  C("cohort", "F-terminology", "do i need a paid openai key for the cohort", "answer", ["ai-cohort.md", "program-landing-page.md"], "corpus says no paid API keys needed"),
  C("cohort", "B-paraphrase", "what will i build in the cohort", "answer", ["ai-cohort.md", "programs.md", "program-landing-page.md"], "outcome question"),
  C("cohort", "E-indirect", "is my laptop enough for this", "answer-or-clarify", ["ai-cohort.md", "program-landing-page.md"], "hardware requirement, indirect phrasing"),

  /* ------------------------------------------------------------ voice interview */
  C("interview", "A-exact", "How does the voice interview work?", "answer", ["voice-interview.md"], "canonical"),
  C("interview", "F-terminology", "how do i give interview", "answer", ["voice-interview.md"], "THE REPORTED FAILURE — 'give' is Indian English for 'sit/take'"),
  C("interview", "D-indian-english", "how can i give the interview", "answer", ["voice-interview.md"], "same verb mismatch, fuller sentence"),
  C("interview", "D-indian-english", "can i give this interview", "answer", ["voice-interview.md"], "eligibility phrased with 'give'"),
  C("interview", "B-paraphrase", "where do i start the interview", "answer", ["voice-interview.md"], "'where' rather than 'how'"),
  C("interview", "C-sloppy", "where is the interview", "answer", ["voice-interview.md"], "location question about a virtual thing"),
  C("interview", "B-paraphrase", "can i retry it", "answer-or-clarify", ["voice-interview.md"], "pronoun with no antecedent; attempts rule"),
  C("interview", "B-paraphrase", "can i do the interview again", "answer", ["voice-interview.md"], "retry phrased naturally"),
  C("interview", "F-terminology", "is there a mock interview on abtalks", "answer", ["voice-interview.md"], "'mock interview' — user's word, also a workshop name"),
  C("interview", "B-paraphrase", "what happens after i finish the interview", "answer", ["voice-interview.md"], "report contents"),
  C("interview", "B-paraphrase", "do i get a score", "answer", ["voice-interview.md"], "scoring, no domain word"),
  C("interview", "E-indirect", "will someone actually listen to my answers", "answer-or-clarify", ["voice-interview.md", "legal-and-privacy.md"], "recording/AI-processing concern"),
  C("interview", "B-paraphrase", "how long does the interview take", "answer", ["voice-interview.md"], "duration"),
  C("interview", "F-terminology", "can i practice with my cv", "answer", ["voice-interview.md"], "'cv' instead of 'resume'; answer is NO"),
  C("interview", "E-indirect", "what if my internet drops during the interview", "answer", ["voice-interview.md"], "short attempts do not consume the attempt"),

  /* ------------------------------------------------------------- certificates */
  C("certificates", "A-exact", "How do I claim my certificate?", "answer", ["certificates.md"], "canonical"),
  C("certificates", "C-sloppy", "how do i get my certificate", "answer", ["certificates.md"], "lowercase, 'get' not 'claim'"),
  C("certificates", "C-sloppy", "where is my cert", "answer", ["certificates.md"], "abbreviation"),
  C("certificates", "D-indian-english", "how to claim the certificate", "answer", ["certificates.md"], "infinitive form, no subject"),
  C("certificates", "B-paraphrase", "is there a button to claim it", "answer", ["certificates.md"], "the answer is that opening the page IS the claim"),
  C("certificates", "E-indirect", "my name is spelled differently on my profile", "answer-or-clarify", ["certificates.md"], "name-rendering problem stated as a fact, not a question"),
  C("certificates", "B-paraphrase", "can someone check if my certificate is real", "answer", ["certificates.md"], "verification from the recruiter's side"),
  C("certificates", "F-terminology", "is this certificate valid for college credit", "answer", ["certificates.md", "legal-and-privacy.md"], "accreditation caveat"),
  C("certificates", "B-paraphrase", "do hackathon people get certificates too", "answer", ["certificates.md"], "cross-domain: certificates + hackathon"),
  C("certificates", "E-indirect", "do i get anything for completing it", "answer-or-clarify", ["certificates.md", "claude-challenge.md", "coding-challenge.md"], "pronoun, no program named"),
  C("certificates", "H-temporal", "my certificate got revoked what does that mean", "answer", ["certificates.md"], "revocation"),
  C("certificates", "B-paraphrase", "do i have to pay for the certificate", "answer", ["certificates.md", "legal-and-privacy.md"], "scam-adjacent pricing question"),

  /* ----------------------------------------------------------------- hackathon */
  C("hackathon", "A-exact", "What do I need to submit for the hackathon?", "answer", ["hackathon.md"], "canonical"),
  C("hackathon", "C-sloppy", "is registration still open for hackathon", "answer", ["hackathon.md"], "MUST say closed"),
  C("hackathon", "H-temporal", "can i still join the hackathon", "answer", ["hackathon.md"], "registration closed"),
  C("hackathon", "B-paraphrase", "is the hackathon online or offline", "answer", ["hackathon.md", "vicodathon.md", "events.md"], "format"),
  C("hackathon", "D-indian-english", "can i attend from home", "answer-or-clarify", ["hackathon.md", "workshops.md", "events.md"], "online-ness asked indirectly, ambiguous across hackathon/workshop"),
  C("hackathon", "B-paraphrase", "how many people can be in my team", "answer", ["hackathon.md"], "team size"),
  C("hackathon", "E-indirect", "i dont have a team can i still do it", "answer", ["hackathon.md"], "solo entry"),
  C("hackathon", "F-terminology", "what is vicodathon", "answer", ["vicodathon.md", "hackathon.md"], "brand name"),
  C("hackathon", "I-ambiguous", "is the 48 hour ai hackathon the same as vicodathon", "answer", ["vicodathon.md", "events.md"], "MUST preserve the unresolved relationship"),
  C("hackathon", "B-paraphrase", "what are the prizes", "answer", ["hackathon.md"], "must not invent — prizes are 'announced soon'"),
  C("hackathon", "B-paraphrase", "who can enter the hackathon", "answer", ["hackathon.md"], "eligibility: Indian college students"),
  C("hackathon", "F-terminology", "do i need to make my repo public", "answer", ["hackathon.md"], "deliverable rule"),
  C("hackathon", "B-paraphrase", "how are winners decided", "answer", ["hackathon.md"], "judging criteria"),

  /* ---------------------------------------------------------- workshops/events */
  C("workshops", "H-temporal", "when is the next workshop", "answer", ["workshops.md", "events.md"], "5 Sep, 7:00 PM IST"),
  C("workshops", "C-sloppy", "whats happening this week", "answer-or-clarify", ["events.md", "workshops.md"], "vague temporal question"),
  C("workshops", "H-temporal", "is registration open for the workshop", "answer", ["workshops.md", "events.md"], "registration IS open for 5 Sep"),
  C("workshops", "H-temporal", "did the figma workshop already happen", "answer", ["workshops.md", "events.md"], "past event — must not be called upcoming"),
  C("workshops", "H-temporal", "what was the august 21 event", "answer", ["events.md", "workshops.md"], "specific past date"),
  C("workshops", "B-paraphrase", "how often do you run workshops", "answer", ["workshops.md", "events.md"], "weekly Saturday cadence"),
  C("workshops", "I-ambiguous", "is free ai bootcamp the same as ai tools workshop", "answer", ["workshops.md", "programs.md"], "MUST preserve UNRESOLVED"),
  C("workshops", "F-terminology", "do you have any webinars", "answer", ["workshops.md", "events.md"], "'webinar' — not the site's word"),
  C("workshops", "B-paraphrase", "where do i register for the workshop", "answer", ["workshops.md", "events.md", "website.md"], "route question"),
  C("workshops", "B-paraphrase", "is the workshop free", "answer", ["workshops.md", "events.md", "legal-and-privacy.md"], "pricing for events"),
  C("workshops", "C-sloppy", "next session kab hai", "answer-or-clarify", ["events.md", "workshops.md"], "Hinglish 'kab hai' (when is it)"),

  /* -------------------------------------------------------- hiring / recruiters */
  C("hiring", "B-paraphrase", "do you guys give jobs", "answer", ["hiring-and-recruiters.md", "legal-and-privacy.md"], "must convey no hiring guarantee"),
  C("hiring", "B-paraphrase", "can you help me get hired", "answer", ["hiring-and-recruiters.md", "legal-and-privacy.md"], "same, phrased as a request"),
  C("hiring", "B-paraphrase", "how do recruiters find me", "answer", ["hiring-and-recruiters.md"], "discovery model"),
  C("hiring", "E-indirect", "who can see my profile", "answer", ["hiring-and-recruiters.md", "voice-interview.md"], "consent model"),
  C("hiring", "B-paraphrase", "will companies get my phone number", "answer", ["hiring-and-recruiters.md", "ai-cohort.md"], "privacy specific"),
  C("hiring", "F-terminology", "what is scout", "answer", ["hiring-and-recruiters.md"], "product name"),
  C("hiring", "B-paraphrase", "do i have to pay to get placed", "answer", ["hiring-and-recruiters.md", "legal-and-privacy.md"], "no placement fee"),
  C("hiring", "E-indirect", "im a recruiter how do i hire from here", "answer", ["hiring-and-recruiters.md"], "recruiter-side entry point"),

  /* --------------------------------------------------------------- pricing/legal */
  C("legal", "C-sloppy", "is it free", "answer", ["legal-and-privacy.md", "homepage.md", "abtalks.md", "certificates.md"], "bare pricing question, no subject"),
  C("legal", "B-paraphrase", "does abtalks charge anything", "answer", ["legal-and-privacy.md", "homepage.md"], "'charge'"),
  C("legal", "D-indian-english", "how much does it cost", "answer", ["legal-and-privacy.md", "homepage.md", "abtalks.md"], "cost phrasing"),
  C("legal", "B-paraphrase", "can i delete my account", "answer", ["legal-and-privacy.md"], "erasure right"),
  C("legal", "B-paraphrase", "what do you do with my data", "answer", ["legal-and-privacy.md"], "data handling"),
  C("legal", "F-terminology", "do you sell my information", "answer-or-clarify", ["legal-and-privacy.md", "hiring-and-recruiters.md"], "'sell' — corpus says recruiters must not resell"),
  C("legal", "B-paraphrase", "how do i stop the emails", "answer", ["legal-and-privacy.md"], "newsletter unsubscribe"),

  /* -------------------------------------------------------- socials / contact */
  C("socials", "C-sloppy", "whats your instagram", "answer", ["socials-and-contact.md"], "handle"),
  C("socials", "C-sloppy", "insta id", "answer", ["socials-and-contact.md"], "'insta id' — very common Indian phrasing"),
  C("socials", "B-paraphrase", "how do i join the community", "answer", ["socials-and-contact.md", "community.md", "homepage.md"], "WhatsApp/Discord"),
  C("socials", "F-terminology", "do you have a whatsapp group", "answer", ["socials-and-contact.md", "homepage.md", "hackathon.md"], "WhatsApp specifically"),
  C("socials", "B-paraphrase", "how do i contact you", "answer", ["socials-and-contact.md", "contact-page.md", "faq.md"], "support email"),
  C("socials", "C-sloppy", "discord link", "answer", ["socials-and-contact.md"], "two-word keyword query"),

  /* ------------------------------------------------------------ eligibility */
  C("eligibility", "C-sloppy", "can second year students join", "answer", ["audience-faqs.md", "faq.md", "coding-challenge.md", "abtalks.md", "hackathon.md"], "year-based eligibility"),
  C("eligibility", "D-indian-english", "im in 2nd year can i do this", "answer", ["audience-faqs.md", "faq.md", "abtalks.md", "hackathon.md", "homepage.md"], "numeric year + 'do this'"),
  C("eligibility", "E-indirect", "can i participate if im not final year", "answer", ["audience-faqs.md", "faq.md", "abtalks.md", "hackathon.md"], "negative framing"),
  C("eligibility", "B-paraphrase", "is this only for students", "answer", ["audience-faqs.md", "homepage.md", "abtalks.md", "faq.md"], "homepage says neither student nor developer required"),
  C("eligibility", "E-indirect", "im working full time can i still do it", "answer", ["audience-faqs.md", "abtalks.md", "homepage.md", "ai-cohort.md"], "working professional audience"),
  C("eligibility", "F-terminology", "do i need to know coding already", "answer", ["challenges-page.md", "audience-faqs.md", "faq.md", "hackathon.md"], "prior experience"),

  /* ------------------------------------------------ website navigation / how-to */
  C("navigation", "C-sloppy", "where do i register", "answer-or-clarify", ["website.md", "homepage.md", "programs.md", "faq.md"], "ambiguous across programs"),
  C("navigation", "D-indian-english", "how do i apply for it", "answer-or-clarify", ["programs.md", "website.md", "ai-cohort.md", "homepage.md"], "pronoun, no antecedent"),
  C("navigation", "B-paraphrase", "where do i submit my proof of work", "answer", ["claude-challenge.md", "coding-challenge.md", "abtalks.md"], "GitHub + LinkedIn"),
  C("navigation", "B-paraphrase", "do i need an account", "answer-or-clarify", ["website.md", "faq.md", "certificates.md"], "login requirement"),

  /* ------------------------------------------------------------- follow-ups */
  C("claude", "G-followup", "What is the Claude Challenge?\nwhat do i have to post", "answer", ["claude-challenge.md", "programs.md"], "chain turn 2"),
  C("claude", "G-followup", "what do i have to post\nwho do i tag", "answer", ["claude-challenge.md"], "chain turn 3"),
  C("claude", "G-followup", "who do i tag\nand after day 60", "answer", ["claude-challenge.md", "certificates.md"], "chain turn 4, pronoun-free but context-dependent"),
  C("interview", "G-followup", "How does the voice interview work?\ncan i do it again", "answer", ["voice-interview.md"], "'it' = the interview"),
  C("interview", "G-followup", "can i do it again\nwhat do i get afterwards", "answer", ["voice-interview.md"], "report, via chain"),
  C("interview", "G-followup", "Who can take the voice interview?\nwhere do i start it", "answer", ["voice-interview.md"], "'it' resolved by previous turn"),
  C("certificates", "G-followup", "Do I get a certificate?\nhow do i claim it", "answer", ["certificates.md"], "'it' = certificate"),
  C("certificates", "G-followup", "how do i claim it\ncan i download it", "answer", ["certificates.md"], "download step"),
  C("hackathon", "G-followup", "What is the hackathon?\ncan i still register", "answer", ["hackathon.md"], "temporal follow-up"),
  C("hackathon", "G-followup", "can i still register\nwhat about the next one", "answer-or-clarify", ["hackathon.md", "events.md"], "future edition — corpus has no date"),
  C("workshops", "G-followup", "What is the next workshop?\nwhen is it", "answer", ["workshops.md", "events.md"], "'it' = the workshop"),
  C("workshops", "G-followup", "when is it\nis it free", "answer", ["workshops.md", "events.md", "legal-and-privacy.md"], "two pronouns deep"),
  C("cohort", "G-followup", "What is the AI Cohort?\nwho can join", "answer", ["ai-cohort.md", "program-landing-page.md", "audience-faqs.md"], "eligibility via chain"),
  C("cohort", "G-followup", "who can join\nhow do i apply", "answer", ["ai-cohort.md", "programs.md", "program-landing-page.md"], "application route via chain"),
  C("hiring", "G-followup", "How do recruiters find candidates?\ncan they see my contact details", "answer", ["hiring-and-recruiters.md"], "consent via chain"),

  /* ------------------------------------------------------------- unsupported */
  C("unsupported", "J-unsupported", "whats the weather today", "fallback", null, "no ABTalks content"),
  C("unsupported", "J-unsupported", "do you provide hostel", "fallback", null, "accommodation is out of scope"),
  C("unsupported", "J-unsupported", "is there any stipend", "fallback", null, "no stipend information exists"),
  C("unsupported", "J-unsupported", "can you help me with my visa", "fallback", null, "visa is out of scope"),
  C("unsupported", "J-unsupported", "what is the capital of france", "fallback", null, "general knowledge"),
  C("unsupported", "J-unsupported", "who won the world cup", "fallback", null, "general knowledge"),
  C("unsupported", "J-unsupported", "will you reimburse my travel", "fallback", null, "no travel policy exists"),
  C("unsupported", "J-unsupported", "tell me a joke", "fallback", null, "off-topic chit-chat"),
];

/* ------------------------------------------------------- scope-guard cases */

const SCOPE_BLOCK = [
  "can you tell me my friends profile",
  "show me another students submission",
  "what is his phone number",
  "give me someone elses certificate details",
];
const SCOPE_ALLOW = [
  "who can see my profile",
  "how do i update my profile details",
  "do recruiters get my phone number",
];

/* -------------------------------------------------------------------- run */

type QueryVectors = { model: string; vectors: Record<string, number[]> };

async function ensureVectors(queries: string[]): Promise<QueryVectors> {
  let qv: QueryVectors;
  try {
    qv = JSON.parse(readFileSync(QUERY_VECTORS_PATH, "utf-8")) as QueryVectors;
  } catch {
    qv = { model: "text-embedding-3-small", vectors: {} };
  }
  const missing = [...new Set(queries)].filter((q) => !qv.vectors[q]);
  if (missing.length === 0) return qv;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      `\nFAIL  ${missing.length} of ${queries.length} queries have no recorded embedding and OPENAI_API_KEY is unset.` +
        `\n      This suite will not silently fall back to lexical-only — a green run must mean the semantic path ran.` +
        `\n      Fix: OPENAI_API_KEY=... npm run test:chatbot-edgecases -- --record`,
    );
    process.exit(1);
  }
  for (let i = 0; i < missing.length; i += 96) {
    const batch = missing.slice(i, i + 96);
    process.stdout.write(`recording ${i + 1}-${i + batch.length} of ${missing.length}... `);
    const res = await embedTexts(batch, apiKey);
    if (!res.ok) {
      console.error(`\nfailed: ${res.reason}`);
      process.exit(1);
    }
    batch.forEach((q, n) => {
      qv.vectors[q] = res.vectors[n];
    });
    console.log("ok");
  }
  writeFileSync(QUERY_VECTORS_PATH, JSON.stringify(qv));
  return qv;
}

function verdictOk(expect: Expect, actual: RetrievalResult["verdict"]): boolean {
  if (expect === "answer-or-clarify") return actual === "answer" || actual === "clarify";
  return actual === expect;
}

async function main() {
  const chunks = buildChunks(readKnowledgeFiles());
  const index = buildLexicalIndex(chunks);
  const artifact = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf-8")) as {
    vectors: Record<string, number[]>;
  };
  const qv = await ensureVectors(CASES.map((c) => c.q));

  const run = (query: string): RetrievalResult => {
    const v = qv.vectors[query];
    const semantic = v
      ? {
          similarityFor: (c: Chunk) => {
            const x = artifact.vectors[c.id];
            return x ? cosine(v, x) : null;
          },
        }
      : null;
    return rankAndGate(index, query, semantic);
  };

  console.log(`corpus: ${chunks.length} chunks | cases: ${CASES.length}\n`);

  let passed = 0;
  const failures: {
    case: Case;
    kind: string;
    detail: string;
  }[] = [];

  for (const testCase of CASES) {
    const r = run(testCase.q);
    const sources = r.results.map((x) => x.chunk.source);
    const verdictPass = verdictOk(testCase.expect, r.verdict);
    const sourcePass =
      !testCase.sources || sources.some((s) => testCase.sources!.includes(s));
    const ok = verdictPass && (r.verdict === "fallback" ? true : sourcePass);

    if (ok) {
      passed++;
      if (!FAILURES_ONLY) {
        console.log(
          `PASS  [${testCase.category}] ${testCase.domain.padEnd(16)} "${testCase.q.replace(/\n/g, " | ")}"  (${r.verdict}, ${r.topScore.toFixed(2)})`,
        );
      }
      continue;
    }

    // Classify the failure so the report groups by cause rather than by case.
    let kind: string;
    if (testCase.expect === "fallback" && r.verdict !== "fallback") {
      kind = "FALSE-POSITIVE";
    } else if (testCase.expect !== "fallback" && r.verdict === "fallback") {
      kind = "FALSE-FALLBACK";
    } else if (!verdictPass && r.verdict === "clarify") {
      kind = "OVER-CLARIFY";
    } else if (!sourcePass) {
      kind = "WRONG-SOURCE";
    } else {
      kind = "VERDICT";
    }

    failures.push({
      case: testCase,
      kind,
      detail: `verdict=${r.verdict} conf=${r.topScore.toFixed(3)} ret=${r.coverage.retrieved.toFixed(2)} voc=${r.coverage.vocabulary.toFixed(2)} top=[${sources.slice(0, 3).join(", ") || "none"}]`,
    });
    console.log(
      `FAIL  [${testCase.category}] ${testCase.domain.padEnd(16)} "${testCase.q.replace(/\n/g, " | ")}"\n      ${kind}: ${failures[failures.length - 1].detail}\n      expected ${testCase.expect}${testCase.sources ? ` from [${testCase.sources.join(", ")}]` : ""}`,
    );
  }

  /* scope guard */
  let scopePassed = 0;
  for (const q of SCOPE_BLOCK) {
    const ok = isThirdPartyDataRequest(q);
    if (ok) scopePassed++;
    else console.log(`FAIL  [scope] guard missed: "${q}"`);
  }
  for (const q of SCOPE_ALLOW) {
    const ok = !isThirdPartyDataRequest(q);
    if (ok) scopePassed++;
    else console.log(`FAIL  [scope] guard over-blocked: "${q}"`);
  }

  /* ------------------------------------------------------------- summary */
  const byKind = new Map<string, number>();
  const byCategory = new Map<string, { pass: number; fail: number }>();
  for (const c of CASES) {
    const entry = byCategory.get(c.category) ?? { pass: 0, fail: 0 };
    entry.pass += 1;
    byCategory.set(c.category, entry);
  }
  for (const f of failures) {
    byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    const entry = byCategory.get(f.case.category)!;
    entry.pass -= 1;
    entry.fail += 1;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`retrieval cases : ${passed}/${CASES.length} passed`);
  console.log(`scope guard     : ${scopePassed}/${SCOPE_BLOCK.length + SCOPE_ALLOW.length} passed`);
  console.log(`\nby failure kind:`);
  for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(16)} ${n}`);
  }
  console.log(`\nby category:`);
  for (const [cat, v] of [...byCategory.entries()].sort()) {
    console.log(`  ${cat.padEnd(18)} ${v.pass}/${v.pass + v.fail}`);
  }

  const total = CASES.length + SCOPE_BLOCK.length + SCOPE_ALLOW.length;
  const totalPassed = passed + scopePassed;
  console.log(`\nTOTAL: ${totalPassed}/${total}`);

  if (totalPassed < total) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
