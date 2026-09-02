# 106 — Résumé upload, parsing, and Résumé Strength Score

## 1. Goal

Turn the Profile's single "Résumé" URL text box into a real résumé section: the
candidate uploads a PDF (or points at a link), the server extracts a structured
résumé from it once, scores the résumé's own quality out of 100, and the profile
renders a clean summary + score + "areas to improve". This is **not** an ATS or
JD-match score — no job description is involved anywhere in this plan.

## 2. Current behavior

- `CandidateProfile.resumeUrl` (`prisma/schema.prisma`) is a user-typed URL. It is
  mirrored down to `StudentProfile.resumeUrl` by `saveLinks`
  (`src/repositories/candidate-detail.ts:699`).
- It is edited in `src/components/profile/links-section.tsx` via
  `saveLinksAction` → `linksSectionSchema.resumeUrl`.
- **Nothing ever fetches or parses it.** `src/features/interview/resume-context.ts`
  says so in its header comment and degrades to `RecruiterReview` +
  self-reported `StudentProfile.skills` instead.
- There is **no file storage anywhere in the app** — no `@vercel/blob`, no S3, no
  Supabase Storage (Supabase is residual, two tables only), no upload route, no
  action that handles a `File`. `pdf-lib` writes PDFs; it cannot read them.
- The Résumé Parser Agent (`agent packages/AI-Agents/Resume Parser Agent/`) is
  **Python**: `parse_resume(raw_text, filename, config)` returning a dict, using
  `pdfplumber` for text and Gemini for structure, with a regex-only local
  fallback and a `normalize_resume_parsed()` canonicaliser. It has **no tests**
  and performs **no scoring**. It cannot run on this Next.js/Vercel deployment.

## 3. Decisions taken (approved before implementation)

1. **Storage: Vercel Blob, private access.** `@vercel/blob@2.8.0` supports
   `put(..., { access: "private" })` and `get(pathname, { access: "private" })`
   returning a stream, so the original file is never publicly reachable and is
   served only through an authenticated route.
2. **Parser: the Python agent is ported to TypeScript on Gemini.** `GEMINI_API_KEY`
   already exists and `src/features/interview/agent/llm/gemini-provider.ts` is the
   in-repo pattern. Gemini accepts PDF bytes as `inlineData`, which removes the
   need for a `pdfplumber` equivalent. The port keeps the agent's **output schema,
   prompt intent and normaliser** — it is the same agent, re-hosted, not a second
   parser.
3. The résumé link input **moves** from Links into the new Résumé section. The
   stored `CandidateProfile.resumeUrl` / `StudentProfile.resumeUrl` values and
   every existing reader are untouched; `linksSectionSchema.resumeUrl` becomes
   optional so a Links save cannot clobber it.

## 4. Files to touch

**New**

| Path | Note |
|---|---|
| `prisma/migrations/20260902120000_candidate_resume/migration.sql` | `[new]` `CandidateResume` table + 2 enums |
| `src/features/resume/types.ts` | `[new]` `ParsedResume`, `ResumeAnalysis`, `ResumeView` |
| `src/features/resume/normalize.ts` | `[new]` port of `normalize_resume_parsed()` |
| `src/features/resume/parse.ts` | `[new]` Gemini PDF to `ParsedResume` |
| `src/features/resume/strength.ts` | `[new]` pure, deterministic scoring |
| `src/features/resume/ingest.ts` | `[new]` file validation + SSRF-guarded URL fetch + Drive |
| `src/features/resume/storage.ts` | `[new]` Vercel Blob put/get/del |
| `src/features/resume/service.ts` | `[new]` orchestration + hash-based skip |
| `src/features/resume/view.ts` | `[new]` row to frontend-safe view |
| `src/features/resume/resume.test.ts` | `[new]` `npm run test:resume` |
| `src/repositories/candidate-resume.ts` | `[new]` the only reader/writer of the table |
| `src/lib/validations/resume.ts` | `[new]` Zod at the action boundary |
| `src/app/actions/resume-actions.ts` | `[new]` upload / link / delete |
| `src/app/api/profile/resume/file/route.ts` | `[new]` auth-gated download (binary, not a mutation) |
| `src/components/profile/resume-section.tsx` | `[new]` **Client** |
| `src/components/profile/resume-strength.tsx` | `[new]` **Client** (child of the above) |

**Edited**

| Path | Note |
|---|---|
| `prisma/schema.prisma` | `[edit]` model + enums + `User.resume` relation |
| `src/app/profile/page.tsx` | `[edit]` **Server** — load view, render new section |
| `src/components/profile/links-section.tsx` | `[edit]` **Client** — drop the résumé input |
| `src/lib/validations/candidate-profile.ts` | `[edit]` `resumeUrl` optional in links |
| `src/repositories/candidate-detail.ts` | `[edit]` `saveLinks` skips undefined resumeUrl |
| `next.config.ts` | `[edit]` `serverActions.bodySizeLimit` |
| `package.json` | `[edit]` `@vercel/blob` dep + `test:resume` script |

## 5. Server vs Client

- `src/app/profile/page.tsx` — **Server**. Passes only plain JSON (`ResumeView`
  or `null`) to the client section. No functions, no icons, no class instances.
- `resume-section.tsx`, `resume-strength.tsx` — **Client**. They need `useState`
  for the file input and the UPLOADING/PROCESSING states.
- Everything under `src/features/resume/` and `src/repositories/` is
  `import "server-only"`. The Gemini key is read in `parse.ts` only.
- `middleware.ts` is untouched — nothing here enters the edge bundle.

## 6. Résumé Strength methodology (deterministic, no JD)

Seven categories, each scored 0–100 from countable signals on the **parsed**
résumé, then combined by fixed weights summing to 100:

| Category | Weight | Signals |
|---|---|---|
| Completeness | 15 | contact block, summary, education, experience/internship, project, skills, certifications |
| Content quality | 20 | bullet count, median bullet length in an 8–35 word band, strong action verb at bullet start, absence of first-person filler |
| Impact / quantification | 20 | share of bullets carrying a number, percent, currency or magnitude token |
| Structure | 15 | section coverage, dated roles/education, bullets-per-role in a 2–6 band, no over-long single bullet |
| Skills evidence | 10 | share of claimed skills that also appear in an experience/project body |
| Experience & project strength | 15 | count and depth of roles and projects, tech listed per item, links on projects |
| Professional readiness | 5 | LinkedIn, GitHub, portfolio, headline present |

`overall = round(sum of category x weight / 100)`. Same input gives the same
output; no LLM runs in the scorer. Strengths / weaknesses / recommendations are
emitted by the same pure function from whichever category rules fired, so they
always describe the actual résumé.

## 6b. Persistence model — why one document, not new tables

Chosen after reading how this codebase already stores a generated document.

`InterviewReport` and `MockInterviewReport` state the rule in their own doc
comments: module and competency assessments live INSIDE the report JSON
"rather than as their own tables: they are written once, always read together
with the report, and never queried independently. Splitting them would buy five
joins for one page and nothing else." Both carry a `version` **column**, a
denormalised `overallScore` **column**, and validate the document **on write
AND on read**. `AssessmentReport` takes the other branch — a real child table,
`AssessmentScore` — precisely because a dimension there must be indexed and
filtered (`@@index([dimension, score])`, `@@index([skillId, score])`).

So the house rule is: **JSON when the sub-document is written once and read
whole; a child table when a dimension must be queried independently.**

The résumé has both kinds of content, and they already have homes:

| Content | Where it lives | Why |
|---|---|---|
| The structured résumé document | `CandidateResume.parsedData` (JSON) | written once per upload, always read whole, versioned + validated both ways — identical to `InterviewReport.report` |
| Strength analysis | `CandidateResume.analysis` (JSON) + `overallScore` column | same, with the score denormalised for listing |
| Education, experience, projects, skills, certifications | **the existing `CandidateEducation` / `CandidateExperience` / `CandidateProjectEntry` / `CandidateSkill` / `CandidateCertification` tables** | these are queried, filtered and indexed by `/hire`, admin and the interview context — they are exactly the `AssessmentScore` case, and they already exist |

**Net: no new relational tables.** A parallel set of résumé-shaped tables would
duplicate five models the platform already reads, and every consumer would then
have to ask which copy is true. `features/resume/enrich.ts` feeds the real ones.

`parsedData` is durable application data, not scratch output: a future JD-match
feature reads the document and never re-reads the PDF. `documentVersion` is a
column so a row written by an older deploy degrades to "unavailable" rather
than half-rendering.

## 6c. Résumé → Profile merge

The candidate never sees an extraction step. They attach a résumé; their profile
gets more complete. `src/features/resume/merge/` is the service that does it,
and it is a separate responsibility from ingestion (`ingest.ts`), extraction
(`parse.ts`) and scoring (`strength.ts`) — a test asserts the planner imports
none of them.

```
Existing profile  +  structured résumé
            ↓
      merge/plan.ts        (pure, deterministic)
            ↓
  normalise → match → dedupe → enrich
            ↓
  repositories/candidate-merge.ts   (guarded writes)
            ↓
      Updated profile
```

### Additive by construction

The plan can only express three things: **create a row**, **append to a list**,
**fill a field that is currently empty**. There is no operation for deleting a
row, removing a bullet, or replacing a candidate-entered value — so "the résumé
wiped my profile" is not a bug that can be written here, it is a shape that does
not exist. A test asserts the applier contains no `delete`, `deleteMany` or
`upsert`.

Every emptiness test is repeated inside the write transaction, so a candidate
typing in another tab wins the race rather than being overwritten. Every row
update is scoped by `userId` as well as `id`.

### Semantic identity, not fuzzy matching

`merge/terms.ts` gives each technology a canonical form: React / React.js /
reactjs collapse; Java and JavaScript do not. It is a curated alias map plus
two conservative rules (strip punctuation and spacing; collapse a trailing `js`
when a stem of 3+ characters remains) — deliberately not an edit distance,
because a distance close enough to unify React/React.js also unifies
Java/JavaScript and silently deletes a real skill. The `Skill` table's own
`aliases` column is consulted first; `canonicalTerm` exists to make a résumé's
spelling findable there.

`merge/text.ts` compares **token sets** rather than characters, with corporate
and institutional noise words removed, so "Nimbus Technologies Pvt. Ltd."
matches "Nimbus" while "Backend Engineer" never matches "Frontend Engineer".

### Matching rules, per entity

| Entity | Matched when | Deliberately NOT matched |
|---|---|---|
| Education | institution matches **and** (degree looks like the same qualification **or** graduation years agree) | a BSc and an MSc at one university — two entries |
| Experience | company matches **and** (title reads as the same role **or** start years agree) | **company alone** — two roles at one employer are two entries, and merging them erases a promotion |
| Projects | same repository URL, **or** a name that reads the same, **or** a near name backed by an overlapping stack | an unrelated project that shares a word |
| Certifications | name matches semantically | — |
| Skills | canonical term already claimed | — |

On a match the existing row is **enriched**: empty fields filled, new bullets
appended (existing bullets keep their exact wording and position), tech stacks
unioned with the candidate's spelling preserved. On no match the entry is
appended as a new row. When matching is undecidable the entries stay separate —
a spurious extra row is deleted in a second; a wrong merge destroys what someone
wrote.

**Idempotence** is tested directly: running the same résumé against the profile
it just produced plans zero creates and zero updates. A merge that keeps
appending on every re-upload is the duplication bug this layer exists to prevent.

### Never written from a résumé

- `phone` — `phoneVerified` hangs off it, and an unverified number from a
  document would desynchronise them.
- `email` — the account identity Auth.js issued.
- Any existing link. LinkedIn/GitHub/portfolio fill only when empty; a résumé
  never silently replaces a link the candidate saved.
- Any experience row whose duration carries no readable year — `startedOn` is
  NOT NULL and a guessed start date is a false fact on a profile a recruiter
  reads. Those rows are skipped.

### Auditability

`CandidateResume.mergeLog` stores the per-entry decisions from the last run —
section, action (`created` / `merged` / `skipped-duplicate` / `kept-existing`),
subject label, and a short reason. It exists to debug a bad merge and is never
read by the UI. `appliedSections` drives the one candidate-facing line
("Your education, projects and skills got more complete").

## 7. Guardrails for Cursor (DO NOT)

- DO NOT add `requireRole`/`requireAdmin` to the download route — it is
  session-gated to the owner only, by `userId`, never by a path parameter.
- DO NOT import anything into `middleware.ts`.
- DO NOT create a second parser. `src/features/resume/parse.ts` is the port of the
  existing agent and is the only place a model sees a résumé.
- DO NOT expose `parsedData` or `analysis` raw to the client — only `ResumeView`.
- DO NOT show the user that an extraction step exists. No "parsing", no
  "parser", no model or agent name, no JSON, in any rendered string.
- DO NOT re-render experience / education / projects / skills inside the résumé
  card. They belong in the profile's own editable sections.
- DO NOT let the merge overwrite, edit or delete anything the candidate typed.
- DO NOT match experience on company name alone.
- DO NOT use character edit distance for skill identity — see merge/terms.ts.
- DO NOT let the merge planner import ingest / parse / strength.
- DO NOT parse on page load. `getResumeView()` reads the stored row and nothing
  else.
- DO NOT name anything ATS / match / JD.
- DO NOT trust the browser's `file.type` — check the `%PDF-` magic bytes.
- DO NOT let a URL fetch reach a private address; `assertPublicHttpUrl` gates it.

## 8. DB safety

Additive only: one new table, two new enums, one new relation field on `User`.
No column is altered or dropped, so no data can be lost and no backfill is
needed.

**Applied 2026-09-02** to the development database on endpoint
`ep-proud-sky-ayl98f6m` (Neon project `little-fog-11679677`), on the owner's
explicit authorisation that this endpoint is their sample database and not the
`production` branch. `prisma migrate status` reports the schema up to date.
Production has NOT been migrated by this plan — it runs `prisma migrate deploy`
through `build:deploy` on the next deploy. See §8b.

## 8b. Deploying this branch — what an admin must add

The feature reads a table that does not exist on any database this branch has
not been migrated against. Until it does, `/profile` still renders (the résumé
read is wrapped in a `.catch` that degrades to the empty state, the same
pattern the mock-interview history already uses on that page) but every upload
and link save fails.

**Schema — migration `20260902120000_candidate_resume`, additive only:**

| Object | Note |
|---|---|
| `CandidateResume` | one row per candidate, `userId` unique, FK to `User(id)` `ON DELETE CASCADE` |
| `ResumeSourceType` | enum `UPLOAD` \| `URL` |
| `ResumeProcessingStatus` | enum `PENDING` \| `PROCESSING` \| `READY` \| `FAILED` |
| indexes | `CandidateResume_userId_key`, `_status_idx`, `_updatedAt_idx` |

No existing column is altered or dropped, so the migration cannot lose data and
needs no backfill.

Apply it with:

```
npx prisma migrate deploy
```

Vercel runs this automatically through `npm run build:deploy`. Any **other**
database — a teammate's local, a Neon child branch, a fresh environment — has to
have it run against it explicitly.

**Environment:**

| Var | Required? | Without it |
|---|---|---|
| `GEMINI_API_KEY` | yes (already set) | uploads fail with "Résumé analysis is temporarily unavailable" |
| `RESUME_GEMINI_MODEL` | no | falls back to `GEMINI_MODEL`, then `gemini-3.5-flash` |
| `resume2_READ_WRITE_TOKEN` | for file storage | parsing, scoring and the profile merge still work; the original PDF is not retained and "View file" does not appear |
| `resume2_STORE_ID` | no (checked only) | the token/store correspondence check is skipped |

**Unchanged:** `CandidateProfile.resumeUrl` and its `StudentProfile` mirror keep
the same values and the same writers, so `/hire` dossiers, the admin student
detail page and `features/interview/resume-context.ts` are unaffected.

## 9. Verification

`npm run test:resume`, `npm run test:profile`, `npx tsc --noEmit`, `npm run lint`,
`npm run build`. Manually: empty, upload, processing, success, replace, remove,
plus a Drive link and a private-link error.

## 10. Commit message

`feat(profile): résumé upload, parsing and Résumé Strength Score`
