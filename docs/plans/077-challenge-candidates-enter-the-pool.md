# 077 — The 60-day challenge enters the hiring pool

> **Branch:** `fix/hire-scout-conversation`
> **Trigger:** Scout can search 5 people. The platform has 320 with ≥10 verified days of work, 234 with ≥30, 74 who finished, 94 certified. The product was gated to 1.5% of its own evidence.
> **Owner's ask:** "bypass kr skte hain na, control to hai apne pe — json bana lo saare candidate ka."

---

## 1. Goal

Make Claude-challenge participants searchable in `/hire`, ranked on the same
evidence rubric, without showing a recruiter anybody's name, email or GitHub
handle before a human has approved it.

---

## 2. Ground truth (measured 2026-08-14, production Neon branch)

| | |
|---|---|
| Enrollments | 3,009 (CLAUDE 2,708 · SE 146 · AI 111 · DS 44) |
| ≥1 day submitted | 682 |
| **≥10 days** | **320** |
| ≥20 days | 272 |
| ≥30 days | 234 |
| ≥60 days (finished) | 74 |
| Certificates ISSUED | 94 |
| Submissions | 14,696 — 11,902 carry a GitHub URL |
| StudentProfile rows | 3,004 · with ≥1 declared skill 2,213 |
| Quiz attempts | 1,086 across 257 people |
| userType | STUDENT 2,454 · PROFESSIONAL 550 |

Top declared skills among the ≥20-day cohort: python 165, sql 84, java 71,
html 60, css 54, c++ 43, javascript 34, react 25.

**Every `Submission` is `ON_TIME`. Zero `LATE` rows.** The column carries no
information, so it must not become a scoring dimension.

---

## 3. Two decisions, and why

### 3.1 Not a JSON file — the database

The owner suggested exporting every candidate to JSON. Rejected, three reasons:

1. **PII in git forever.** 682 real students' skills, colleges, grad years and
   GitHub handles, committed to a repo that opens a PR against the owner's
   public GitHub. A later delete does not remove it from history.
2. **It goes stale on day one.** 14,696 submissions and growing daily. Scout
   quoting a snapshot number while the card shows a live one is exactly the
   trust failure plan 076 was written to stop.
3. **It is not less work.** The hard part is the evidence→dossier adapter, and
   that is identical whether rows come from a file or from Prisma. JSON adds an
   export script and a staleness bug on top.

### 3.2 Not a consent column — identity-blind by construction

`CandidateDossier` already refuses to carry name, email, employer, resume URL
and profile links (types.ts:64). `candidatePublicId()` already turns an internal
id into `AB-####`. `TalentEngagementRequest` already releases identity only at
`CONTACT_SHARED`, decided by an admin.

So a challenge candidate can enter the pool **today**, showing evidence and
nothing else. Consent is collected at the moment it matters — when a specific
recruiter asks about a specific person and the team calls them — instead of via
a blanket checkbox that nobody has ticked and that would have to be
back-collected from 682 people before the product could work at all.

This is the bypass the owner asked for. It bypasses the *blocking gate*, not the
*protection*.

### 3.3 No migration needed — the seam already exists

| Column | Already there |
|---|---|
| `TalentCandidateSource` | `PROGRAM · CHALLENGE_60 · CLAUDE · HACKATHON` |
| `TalentEngagementRequest.source` / `.candidateUserId` | both present, `programMemberId` already nullable |
| `TalentRequestMatch.source` / `.studentUserId` | both present |
| `CandidateDossier.programMemberId` | already `string \| null` |

**`prisma/schema.prisma` is not touched. No migration. No seed.**

---

## 4. The candidate handle

A challenge candidate has no `ProgramMember` row, so `programMemberId` cannot
address them. Introduce one opaque handle carried end-to-end:

```
PROGRAM:<programMemberId>     CLAUDE:<userId>
```

`userId` (not enrollment id) is the challenge key, because it is what
`TalentEngagementRequest.candidateUserId` and `TalentRequestMatch.studentUserId`
already store — so a match can be reloaded and an engagement re-keyed without a
join table.

`programMemberId` survives on the card **only** for the two affordances that are
genuinely program-only: the shortlist cart and `/talent/members/<id>`.

---

## 5. Evidence mapping

| Dimension | PROGRAM | CLAUDE |
|---|---|---|
| stack | `ProgramMember.skills` | `StudentProfile.skills`, **re-split** |
| missions | earned mission passes / 28 | days submitted / 60 |
| cleanPass | first-attempt pass rate | **uncovered** — every row is ON_TIME |
| consistency | commit days / 30 | `longestStreak` / 60 |
| projects | graded projects | uncovered |
| interview | exit interview | uncovered |
| experience | declared years | declared years, or derived from `graduationYear` |

**Skills are re-split.** One real row reads `["php mysql react-js  js  html css
python"]` — a single string. Split on `,;/|` always; then split on whitespace
only when a token holds 3+ words, so `machine learning` survives and that blob
does not.

**Certificate and quiz average are shown, never scored.** A certificate means
60/60 days, which `missionScore` already reads in full. Quiz covers 257 of 682
people — a dimension two thirds of the pool cannot produce would rank them down
for an assessment they were never given.

### Coverage is per source, not per search

This is the one real correctness trap. Coverage exists so nobody is scored
against evidence their cohort could not create. Union the two pools naively and
one program member with a graded project switches `projects` on **for all 320
challenge candidates**, who then score zero on it. So each candidate is scored
under its own source's coverage.

---

## 6. Files

| Path | | Note |
|---|---|---|
| `src/features/hire/candidate-ref.ts` | **new** | encode/decode/publicId for the handle |
| `src/features/hire/challenge-dossier.ts` | **new** | `buildChallengeDossierSet()` |
| `src/features/hire/types.ts` | edit | `source`, `candidateRef`, per-member coverage, track denominators, certificate/quiz facts |
| `src/features/hire/dossier.ts` | edit | set `candidateRef`; `cleanPass` coverage reads clean passes, not missions |
| `src/features/hire/pool-policy.ts` | edit | challenge gate + evidence floor |
| `src/lib/feature-flags.ts` | edit | `hireChallengePool()` |
| `src/features/hire/score-candidate.ts` | edit | track-aware denominators, `candidateRef`, nullable `programMemberId` |
| `src/features/hire/search-candidates.ts` | edit | merge both pools, dedupe by userId, per-source coverage |
| `src/features/hire/pool-facts.ts` | edit | snapshot spans both pools |
| `src/features/hire/capabilities.ts` | edit | drop the "challenge not searchable" limit when the pool is on |
| `src/features/hire/to-public-match.ts` | edit | carry the ref |
| `src/features/hire/explain-matches.ts` | edit | publicId from the ref |
| `src/features/hire/contact-access.ts` | edit | key on refs, both sources |
| `src/features/hire/load-request-matches.ts` | edit | reload challenge rows |
| `src/components/hire/match-card.tsx` | edit **Client** | ref-based; program-only affordances guarded |
| `src/components/hire/request-intro-button.tsx` | edit **Client** | takes `candidateRef` |
| `src/lib/validations/hire-request.ts` | edit | `candidateRef` schema |
| `src/app/actions/hire-request-actions.ts` | edit | resolve either source, write correct `source` |
| `src/app/actions/hire-actions.ts` | edit | persist challenge matches |

**Server → Client:** `MatchCardData` stays plain JSON. `candidateRef` is a string.

---

## 7. Out of scope, deliberately

- **The shortlist cart.** `RecruiterShortlistItem.memberId` is a hard FK to
  `ProgramMember`; challenge candidates cannot be added without a migration.
  Their card shows **View** and **Request an intro** — both real actions, no
  dead end. Say so plainly rather than rendering a button that errors.
- Working languages for challenge candidates. `DailyTask` has no language
  column, so the chip is absent rather than guessed.
- 60-day SE/AI/DS tracks (301 enrollments). Same adapter, one flag value away.

---

## 8. Guardrails (DO NOT)

1. **DO NOT** touch `prisma/schema.prisma`. The columns exist.
2. **DO NOT** weaken `memberEligibilityWhere` — program consent is unchanged.
3. **DO NOT** put a name, email, college name, GitHub handle or submission URL
   on a recruiter-facing card or dossier. Grad year and skills only.
4. **DO NOT** score a dimension a source cannot produce.
5. **DO NOT** default the flag on. Production stays as it is until the owner
   sets it deliberately.
6. **DO NOT** write an enrollment id into `TalentRequestMatch.programMemberId` —
   it is an FK to `ProgramMember` and will throw.
7. Always: `select` on every query, result envelope, Zod at the boundary,
   `lib/logger.ts`, no `any`.

---

## 9. Flag

```
HIRE_CHALLENGE_POOL=10        # min verified days; "true" = 10, unset = off
```

Set in `.env.local` so it works locally now. Vercel is the owner's call.

---

## 10. Verification

| # | Check |
|---|---|
| V1 | `tsc --noEmit`, 16/16 existing scoring tests, production build |
| V2 | Flag unset → search returns exactly what it returns today |
| V3 | Flag set → ≥300 candidates, ranked, `AB-####` only |
| V4 | No name/email/college/GitHub in any payload crossing to the client |
| V5 | Challenge candidate scored with `projects`/`interview`/`cleanPass` `null`, not 0 |
| V6 | Program candidate's score unchanged with the flag on |
| V7 | "Request an intro" on a challenge card writes `source: CLAUDE` + `candidateUserId` |
| V8 | Same person in both pools appears once, as PROGRAM |
| V9 | Scout stops claiming the challenge track is unsearchable |
| V10 | `/admin/hire` shows the request with a resolvable candidate |

---

## 11. Commit message

```
feat(hire): the 60-day challenge cohort enters the searchable pool
```
