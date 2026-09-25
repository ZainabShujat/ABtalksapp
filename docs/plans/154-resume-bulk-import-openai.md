# 154 — Résumé parsing on OpenAI + admin bulk import, registration and Google claim

Directed by Sohail (auth / admin / search / shared-architecture owner).
Revision 2 — 2026-09-25. Supersedes revision 1 (which kept imports User-less
until claim; the acceptance criteria below require admin registration and
recruiter visibility BEFORE claim, which a profile can only have with a `User`).

## Implementation status (2026-09-25)

Part A built on branch `feat/resume-import-154` (from origin/master; the old
`live-registration-issue` WIP is in `git stash` as "superseded by plan 154").
Part B built on branch `feat/person-name-format` (worktree `../ABtalksapp-names`).
Neither migration has been applied to any database yet.

Deviations from the steps below, all deliberate:
- Admin link lives in `features/admin/admin-nav.ts` (drives desktop and mobile
  nav), not an `admin/page.tsx` card.
- `status.ts` [new]: `loadImportStatus` + `CONSENT_ATTESTATION` cannot live in
  the "use server" actions file — any exported async function there is a
  callable, unguarded action.
- Self-continuation calls the deployment's own `VERCEL_URL` (or localhost in
  dev), never `NEXT_PUBLIC_APP_URL`, which can point a local run at production.
- `evaluateGoogleLink` / `onGoogleAccountLinked` take an optional DB client so
  the claim logic is unit-tested with fakes.
- Admin-registered profiles pass no college/organization to
  `createCandidateIdentity` (it would seed an education/experience row that the
  résumé merge then duplicates); the merge is the only writer of those sections.
- Step 20 synthetic variants (`build-resume-fixture --variants`) not built yet;
  `eval:resume-models` scores any fixture that has a `.expected.json`.
  Re-run on 2026-09-25 with strict json_schema (1 fixture × 2 runs):
  gpt-4.1-mini, gpt-4o-mini, gpt-5-mini all 100% field accuracy, 0 fabricated
  URLs; $2.02 / $0.88 / $2.81 per 1,000; only 4.1-mini returns the name in
  the document's casing. Default stays gpt-4.1-mini until the variant set exists.

## 0. Acceptance criteria (the definition of done)

| # | Criterion | Delivered by | Proven by |
|---|---|---|---|
| A1 | 1,000+ PDFs can be uploaded in one admin operation | Step 7 (direct-to-Blob client upload, folder/multi select, 6 in flight) + Step 8 | T3, M2 |
| A2 | 1,000+ parsing jobs run server-side without browser dependency | Steps 10–12 (DB queue, self-chaining drain, cron) | T9, T10, M4 |
| A3 | Processing survives browser closure / worker interruption | Step 11 leases + requeue, Step 12 self-chain + poll kick + daily cron | T10, M4 |
| A4 | Rate limits, retries, leases and recovery work | Steps 5, 9, 11 | T7, T8, T9, T10 |
| A5 | Duplicate PDFs are deduplicated | `contentHash @unique`, Step 8 | T4 |
| A6 | Résumé email extracted and normalized | Steps 4, 6 | T5 |
| A7 | Conflicting/missing emails go to review | Steps 6, 11, 13 | T5, T6 |
| A8 | Admin can register imported students | Step 13 | T11, E2E |
| A9 | Registered-but-unclaimed students are recruiter-visible | Step 13 (visibility row) + existing PROFILE track | T12, E2E |
| A10 | Recruiters see only available résumé-backed information | Step 13 mapping (no invented facts), Step 16 (contact locked until claim), Step 17 badge | T12, T13, E2E |
| A11 | Student Google login claims the correct candidate by verified email | Steps 14–15 | T14, E2E |
| A12 | Claim is atomic and race-safe | Account unique + partial unique index (Step 2), conditional update (Step 15) | T15 |
| A13 | Existing candidate data is never silently overwritten | Step 13 existing-user branch uses the additive merge only; claim never writes profile data | T16, E2E |
| A14 | No duplicate recruiter candidate after claim | Claim links Google to the SAME `User` → same `CandidateProfile` / public id | T17, E2E |
| A15 | Normal student registration still works | Step 15 gate returns the old outcome for every non-import case; Step 14 | T18, M8 |
| A16 | `/register` and `/profile` use OpenAI | Step 4 (`RESUME_PARSER_PROVIDER=openai`, shared `parseResumeDocument`) | T1, M8 |
| A17 | Model is configurable | `RESUME_OPENAI_MODEL`, one default constant | T2 |
| A18 | Model chosen on accuracy + cost | §2d evaluation + Step 20 eval script, re-runnable | Step 20 output committed in PR description |
| A19 | Actual token usage and cost recorded | `ResumeParseUsage` (Step 2), written for every call on every path | T19 |
| A20 | Parsing isolated from interview model limits | Different model (per-model OpenAI limits) + bulk TPM budget + header back-off | §2c, T8 |
| A21 | E2E: Admin → Parse → Register → Recruiter → Google Claim | Step 21 DB-backed test | E2E |
| A22 | Every person name is stored with each word's first letter capitalised, whichever code path writes it | Part B: Postgres `BEFORE INSERT/UPDATE` triggers on all 6 person-name columns | N1, N2 |
| A23 | Deliberate casing is preserved (McDonald, DeSouza, initials like RK) | Part B rule table | N1 |
| A24 | Existing names are corrected | Part B backfill script, dry-run first | N3, M9 |
| A25 | Imported résumé names (e.g. "ASHA MENON") arrive capitalised | Part B trigger (Step 6 no longer needs its own rule) | N2, E2E |

## 1. Goal
Stop résumé parsing failing under load (the Gemini quota exhaustion behind the
`live-registration-issue` stopgap), and let an admin import 1,000+ student
résumés, parse them server-side under a rate budget, register them as
recruiter-visible candidates, and have each student's Google sign-in take over
that same candidate account — with no duplicate candidate and no overwritten data.

## 2. Current behavior

### 2a. Parsing
- `src/features/resume/parse.ts` is the only parser: PDF → Gemini
  (`gemini-3.5-flash`, `GEMINI_API_KEY`) → first balanced JSON object →
  `normalizeParsedResume`. 429 → `BUSY_MESSAGE`; `SERVICE_FAILURE_MESSAGES`
  let the candidate register anyway (`resumeAllowsRegistration`).
- `service.ts` `processDocument`: sha256 dedupe → private blob
  `resumes/<userId>/<sha>.pdf` → parse → `looksLikeResume` →
  `analyseResumeStrength` → `upsertResume` READY → additive `mergeIntoProfile`.
- `completeRegistrationAction` runs `applyStoredResumeToProfile` right after
  `completeRegistration` → `createCandidateIdentity`.

### 2b. Identity, visibility, contact
- `CandidateProfile.userId` / `CandidateResume.userId` are required unique FKs
  to `User`. `User.email` is unique.
- Google sign-in: PrismaAdapter. With an existing `User` of the same email and
  no linked `Account`, Auth.js currently refuses (`OAuthAccountNotLinked`).
  `callbacks.signIn` gates deleted/disabled users; `events.createUser` records
  legal consent + newsletter preference for OAuth signups.
- `isCandidateRegistered(userId)` = a `CandidateProfile` exists.
- Recruiter visibility: `searchableUserWhere()` (`repositories/talent.ts`)
  requires a live `CandidateVisibility` row. The PROFILE track
  (`resolveProfileRefs`, `repositories/hire.ts`) = name + ≥1 skill with
  `claimedByCandidate: true` (the résumé merge writes skills that way).
  `CandidateVisibility` rows are written through `applyVisibilityChange`
  (`repositories/visibility.ts`) with a `consentSource`.
- Dossier facts carry provenance (`VERIFIED` / `DECLARED` / `DERIVED`);
  résumé-derived profile data is `DECLARED`. An imported candidate has no
  missions, interviews or assessments, so nothing VERIFIED can appear.
- Contact: email/phone are released only at `TalentEngagementRequest.status =
  CONTACT_SHARED`. Paid unlock (`unlock-contact.ts` / `unlock-transaction.ts`,
  Zainab's module) creates that row WITHOUT the candidate's involvement.
- Admin: `requireAdmin()` / `getAdminContext()` (`lib/admin-auth.ts`);
  layout guards pages only, every action must call the guard. Audit =
  `adminAction.create`.
- No job/queue infra: two daily-safe Vercel crons with `CRON_SECRET`;
  `after()` already used in `admin-actions.ts`. Hosting is free tier →
  crons are daily at most; function `maxDuration` 300 is already in use
  (`api/interview/stt`).

### 2c. OpenAI limits measured 2026-09-25 (shared `OPENAI_API_KEY`, one project, Tier 1)

| Model          | RPM / RPD      | TPM     | Current user                  |
|----------------|----------------|---------|-------------------------------|
| gpt-4o         | 500 RPM        | 30,000  | interview judge + report      |
| gpt-4.1        | 500 RPM        | 30,000  | —                             |
| gpt-4.1-mini   | 500 RPM        | 200,000 | helper chatbot                |
| gpt-4.1-nano   | 500 RPM        | 200,000 | —                             |
| gpt-4o-mini    | 10,000 / day   | 200,000 | —                             |
| gpt-5-mini     | 500 RPM        | 500,000 | —                             |
| gpt-5-nano     | 500 RPM        | 200,000 | —                             |

OpenAI limits are per model, so any résumé model other than gpt-4o never
touches the interview judge's bucket; STT/TTS are separate models. The prepaid
balance is shared. Batch queue limit is not exposed by the API (published
Tier-1: 2M enqueued tokens for the mini models, 90k for gpt-4o).

### 2d. Model evaluation (accuracy + cost), 2026-09-25
Each model parsed `fixtures/sample-resume.pdf` twice with the production
prompts; output scored by the 15 invariants of `resume-e2e.test.ts` (links in
every format, sections, merge, idempotence). Gemini recorded fixture = 15/15.

| Model        | Invariants (run 1 / 2) | Real failures                          | Tokens in/out | Latency | List $/1M in · out | ≈ $/résumé* | ≈ $/1,000* |
|--------------|------------------------|----------------------------------------|---------------|---------|--------------------|-------------|------------|
| gpt-4.1-mini | **15 / 15**            | none; identical output both runs       | 1,376 / 947   | 7–8 s   | 0.40 · 1.60        | 0.0046      | 4.6        |
| gpt-4o-mini  | 14 / 14                | name returned in capitals only         | 1,376 / 979   | 9 s     | 0.15 · 0.60        | 0.0017      | 1.7        |
| gpt-5-mini   | 14 / 14                | name in capitals only                  | 1,375 / 1,156 | 8 s     | 0.25 · 2.00        | 0.0049      | 4.9        |
| gpt-4.1-nano | 14 / 11                | invented a demo URL, lost advice       | 1,376 / ~950  | 5 s     | 0.10 · 0.40        | 0.0012      | 1.2        |
| gpt-5-nano   | 11 / 13                | dropped project demo links, lost skills| 1,375 / ~970  | 6 s     | 0.05 · 0.40        | 0.0010      | 1.0        |

\* Real résumé estimate 3.5k in / 2k out; prices are list prices at time of
writing, configured in code (Step 3), and replaced by recorded actuals (A19).

**Decision: `gpt-4.1-mini`.** Only model with zero failures and deterministic
output (temperature 0). Nanos are rejected on accuracy (invented/dropped URLs
reach recruiters). The cost gap to gpt-4o-mini is ≈ $3 per 1,000 résumés —
immaterial next to one wrong profile. Its bucket is shared only with the
chatbot; the bulk budget (below) leaves that half free.
**Fallback (env only):** `gpt-5-mini` if throughput must rise — 500k TPM,
bucket unused by anything — with `reasoning_effort: "minimal"`.
One synthetic fixture is a thin sample: Step 20 adds a re-runnable eval over a
larger synthetic set and must confirm this choice before production rollout.

**Throughput (gpt-4.1-mini, bulk budget 100k TPM, ~8k reserved per request
because OpenAI counts `max_tokens`):** ≈ 12–16 résumés/min.
1 ≈ 7–25 s · 100 ≈ 7–8 min · 500 ≈ 30–45 min · **1,000 ≈ 60–85 min**.
Raising `RESUME_IMPORT_TPM_BUDGET` to 150k → ≈ 50 min for 1,000.
Batch API is not needed (1,000 × ~3.5k = 3.5M enqueued tokens exceeds the
Tier-1 2M queue anyway); the job model keeps the seam (`mode`, `providerBatchId`).

## 3. Files to touch

Schema
- `prisma/schema.prisma` [edit] — `ResumeImport`, `ResumeParseUsage`, 3 enums.
- `prisma/migrations/<ts>_resume_import/migration.sql` [new] — generated + raw SQL (2 partial unique indexes).

Parser (all paths)
- `src/features/resume/providers/openai.ts` [new] — OpenAI transport, strict json_schema, price table, typed failures, rate headers.
- `src/features/resume/parse.ts` [edit] — provider switch (default `openai`), `parseResumeDocumentDetailed`, interactive 429 retry, usage recording; `parseResumeDocument` signature unchanged.
- `src/features/resume/usage.ts` [new] — `recordParseUsage()` → `ResumeParseUsage` (never throws).
- `src/features/resume/service.ts` [edit] — pass `{ source, userId }` into parse for usage; export `applyParsedResumeToProfile`. No other logic change.
- `src/features/resume/storage.ts` [edit] — `importPathname`, `storeImportFile`, `moveBlob` helper (copy + del), `readResumeBytes`.
- `src/repositories/candidate-resume.ts` [edit] — optional `db` param on `upsertResume`.

Import pipeline
- `src/features/resume/import/email.ts` [new] — pure normalize / resolve.
- `src/features/resume/import/identity-mapping.ts` [new] — pure `identityFromParsedResume`.
- `src/features/resume/import/rate-budget.ts` [new] — pure budget + backoff.
- `src/features/resume/import/worker.ts` [new] — drain loop (parse jobs + register jobs), injectable deps.
- `src/features/resume/import/register.ts` [new] — `registerImportedStudent(importId, adminId)`.
- `src/features/resume/import/claim.ts` [new] — `evaluateGoogleLink`, `onGoogleAccountLinked`, `attachParsedImportToUser`.
- `src/repositories/resume-import.ts` [new] — all `ResumeImport` Prisma access.

Admin / routes
- `src/app/api/admin/resume-imports/upload/route.ts` [new] — Blob `handleUpload` token route (admin-gated). The Blob client protocol requires a route handler; it only issues tokens, it writes no rows.
- `src/app/api/internal/resume-imports/drain/route.ts` [new] — POST, `CRON_SECRET`, runs one drain and self-chains.
- `src/app/api/cron/resume-imports/route.ts` [new] — daily recovery kick.
- `vercel.json` [edit] — the daily cron.
- `src/app/actions/admin-resume-import-actions.ts` [new] — admin actions (Step 9).
- `src/app/admin/resume-imports/page.tsx` [new] — Server.
- `src/app/admin/resume-imports/import-table.tsx` [new] — Client.
- `src/app/admin/page.tsx` [edit] — link card.

Auth / visibility / recruiter
- `src/auth.ts` [edit] — Google `allowDangerousEmailAccountLinking: true` GATED by `callbacks.signIn` → `evaluateGoogleLink`; `events.linkAccount` → `onGoogleAccountLinked`; `events.createUser` → `attachParsedImportToUser`.
- `src/repositories/visibility.ts` [edit] — new `VisibilityKind` `"admin_import"` (consentSource `admin_resume_import`) and `"claim_consent"` (re-stamps consentSource `oauth_claim`).
- `src/features/hire/unlock-transaction.ts` [edit] — refuse paid unlock for an imported, unclaimed candidate (Zainab's module).
- `src/features/hire/profile-dossier.ts` [edit] — `importedUnclaimed` flag → card badge "Imported from résumé · not yet claimed".
- the card component that renders dossier badges [edit] — render that badge (locate via `PROVENANCE_BADGE` usage; one line).

Config / tests / tooling
- `.env.example` [edit]; `package.json` [edit] — 3 scripts.
- `scripts/eval-resume-models.ts` [new] — Step 20.
- `scripts/build-resume-fixture.ts` [edit] — generate N synthetic variants (no real people).
- `src/features/resume/import/import.test.ts` [new] — unit + simulated 1,000-job load.
- `src/features/resume/import/import-e2e.test.ts` [new] — DB-backed A21.

NOT touched: `normalize.ts`, `strength.ts`, `merge/*`, `types.ts`,
`document.ts`, prompts' wording, `features/interview/**`, `admin-auth.ts`,
`middleware.ts`, `auth.config.ts`, `registration-gate.ts`,
`complete-registration.ts`, `contact-access.ts`.

## 4. Server vs Client
- `admin/resume-imports/page.tsx` — **Server**; `requireAdmin()`; passes `ImportRowView[]` + `ImportCounts` + `UsageTotals` (plain JSON) to the table. No functions/icons/classes cross.
- `admin/resume-imports/import-table.tsx` — **Client**; uses `@vercel/blob/client` `upload`, server actions, polling. Icons imported inside it.
- Dossier badge component — whichever it is today (Server or Client); receives one extra boolean.
- Route handlers, actions, worker, claim, repo, providers — server only (`import "server-only"` where not a route). Pure files (`email.ts`, `identity-mapping.ts`, `rate-budget.ts`) have no `server-only` so tests import them.
- Edge: nothing new is imported by `middleware.ts` / `auth.config.ts`. `auth.ts` (Node) imports `claim.ts` — fine; `claim.ts` must not import anything client-side.

## 5. Steps

### Step 1 — env (`.env.example`)
```
# Résumé parsing (plan 154)
RESUME_PARSER_PROVIDER=openai          # openai | gemini (fallback only)
# RESUME_OPENAI_API_KEY=               # optional; falls back to OPENAI_API_KEY
RESUME_OPENAI_MODEL=gpt-4.1-mini
RESUME_OPENAI_MAX_OUTPUT_TOKENS=4096
RESUME_IMPORT_CONCURRENCY=4
RESUME_IMPORT_TPM_BUDGET=100000
RESUME_IMPORT_RPM_BUDGET=200
RESUME_IMPORT_MAX_ATTEMPTS=6
RESUME_IMPORT_MIN_REMAINING_RATIO=0.3
# optional price overrides (USD per 1M tokens) when the model is not in the table
# RESUME_OPENAI_PRICE_IN=
# RESUME_OPENAI_PRICE_OUT=
```
`CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `resume2_READ_WRITE_TOKEN` already exist.

### Step 2 — schema
```prisma
enum ResumeImportStatus {
  UPLOADED      // stored — UI "Ready to Parse"
  QUEUED        // parse requested
  PROCESSING    // leased by a worker
  PARSED        // parsed, email resolved
  NEEDS_REVIEW  // missing/conflicting/duplicate email, missing name, non-student account
  FAILED        // retryable by admin
  REGISTERED    // User + CandidateProfile exist, not yet claimed
  CLAIMED       // a Google account is linked to that User
}
enum ResumeImportMode { SYNC BATCH }                 // BATCH reserved, no writer
enum ResumeParseSource { REGISTER PROFILE IMPORT }

model ResumeImport {
  id                String             @id @default(cuid())
  originalFilename  String
  fileSizeBytes     Int
  contentHash       String             @unique   // A5
  blobPathname      String?                      // resume-imports/<sha>.pdf, private
  sourceEmail       String?
  normalizedEmail   String?
  emailCandidates   String[]           @default([])
  status            ResumeImportStatus @default(UPLOADED)
  mode              ResumeImportMode   @default(SYNC)
  providerBatchId   String?
  registerRequested Boolean            @default(false)
  attempts          Int                @default(0)
  nextAttemptAt     DateTime?
  leaseUntil        DateTime?
  lastError         String?
  documentVersion   Int                @default(1)
  parsedData        Json?              // cleared once copied to CandidateResume
  analysis          Json?
  overallScore      Int?
  model             String?
  promptTokens      Int                @default(0)   // summed over all attempts
  completionTokens  Int                @default(0)
  costMicroUsd      Int                @default(0)
  uploadedByUserId  String
  registeredByUserId String?
  registeredUserId  String?            // the User the import became / was attached to
  linkedExisting    Boolean            @default(false)
  registeredAt      DateTime?
  claimedAt         DateTime?
  parsedAt          DateTime?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  // SQL: CREATE UNIQUE INDEX "ResumeImport_open_email_key" ON "ResumeImport"("normalizedEmail")
  //      WHERE "status" IN ('PARSED','REGISTERED');
  @@index([status, nextAttemptAt])
  @@index([normalizedEmail])
  @@index([registeredUserId])
  @@index([createdAt(sort: Desc)])
}

model ResumeParseUsage {
  id               String            @id @default(cuid())
  source           ResumeParseSource
  userId           String?
  resumeImportId   String?
  provider         String            // "openai" | "gemini"
  model            String
  outcome          String            // ok | rate_limited | unavailable | bad_output | truncated | not_resume
  promptTokens     Int               @default(0)
  completionTokens Int               @default(0)
  costMicroUsd     Int               @default(0)
  latencyMs        Int
  createdAt        DateTime          @default(now())

  @@index([createdAt(sort: Desc)])
  @@index([source, createdAt(sort: Desc)])
  @@index([resumeImportId])
}
```
Plus, raw SQL on the existing `Account` table (A12):
`CREATE UNIQUE INDEX "Account_one_google_per_user" ON "Account"("userId") WHERE "provider" = 'google';`
(pre-check in §7 that no user already has two Google accounts).
No relation fields are added to `User` (snapshots, like `AdminAction`).

### Step 3 — `providers/openai.ts`
- `RESUME_OPENAI_DEFAULT_MODEL = "gpt-4.1-mini"` — the only model literal. `resumeOpenAiModel()`, `resumeOpenAiKey()` (= `RESUME_OPENAI_API_KEY || OPENAI_API_KEY`).
- `RESUME_MODEL_PRICES: Record<string, { inPerM: number; outPerM: number }>` for the five models in §2d; `priceFor(model)` falls back to env overrides, else `{0,0}` + one `logger.warn`. `costMicroUsd(model, in, out)` = round((in·inPerM + out·outPerM)).
- `RESUME_JSON_SCHEMA` — strict JSON Schema of the raw shape in `RESUME_SCHEMA_PROMPT` (snake_case, all keys required, strings `["string","null"]`, `additionalProperties:false`) + top-level `all_emails: string[]`. `normalizeParsedResume` ignores the extra key → `ParsedResume` unchanged.
- `callOpenAiResumeParser({ bytes, fileName, system, user, maxTokens })`: POST `/v1/chat/completions`; `gpt-5*` → `max_completion_tokens` + `reasoning_effort:"minimal"` (no temperature); else `max_tokens` + `temperature:0`; `response_format: json_schema strict`; user content `[ {type:"file", file:{filename, file_data:"data:application/pdf;base64,…"}}, {type:"text", text:user} ]`; `AbortSignal.timeout(45_000)`.
- Returns `{ ok:true, raw, usage:{prompt,completion}, rate, latencyMs }` or `{ ok:false, kind:"rate_limited"|"quota"|"unavailable"|"bad_output"|"truncated", retryAfterMs, rate, usage, latencyMs, detail }`. 429 with `error.code === "insufficient_quota"` → `quota`. Parses `retry-after` and `x-ratelimit-{limit,remaining,reset}-{tokens,requests}` (`6ms`/`8.64s`/`1m2s` → ms).

### Step 4 — `parse.ts`
- Gemini fetch moved verbatim into local `callGemini()` with the same result shape (fallback provider only).
- `isParserConfigured()` provider-aware.
- `parseResumeDocumentDetailed(input, { source, userId?, resumeImportId?, retry429 })` → `{ ok:true, data, emails, usage, rate, model } | { ok:false, kind, message, retryAfterMs, rate }`. `emails` = `raw.all_emails` read before normalizing. Messages map to the EXISTING constants (rate_limited → `BUSY_MESSAGE`; unavailable/quota/bad_output/truncated → `NOT_ANALYSED_MESSAGE`; no key → `UNAVAILABLE_MESSAGE`); `SERVICE_FAILURE_MESSAGES` unchanged.
- Every underlying HTTP attempt calls `recordParseUsage(...)` (A19).
- `retry429` (interactive): ≤2 extra attempts, delay `max(retryAfterMs, fullJitter)` ≤ 8 s each, ≤ 20 s total (fits `maxDuration = 60`).
- `parseResumeDocument(input)` keeps its signature; gains an optional 2nd arg `ctx?: { source; userId? }` defaulting to `{ source: "PROFILE" }`, and calls the detailed version with `retry429: true`.

### Step 5 — `import/rate-budget.ts` (pure, injected clock/random)
- `createRateBudget({ tpm, rpm, minRemainingRatio, now })`: `reserve(tokens)` → wait ms (sliding 60 s window, both TPM and RPM); `settle(id, actual)`; `observe(rate)` → if `remainingTokens/limitTokens < ratio` or `remainingRequests/limitRequests < ratio`, block until `now + reset`.
- `fullJitterBackoff(attempt, { baseMs:2000, capMs:60000, random })`; `nextDelay(attempt, retryAfterMs) = max(retryAfterMs ?? 0, fullJitterBackoff(attempt))`.
- `estimateTokens(maxOutputTokens) = 4000 + maxOutputTokens`.

### Step 6 — `import/email.ts` and `import/identity-mapping.ts` (pure)
- `normalizeEmail(s)`: trim, strip `mailto:` and `<>`, lowercase, `z.email()` → string | null.
- `resolveImportEmail(primary, all)` → `single | none | conflict(candidates)`; never picks one of several.
- `identityFromParsedResume(parsed)` → `{ ok:true, input: Omit<CreateCandidateIdentityInput,"userId"|"referralCode"|"synergyPoints"> } | { ok:false, reason:"no_name" }`:
  - `fullName` = `candidateName` trimmed. Empty → `no_name`. Capitalisation is NOT done here: the Part B trigger formats it on write, exactly as for every other writer (`normalize.ts` untouched).
  - `userType` = `PROFESSIONAL` iff `estimatedExperienceYears >= 1` AND `experience.length > 0`, else `STUDENT`.
  - STUDENT: `college` = first education `institution` or null; PROFESSIONAL: `organization`/`role` from first experience, `yearsExperience` = floor of estimate.
  - `headline` = parsed headline or null. `phone: null`, `phoneVerified: false`, `collegeId`, location, country → null. Nothing is invented; everything else arrives through the additive merge.

### Step 7 — Uploads that scale to 1,000+ (A1)
- `api/admin/resume-imports/upload/route.ts`: `handleUpload` from `@vercel/blob/client` with `token: process.env["resume2_READ_WRITE_TOKEN"]`. `onBeforeGenerateToken(pathname)`: `getAdminContext()` or throw; `pathname` must match `^resume-imports/staging/[A-Za-z0-9._-]{1,140}\.pdf$`; returns `{ allowedContentTypes:["application/pdf"], maximumSizeInBytes: MAX_RESUME_BYTES, addRandomSuffix: true, tokenPayload: JSON.stringify({ adminId }) }`. `onUploadCompleted`: no-op (registration is explicit, Step 8 — the webhook cannot reach localhost).
- Client: `<input type="file" accept="application/pdf" multiple>` plus a "Choose folder" input (`webkitdirectory`); files filtered to `.pdf` ≤ 4 MB client-side; `upload(\`resume-imports/staging/${safeName}\`, file, { access:"private", handleUploadUrl })` with 6 in flight; completed pathnames are batched (50) into `registerUploadsAction`. Progress: uploaded / registered / duplicates / rejected. The page says "Keep this tab open until uploads finish — parsing continues without it." Re-running a partially finished upload is safe (A5 dedup).

### Step 8 — `registerUploadsAction` → repo
For each staging pathname (sequential within the batch):
`readResumeBytes` → `validateResumeBytes` (magic bytes/size) → sha256 → if `contentHash` exists: `del` staging, count duplicate → else `moveBlob(staging → importPathname(sha))`, `createOrGetImport(...)` (upsert on `contentHash`; P2002 race → duplicate). Invalid → `del` staging, count rejected with reason. One `AdminAction` per batch (`RESUME_IMPORT_UPLOAD`, metadata counts). Returns counts only.

### Step 9 — admin actions (`"use server"`)
Every action starts with `const admin = await getAdminContext(); if (!admin) return { ok:false, message:"Not authorised." };`, then Zod, envelope, `logger`.
1. `registerUploadsAction({ pathnames: string[1..50] })` — Step 8.
2. `queueParseAction({ ids?: string[]; all?: true; autoRegister: boolean })` — UPLOADED/FAILED → QUEUED, sets `registerRequested`; audit; `after(kickDrain)`.
3. `retryFailedAction({ ids?; all? })` — FAILED → QUEUED, `attempts=0`; audit; `after(kickDrain)`.
4. `resolveEmailAction({ id, email })` — valid email; NEEDS_REVIEW → PARSED (P2002 → stays NEEDS_REVIEW "email already used by import X").
5. `requestRegistrationAction({ ids?; all?; consentAttested: literal(true) })` — sets `registerRequested` on PARSED rows; audit `RESUME_IMPORT_REGISTER` with the attestation text "These students agreed to ABTalks sharing their profile with recruiters" (A9 consent record); `after(kickDrain)`.
6. `getImportStatusAction({ cursor?, filter? })` — rows (100/page), counts by status, usage totals (sum tokens, sum cost, calls, last-hour 429 count); if work exists and no live worker lease → `after(kickDrain)`.
`kickDrain()` = `fetch(\`${NEXT_PUBLIC_APP_URL}/api/internal/resume-imports/drain\`, { method:"POST", headers:{ authorization:\`Bearer ${CRON_SECRET}\` }, signal: AbortSignal.timeout(3000) }).catch(() => {})` — fire-and-forget.
`ImportRowView` never includes `parsedData`/`analysis`.

### Step 10 — `repositories/resume-import.ts`
- `createOrGetImport`, `queueImports`, `requestRegistration`, `resolveEmail`, `listImports`, `countByStatus` (`groupBy`), `usageTotals` (aggregate over `ResumeParseUsage`), `hasPendingWork`.
- `leaseParseJobs(n)` — raw `UPDATE … SET status='PROCESSING', "leaseUntil"=now()+interval '5 minutes', attempts=attempts+1 WHERE id IN (SELECT id … WHERE status='QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=now()) ORDER BY "createdAt" LIMIT n FOR UPDATE SKIP LOCKED) RETURNING …`.
- `leaseRegisterJobs(n)` — same shape over `status='PARSED' AND "registerRequested"`, leasing by setting `leaseUntil` (status unchanged; the lease column is the lock).
- `requeueStale()` — PROCESSING with expired lease → QUEUED; clears expired `leaseUntil` on PARSED rows.
- `markParsed` (validates with `resumeDocumentSchema` / `resumeAnalysisSchema`; P2002 on open-email index → NEEDS_REVIEW), `markNeedsReview`, `markRetry`, `markFailed`, `addUsage(id, in, out, cost, model)` (increment).
- Worker lease: `PlatformConfig` key `resume_import.worker_lease` (`stringValue` = ISO expiry): `acquireWorkerLease(ms)` via conditional `updateMany` (create on first use; P2002 → not acquired), `renewWorkerLease`, `releaseWorkerLease`, `workerLeaseLive()`.

### Step 11 — `import/worker.ts` (A2–A4)
```
drainResumeImports({ budgetMs = 240_000, deps = defaultDeps })
  if !acquireWorkerLease(300s) → { skipped:true }
  requeueStale()
  budget = createRateBudget(env)
  loop until deadline:
    registrations = leaseRegisterJobs(5) → registerImportedStudent each (no model budget)
    free slots (RESUME_IMPORT_CONCURRENCY) → leaseParseJobs(free)
    each job: await budget.reserve(estimate) → processParseJob in a slot
    renew lease every 60 s; stop leasing new work at deadline − 60 s
    nothing leased and nothing in flight → break
  await in-flight; release lease
  return { parsed, failed, retried, registered, remaining: hasPendingWork() }

processParseJob(job)
  bytes = deps.readBytes(blobPathname)          (missing → markFailed "File missing — re-upload")
  r = parseResumeDocumentDetailed(..., { source:"IMPORT", resumeImportId, retry429:false })
  budget.observe(r.rate); budget.settle(actual); addUsage(...)
  rate_limited | unavailable | truncated | bad_output:
       attempts < MAX → markRetry(now + nextDelay(attempts, retryAfterMs))   (slot freed immediately)
       else → markFailed(short message)
  quota → markFailed("OpenAI quota exhausted — top up, then Retry failed")   (no auto retry)
  ok → completeImport(job, r)

completeImport(job, r)      // shared with a future Batch collector
  !looksLikeResume → markFailed("Not a résumé")
  analysis = analyseResumeStrength(data)
  email = resolveImportEmail(data.email, r.emails)
  single → markParsed(...); none/conflict → markNeedsReview(candidates)
```
`deps` (readBytes, parse, register, clock, random) are injectable for T9/T10.

### Step 12 — drain triggers (browser-independent)
- `api/internal/resume-imports/drain/route.ts`: `runtime="nodejs"`, `maxDuration=300`, POST only, `Authorization: Bearer ${CRON_SECRET}` else 403. Runs `drainResumeImports({})`; if `result.remaining` → `after(kickDrain)` (self-chain). Returns counts.
- `api/cron/resume-imports/route.ts` — clone of `cron/hire-alerts`: `requeueStale()` + `kickDrain()`. `vercel.json`: `{ "path": "/api/cron/resume-imports", "schedule": "30 3 * * *" }`.
- Recovery ladder: self-chain (primary) → admin status poll kicks when no live lease → daily cron. An interrupted function leaves leases that expire in ≤5 min and are requeued by the next drain.

### Step 13 — `import/register.ts` (A8, A9, A10, A13)
`registerImportedStudent(importId, adminId)`:
1. Load import (PARSED, `normalizedEmail`, `parsedData`). `identityFromParsedResume` → `no_name` → NEEDS_REVIEW.
2. Existing `User` by email (`findUnique`, select id, role, deletedAt, disabledAt, candidateProfile.id, resume.id):
   - role ≠ STUDENT, or deleted/disabled → NEEDS_REVIEW ("Email belongs to a non-student / closed account").
   - **exists with profile** → no new rows except: `CandidateResume` from import only if none; `applyParsedResumeToProfile` (additive). Visibility untouched (their decision stands). Mark REGISTERED, `linkedExisting=true`, `registeredUserId`; if the user has any `Account` → CLAIMED immediately.
   - **exists without profile** (signed in, never finished /register) → attach `CandidateResume` if none; do NOT create the profile (they finish /register themselves); mark CLAIMED, `linkedExisting=true`.
3. No user → one transaction (`writeClient().$transaction`, timeout 20 s):
   `tx.user.create({ data:{ email, name: fullName, role:"STUDENT" }, select:{ id:true } })` (no password, no Account, no session possible) → `createCandidateIdentity(tx, { userId, ...mapping, referralCode: await generateUniqueReferralCode(), synergyPoints:0 })` → `upsertResume(userId, fromImport, tx)` → `applyVisibilityChange(tx, { userId, kind:"admin_import" })` → import: REGISTERED, `registeredUserId`, `registeredByUserId`, `registeredAt`, clear `parsedData`/`analysis`. `User.email` unique (P2002) → retry the step-2 branch once.
4. After commit: `applyParsedResumeToProfile(userId, parsed)` (additive merge fills education / experience / projects / skills with `claimedByCandidate` → PROFILE-track eligible); then `markMergeApplied` as the service does. Errors → logged, import stays REGISTERED, retried by `requestRegistrationAction`.
5. No LegalConsent row is written here (the student has not acted) — it is written at claim (Step 15). The admin attestation (Step 9.5) is the pre-claim consent record.

### Step 14 — sign-in for students who were never registered by an admin (A15)
`events.createUser` (Google, new User): after the existing consent writes, `attachParsedImportToUser(user.id)` — if exactly one PARSED import has that email: conditional update (status PARSED → CLAIMED, `registeredUserId`, `claimedAt`), `upsertResume` from it if the user has none. They then see `/register` with the résumé already done; `completeRegistrationAction` merges as today. No match → nothing (normal registration).

### Step 15 — Google claim of an admin-registered student (A11, A12, A14)
`auth.ts`:
- Google provider: `allowDangerousEmailAccountLinking: true`.
- `callbacks.signIn({ user, account, profile })`: keep the existing deleted/disabled gate first; then `if (account?.provider === "google") { const d = await evaluateGoogleLink({ providerAccountId: account.providerAccountId, email: profile?.email ?? user.email, emailVerified: profile?.email_verified === true }); if (d === "deny") return "/login?error=OAuthAccountNotLinked"; }`.
- `evaluateGoogleLink` (in `claim.ts`) returns `"allow"` when: an `Account(google, providerAccountId)` already exists (normal returning user), OR no `User` has that email (normal new signup). It returns `"allow"` for linking ONLY when the existing `User` has zero `Account` rows, is not deleted/disabled, has an import with `registeredUserId = user.id AND status = 'REGISTERED'`, and `emailVerified` is true. Every other existing-email case → `"deny"` — exactly today's `OAuthAccountNotLinked` outcome, so recruiter-OTP and dev accounts behave as before.
- The adapter then links: `Account` create is protected by `@@unique([provider, providerAccountId])` and the new one-Google-account-per-user index → concurrent or second-account links fail atomically.
- `events.linkAccount({ user, account })` → `onGoogleAccountLinked(user.id)`: in one transaction, `updateMany` import `where { registeredUserId: user.id, status: "REGISTERED" }` → CLAIMED + `claimedAt`; `user.update emailVerified = now`; `applyVisibilityChange(tx, { userId, kind:"claim_consent" })`. Then (outside, never throwing) `recordLegalConsents({ source:"oauth_claim" })` + newsletter preference, mirroring `events.createUser`.
- Result: same `User.id`, same `CandidateProfile`, same `candidatePublicId`; `isCandidateRegistered` is true so the student lands on the dashboard; a one-time banner on `/profile` is out of scope (Shallika) — noted in risks.

### Step 16 — contact stays locked until claim (A10; Zainab's module)
`unlock-transaction.ts`: before charging, if `ResumeImport` exists with `registeredUserId = candidate.userId AND status = 'REGISTERED'` → refusal `CANDIDATE_NOT_CLAIMED` ("This candidate hasn't activated their account yet."), no credit spent. `contact-access.ts` untouched. Admin introductions are unaffected (explicit human decision).

### Step 17 — recruiter badge (A10)
`profile-dossier.ts`: add `importedUnclaimed: boolean` (one `resumeImport.count` by `registeredUserId`, `status: "REGISTERED"`); the dossier card shows "Imported from résumé · not yet claimed" next to the existing DECLARED labels. No other dossier field changes.

### Step 18 — `service.ts` / `storage.ts` / `candidate-resume.ts` details
- `processDocument` passes `{ source: <REGISTER|PROFILE>, userId }` through to `parseResumeDocument` (the upload action knows the page; default PROFILE). No behaviour change.
- `export async function applyParsedResumeToProfile(userId, parsed)` → `mergeIntoProfile` + `markMergeApplied` exactly as `processDocument` does.
- `storage.ts`: `importPathname(sha)`, `storeImportFile`, `moveBlob(from, to)` (`copy` with `access:"private"`, then `del`), `readResumeBytes(pathname)` (stream → `Uint8Array`, ≤ `MAX_RESUME_BYTES`).
- `upsertResume(userId, input, db = writeClient())`.

### Step 19 — admin UI (`/admin/resume-imports`)
- Upload panel (Step 7) with folder + multi select and live counters.
- Summary: Total · Ready · Queued · Processing · Parsed · Needs review · Failed · Registered · Claimed; usage: tokens in/out, total cost (USD), avg cost per résumé, 429s last hour, ETA (= remaining ÷ observed rate).
- Filters by status; table (100/page): checkbox, filename, email, status badge, attempts, `lastError`, score.
- Actions: Parse (row / selected / all ready) with "also register when parsed"; Retry failed; Resolve email (NEEDS_REVIEW, choose candidate or type); Register (row / selected / all parsed) behind a required consent attestation checkbox.
- Polls every 5 s while anything is QUEUED / PROCESSING / register-requested.
- `export const maxDuration = 60` on the page; heavy work never runs in the page.

### Step 20 — model evaluation script (A18)
- `scripts/build-resume-fixture.ts`: add `--variants 20` producing synthetic PDFs (1–2 pages, single/two-column, all-caps names, inline/bare/labelled links, `Node.js`/`React.js` tokens, 0/1/2 emails) + an `expected.json` per variant. No real résumés.
- `scripts/eval-resume-models.ts --models gpt-4.1-mini,gpt-4o-mini,gpt-5-mini`: runs each variant through `callOpenAiResumeParser` + `normalizeParsedResume`; scores field accuracy vs expected (email exact, name, link precision/recall with fabricated-URL count, section counts, skills recall); prints accuracy, fabricated URLs, p50/p95 latency, tokens, cost/résumé. Script: `npm run eval:resume-models`. The choice in §2d holds unless another model beats gpt-4.1-mini on accuracy with zero fabricated URLs.

### Step 21 — tests
`import.test.ts` (offline; run `npm run test:resume-import`):
- T1 provider switch: `parseResumeDocument` routes to OpenAI by default, Gemini when set; messages map to existing constants.
- T2 model config: only `providers/openai.ts` contains a model literal (source assertion); env override honoured; `gpt-5*` request shape.
- T3 upload route: non-admin token request throws; bad path/type rejected; admin accepted. Every action returns "Not authorised." without an admin context (stubbed guard) — covers "non-admin cannot upload" and "admin can upload one / many".
- T4 dedup: same bytes twice → one row, staging deleted.
- T5 email: normalize cases; none/conflict never picks.
- T6 NEEDS_REVIEW paths: no email, two emails, duplicate open email (P2002), no name, non-student account.
- T7 429: retry-after honoured, full-jitter bounds, MAX → FAILED; `quota` not auto-retried.
- T8 budget: reservations never exceed TPM/RPM in any 60 s window; header guard pauses below ratio.
- T9 simulated load: 1,000 jobs through the worker with fake deps (random 3–20 s latency on a fake clock, 5% 429s, 1% bad output) → every job terminal, budget never exceeded, concurrency never exceeded.
- T10 interruption: kill the worker mid-run (abandon in-flight), advance clock past lease → `requeueStale` + new drain completes all; second concurrent drain is skipped by the worker lease.
- T11 register mapping: `identityFromParsedResume` (student vs professional, nothing invented, name passed through trimmed).
- T12/T13 recruiter view (fake tx): registered user gets visibility `admin_import`; unlock refused `CANDIDATE_NOT_CLAIMED` with no credit movement.
- T14–T17 `evaluateGoogleLink` / `onGoogleAccountLinked`: matching verified email → allow + CLAIMED; unverified → deny; different email → allow as new user (no claim); already claimed (has Account) → deny; lost race (updateMany 0) → no-op; same userId kept.
- T16 existing profile: register with an existing profile → no user/profile create, merge additive only (reuse merge-plan fixtures: second plan empty).
- T18 recruiter-otp / dev user with same email as a Google sign-in → deny (unchanged behaviour); `registration-actions.ts` still calls `applyStoredResumeToProfile` (source assertion).
- T19 usage: every attempt (incl. 429) writes a `ResumeParseUsage` row; cost math per price table.
- Plus existing: `npm run test:resume`, `npm run test:resume:e2e` (Project URLs, `Node.js`/`React.js` not URLs) green.

`import-e2e.test.ts` (A21; `npm run test:resume-import:e2e`, requires `RESUME_IMPORT_E2E=1` and a `DATABASE_URL` whose host/db differs from production — refuses otherwise; OpenAI replaced by the recorded fixture via injected `parse` dep; Blob via injected `readBytes`):
1. Seed an admin (`UserRoleAssignment` ADMIN) and 3 synthetic imports (valid, duplicate bytes, two emails).
2. Parse via `drainResumeImports` → 1 PARSED, 1 deduped, 1 NEEDS_REVIEW; resolve it.
3. Register → `User` without `Account`, `CandidateProfile`, `CandidateResume` READY, visibility `admin_import`.
4. Recruiter: `resolveProfileRefs([userId])` returns it; dossier has `importedUnclaimed=true`, no VERIFIED facts; paid unlock refused.
5. Google claim: `evaluateGoogleLink` (verified, matching) → allow; insert `Account` as the adapter would; `onGoogleAccountLinked` → CLAIMED; a second Google `Account` for that user fails on the unique index; a different-email Google user gets nothing.
6. Assert exactly one `User`, one `CandidateProfile`, same public id; pre-existing profile fields unchanged; unlock now allowed by policy.
7. Cleanup of everything created (by ids).

## 6. Guardrails for Cursor (DO NOT)
- DO NOT change `normalize.ts`, `strength.ts`, `merge/*`, `types.ts`, `document.ts`, the prompts' wording or the `ParsedResume` shape.
- DO NOT create an `Account`, password or session for an imported student. Only the Google claim creates an `Account`, via the adapter.
- DO NOT enable email-account linking for any provider but Google, and never without `evaluateGoogleLink` returning allow.
- DO NOT accept a user/import/profile id from the client in any claim path; identity = the OAuth callback's provider data + DB email.
- DO NOT touch `features/interview/**`, `OPENAI_INTERVIEW_MODEL`, `admin-auth.ts`, `middleware.ts`, `auth.config.ts`, `contact-access.ts`, `complete-registration.ts`.
- DO NOT hard-code a model outside `RESUME_OPENAI_DEFAULT_MODEL`; never default to `gpt-4o`.
- DO NOT loop parse calls from the browser; the browser uploads files and sends ids only.
- DO NOT add Redis/queues/new dependencies (`@vercel/blob/client` is already installed).
- DO NOT write `access:"public"` or build blob URLs; staging and import blobs are private.
- DO NOT expose `parsedData`/`analysis` or raw model output to the admin client.
- DO NOT put emails in logs, URLs or query strings (the `?error=` redirect carries no email).
- DO NOT add `requireAdmin` to `/login`, `/register` or the Auth.js handler; the drain/cron routes use `CRON_SECRET`, not a session.
- Build on a fresh branch from `master` once the `live-registration-issue` work is merged.

## 7. DB safety
1. Commit checkpoint; note the hash.
2. Neon branch snapshot of the target DB.
3. Pre-check (must return 0 rows):
   `SELECT "userId" FROM "Account" WHERE provider='google' GROUP BY "userId" HAVING count(*) > 1;`
4. No `migrate dev` (dev DB drift). `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` → `prisma/migrations/<ts>_resume_import/migration.sql`; append the two partial unique indexes; `npx prisma migrate deploy`; `npx prisma generate`.
5. Additive only. Rollback: drop the two tables, three enums and the two indexes.
6. The E2E test runs only against a throwaway Neon branch.

## 8. Verification
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- `npm run test:resume`, `test:resume:e2e`, `test:resume-import`, `test:resume-import:e2e` (on a Neon test branch), `eval:resume-models` (report pasted in the PR).
- Manual:
  - M1 non-admin → `/admin/resume-imports` redirects; upload token route 403s.
  - M2 upload a folder of ≥1,000 synthetic PDFs (script output) → counters complete; re-run → all duplicates.
  - M3 Parse all with auto-register.
  - M4 close the tab; 10 min later reopen → progress advanced; kill a deploy mid-run → resumes within ~5 min of the next kick.
  - M5 lower `RESUME_IMPORT_TPM_BUDGET` to 20000 → pacing visible; usage panel shows tokens + cost.
  - M6 a registered import appears in `/hire` search with the "not yet claimed" badge; unlock refused.
  - M7 Google sign-in with that email → dashboard, same candidate; recruiter view: one candidate, badge gone, unlock allowed.
  - M8 a fresh Google account with no import → normal `/register`; self-upload parses via OpenAI (check a `ResumeParseUsage` row with source REGISTER).
- Files changed = exactly §3.

## Part B — Person-name capitalisation (global) + backfill

Independent of Part A: own migration, own commit, and it can ship FIRST.

### B1. Current behavior
- No capitalisation exists anywhere. The only name rule is the letters-only
  refine in `personName()` (`lib/validations/candidate-profile.ts`); the
  register, profile, talent, hackathon, workshop and recruiter validators only
  `trim()`.
- Person-name columns (schema): `User.name`, `CandidateProfile.fullName`,
  `RecruiterProfile.fullName`, `HackathonParticipant.fullName`,
  `HackathonRemoval.fullName` (snapshot), `WorkshopRegistration.name`.
- Writers are spread over ≥10 files and 5 owners: `completeRegistration` →
  `createCandidateIdentity`, `candidate-profile-actions.ts`, `profile-actions.ts`,
  `talent-actions.ts`, `hackathon-team-actions.ts`, `admin-hackathon-actions.ts`,
  `workshop-actions.ts`, `recruiter-profile-actions.ts` + recruiter OTP signup,
  the Auth.js PrismaAdapter (`User.name` from Google), seeds, and now the
  résumé import.
- Dev DB (`.env.local`, 2026-09-25, read-only count): CandidateProfile 27 names
  (1 ALL CAPS), User 58 (2 with a lowercase-initial word), RecruiterProfile 23
  (1). Production counts come from the dry run (B5).

### B2. Why a database trigger, not app code
"Global, no matter where the name is written" is only guaranteed at the
database: a trigger covers every current writer, the Auth.js adapter, nested
Prisma writes, raw SQL, seeds and any future code path, with zero edits in
other developers' modules and no TypeScript type changes.
The alternatives were rejected:
- Zod transforms in each validator: 8+ files across 5 owners, misses the
  adapter, nested writes and anything added later.
- Prisma `$use` middleware: removed in Prisma 6.14 (we are on 6.19).
- Prisma `$extends` query extension: sees only top-level args (misses nested
  creates), and changes the client type that `writeClient(): PrismaClient` and
  every `Tx` type depend on.
One implementation (SQL), so there is nothing to drift.

### B3. The rule (`abt_format_person_name(text)`)
Collapse runs of whitespace to one space and trim. Split into letter runs
and separators (space, `-`, `'`, `’`, `.`, anything else). Then, per letter run:

| Letter run is… | Action | Example |
|---|---|---|
| all lowercase | capitalise the first letter | `asha menon` → `Asha Menon`, `o'brien` → `O'Brien`, `mary-jane` → `Mary-Jane`, `a.p.j.` → `A.P.J.` |
| all uppercase, 3+ letters | first letter kept, rest lowercased | `ASHA MENON` → `Asha Menon`, `D'SOUZA` → `D'Souza` |
| all uppercase, 1–2 letters | unchanged (initials) | `RAHUL KS` → `Rahul KS`, `RK Sharma` → `RK Sharma` |
| mixed case | unchanged (deliberate) | `McDonald`, `DeSouza`, `LaToya` stay |
| no case (Devanagari, Tamil, digits) | unchanged | `राहुल` stays |

Properties: idempotent (f(f(x)) = f(x)); NULL → NULL; `''` → `''`. Known
limits, accepted: `mcdonald` → `Mcdonald` (nobody told us otherwise);
lowercase particles are capitalised (`van der berg` → `Van Der Berg`); non-ASCII
Latin letters (é, ñ) keep the case they were typed in, because the database's
default collation only case-maps ASCII reliably.

### B4. Files to touch
- `prisma/migrations/<ts>_person_name_format/migration.sql` [new] — function, generic trigger function, 6 triggers. Hand-written SQL (Prisma does not model triggers; `migrate diff` ignores them, so later diffs will not try to drop them).
- `prisma/scripts/backfill-person-names.ts` [new] — dry-run / apply.
- `prisma/scripts/person-name-cases.json` [new] — the rule table above as `{ input, expected }` pairs (≈40 cases), shared by the backfill self-check and N1.
- `src/lib/person-name.test.ts` [new] — N1/N2, DB-backed (runs the SQL function).
- `package.json` [edit] — `db:backfill:person-names`, `test:person-name`.
- `docs/CHANGELOG.md` [edit] — one line under `## Pending reconcile` (new DB convention: person names are formatted by trigger).
No application file changes. No write path in any module is edited.

### B5. Steps
1. Migration SQL:
   ```sql
   CREATE OR REPLACE FUNCTION abt_format_person_name(input text)
   RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
   DECLARE cleaned text; result text := ''; tok text;
   BEGIN
     IF input IS NULL THEN RETURN NULL; END IF;
     cleaned := btrim(regexp_replace(input, '[[:space:]]+', ' ', 'g'));
     FOR tok IN SELECT (regexp_matches(cleaned, '([A-Za-z]+|[^A-Za-z]+)', 'g'))[1] LOOP
       IF tok ~ '^[a-z]+$' THEN
         tok := upper(left(tok, 1)) || substr(tok, 2);
       ELSIF tok ~ '^[A-Z]{3,}$' THEN
         tok := left(tok, 1) || lower(substr(tok, 2));
       END IF;
       result := result || tok;
     END LOOP;
     RETURN result;
   END $$;

   CREATE OR REPLACE FUNCTION abt_person_name_trigger()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     NEW := jsonb_populate_record(NEW, jsonb_build_object(
       TG_ARGV[0], abt_format_person_name(to_jsonb(NEW) ->> TG_ARGV[0])));
     RETURN NEW;
   END $$;

   CREATE TRIGGER "User_name_format" BEFORE INSERT OR UPDATE OF "name" ON "User"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('name');
   CREATE TRIGGER "CandidateProfile_fullName_format" BEFORE INSERT OR UPDATE OF "fullName" ON "CandidateProfile"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('fullName');
   CREATE TRIGGER "RecruiterProfile_fullName_format" BEFORE INSERT OR UPDATE OF "fullName" ON "RecruiterProfile"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('fullName');
   CREATE TRIGGER "HackathonParticipant_fullName_format" BEFORE INSERT OR UPDATE OF "fullName" ON "HackathonParticipant"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('fullName');
   CREATE TRIGGER "HackathonRemoval_fullName_format" BEFORE INSERT OR UPDATE OF "fullName" ON "HackathonRemoval"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('fullName');
   CREATE TRIGGER "WorkshopRegistration_name_format" BEFORE INSERT OR UPDATE OF "name" ON "WorkshopRegistration"
     FOR EACH ROW EXECUTE FUNCTION abt_person_name_trigger('name');
   ```
   This exact function body was verified 2026-09-25 as a session-only
   `pg_temp` function in a rolled-back transaction: 19/19 rule-table cases pass,
   idempotent, NULL → NULL. Use `[[:space:]]`, NOT `\s`: when the SQL was passed
   through a JS string the backslash was lost and `s` became the pattern
   ("asha" → "A Ha"). The `.sql` file must be copied verbatim, never built from
   a template string.
   ASCII classes on purpose (see B3 limits): they behave the same under any
   collation, so dev and prod cannot differ. `UPDATE OF <col>` means only writes
   that touch the name fire it. Values returned by Prisma `create`/`update`
   `select` are the formatted ones (`RETURNING` sees BEFORE-trigger changes).
2. Apply: `npx prisma migrate deploy` (never `migrate dev`, see dev-DB drift);
   no `prisma generate` needed (schema unchanged).
3. `backfill-person-names.ts`:
   - Self-check first: runs every `person-name-cases.json` case through
     `SELECT abt_format_person_name($1)` and aborts on any mismatch.
   - `--dry-run` (default): per table, `count(*) WHERE col IS DISTINCT FROM abt_format_person_name(col)`
     and up to 10 `before → after` samples per table, printed to the local
     console only (PII: never logged via `logger`, never written to a file).
   - `--apply`: per table, in batches of 500 ids:
     `UPDATE "<T>" SET "<col>" = abt_format_person_name("<col>") WHERE id = ANY($ids) AND "<col>" IS DISTINCT FROM abt_format_person_name("<col>")`.
     Raw SQL on purpose: Prisma's `@updatedAt` does not bump, so
     "recently updated" sorts and profile-freshness signals don't treat a
     formatting pass as candidate activity. Prints counts per table.
   - Run: `npm run db:backfill:person-names -- --dry-run`, review, then `-- --apply`.
4. `docs/CHANGELOG.md`: one dated line under `## Pending reconcile`.

### B6. Guardrails (DO NOT)
- DO NOT add capitalisation code to validators, actions, repositories or components. The trigger is the single implementation.
- DO NOT apply the trigger to non-person names (`College`, `Organization`, `Skill`, `Cohort`, `TalentList`, `JobAlert`, `CandidateCertification`, …).
- DO NOT run `--apply` before the dry run has been reviewed, or on production before the Neon snapshot.
- DO NOT use Prisma `updateMany` for the backfill (it would bump `updatedAt`).
- DO NOT remove the `personName()` letters-only refine; the trigger formats, it does not validate.

### B7. DB safety
Commit checkpoint + Neon snapshot. Additive: 2 functions + 6 triggers.
Rollback: `DROP TRIGGER … ON …` ×6, `DROP FUNCTION abt_person_name_trigger(), abt_format_person_name(text)`.
The backfill cannot be un-done by the rollback, so the snapshot is the undo for it.

### B8. Tests and verification
- N1 (`npm run test:person-name`, DB-backed on the test branch): every case in `person-name-cases.json` via the SQL function; idempotence (format twice = once) on all cases.
- N2: insert/update through Prisma on each of the 6 tables (`create`, `update`, `upsert`, a nested `user.create({ candidateProfile: { create } })`, and a raw `INSERT`) → stored value formatted; an update that does not touch the name does not fire.
- N3: backfill on seeded rows → dry-run count = rows changed by apply; second apply changes 0; `updatedAt` unchanged.
- M9: `/register` with "asha menon" → profile, dashboard header (after the next sign-in), admin students list and recruiter card all show "Asha Menon"; a recruiter signing up as "RAHUL KS" → "Rahul KS".
- Known display gap: an already-issued session JWT keeps the name it was issued with until the next sign-in.

### B9. Commit message
```
feat(db): capitalise person names on write via trigger, with backfill (plan 154 part B)

- abt_format_person_name(): capitalise lowercase words, de-shout 3+ letter
  ALL-CAPS words, keep initials and deliberate mixed case.
- BEFORE INSERT/UPDATE triggers on User.name, CandidateProfile.fullName,
  RecruiterProfile.fullName, HackathonParticipant.fullName,
  HackathonRemoval.fullName, WorkshopRegistration.name.
- db:backfill:person-names with dry run and self-check.
```

## 9. Risks / open items
- **Consent (DPDP):** recruiter visibility before the student has signed in rests on the admin attestation (Step 9.5). Business must confirm the collection process actually obtained that consent; otherwise run imports with auto-register off and register only after claim.
- **Auth change (Sohail review):** Google email-account linking is now on, gated to REGISTERED imported users with zero accounts and a verified Google email. All other cases keep today's error.
- Imported students skip the `/register` phone-OTP step after claiming; phone stays unverified until they verify it on `/profile`.
- Only Google claims; a student whose Google email differs from the résumé email cannot claim — the admin fixes the email (NEEDS_REVIEW/Resolve) before registering.
- Skills merged from an imported résumé carry `claimedByCandidate: true` (existing merge semantics), which is what makes them PROFILE-track visible; the badge tells recruiters they are unconfirmed.
- Shared prepaid balance: a 1,000-résumé import costs ≈ $5; `quota` failures stop cleanly and resume with "Retry failed".
- Unclaimed imports hold PII indefinitely; a retention job is out of scope.
- Hobby cron is daily; browser-independence relies on the self-chain, with the cron as a backstop.

## 10. Commit message
```
feat(resume): OpenAI parser, 1k-scale admin résumé import, registration and Google claim (plan 154)

- All résumé parsing on OpenAI (RESUME_OPENAI_MODEL, default gpt-4.1-mini,
  chosen by eval); per-call token + cost recorded in ResumeParseUsage.
- ResumeImport queue: direct-to-Blob uploads, dedup by sha256, server-side
  drain with TPM/RPM budget, leases, full-jitter 429 backoff, self-chaining
  and cron recovery.
- Admin registers imported students (User without Account + CandidateProfile
  + CandidateResume + visibility); contact unlock waits for claim.
- Verified Google sign-in links to the imported User atomically; one
  candidate before and after claim.
```
