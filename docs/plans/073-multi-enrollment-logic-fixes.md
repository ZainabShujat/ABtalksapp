# 073 — Multi-enrollment logic fixes (tester findings 1–6)

## 1. Goal

Make every enrollment lookup in the 60-day tracks status-aware and deterministic,
so users with historical enrollments (ABANDONED / COMPLETED rows) see the right
track, can join new tracks, and never hit a silent dead-end. Also close the
self-redirect loops in `/program/apply` and make the Claude "Join" card actually
enroll.

## 2. Current behavior

### 2.0 The constraint that shapes all of this

`prisma/schema.prisma:101` — `Enrollment @@unique([userId, challengeId])`, and
`Challenge.domain` is unique. **A user has at most ONE enrollment row per
domain.** So the bug is never "which of the two AI rows do we pick" — it is
always "we found the one AI row, then threw it away because of a status filter
and silently substituted a different domain."

Statuses: `ACTIVE | COMPLETED | ABANDONED` (`schema.prisma:597`). `ABANDONED` is
set by the admin "remove from challenge" action.

### 2.1 Correction to tester finding #1 — not currently reachable

`isProgramEntryBypassEnabled()` (`src/lib/feature-flags.ts:21`) returns a
hard-coded `true`. In `getEntryState`, the APPLIED branch hits the bypass at
`src/features/program/entry.ts:191` and returns `enrolled` / `waitlisted`
**before** the attempts query that can produce `in_progress`
(`entry.ts:201-210`). So no legacy applicant is trapped today.

The self-redirect at `src/app/program/apply/page.tsx:45-47` is still a live
landmine — it becomes a hard infinite loop the moment that flag stops being
hard-coded. The `intro` branch at `apply/page.tsx:147-149` has the **same** bug
(`?code=X` resolves to `intro` again → redirects to itself). Both get fixed, but
this is defensive work, not a live incident. Severity downgraded accordingly.

### 2.2 Finding #2 — `/ai`, `/ds`, `/se` can render another track's data

`src/components/challenge/track-page.tsx:116-123` finds the domain's enrollment
with no status filter and passes its id into `getDashboardData`.
`resolveDashboardEnrollment` (`src/features/enrollment/resolve-dashboard-enrollment.ts:42-53`)
honours an explicit id **only if ACTIVE**; otherwise it silently falls through to
"oldest ACTIVE enrollment, any domain" (`:55-60`). A user with a COMPLETED AI
enrollment and an ACTIVE DS enrollment opens `/ai` and gets DS data, DS heatmap,
DS streaks, and a "Start Today's Challenge" link into the DS day. Confirmed real.

Note the fallback chain also serves a *wanted* path today: a user whose only AI
row is ABANDONED reaches `EnrollmentEndedScreen` (`track-page.tsx:185`) via the
`profileDomain` fallback at `:62-69`. The fix must preserve that outcome while
making it deterministic instead of accidental.

`getDashboardData` has exactly one caller — `track-page.tsx:133` — so the blast
radius of changing the resolver is one component.

### 2.3 Finding #3 — `/register?domain=…` blocks legacy users

`src/app/register/page.tsx:46-53`: an unordered `findFirst()` over all
enrollments; if it returns an ABANDONED row the user is bounced to `/dashboard`
before the core-track join logic at `:55-73` ever runs. A user removed from AI
can no longer join DS. Confirmed real.

Two hazards in the same block that the plan must not disturb:

- `:76-80` — `profile && !enrollment` **deletes the StudentProfile**. That
  branch's "no enrollment" test must stay "zero rows of *any* status". Narrowing
  the query without splitting this check would delete the profile of every
  removed user.
- `redirect()` throws; it must never sit inside a `try`/`catch`.

### 2.4 Finding #5 — join failure is silent, and one failure mode is guaranteed

`register/page.tsx:66-68` discards the `CreateCoreEnrollmentResult`. Worse:
`createCoreEnrollment` checks for an existing row with
`status: { not: ABANDONED }` (`src/features/enrollment/create-core-enrollment.ts:56-63`),
so when an ABANDONED row exists it falls through to `prisma.enrollment.create`,
violates `@@unique([userId, challengeId])`, is swallowed by the catch at `:85`,
and returns `internal_error`. The user is redirected to `/ai` anyway and lands on
the "removed from challenge" screen. Every re-join attempt on an abandoned track
takes this path.

### 2.5 Finding #4 — dashboard hub mixes historical and active state

`src/features/dashboard/get-hub-data.ts:50-58` runs three enrollment queries;
two are unscoped (`where: { userId }`). `allEnrollmentDomains` (all statuses)
drives the Join/Continue cards, and `streakRows` (all statuses) inflates the
streak card from abandoned tracks. Confirmed real.

### 2.6 Not in the tester's list — the Claude "Join" card is a dead end

Restoring the Claude Join card (part of fixing #4) restores a broken path:
`OtherChallenges` links to `/claude-signup`, and
`src/app/claude-signup/page.tsx:32-45` sees the existing profile and redirects to
`/dashboard` **without ever creating a CLAUDE enrollment**. The only working
Claude join is the modal's `enrollInClaudeChallenge()` server action
(`src/app/actions/enrollment-actions.ts:8`). Also, the enrolled branch at `:42`
redirects to `/dashboard?challenge=<id>`, a parameter the rebuilt hub
(`src/app/dashboard/page.tsx`) no longer reads — same stale link in
`src/features/landing/get-landing-state.ts:75`.

### 2.7 Finding #6 — post-registration landing

`src/app/register/registration-form.tsx:278` pushes `/dashboard`. Per the product
decision this stays; the requirement is that the just-registered track is visible
under "Continue your journey" on arrival. Registration already creates an ACTIVE
enrollment (`src/features/registration/complete-registration.ts:193`), and
`ContinueJourney` lists ACTIVE enrollments — so this is a verification plus one
cache-invalidation line, not a rewrite.

## 3. Decisions taken (answered by product owner)

| # | Decision |
|---|---|
| D1 | **ABANDONED is a per-track block.** Removed from AI ⇒ cannot re-join AI, but DS/SE remain joinable. |
| D2 | **"Already joined" = ACTIVE + COMPLETED.** ABANDONED never counts as joined. Streak card computed from ACTIVE + COMPLETED only. |
| D3 | **Post-registration lands on `/dashboard`**, and the new track must appear in "Continue your journey" immediately. |
| D4 | **Fix the Claude join dead end** in this plan. |

Out of scope, deliberately: the activity heatmap
(`src/features/dashboard/get-activity-heatmap.ts`) stays user-wide across all
enrollments — it charts submissions that really happened, including on a track
the user was later removed from. Do not scope it by status.

## 4. Files to touch

| File | | Note |
|---|---|---|
| `src/features/enrollment/resolve-dashboard-enrollment.ts` | `[edit]` | Explicit id wins regardless of status; no cross-domain fallback. |
| `src/features/enrollment/create-core-enrollment.ts` | `[edit]` | Detect ABANDONED rows before `create`; add `"abandoned"` reason; `logger` not `console.error`. |
| `src/features/enrollment/create-claude-enrollment.ts` | `[edit]` | Same `"abandoned"` reason + `logger`. |
| `src/components/challenge/track-page.tsx` | `[edit]` | Deterministic domain lookup + comment. |
| `src/app/register/page.tsx` | `[edit]` | Deterministic gate, per-domain join, result handling, error redirects. |
| `src/features/dashboard/get-hub-data.ts` | `[edit]` | One enrollment query; `joinedDomains` + `abandonedDomains`; status-aware streaks. |
| `src/app/dashboard/page.tsx` | `[edit]` | Accept `searchParams`; render join notice; pass new props. |
| `src/components/dashboard-hub/continue-journey.tsx` | `[edit]` | Render COMPLETED cards distinctly. |
| `src/components/dashboard-hub/roadmaps.tsx` | `[edit]` | Three states: Continue / View status / Join. |
| `src/components/dashboard-hub/other-challenges.tsx` | `[edit]` | Hide when joined or abandoned; use the join button. |
| `src/components/dashboard-hub/join-claude-button.tsx` | `[new]` | Client button calling `enrollInClaudeChallenge()`. **The only new file in this plan.** |
| `src/app/claude-signup/page.tsx` | `[edit]` | Enrolled ⇒ `/claude`. |
| `src/features/landing/get-landing-state.ts` | `[edit]` | Claude CTA ⇒ `/claude`. |
| `src/app/program/apply/page.tsx` | `[edit]` | Remove both self-redirects. |
| `src/app/actions/registration-actions.ts` | `[edit]` | `revalidatePath("/dashboard")` on success. |

## 5. Server vs Client

| Component | | Note |
|---|---|---|
| `TrackPage` | Server | unchanged boundary |
| `RegisterPage` | Server | unchanged boundary |
| `DashboardPage` | Server | gains `searchParams: Promise<…>` |
| `ContinueJourney` | Server | props gain `status: "ACTIVE" \| "COMPLETED"` — plain string, safe |
| `Roadmaps` | Server | props gain `abandonedDomains: Domain[]` — plain enum strings, safe |
| `OtherChallenges` | Server | props gain `abandonedDomains`; renders the client button as a child |
| `JoinClaudeButton` | **Client** | `"use client"`; takes **no props** — no Server→Client boundary risk at all |
| `ProgramApplyPage` | Server | unchanged boundary |
| `RegistrationForm` | Client | unchanged |

No functions, icon components, or class instances cross a Server→Client boundary
anywhere in this plan.

## 6. Steps

### Step 1 — `src/features/enrollment/resolve-dashboard-enrollment.ts`

Replace the explicit-id block (`:42-53`) so an explicitly requested enrollment is
honoured whatever its status, and a miss returns `null` rather than substituting
another track:

```ts
const trimmed = enrollmentId?.trim();
if (trimmed) {
  // Caller named an enrollment (track pages pass the row for their own domain).
  // Honour it at ANY status — a COMPLETED or ABANDONED track must render its own
  // data, never silently fall back to a different domain.
  return prisma.enrollment.findFirst({
    where: { id: trimmed, userId },
    select: sessionEnrollmentSelect,
  });
}
```

Leave the no-id fallback chain (`:55-75`) exactly as it is. Update the JSDoc at
`:29-36` to state the new contract. `resolveChallengeEnrollment` in the same file
is **not** touched.

### Step 2 — `src/features/enrollment/create-core-enrollment.ts`

2a. Add `"abandoned"` to the `reason` union in `CreateCoreEnrollmentResult`.

2b. Change the existing-row check (`:56-70`) to cover **all** statuses, so the
guaranteed unique-constraint violation described in §2.4 can no longer happen:

```ts
const existing = await prisma.enrollment.findFirst({
  where: { userId, challengeId: challenge.id },
  select: { id: true, status: true },
});
if (existing?.status === EnrollmentStatus.ABANDONED) {
  return {
    ok: false,
    reason: "abandoned",
    message: "You were removed from this track and cannot re-join it.",
  };
}
if (existing) {
  return { ok: false, reason: "already_enrolled", message: "You are already enrolled in this track." };
}
```

2c. Replace `console.error` at `:86` with `logger.error("[enrollment] createCoreEnrollment failed", { error: String(e) })`, importing from `@/lib/logger` (project rule).

### Step 3 — `src/features/enrollment/create-claude-enrollment.ts`

Same three changes: add `"abandoned"` to the reason union, split the existing-row
check at `:48-61` so an ABANDONED Claude row returns `"abandoned"` with the
correct message instead of a misleading "already enrolled", and swap
`console.error` at `:77` for `logger.error`.

### Step 4 — `src/components/challenge/track-page.tsx`

Only the query at `:116-123` changes — add ordering and a comment. Behaviour is
already deterministic thanks to the unique constraint; this documents why and
protects against future schema drift:

```ts
// @@unique([userId, challengeId]) + unique Challenge.domain ⇒ at most one row
// per domain. Any status: COMPLETED renders its finished track, ABANDONED
// renders EnrollmentEndedScreen below.
const enrollmentForDomain = await prisma.enrollment.findFirst({
  where: { userId: session.user.id, domain },
  orderBy: { startedAt: "desc" },
  select: { id: true },
});
```

Do not touch anything else in this file. With Step 1 in place, the id passed at
`:133` now always resolves to this exact row, so `/ai` renders AI and the
ABANDONED branch at `:185` is reached deterministically.

### Step 5 — `src/app/register/page.tsx`

Replace lines `42-80` with the following shape. Read the guardrails in §7 before
writing this.

```ts
const profile = await prisma.studentProfile.findUnique({
  where: { userId: session.user.id },
  select: { id: true },
});

// Registration completeness gate: "has the user ever enrolled in anything",
// ANY status. Narrowing this would delete the profile of removed users.
const enrollmentCount = await prisma.enrollment.count({
  where: { userId: session.user.id },
});

if (profile && enrollmentCount > 0) {
  if (isCoreDomain(requestedDomain)) {
    const existing = await prisma.enrollment.findFirst({
      where: { userId: session.user.id, domain: requestedDomain },
      select: { id: true, status: true },
    });

    // D1: ABANDONED blocks this track only — other tracks stay joinable.
    if (existing?.status === "ABANDONED") {
      redirect(`/dashboard?joinBlocked=${requestedDomain}`);
    }

    if (!existing) {
      const result = await createCoreEnrollment(session.user.id, requestedDomain);
      if (!result.ok && result.reason === "abandoned") {
        redirect(`/dashboard?joinBlocked=${requestedDomain}`);
      }
      if (!result.ok && result.reason !== "already_enrolled") {
        redirect(`/dashboard?joinError=${result.reason}`);
      }
    }

    redirect(CORE_TRACK_PATH[requestedDomain]);
  }

  redirect("/dashboard");
}

if (profile && enrollmentCount === 0) {
  await prisma.studentProfile.delete({ where: { userId: session.user.id } });
}
```

The blanket `if (enrollment?.status === "ABANDONED") redirect("/dashboard")` at
`:51-53` is **deleted** — D1 replaces it with the per-domain check above.

### Step 6 — `src/features/dashboard/get-hub-data.ts`

6a. Export the row type the hub renders:

```ts
export type HubEnrollment = {
  id: string;
  domain: Domain;
  status: "ACTIVE" | "COMPLETED";
  challengeTitle: string;
  daysCompleted: number;
  currentStreak: number;
};
```

6b. `HubData`: replace `enrollments: UserEnrollmentSummary[]` with
`enrollments: HubEnrollment[]`, replace `allEnrollmentDomains: Domain[]` with
`joinedDomains: Domain[]`, and add `abandonedDomains: Domain[]`.

6c. Collapse the three enrollment queries at `:50-58` into **one** (this also
removes two round trips — consistent with plan 019):

```ts
prisma.enrollment.findMany({
  where: { userId },
  orderBy: { startedAt: "asc" },
  select: {
    id: true,
    domain: true,
    status: true,
    daysCompleted: true,
    currentStreak: true,
    longestStreak: true,
    challenge: { select: { title: true } },
  },
}),
```

Drop the `getUserActiveEnrollments` import from this file. **Leave
`src/features/enrollment/get-user-enrollments.ts` itself unchanged** — `TrackPage`
still uses it for the header's enrollment switcher, and that surface is not in
scope.

6d. Partition in JS after the `Promise.all`:

```ts
const joined = rows.filter(
  (r) => r.status === "ACTIVE" || r.status === "COMPLETED",
);

// ACTIVE first, then COMPLETED; startedAt asc within each group.
const enrollments: HubEnrollment[] = [
  ...joined.filter((r) => r.status === "ACTIVE"),
  ...joined.filter((r) => r.status === "COMPLETED"),
].map((r) => ({
  id: r.id,
  domain: r.domain,
  status: r.status as "ACTIVE" | "COMPLETED",
  challengeTitle: r.challenge.title,
  daysCompleted: r.daysCompleted,
  currentStreak: r.currentStreak,
}));

const joinedDomains = [...new Set(joined.map((r) => r.domain))];
const abandonedDomains = [
  ...new Set(rows.filter((r) => r.status === "ABANDONED").map((r) => r.domain)),
];

// D2: streaks from joined tracks only — an abandoned track must not inflate them.
let current = 0;
let longest = 0;
for (const r of joined) {
  current = Math.max(current, r.currentStreak);
  longest = Math.max(longest, r.longestStreak);
}
```

### Step 7 — `src/app/dashboard/page.tsx`

7a. Accept search params:

```ts
type PageProps = {
  searchParams: Promise<{ joinError?: string; joinBlocked?: string }>;
};
```

7b. Above the component, a plain message map — inline, no new file:

```ts
const JOIN_ERROR_MESSAGE: Record<string, string> = {
  no_user: "Your session expired. Please sign in again.",
  no_challenge: "That track isn't open yet. Please try again later.",
  internal_error: "We couldn't add that track. Please try again.",
};
```

7c. Resolve `searchParams`, build a `notice` string
(`joinBlocked` ⇒ `` `You were removed from the ${domain} track and can't re-join it.` ``;
`joinError` ⇒ the mapped message, ignoring unknown keys), and render it directly
above `<ContinueJourney>` when present — a plain server-rendered `<p>` inside a
bordered card using `HUB_CARD_HOVER_CLASS`-adjacent styling. No toast, no client
component.

7d. Update the three call sites at `:56-61`:

```tsx
<ContinueJourney enrollments={data.enrollments} />
<OtherChallenges
  joinedDomains={data.joinedDomains}
  abandonedDomains={data.abandonedDomains}
/>
<Roadmaps
  joinedDomains={data.joinedDomains}
  abandonedDomains={data.abandonedDomains}
  hasProgramMembership={data.hasProgramMembership}
/>
```

### Step 8 — `src/components/dashboard-hub/continue-journey.tsx`

Change the prop type from `UserEnrollmentSummary[]` to `HubEnrollment[]`
(imported from `@/features/dashboard/get-hub-data`). Inside the map, branch on
`e.status`:

- `COMPLETED` — subtitle `"Completed · 60 of 60"`, progress bar at 100%, button
  label `"View"`.
- `ACTIVE` — exactly what renders today.

Both still link to `TRACK_PATH[e.domain]`. No other change.

### Step 9 — `src/components/dashboard-hub/roadmaps.tsx`

Props become `{ joinedDomains, abandonedDomains, hasProgramMembership }`. Build
two `Set`s and give each of the three core cards one of three states:

| State | Label | Href |
|---|---|---|
| joined | `Continue` | `path` |
| abandoned | `View status` | `path` (renders `EnrollmentEndedScreen`) |
| neither | `Join` | `` `/register?domain=${domain}` `` |

The "Join" href changes from `/challenges` to `/register?domain=…` — that is the
route Step 5 turns into a working one-click join for signed-in users;
`/challenges` is the logged-out marketing page. The AI Prep Kit section below is
untouched.

### Step 10 — `src/components/dashboard-hub/other-challenges.tsx`

Props become `{ joinedDomains, abandonedDomains }`. Show the Claude card only
when `isClaudeEnabled() && !joined.has("CLAUDE") && !abandoned.has("CLAUDE")`.
Replace the `<Link href="/claude-signup">` at `:45-48` with `<JoinClaudeButton />`.

### Step 11 — `src/components/dashboard-hub/join-claude-button.tsx` `[new]`

Client component, no props:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { enrollInClaudeChallenge } from "@/app/actions/enrollment-actions";
import {
  HUB_ARROW_HOVER_CLASS,
  HUB_TEXT_LINK_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

export function JoinClaudeButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleJoin() {
    setPending(true);
    try {
      const result = await enrollInClaudeChallenge();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Welcome to the Claude Challenge!");
      router.push("/claude");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleJoin}
      disabled={pending}
      className={cn(HUB_TEXT_LINK_CLASS, "mt-4 disabled:opacity-60")}
    >
      {pending ? "Joining…" : "Join"}
      <ArrowRight className={HUB_ARROW_HOVER_CLASS} aria-hidden />
    </button>
  );
}
```

`<Toaster />` is already mounted globally (`src/app/layout.tsx:76`), and
`enrollInClaudeChallenge` already calls `revalidatePath("/dashboard")`. No server
action changes needed.

### Step 12 — `src/app/claude-signup/page.tsx`

At `:42`, redirect an already-enrolled user to `/claude` instead of
`/dashboard?challenge=${claudeEnrollment.id}` (the hub no longer reads that
param). The two branches below (`:44` and `:47`) stay as they are — with Step 10
the dashboard Join button is the entry point for existing users, so
`/claude-signup` no longer needs to enroll anyone, and this page performs no
writes.

### Step 13 — `src/features/landing/get-landing-state.ts`

Same stale link at `:75` — change the `claudeCta` href to `"/claude"`. One line;
nothing else in the file changes.

### Step 14 — `src/app/program/apply/page.tsx`

14a. Delete the self-redirect at `:44-47`.

14b. Delete the `intro` self-redirect at `:146-149`.

14c. Fold both screens into the existing legacy status card at `:130-144`:

```tsx
// Assessment quiz removed. `in_progress` / `intro` / `cooldown` / `failed` are
// unreachable while the entry bypass is on; render a terminal status card rather
// than redirecting to this same route (that would be an infinite loop).
if (
  state.screen === "in_progress" ||
  state.screen === "intro" ||
  state.screen === "cooldown" ||
  state.screen === "failed"
) {
```

After 14b the `form` branch is the final fall-through, so TypeScript still
narrows `state` correctly for `state.joinCode` / `state.cohortName` at `:156-173`.
`src/features/program/entry.ts` is **not** modified. `/program/page.tsx` keeps
mapping `in_progress` / `intro` to "Continue application" → `/program/apply`,
which now renders the status card instead of looping.

### Step 15 — `src/app/actions/registration-actions.ts` (D3)

Add `revalidatePath("/dashboard")` immediately before the final
`return { ok: true as const }` at `:149`, importing `revalidatePath` from
`next/cache`. `registration-form.tsx` is **not** changed — it keeps
`router.push("/dashboard")` at `:278`, and the new ACTIVE enrollment now shows
under "Continue your journey" on arrival with no stale-cache window.

## 7. Guardrails for Cursor (DO NOT)

- **DO NOT** narrow the enrollment query that guards the `StudentProfile.delete`
  in `register/page.tsx`. It must count rows of **every** status. Scoping it to
  ACTIVE would delete the profile of every removed user who opens `/register`.
- **DO NOT** put any `redirect()` call inside a `try`/`catch` — `redirect()`
  works by throwing.
- **DO NOT** modify `src/features/program/entry.ts`. Finding #1 is fixed entirely
  in the page component.
- **DO NOT** change `isProgramEntryBypassEnabled()`.
- **DO NOT** modify `getUserActiveEnrollments` in
  `src/features/enrollment/get-user-enrollments.ts` — `TrackPage` and the header
  switcher depend on its current ACTIVE-only shape.
- **DO NOT** touch `resolveChallengeEnrollment` (same file as Step 1) — the
  challenge/submission flows depend on its non-ABANDONED semantics.
- **DO NOT** scope `getActivityHeatmap` by status (§3).
- **DO NOT** add any file other than
  `src/components/dashboard-hub/join-claude-button.tsx`. No new helper modules,
  no shared "enrollment status" utility — the partition logic is six lines and
  belongs inline in `get-hub-data.ts`.
- **DO NOT** convert `OtherChallenges`, `Roadmaps`, or `ContinueJourney` to
  client components. Only the new join button is `"use client"`.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>`; the hub uses
  `HUB_TEXT_LINK_CLASS` / `dsButtonVariants()` directly on the element.
- **DO NOT** add `console.error` anywhere — `logger` from `@/lib/logger`.
- **DO NOT** add a `select`-less Prisma query.
- No schema changes, no migration, no seed. If you believe you need one, stop.

## 8. Verification

**No DB safety section: this plan contains zero schema changes, migrations, or
data backfills.** Every fix is read-path logic. Still commit before starting so
the register-page edit is trivially revertible.

Build gate: `npx tsc --noEmit` clean, `npm run build` clean. Expect TS errors
until Steps 6–10 are all done — `HubData`'s renamed field breaks
`dashboard/page.tsx` and the three hub components in the same pass; that is the
intended safety net.

Manual test matrix — seed or hand-build these users:

| # | Setup | Expected |
|---|---|---|
| 1 | COMPLETED AI + ACTIVE DS | `/ai` shows **AI** data (heatmap, streak, day counter); `/ds` shows DS. Before the fix `/ai` showed DS. |
| 2 | ABANDONED AI only | `/ai` shows `EnrollmentEndedScreen` with the admin's reason (unchanged behaviour, now deterministic). |
| 3 | ABANDONED AI + ACTIVE DS | `/dashboard` shows DS under Continue; AI card reads **View status**; `/register?domain=SE` **joins SE** and lands on `/se`. Before the fix this bounced to `/dashboard`. |
| 4 | ABANDONED AI | `/register?domain=AI` → `/dashboard?joinBlocked=AI` with the notice. No unique-constraint error in logs. |
| 5 | COMPLETED AI | Dashboard shows AI as "Completed · 60 of 60 / View"; no AI **Join** card. Streak card reflects only ACTIVE + COMPLETED. |
| 6 | ACTIVE AI, no Claude | Claude **Join** card appears; clicking it enrolls and lands on `/claude`; card is gone on return. Before the fix it dead-ended on `/dashboard`. |
| 7 | ABANDONED Claude | No Claude Join card. |
| 8 | Fresh user | Register with DS → lands on `/dashboard` → DS visible under Continue your journey **without a manual refresh**. |
| 9 | Program applicant (any state) | `/program/apply` renders a card. Load it 3× — never a redirect loop. `/program` CTA → `/program/apply` renders, no loop. |
| 10 | Regression | `/challenge/today?challenge=<id>` and the header enrollment switcher behave exactly as before. |

For #4, temporarily flipping a test enrollment to ABANDONED in a Neon branch is
the cheapest setup; do not do this against production data.

Files that should show in `git status` when done — exactly the 15 in §4, no
others.

## 9. Commit message

```
fix(enrollment): make multi-enrollment lookups status-aware

Track pages resolved an explicitly requested enrollment only when ACTIVE and
otherwise fell back to the oldest active enrollment, so /ai could render DS
data for users with historical enrollments. Honour an explicitly requested
enrollment at any status and stop falling back across domains.

- /register?domain=X: per-domain join check instead of an unordered findFirst
  over all enrollments; ABANDONED now blocks only its own track
- surface createCoreEnrollment failures instead of redirecting into a dead end;
  detect ABANDONED rows before create (was a guaranteed unique violation)
- dashboard hub: join/continue cards and streaks from ACTIVE + COMPLETED only,
  in one query instead of three; abandoned tracks show "View status"
- Claude "Join" card now enrolls via the server action instead of bouncing to
  /dashboard without creating an enrollment
- /program/apply: render a status card for in_progress/intro instead of
  redirecting to itself
```
