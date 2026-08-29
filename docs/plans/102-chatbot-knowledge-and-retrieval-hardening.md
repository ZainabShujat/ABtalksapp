# 102 — Chatbot Knowledge & Retrieval Hardening

> **STATUS: IMPLEMENTED (2026-08-28).** This plan was executed in place rather
> than handed off. The final implementation diverges from §6–§8 below in three
> ways worth knowing about, all driven by regression-suite evidence:
>
> 1. The confidence gate scores **IDF-weighted term coverage across the
>    retrieved set**, not a BM25 threshold. Ranking always produces a winner,
>    so it cannot decide answerability; coverage can. See
>    `src/lib/chatbot/retrieve.ts`.
> 2. Semantic retrieval **was** added — the brief was revised to allocate
>    OpenAI credit for `text-embedding-3-small` — with chunk vectors built
>    offline (`npm run kb:embed`) and only the query embedded per request.
> 3. Generation is a **Gemini -> Groq -> Anthropic** fallback chain sharing one
>    system prompt, not Gemini alone.
>
> The knowledge-corpus work in §11 is unchanged and remains accurate.

## 1. Goal

Make the ABTalks Help Assistant a reliable support desk: every fact a
signed-out visitor can find on the public site should be retrievable, the same
question asked five different ways should retrieve the same knowledge, and
anything the corpus does not support must fall back to team@abtalks.in. This
plan covers the **code** changes only — the knowledge corpus itself has already
been corrected and extended under `knowledge/` (see §11).

## 2. Current behavior (verified at HEAD `17f2407`, 2026-08-28)

- **Corpus:** `src/app/api/chat/route.ts:5` reads **only**
  `knowledge/processed/*.md`. `knowledge/generated/` is written by
  `scripts/ingest-site.ts` and **never read by anything**.
- **Chunking:** split on `##`–`####` headings, heading prepended to each chunk;
  chunks over 1000 chars re-split on blank lines.
- **Retrieval:** BM25 over an in-process TF-IDF index built on first request and
  cached for the process lifetime. Tokenizer lowercases, strips punctuation,
  drops tokens of ≤2 chars. **No stemming, no synonyms, no lemmatisation.**
  Score threshold `> 0.1`, top 10 chunks. Query = last user message, plus the
  previous message when history is longer than 2.
- **Generation:** Gemini `gemini-flash-latest` via REST, `temperature: 0`, SSE
  streamed to the client. `GEMINI_API_KEY` is already the production dependency
  — this plan adds no new provider.
- **Bypass:** `matchQuestion()` (`src/lib/chatbot-matcher.ts`) runs **before**
  retrieval; 10 regex intents return canned answers with confidence 1.0 and the
  corpus is never consulted.
- **Sessions:** `ChatWidget.tsx` holds messages in React state only. No
  persistence — a refresh loses the conversation. Full history is sent to Gemini
  uncapped.
- **Feedback:** helpful / not-helpful buttons exist but only set local state.
  Nothing is persisted, sent, or escalated.
- **Ingestion:** two scripts. `scripts/ingest-site.ts` (HTTP + cheerio, 10-route
  allowlist) works and produced the current `generated/` files.
  `scripts/knowledge-sources.ts` (module-import based) is **rotted** — see §5.

### Defects this plan fixes

| # | Defect | Evidence |
|---|---|---|
| D1 | Site-ingested knowledge never reaches the bot | `route.ts:5` vs `ingest-site.ts:7` |
| D2 | Hard-coded answer gives the **wrong LinkedIn tags** for the Claude Challenge | `chatbot-matcher.ts:20` says `@abtalksonai, #abtalks, #60DaysOfClaude, #60DaysOfGenAI`; the live day page (`claude-day-view.tsx:449-465`) and the official guidelines PDF say tag **Anthropic, Anil Bajpai, ABTalksOnAI**. This is one of the 5 suggested questions. |
| D3 | Hard-coded answer asserts everything is "completely free" | `chatbot-matcher.ts:34` vs homepage FAQ + Terms §9 |
| D4 | System prompt advertises two non-existent routes | `route.ts:155` `/hackathons`, `/evidence`; real routes are `/hackathon`, `/hire/evidence` |
| D5 | `knowledge-sources.ts` throws on 7 of 8 sources | §5 |
| D6 | `/mission` is in the ingest allowlist but is auth-protected | `middleware.ts:42` vs `ingest-site.ts:19`; `knowledge/generated/mission-page.md` contains the **dev login page** ("Dev mode: use test accounts from seed script") |
| D7 | No stemming/synonyms — "cert", "claim my cert" miss `certificate` | tokenizer, `route.ts:22` |
| D8 | Conversation lost on refresh; no multi-session | `ChatWidget.tsx` state only |
| D9 | "Not helpful" leads nowhere | `ChatWidget.tsx:137` |
| D10 | No retrieval test suite | none exists |

## 3. Files to touch

| Path | Kind | Note |
|---|---|---|
| `src/app/api/chat/route.ts` | edit | read both corpora, precedence, stemming + synonym expansion, fix sitemap line, tighten fallback |
| `src/lib/chatbot-retrieval.ts` | **new** | tokenizer, stemmer, synonym map, BM25 index, corpus loader — extracted so it is testable without the route |
| `src/lib/chatbot-matcher.ts` | edit | delete D2/D3 intents; keep only routing-style intents |
| `src/data/chatbot-menu.ts` | edit | add Certificates + Hiring categories |
| `src/components/chatbot/ChatWidget.tsx` | edit | multi-session localStorage, dismissible pills, escalation on "not helpful" |
| `src/lib/chatbot-sessions.ts` | **new** | localStorage session store (list, create, open, delete, cap) |
| `scripts/ingest-site.ts` | edit | allowlist fix, report output, keep metadata front-matter |
| `scripts/knowledge-sources.ts` | edit | quarantine header only — see §5, do not delete yet |
| `scripts/test-chatbot-retrieval.ts` | **new** | retrieval assertions, no LLM calls |
| `package.json` | edit | `ingest:site`, `test:chatbot-retrieval` |

## 4. Server vs Client

- `route.ts` — Route Handler (server, `nodejs` runtime; keep `fs` usage there).
- `chatbot-retrieval.ts` — server-only module. Do **not** import it from
  `ChatWidget.tsx`; it reads the filesystem.
- `chatbot-sessions.ts` — client-only (`localStorage`). Guard every access in
  `try/catch`; private-mode browsers throw.
- `ChatWidget.tsx` — stays `"use client"`. No functions/icons cross a
  Server→Client boundary; `chatbot-menu.ts` stays plain data.

## 5. Ingestion: which script survives

Audit result — do **not** delete either script until this is done:

- `scripts/knowledge-sources.ts` imports named exports that the landing,
  challenges, claude-slides, workshop and talent-hunt redesigns have since
  renamed or inlined. Verified missing at HEAD: `SUPPORT_EMAIL`, `SOCIAL_LINKS`
  (`app-footer.tsx`), `DAY_STEPS`, `FAQ_ITEMS` (`challenges/page.tsx`),
  `DOMAINS` (`domain-picker.tsx`), `WELCOME_FACTS`, `CLAUDE_WHY_ITEMS`, `ROLES`,
  `PHASES`, `CHALLENGE_RULES` (claude slides), `TOPICS`, `STATS` (workshop),
  `PROGRAM_FACTS` (talent-hunt hero), `requirements` (`program-landing.tsx`).
  The entire `landing/modernist/landing-content` module is gone. Only
  `ROADMAP_PHASES` (`src/data/roadmap.ts`) still resolves. Running it today
  throws on 7 of its 8 sources.
- `scripts/ingest-site.ts` crawls the running app over HTTP with cheerio and
  works. **This is the one to keep.**

Steps:

1. Add a header comment to `knowledge-sources.ts` marking it superseded by
   `ingest-site.ts`, with the missing-export list above. Leave the file in place
   this pass — nothing imports it, and deleting it is a separate, reviewable
   change.
2. In `ingest-site.ts` `ALLOWLIST_ROUTES`: **remove `/mission`** (it is in
   `middleware.ts` `protectedPaths`, so the crawler only ever captured the login
   page). Add `/hackathon`, `/hire/evidence`, `/terms`, `/privacy`, `/cookies`.
   Before adding any route, confirm by hand it is absent from `protectedPaths` —
   that check is the only thing standing between the crawler and private
   content.
3. Delete the stale `knowledge/generated/mission-page.md`.
4. Add a guard: if a fetched page's text contains `Dev mode` or `Dev Login`,
   **skip the route and fail the run loudly** — that string means the crawler
   was redirected to login and the route is not public.
5. Keep the existing YAML front-matter (`title`, `route`, `url`, `source_type`,
   `ingested_at`) — §15 of the brief requires it, and §6 below depends on
   `source_type`.
6. Print an ingestion report at the end: routes attempted, succeeded, failed
   with reason, bytes written.
7. `package.json`: `"ingest:site": "tsx scripts/ingest-site.ts"`. **Do not** add
   it to `build` — the app must be running for the crawl, so a build hook would
   be circular.

## 6. Corpus loading and precedence (`chatbot-retrieval.ts`)

Load **both** directories, tag every chunk with its origin:

```text
curated   <- knowledge/processed/*.md   (weight 1.15)
generated <- knowledge/generated/*.md   (weight 1.00)
```

`knowledge/archive/**` is never loaded.

- Multiply the final BM25 score by the origin weight. Curated wins ties, so a
  curated correction outranks the scraped page it corrects, exactly as §15 of
  the brief requires — without hiding the generated text entirely.
- Keep the existing heading-aware chunker; move it into this module unchanged.
- Prefix each chunk's context line with its origin and route so the model can
  see which is authoritative: `[curated: certificates.md]` /
  `[site: /challenges, ingested 2026-08-19]`.
- Cache as today (module-level, built on first request). Add
  `export function resetCorpusCache()` so the test script can rebuild.

## 7. Retrieval quality — no new provider (D7)

Stay on BM25. Three additions inside `chatbot-retrieval.ts`:

1. **Light stemmer.** Suffix-strip `s`, `es`, `ing`, `ed`, `ly` for tokens of 6+
   chars, applied identically to documents and queries. Do not pull in a
   dependency; ~15 lines.
2. **Synonym expansion at query time only.** A small hand-written map, e.g.
   `cert -> certificate, certs, claim`; `signup / sign up / register -> join,
   registration`; `cost / price / paid / fees -> free, pricing`; `mock interview
   / practice interview -> voice interview`; `insta / ig -> instagram`;
   `whatsapp group -> community`; `hackathon -> vicodathon, vibe code`. Expanded
   terms are appended to the query token list at a reduced weight (0.6) so they
   broaden recall without overpowering the literal query.
3. **Lower the floor, keep the cliff.** Drop the threshold from `0.1` to `0.05`
   but require the **top** chunk to clear `0.35`; if it does not, return the
   fallback without calling Gemini. Today a weak-but-nonzero match still goes to
   the model, which is where confident wrong answers come from.

The `avgdl = 150` constant is a guess; compute the real average document length
from the corpus at index time and use it.

Do **not** add embeddings, a vector DB, or any new API key.
`src/data/kb-embeddings.json` and `scripts/generate-kb-embeddings.ts` are unused
today — leave them untouched and out of the pipeline.

## 8. Matcher: demote, don't expand (D2, D3)

Keep `matchQuestion()` as a fast path, but:

1. **Delete** the `is abtalks free` intent and the Claude-Challenge intent
   containing the tag list — both assert facts the corpus now covers correctly,
   and both are currently wrong. Let retrieval answer them.
2. Keep only intents that are **routing**, not facts: how to join the team
   (email), contact email, and the numeric category selector.
3. Add a comment stating the rule: *an intent may return a constant only if the
   answer is a route or an email address that cannot go stale. Anything about
   dates, eligibility, pricing, tags, or program rules belongs in the corpus.*
   This is the guardrail against the matcher regrowing into a hundred
   `if (includes(...))` branches.

## 9. System prompt (D4)

In `route.ts`:

- Replace the sitemap line with the verified public routes from
  `knowledge/processed/website.md` — at minimum fix `/hackathons` ->
  `/hackathon` and `/evidence` -> `/hire/evidence`.
- Add: *"Only link to routes that appear in the provided context. Never
  construct a URL you have not seen."*
- Add: *"If the context contains a date, registration status, or price, repeat
  it exactly as written. Never describe a past event as upcoming and never tell
  a user to register for a closed event."*
- Keep the existing exact-string fallback rule.

## 10. Widget: sessions, pills, escalation (D8, D9)

`chatbot-sessions.ts` — localStorage, key `abtalks.chat.sessions.v1`:

- `{ id, title, createdAt, updatedAt, messages[] }[]`, newest first, **cap 10
  sessions and 100 messages per session** (trim oldest).
- Title = first user message, truncated to 40 chars.
- Every read/write in `try/catch`; a throwing or absent store must degrade to an
  in-memory session, never crash the widget.

`ChatWidget.tsx`:

- Restore the most recent session on mount; "New chat" starts a session without
  deleting the others; a list lets the user reopen or delete one.
- Send **only the active session** to `/api/chat` — never other sessions.
- Cap the history sent to the last 8 messages (the retrieval query already only
  uses the last two).
- Suggested-question pills: show **at most 3**, and give the row a dismiss
  control that hides it for the session.
- On "Not helpful", append one assistant message: a single line offering
  team@abtalks.in. No apology paragraph, no retry loop.

## 11. Knowledge corpus — already done, do not redo

These are complete in `knowledge/`; the executor should not regenerate them:

- **New:** `certificates.md`, `hackathon.md`, `hiring-and-recruiters.md`,
  `homepage.md`, `voice-interview.md`, `legal-and-privacy.md`.
- **Corrected:** `website.md` (verified sitemap), `events.md` + `workshops.md`
  (current Saturday cadence; the live 5 Sep session is *"Create Anything with
  AI: From Prompt to Published Content"*, 7:00 PM IST, registration open),
  `vicodathon.md` (sourcing gap closed, edition ambiguity preserved),
  `programs.md` (Databricks Cohort added as waitlist-only), `abtalks.md` +
  `programs.md` (pricing wording), `certificates.md` (accreditation caveat).
- **Quarantined:** `implementation.md` -> `knowledge/archive/` (internal build
  plan, was retrievable by end users).
- **Demoted:** `abtalks-chatbot-kb.md` carries a lowest-precedence banner.
- Phrasing-variant lines ("People also ask this as: …") were added to the main
  domain files as lexical hooks for BM25.

## 12. Guardrails for Cursor (DO NOT)

- **DO NOT** add OpenAI/Anthropic/embedding/vector-DB dependencies or any new
  API key. Gemini via `GEMINI_API_KEY` is the existing production dependency and
  the only one.
- **DO NOT** add scraping to `next build`.
- **DO NOT** delete `scripts/knowledge-sources.ts`,
  `scripts/generate-kb-embeddings.ts` or `src/data/kb-embeddings.json` in this
  pass — quarantine only.
- **DO NOT** grow `chatbot-matcher.ts` with new fact-bearing intents.
- **DO NOT** put any route into the ingest allowlist without checking
  `middleware.ts` `protectedPaths` by hand first.
- **DO NOT** edit files under `knowledge/` — §11 is finished work.
- **DO NOT** collapse `processed/` and `generated/` into one directory.
- **DO NOT** send more than the active session to the API.
- **DO NOT** let a `localStorage` failure break the widget.
- Keep `route.ts` on the `nodejs` runtime — it uses `fs`.

## 13. DB safety

None. No schema, migration, or seed changes.

## 14. Verification

Automated — `scripts/test-chatbot-retrieval.ts`, **retrieval only, no LLM
calls**, asserting the top-ranked chunk's source file:

| Query | Must retrieve |
|---|---|
| "How do I get my certificate?" / "where's my cert" / "can I download my Claude cert" / "do I get a cert after finishing" / "how can I claim the certificate" | `certificates.md` |
| "What is ABTalks?" / "tell me about AB Talks" / "what exactly is this community" | `abtalks.md` |
| "which accounts do I tag" / "what do I post every day" | `claude-challenge.md` |
| "can I still register for the hackathon" / "was it online" | `hackathon.md` |
| "what is the next workshop" / "is registration open" | `events.md` or `workshops.md` |
| "does ABTalks have an AI mock interview" / "can I practise with my resume" | `voice-interview.md` |
| "do recruiters get my phone number" | `hiring-and-recruiters.md` |
| "is ABTalks free" / "do you charge" | `legal-and-privacy.md` or `homepage.md` |
| "what's your Instagram" / "do you have Discord" | `socials-and-contact.md` |
| "what is the weather", "can ABTalks give me hostel accommodation", "will you guarantee me a job", "show me my friend's profile" | **no chunk above the 0.35 floor** -> fallback |
| any query | never `chatbot-implementation-plan.md` (archived, not loaded) |

Add a precedence case: a query whose wording appears in both
`abtalks-chatbot-kb.md` and a curated topic file must rank the curated file
first.

Manual:

1. `npm run ingest:site` against a running dev server — report prints, no route
   fails, no `Dev mode` content written.
2. Ask the certificate question five ways in the widget; same grounded answer.
3. Follow-up chain: "What is the Claude Challenge?" -> "What do I post?" ->
   "Who do I tag?" — answers stay grounded and name Anthropic / Anil Bajpai /
   ABTalksOnAI.
4. Refresh mid-conversation — it restores. "New chat" leaves the old one in the
   list. Delete works.
5. "Not helpful" -> escalation line with team@abtalks.in.
6. `npx tsc --noEmit` and `npm run build` pass.

Changed files must be exactly those in §3 — nothing under `knowledge/`,
`prisma/`, or `src/features/`.

## 15. Commit message

```text
feat(chatbot): wire generated corpus, harden retrieval, add sessions

Read both knowledge/processed and knowledge/generated with curated
precedence, add stemming + query synonym expansion and a confidence floor
to BM25 retrieval, and drop the two hard-coded matcher answers that had
gone stale (Claude tags, "everything is free"). Fix the two invalid routes
in the system prompt, repair the ingest allowlist (/mission is protected),
and give the widget multi-session localStorage history plus a real
not-helpful escalation path.
```
