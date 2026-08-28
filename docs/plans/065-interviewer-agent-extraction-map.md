# 065 — Interviewer Agent: extraction map

Status: **investigation / architecture decision doc**, not an implementation plan.
Produces the keep/rework/discard mapping from the standalone `Interviewer-Agent`
repo into ABTalks, plus the open questions that block writing an implementation
plan. A follow-up plan (066+) should use the standard 9-section template once
the open questions below are answered.

Source repo: `C:\Users\shuja\Desktop\ZAINAB\ai agents- cloned from github\Interviewer-Agent`
(Next.js 15 + raw SQL over Neon, no ORM, ~8.4k lines).

## 1. Why this exists, and the fit that isn't obvious yet

ABTalks already runs an AI interview end-to-end — just not for the pipeline the
source repo was built for.

- **`ProgramInterview`** (`prisma/schema.prisma:895-911`, `src/features/program/interview.ts`):
  exit interview for the 31-day AI Cohort. OpenAI Realtime for the live voice
  session, `askClaudeJson` (`src/lib/anthropic.ts`) for post-hoc transcript
  scoring. This pattern already works in production.
- **`jobs` + `JobApplication`** (`src/features/jobs/`): candidates apply, admins
  see a list. No screening step exists at all today.
- **`recruiter`** (human-written `RecruiterReview`) and **`talent-pool`**
  (program-track discovery at `/talent`) are both read surfaces, not screening.

The source repo is a JD↔resume↔candidate AI screening interview, gated by an
`invite_threshold` match score, with identity verification and proctoring —
built for exactly the gap that sits under `jobs`/`recruiter`, not a second copy
of what `program/interview.ts` already does. Treat this as **new capability for
the challenge-track hiring pipeline**, and treat `program/interview.ts` as the
proof that the voice-interview mechanism already works here — copy its pattern,
don't duplicate its model.

## 2. Target module boundary

New top-level `src/features/interview/`, mirroring how `program/interview.ts`
sits as its own file inside its track rather than folded into `recruiter`/`jobs`.
Relates to `Job` / `JobApplication` / `StudentProfile`. Recruiter-facing summaries
get surfaced into `talent-pool`/`recruiter` via `select`-only reads, the same way
`talent-pool/pool.ts` already reads `ProgramInterview` fields — not by merging
interview logic into those modules.

New Server Actions: `src/app/actions/interview-actions.ts` (candidate side),
`src/app/actions/admin-interview-actions.ts` (admin/recruiter side), following
the `job-actions.ts` shape: `"use server"` → Zod → `auth()` → Prisma → Result
envelope.

## 3. Extraction map

### Keep — port with adaptation (pure or near-pure logic, LLM call repointed)

| Source file | Target | Note |
| --- | --- | --- |
| `src/lib/interview/instructions.ts` | `features/interview/instructions.ts` | Pure prompt-string builder, no LLM call. Port near-verbatim. |
| `src/lib/interview/turnDecision.ts` | `features/interview/turn-decision.ts` | The real judge for text-turn mode. Repoint Gemini → `askClaudeJson`. Keep its deterministic-fallback-on-LLM-failure behavior. |
| `src/lib/interview/evaluate.ts` | `features/interview/evaluate.ts` | Split: LLM scoring call stays; weighted `core_score`/`integrity_score` math (deliberately never trusted from the model) stays in code; strip the inline `sqlQuery` calls, return data and let the caller persist via a Prisma transaction. |
| `src/lib/interview/coreQuestions.ts` + `probes.ts` | `features/interview/questions.ts` | Merge. Repoint LLM to Claude. |
| `src/lib/agents/interviewPlanner.ts` | `features/interview/planner.ts` | This is the actually-used blueprint generator (merges JD + resume + challenge history). Repoint LLM; repoint challenge-history source to ABTalks's real `Submission`/mission tables instead of the source repo's placeholder. |
| `src/lib/agents/challengeContext.ts` | `features/interview/challenge-context.ts` | Pure deterministic keyword filter, no LLM. Port as-is, repoint to ABTalks's actual task/challenge tables. |
| `src/lib/interview/identityVerification.ts` | `features/interview/identity-verification.ts` | Deterministic status decision in code, two vision-LLM checks. Port pending open question 4 below. |
| `src/lib/agents/readinessMatcher.ts` | `features/interview/readiness-matcher.ts` | Pure regex/keyword scoring, no LLM. Port as-is. |
| `src/lib/agents/redact.ts` | `features/interview/redact.ts` | Pure function. Port as-is. |
| `src/lib/agents/jdParser.ts` + `resumeParser.ts` | `features/interview/jd-parser.ts`, `resume-parser.ts` | Repoint LLM. Blocked on open question 3 (no resume text source in ABTalks today). |
| `src/lib/interview/contracts.ts` | `features/interview/types.ts` | Zod schemas — already matches house convention. |
| `src/lib/files/extractText.ts` | `lib/files/extract-text.ts` | mammoth/pdf-parse, no DB coupling. Port as-is once resume upload exists (open question 3). |

### Rewrite — concept kept, implementation rebuilt against ABTalks conventions

| Source concept | What changes |
| --- | --- |
| `src/lib/interview/createInterview.ts` (parse→match→gate→plan→persist) | Rewrite against a Prisma transaction, not raw SQL. Auth model TBD (open question 5). |
| Interview status lifecycle | Source repeats ad hoc status checks inline across 4+ routes — a known weakness, even per the source's own structure. Centralize as one `features/interview/state.ts` instead of porting the duplication. |
| `schema.sql` domain model | New Prisma models: `Interview`, `InterviewQuestion`, `Answer`, `ProctorEvent`, `CoreQuestion` (the source's `match_reports` likely folds into `Interview` fields rather than staying a separate table). **Requires `prisma/schema.prisma` changes — needs your sign-off before any migration work per CLAUDE.md.** |
| Realtime voice session route | Rebuild as `src/app/api/interview/session/route.ts`, copying `src/app/api/program/interview/session/route.ts` almost exactly (OpenAI Realtime ephemeral-secret mint). This precedent already exists and already works — lowest-risk piece of the whole extraction. |
| Candidate flow pages (`i/[token]/{check,interview,done}`, ~1,930 lines of WebRTC/proctoring UI) | Rebuild JSX/styling against ABTalks design system (`docs/design-system.md` tokens, no rounded corners/gradients/second font per standing rules). Reuse the *mechanism* — `RTCPeerConnection` wiring, `useProctor.ts` event capture, MediaPipe face detector — not the markup. |
| Admin/recruiter review UI | Rebuild under `/admin/interviews` (or a `talent-pool`-style read-only summary), Server Components, wrapped in `requireAdmin`/`requireRecruiter`. Source repo's admin routes have **no auth at all** — explicit anti-pattern, do not carry forward. |

### Discard — do not port

- `agent packages/**` — separate Python repos, confirmed dead: not invoked from `src/` at runtime despite what `CLAUDE.md`/`PLAN.md` in the source repo claim.
- `src/lib/gemini.ts` and every call site using it — see §4, provider drift.
- `src/lib/openai.ts` Chat Completions paths (keep only the Realtime ephemeral-secret mint logic).
- Source's own landing/dashboard/`/jobs`/`/admin` page shells — ABTalks has its own.
- `src/lib/interview/token.ts` (opaque-token candidate access) — pending open question 5.
- `src/app/api/integrations/abtalks/**` — this integration seam becomes unnecessary once the capability lives inside ABTalks itself.
- Unauthenticated admin/recruiter routes — the missing-auth pattern must not cross over, full stop.

## 4. Problem to resolve before any porting starts: LLM provider drift

The source repo's docs (`CLAUDE.md`, `PLAN.md`) describe OpenAI-only (Realtime
for voice, Chat Completions for text). The actual code in every generation/
scoring file — `coreQuestions.ts`, `probes.ts`, `evaluate.ts`, `turnDecision.ts`,
`interviewPlanner.ts`, `identityVerification.ts`, `jdParser.ts`, `resumeParser.ts`
— calls Gemini instead, each with a `// TEMPORARY: OPENAI_API_KEY has no billing`
comment. This is a real gap between stated and actual architecture in the source,
not a porting nuance.

Recommendation: standardize on `askClaudeJson` (`src/lib/anthropic.ts`) for every
text/judge/scoring call, matching what `program/interview.ts` already does, and
keep OpenAI Realtime for the live voice session only — same split ABTalks already
runs in production. This resolves the drift and avoids adding a third provider.

## 5. Effort signal

Core interview/agent logic in the source: **~2,377 lines / 20 files** — the
reusable kernel. App shell (pages + API routes): **~5,678 lines / 33 files**,
of which the two candidate-facing WebRTC pages alone are ~1,930 lines and are
worth rebuilding carefully rather than discarding outright (real mechanism, not
boilerplate). Extraction is a moderate rewrite, not a copy: every DB touchpoint
moves from raw SQL to Prisma, every LLM call repoints to Claude, and the UI
layer gets rebuilt against ABTalks's design tokens.

## 6. Open questions (need your decision before an implementation plan is written)

1. **Which pipeline does this attach to?** Everything above assumes challenge-track
   (`StudentProfile` + `Job`/`JobApplication`) since that's the pipeline with zero
   screening today, vs. program-track which already has `ProgramInterview`. Confirm.
2. **LLM provider**: confirm Claude for text/judge/scoring, OpenAI Realtime for
   voice (§4), or say if you want something else.
3. **Resume ingestion**: ABTalks stores `resumeUrl` as a link only, no binary
   upload or extracted text anywhere in the schema. The source repo's JD/resume
   matching needs actual resume text. Options: (a) build upload+parse now
   (pulls in `extractText.ts`, storage decision), or (b) ship v1 on
   JD + challenge-history questioning only (source's no-resume path already
   exists via `challengeContext.ts`) and add resume-aware questioning later.
4. **Identity verification + proctoring scope for v1**: this is the heaviest,
   most compliance-sensitive slice — ID document images, live-capture face
   match, retention/purge timestamps, Vercel Blob storage (not currently used
   elsewhere in ABTalks, needs its own check). Recommend scoping this to a
   separate phase/plan given the data-privacy weight, rather than bundling it
   into interview v1. Confirm or push back.
5. **Candidate access model**: source repo uses opaque emailed-link tokens, no
   login. ABTalks candidates are already authenticated (`StudentProfile` behind
   NextAuth). Recommend session-gating via a `requireInterviewCandidate()`
   function shaped like `requireProgramMember()`, dropping the token model —
   unless there's a business reason to interview people before they have an
   ABTalks account.

## 7. Next step

Once 1–5 above are answered, write `docs/plans/066-<name>.md` using the standard
plan template — starting with whichever is smallest and least blocked (§6.1–.5
suggests scoping v1 to: Claude-only text/judge calls, JD + challenge-history
questioning (no resume yet), session-gated candidates, identity verification/
proctoring deferred to a later plan). That scope reuses the most already-proven
ABTalks code (`program/interview.ts`'s voice-session pattern, `askClaudeJson`,
existing auth conventions) and defers every open question that touches new
infrastructure (blob storage, resume upload) to a phase 2 plan.
