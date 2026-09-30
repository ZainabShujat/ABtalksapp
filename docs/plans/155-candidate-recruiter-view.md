# 155 — Recruiter View: let a candidate see their own profile the way a recruiter sees it

## 1. Goal

Give a signed-in candidate one page — `/profile/recruiter-view` — that renders their
own record through the *recruiter's* lens: the ranked search card a recruiter meets
first, the detail panel a recruiter opens, the five evidence dimensions the ranking
actually measures on them, and a candidate-safe answer to "can a recruiter find me,
and what is holding it back?" Every figure is read through the same functions the
recruiter path uses, so the preview cannot drift from the real thing.

## 2. Current behavior

A recruiter sees a candidate through two surfaces, both under `/hire`:

| Surface | File | What it shows |
| --- | --- | --- |
| Ranked search card | `src/components/hire/match-card.tsx` | masked name, role label, AB score + tier, meta pills (exp / location / employment / education), skill chips, open-to-work badge, evidence line |
| Detail panel | `src/components/hire/candidate-inspector.tsx` (1367 lines) | 5 tabs — ABTalks Evidence, Contact, Experience, Education, Skills |

Field-level truth is `RECRUITER_FIELD_POLICY` (`src/repositories/talent.ts:60`) and the
recruiter-safe identity overlay `loadRecruiterIdentities` in the same file. Contact,
résumé and LinkedIn/GitHub URLs sit behind a paid credit unlock.

What the candidate has today on `/profile`:

- `ProfileWizard` — ten editable sections (`basic`, `experience`, `education`,
  `projects`, `skills`, `accomplishments`, `resume`, `links`, `preferences`).
- `profile-review.tsx` — a "report card" whose own comment says *"the profile as a
  recruiter sees it"*. It is **not** the recruiter's view: it is the candidate's own
  fields laid out in cards. No score, no ranked-card framing, no evidence tab, no
  masking, no findability verdict.
- `profile-performance.tsx` — two counters over 90 days (`searchAppearances` from
  `DETAIL_VIEW` events, `recruiterActions` from `RESUME_UNLOCK`).

What exists but is admin-only: `src/features/admin/candidate-discoverability.ts` +
`get-candidate-discoverability.ts` — a check engine that answers exactly "why isn't
this candidate showing up?", with two **live probes** (`searchableUserWhere()` run
against the one id, and `resolveProfileRefs([userId])`) so the verdict cannot drift
from the platform. Rendered at `/admin/students/[id]` via
`components/admin/candidate-discoverability-panel.tsx`.

## 3. Decisions taken (answers to the clarifying round)

1. **Score — absolute dimensions only.** `stack` and `role` are scored against a
   recruiter's spec and do not exist without one; they are shown as *"set by each
   recruiter's search"*, not as numbers.
2. **Surfaces — card + panel, rebuilt in the candidate design system.** Not the
   `/hire` components verbatim: `src/app/hire/hire-scout.css` is 15,889 lines
   imported only by `src/app/hire/layout.tsx`, and dragging it onto a candidate
   route would couple candidate UI to recruiter internals both ways.
3. **Lock states — skipped.** No Contact tab, no unlock mechanics, no
   before/after. Four tabs: Evidence, Experience, Education, Skills.
4. **Findability — yes, candidate-safe wording**, reusing the admin check engine,
   with each fixable gap deep-linking to the wizard step that fixes it.

### 3a. Correction to decision 1 — `experience` is also spec-relative

`experienceScore(years, min, max)` (`score-candidate.ts:393`) **returns a flat `0.7`
when the spec states no band**, and `effectiveExperienceBand` derives that band
entirely from the recruiter's `seniority` / `minExperience` / `maxExperience`. So an
"Experience: 40" reading would be fabricated.

The genuinely absolute dimensions are **five**, not six:

| Dimension | Formula (`score-candidate.ts`) | Depends on spec? |
| --- | --- | --- |
| `missions` | `missionsPassed / clamp(cohortDay, 3, maxEarnable)` | no |
| `cleanPass` | `cleanPassCount / missionsPassed` | no |
| `projects` | `(mean·0.6 + best·0.4) / 100` | no |
| `consistency` | `commitDays / clamp(cohortDay, 5, window)` | no |
| `interview` | `mean(comm, tech, problem, overall) / 100` | no |
| `experience` | `experienceScore(years, spec.min, spec.max)` | **yes** |
| `stack` | `stackScore(skills, spec, roleSkills)` | **yes** |
| `role` | `assessRole(member, spec).title.fit` | **yes** |

Experience therefore joins stack and role in the "set by each recruiter's search"
group, with the candidate's **actual years** shown beside it as the fact it is.

## 4. Files to touch

### New

| Path | Note |
| --- | --- |
| `src/features/hire/own-track-evidence.ts` | `[new]` server-only. `loadOwnTrackEvidence(userId)` → the candidate's own raw evidence counts (`missionsPassed`, `missionsAttempted`, `cleanPassCount`, `commitDays`, `projectScores`, `interview`, `cohortDay`, `maxEarnable`, `consistencyWindow`, `source`, `candidateRef`) by reusing the existing dossier builders and picking their row. Returns raw counts only — never a `ScoreableMember`, never a `coverage`. |
| `src/features/profile/recruiter-view.ts` | `[new]` server-only assembler. Returns one `CandidateRecruiterView` for the signed-in candidate: identity overlay, card facts, the five absolute dims, the four tabs' payloads, the search-relative note, and the candidate-safe findability list. |
| `src/features/profile/recruiter-view-name.ts` | `[new]` **pure.** Re-states the recruiter card's surname-masking rule and returns a mask LENGTH, never a name. See §12 — `splitName` cannot be imported. |
| `src/features/profile/recruiter-view-checks.ts` | `[new]` **pure.** Translates `CandidateDiscoverability` checks into candidate-safe rows (`{ tone, label, detail, fixStep }`). Drops admin-only actions; never phrases a platform/admin gate as the candidate's choice. Unit-tested directly. |
| `src/features/profile/recruiter-view-checks.test.ts` | `[new]` pins the wording rules: every BLOCKING platform gate maps to "managed by ABTalks", every candidate-fixable gap carries a `fixStep`, no admin `action` string leaks. |
| `src/features/profile/recruiter-view.test.ts` | `[new]` pins the score contract: `stack`, `role`, `experience` are never emitted as numbers; the five absolute dims match the scorer's formulas. |
| `src/app/profile/recruiter-view/page.tsx` | `[new]` **Server Component.** `auth()` → redirect, assemble, render. |
| `src/components/profile/recruiter-view/recruiter-view-screen.tsx` | `[new]` **Client** (tab state only). Composes the sections. |
| `src/components/profile/recruiter-view/search-card-preview.tsx` | `[new]` **Client.** The ranked card as a recruiter meets it. |
| `src/components/profile/recruiter-view/evidence-meter.tsx` | `[new]` **Client.** One dimension row: label, bar, value, or the "search-relative" note. |
| `src/components/profile/recruiter-view/panel-preview.tsx` | `[new]` **Client.** The four-tab detail panel. |
| `src/components/profile/recruiter-view/findability-panel.tsx` | `[new]` **Client.** Verdict banner + check rows + fix links. |
| `src/components/profile/recruiter-view/recruiter-view.css` | `[new]` Scoped `.rv-*` rules on the `--pw-*` tokens already declared in `profile-wizard.css`. Imported by the route's page only. |

### Edited

| Path | Note |
| --- | --- |
| `src/app/profile/page.tsx` | `[edit]` **cross-module (Shivansh).** Two additive changes: a "See how recruiters see you" link into the page header area, and `?step=<key>` → `initialIndex` so the fix CTAs can deep-link a wizard section. No behavior change when the param is absent. |
| `src/components/profile/profile-performance.tsx` | `[edit]` **cross-module (Shivansh).** One `<Link>` under the 90-day counters. That panel is already the only part of `/profile` about recruiters, so the entry point belongs there rather than in the page chrome. Utility classes, so `profile-wizard.css` is untouched. |
| `src/components/dashboard-hub/nav-items.ts` | Considered and rejected — the entry point is on `/profile`, not the sidebar. **Not edited.** |

## 5. Server vs Client

| Component | Boundary | Notes |
| --- | --- | --- |
| `app/profile/recruiter-view/page.tsx` | **Server** | Only place that touches Prisma / `auth()`. |
| `recruiter-view-screen.tsx` | **Client** | `useState` for the active tab. Receives one plain serialisable object. |
| `search-card-preview.tsx` | **Client** | Pure render. |
| `evidence-meter.tsx` | **Client** | Pure render. |
| `panel-preview.tsx` | **Client** | Pure render, driven by the parent's tab state. |
| `findability-panel.tsx` | **Client** | Renders `next/link` hrefs built from string `fixStep` keys. |

**Server → Client boundary:** exactly one prop, `view: CandidateRecruiterView`, and
it is plain data only — strings, numbers, booleans, arrays, `null`. **No functions,
no Lucide icon elements, no `Date` objects, no class instances.** Every date is
pre-formatted to a string on the server (`formatDateTimeIST` / `monthYear`). Icons
are chosen client-side from a string key, the same discipline
`build-review.ts` / `profile-review.tsx` already use (`ReviewIconKey`).

## 6. Steps

### Step 1 — `src/features/hire/own-track-evidence.ts` [new]

```
export type OwnTrackEvidence = {
  source: CandidateSource;
  candidateRef: string;
  missionsPassed: number;
  missionsAttempted: number;
  cleanPassCount: number;
  commitDays: number;
  projectScores: number[];
  interview: { comm: number | null; tech: number | null;
               problem: number | null; overall: number | null } | null;
  cohortDay: number;
  maxEarnable: number;
  consistencyWindow: number;
  certificateIssued: boolean;
  quizAverage: number | null;
  totalTrackDays: number | null;
};

export async function loadOwnTrackEvidence(userId: string): Promise<OwnTrackEvidence | null>
```

- Reuse the **existing** set builders rather than re-deriving counts, so the numbers
  carry the same definitions the recruiter path uses: `buildDossierSet` (PROGRAM,
  scoped by `memberEligibilityWhere` for the cohorts `/hire` opens),
  `buildChallengeDossierSet` (CLAUDE, then CHALLENGE_60), `buildHackathonDossierSet`.
  Pick the dossier whose `userId` matches; stop at the first hit, ordered by the
  registry's `dedupePriority` (PROGRAM wins over the challenge, as on search).
- Return `null` when the candidate is in no searchable track. The page then shows the
  profile-only state — the `PROFILE` track's honest zeros — which is correct and is
  what `buildProfileDossierSet` documents.
- **Return raw counts only.** No `coverage`: the dossier builders' own comments say a
  per-member dossier "would have to guess" coverage, and coverage is a property of a
  *pool*, not a person. Nothing here may be fed back into ranking.
- Known cost, stated deliberately: each builder assembles its pool, so a cold load of
  this page costs roughly one `searchCandidates` pool assembly. Acceptable — it is a
  candidate-visited page, not a hot path, and `searchCandidates` already pays it on
  every recruiter search. The cheap follow-up (an optional `userIds` narrowing
  threaded into the three builders' where clauses) is **named here and not done**,
  because it changes signatures on the live search path for a profile feature.

### Step 2 — export the five absolute scorers from `score-candidate.ts` [edit]

`missionScore`, `cleanPassScore`, `projectScore`, `consistencyScore` and
`interviewScore` are currently reachable only through `export const __test`
(`score-candidate.ts:911`). Promote those five to real named exports and keep
`__test` re-exporting them unchanged.

- Pure additive: no call site changes, no behaviour change, `__test` keeps its shape
  so `score-candidate.test.ts` is untouched.
- **Do not** export `stackScore`, `assessRole`, `experienceScore`, `reweight`,
  `tierFor` or `BASE_WEIGHTS`. Those are the spec-relative machinery and the whole
  point of decision 1 is that a candidate surface cannot reach them.

### Step 3 — `src/features/profile/recruiter-view.ts` [new]

```
export type EvidenceDim =
  | { key: string; label: string; kind: "measured"; value: number; caption: string }
  | { key: string; label: string; kind: "unavailable"; caption: string }
  | { key: string; label: string; kind: "search-relative"; caption: string;
      fact: string | null };

export type CandidateRecruiterView = {
  card: { name: string; nameMasked: string | null; roleLabel: string;
          pills: { kind: "exp" | "location" | "employment" | "education";
                   text: string }[];
          skills: { name: string; evidenceBacked: boolean }[];
          openToWork: boolean; trackLabel: string | null;
          evidenceLine: string; summary: string };
  dims: EvidenceDim[];
  tabs: { evidence: …; experience: …; education: …; skills: … };
  findability: { appears: boolean; headline: string;
                 rows: CandidateSafeCheck[] };
  performance: { searchAppearances: number; recruiterActions: number };
};

export async function getCandidateRecruiterView(userId: string): Promise<CandidateRecruiterView | null>
```

Assemble in one `Promise.all`:

| Piece | Read through |
| --- | --- |
| identity, role, years, education line, skills, has-linkedin/github | `loadRecruiterIdentities([userId])` — **the recruiter-safe overlay itself**, so `RECRUITER_FIELD_POLICY` is enforced by the same code the recruiter gets |
| masked name | `splitName(fullName)` from `components/hire/desk-match-card` (exported, pure) |
| role label, evidence line, summary | `recruiterRoleLabel`, `verifiedEvidenceSentence`, `candidateSummaryDetail` from `features/hire/candidate-summary.ts` (pure, no CSS) |
| raw counts | `loadOwnTrackEvidence(userId)` (step 1) |
| the five dims | the five scorers promoted in step 2, ×100, rounded |
| Evidence tab | `getVerifiedAccomplishments(userId, "wins-only")` |
| Experience tab | `listPublicWorkHistory(userId)` |
| Education tab | the declared level off the identity overlay — **never the university name**, matching `MatchCardData.evidence.educationLevel`'s own comment |
| Skills tab | `getVerifiedSkills(userId)` + the claimed `CandidateSkill` names, split into evidence-backed vs declared |
| findability | `getCandidateDiscoverability(userId)` → `toCandidateSafeChecks` (step 4) |
| performance | `getProfilePerformance(userId)` |

- Emit `stack`, `role` and `experience` as `kind: "search-relative"`. `experience`
  carries `fact: "2 years"` (or `null`); the other two carry `fact: null`.
- A dimension the candidate's track cannot produce is `kind: "unavailable"` with a
  caption naming why ("the 60-day challenge has no graded project"), **never a zero**
  — the same rule `scoreBreakdown` follows when it reports `null`.
- Do **not** compute or emit a total, a tier, or gaps. A total over five of eight
  dimensions is not the AB score and must not be shown as one.

### Step 4 — `src/features/profile/recruiter-view-checks.ts` [new, pure]

`toCandidateSafeChecks(d: CandidateDiscoverability): { appears, headline, rows }`.

Reads the existing `DiscoverabilityCheck[]`. Per row:

- **Candidate-fixable** (`profile` and `skills` groups — no headline, no location,
  no claimed skills, thin skills, no education/experience rows): keep, rewrite to
  second person, attach `fixStep` = the wizard key (`basic` / `skills` / `education`
  / `experience` / `links` / `resume` / `preferences`).
- **Platform / admin gates** (`deletion`, `account`, `moderation`, `index` groups,
  incl. `moderation-stop`, `moderation-durable-stop`, `discovery-record`,
  `profile-pool-cap`): collapse into **one** row — *"Some visibility settings are
  managed by ABTalks. [Contact support]"* — with **no** detail text and **no**
  `fixStep`. `candidate-discoverability.ts`'s own header says a blocker here "is
  always something the platform or an admin did, never something the candidate
  chose, and this panel must never phrase one as a candidate decision."
- Drop every `action` string verbatim — they are admin runbook instructions
  ("Clearing it is an admin database change"), and they must not reach a candidate.
- `INFO` rows (e.g. `sessions-invalidated`) are dropped entirely.

### Step 5 — `src/app/profile/recruiter-view/page.tsx` [new, Server]

- `const session = await auth(); if (!session?.user?.id) redirect("/login");`
- `getCandidateRecruiterView(userId)`; `null` → the same "complete your registration
  first" card `/profile` already renders for a missing `CandidateDetail`.
- Wrap in `DashboardShell` (same `shellUser` / `isAdmin` shape as `/profile`), import
  `./recruiter-view.css`, render `<RecruiterViewScreen view={view} />`.
- **No `requireRole` / `requireAdmin` / `requireRecruiter`.** `/profile` is already in
  `middleware.ts`'s protected list (line 60) and `/profile/recruiter-view` inherits
  that prefix; the route's own `auth()` check is the authorisation. Adding a
  recruiter gate here would lock the candidate out of their own page.

### Step 6 — components [new, Client]

`recruiter-view-screen.tsx` — three stacked sections with a short honest preamble
("This is your record as a recruiter's search returns it. Nothing here is editable —
edit on your profile."):

1. **In search results** → `<SearchCardPreview>`: masked name, role label, track
   badge, open-to-work badge, meta pills, skill chips (evidence-backed ones marked),
   evidence line. One caption: *"Recruiters see your given name here; your surname,
   contact details and résumé are released separately."*
2. **What the ranking measures** → `<EvidenceMeter>` per dim. Measured dims get a
   bar + value; `unavailable` gets an em-dash + caption; `search-relative` gets the
   ⓘ caption and its `fact`.
3. **When a recruiter opens you** → `<PanelPreview>`: four tabs, `useState<TabId>`,
   defaulting to `evidence` — the same order and default the real inspector uses
   (`candidate-inspector.tsx:84`), minus Contact.
4. **Can recruiters find you** → `<FindabilityPanel>`: verdict banner, check rows,
   each `fixStep` a `<Link href={`/profile?step=${fixStep}`}>` styled with
   `buttonVariants` **directly on the Link** (never `<Button asChild>`), plus the
   existing 90-day performance counters.

`recruiter-view.css`: `.rv-*` only, on the `--pw-*` tokens already declared by
`profile-wizard.css`. Mobile-first — single column under 768px, the tab strip
horizontally scrollable, the meter rows stacking label-over-bar.

### Step 7 — `src/app/profile/page.tsx` [edit, cross-module]

Additive only:

```
export default async function ProfilePage({ searchParams }: {
  searchParams?: Promise<{ step?: string }>;
}) {
  …
  const requested = (await searchParams)?.step;
  const stepIndex = steps.findIndex((s) => s.key === requested);
  const initialIndex = stepIndex >= 0 ? stepIndex : <existing value>;
```

plus a `<Link href="/profile/recruiter-view">` beside the existing header actions.
Nothing is removed, no existing prop changes, and with no `?step=` the page behaves
exactly as it does today.

## 7. Guardrails for Cursor (DO NOT)

- **DO NOT** import `src/app/hire/hire-scout.css` from anywhere under
  `src/app/profile/`, and do not render `MatchCard`, `DeskMatchCard`,
  `CandidateInspector`, `LockedField`, `UnlockContactDialog`,
  `OutreachComposeDialog`, `ShortlistButton`, `DeskShortlistButton` or
  `AddToPipelineButton` on a candidate route. Only the **pure** helpers named in
  step 3 (`splitName`, `candidate-summary.ts`) may be imported from `components/hire`
  / `features/hire`.
- **DO NOT** call any `hire-*-actions.ts` Server Action from the candidate page.
  `loadInspectorWorkHistoryAction` and friends are unauthenticated by design
  (ref-scoped, not session-scoped) and a candidate surface calling them would make a
  candidate page depend on a recruiter-side gap. Call the underlying repository
  functions server-side instead.
- **DO NOT** add a Contact tab, an email/phone row, a résumé link, a LinkedIn or
  GitHub URL, or any unlock/credit affordance. Decision 3. `hasLinkedin` /
  `hasGithub` may be shown as **booleans only**.
- **DO NOT** emit a total score, a tier (`STRONG` / `PARTIAL` / `NONE`), a rank, or a
  gap list. And do not emit `stack`, `role` or `experience` as a number — including
  "70" for experience, which is `experienceScore`'s no-band constant, not a
  measurement.
- **DO NOT** print a zero for a dimension the candidate's track cannot produce. Use
  the `unavailable` variant.
- **DO NOT** change `scoreCandidate`, `rankCandidates`, `selectSearchResults`,
  `reweight`, `evaluateHardFilters`, `RECRUITER_FIELD_POLICY`, `searchableUserWhere`,
  or any dossier-builder signature. Step 2 is five `function` → `export function`
  keywords and nothing else.
- **DO NOT** let `loadOwnTrackEvidence` return or expose a `coverage`, and do not
  feed anything it returns back into the scorer or into a stored `TalentMatch`.
- **DO NOT** write anything. This whole feature is reads: no `CandidateProfileEvent`
  row, no `DETAIL_VIEW`, no `lastViewedAt`. A candidate looking at their own preview
  must not inflate their own "recruiters viewed you" counter.
- **DO NOT** surface another recruiter's search spec, project name, company, or any
  stored `TalentMatch` row. Recruiter isolation.
- **DO NOT** phrase a platform or admin gate as something the candidate chose or can
  fix, and do not copy any admin `action` string onto the page.
- **DO NOT** add `requireRole` / `requireAdmin` / `requireRecruiter` to the new route.
- **DO NOT** touch `middleware.ts` or anything it imports.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>`; put
  `buttonVariants` on the `<Link>`.
- **DO NOT** use `console.error` — `lib/logger.ts` only.
- **DO NOT** pass a function, an icon element, a `Date`, or a class instance across
  the Server → Client boundary.
- **DO NOT** create files this plan does not list, and do not refactor
  `profile-review.tsx`, `build-review.ts`, `profile-wizard.tsx` or
  `completeness.ts` — they belong to the candidate-profile module and this feature
  sits beside them.

## 8. DB safety

**None.** No schema change, no migration, no seed, no data write. Every read goes
through existing repository and feature functions.

## 9. Verification

Build / typecheck:

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Unit:

```bash
npx vitest run src/features/profile/recruiter-view-checks.test.ts src/features/profile/recruiter-view.test.ts src/features/hire/score-candidate.test.ts src/features/hire/visibility.test.ts
```

`visibility.test.ts` and `score-candidate.test.ts` must pass **unchanged** — they are
the regression fence around steps 2 and 3.

Manual, as a seeded candidate (`npm run db:seed` → an `@abtalks.dev` user):

1. `/profile` → the "See how recruiters see you" link is present.
2. `/profile/recruiter-view` → card, meters, four tabs, findability all render.
3. Confirm **absent**: any email, any phone, any résumé link, any LinkedIn/GitHub
   URL, any total score, any tier, any unlock button.
4. Confirm the three search-relative rows read as captions, not numbers.
5. A fix CTA → `/profile?step=skills` opens the Skills wizard step directly.
6. `/profile?step=` and `/profile?step=bogus` open the default step, unchanged.
7. 375px viewport: no horizontal scroll; tab strip scrolls; meters stack.
8. Signed out, `/profile/recruiter-view` → redirected to `/login`.
9. A user with no track (profile-only) → honest zeros / `unavailable`, no crash.
10. Load the page twice, then check `CandidateProfileEvent` — the candidate's own
    `searchAppearances` must **not** have moved.

Files that should have changed, and no others: the twelve `[new]` paths in §4,
`src/features/hire/score-candidate.ts` (five export keywords), and
`src/app/profile/page.tsx`.

## 10. Ownership

**CROSS-MODULE CHANGE REQUIRED**

| Owner | Module | Files | Why | Proposed change |
| --- | --- | --- | --- | --- |
| Shivansh | Candidate profile | `src/app/profile/page.tsx` | The entry point belongs on the profile, and the fix CTAs need a wizard deep-link | Additive: one `<Link>`, plus `?step=` → `initialIndex`. No existing prop or behaviour changes. |
| Shivansh | Candidate profile | `src/components/profile/recruiter-view/**`, `src/features/profile/recruiter-view*.ts` | New files under a module Shivansh owns | New files only; nothing existing is refactored. |
| Shashank | Candidate review panel | — | The panel's *shape* is mirrored | **Read-only mirror. No file of Shashank's is touched.** |
| Zainab | Contact unlock / credits | — | — | **Nothing touched — decision 3 removes the Contact surface entirely.** |
| Shallika | UI/UX, design system | `recruiter-view.css` | New page needs styling | Scoped `.rv-*` on existing `--pw-*` tokens. No shared token or primitive changed. |

Sohail-owned and self-reviewed: candidate search / search ranking
(`score-candidate.ts` step 2, `own-track-evidence.ts`), authorization (the new
route's `auth()` gate), recruiter isolation (the no-`TalentMatch` guardrail).

Approval to proceed was given directly in-session.

## 11. Changed during implementation

Two things were decided at the keyboard rather than in the plan. Both are recorded
here because both changed what shipped.

### 12a. `splitName` could not be imported — the masking rule is re-stated

The plan had `recruiter-view.ts` call `splitName` from
`components/hire/desk-match-card.tsx`, to guarantee the preview masks a name
exactly as the recruiter card does. That module is `"use client"`, and the
assembler is `server-only`. In the App Router a Server Component importing a named
export from a client module can be handed a **client reference rather than the
function**, so calling it server-side is a runtime hazard, not a style question.
It is also untestable from here: plain `tsx` makes `server-only` in its import
graph throw, and `--conditions=react-server` breaks `react.createContext`.

So `recruiter-view-name.ts` re-states the rule as a pure function, and the test
pins it **textually** to the card's source — all three clauses
(`parts.length < 2`, `parts.slice(1).join(" ")`,
`Math.max(4, Array.from(family).length)`) plus a behavioural table of its own. A
change on the card fails the build here.

It also returns a **length**, not a string. `splitName` produces a *decoy*
surname for the recruiter card to render under a CSS blur; the candidate's own
page has no reason to invent one, so the server sends a number and the component
draws that many block glyphs. Nothing name-shaped enters the page's HTML.

### 12b. Three CSS fixes found in the browser, not in review

Measured in the pane at 1280px and 375px:

- **Findability rows** were flex, so on a phone the fix button sat beside the text,
  squeezing the detail copy into ~150px and pushing the row to 236px tall. Now a
  grid: the button drops under the text below 768px (row 197px, body 271px) and
  returns beside it above.
- **Meter label column** was 210px; `"Stack match"` plus its `Set by the search`
  pill needs 223, so that label and `"Graded projects"` both wrapped. Now 236px,
  and no label wraps.
- **Tap targets** were 16px (back link) and 29px (fix buttons). Now floored at 40px,
  with the tab strip at 44px. The back link takes a negative inline margin so the
  bigger hit area does not move it off the 16px gutter.

Verified at both widths: no horizontal overflow, nothing wider than the viewport,
meters stack, the tab strip scrolls rather than clipping, and the 16px gutter holds.

## 12. Commit message

```
feat(profile): show a candidate their profile as recruiters see it

New /profile/recruiter-view renders the candidate's own record through the
recruiter lens: the ranked search card, the detail panel a recruiter opens,
the five evidence dimensions the ranking measures on them, and a
candidate-safe findability verdict.

Reads through the recruiter path's own functions so the preview cannot
drift: loadRecruiterIdentities for the field policy, the existing dossier
builders for evidence counts, and the admin discoverability check engine
(reworded, platform gates collapsed) for findability.

stack, role and experience are shown as search-relative rather than as
numbers — experienceScore returns a flat 0.7 with no spec band, so a figure
there would be fabricated. No total, no tier, no contact, no unlock.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
