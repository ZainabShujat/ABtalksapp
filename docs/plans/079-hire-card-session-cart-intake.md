# Plan 079 — Readable cards, guest session restore, fewer questions, cart back

> **Branch:** `fix/hire-scout-conversation`
> **Trigger:** after the Claude/60-day/hackathon pool went live, recruiters
> reported four things at once: card type is too small, “Back to the
> requirement” opens a blank Scout, the bot asks too many questions, and
> Add to cart is gone.
> **Owner ask:** dive deep, plan only, change nothing that already works.

---

## 1. Goal

Four product holes, one careful pass:

1. Match cards must be readable (type size).
2. A guest who searches, opens “View N more”, then hits **Back to the
   requirement** must land on the *same* Scout turn, not a new chat.
3. Default intake must ask fewer questions. A stated pool brief must still
   skip the form entirely (plan 078).
4. **Add to cart** must show and work on Claude / 60-day / hackathon cards,
   not only US-cohort `ProgramMember` rows.

Nothing else moves: OTP, seats, `requireRecruiter`, Request intro,
signed-in `/hire/[requestId]`, PROGRAM shortlist FK, scoring, pool-brief
parser.

---

## 2. Current behaviour (verified in code)

### 2.1 Cards look small

`src/components/hire/match-card.tsx` — chips `text-xs`, track/tier/stat
labels `text-[11px]`, coverage and disclaimers `text-[11px]`. Title
(`text-lg`) and score (`text-3xl`) are fine. Only this file.

### 2.2 “Back to the requirement” is a new chat

| Surface | Link | What loads |
|---|---|---|
| Guest `/hire/matches` | `href="/hire"` | `HirePage` always mounts `ScoutChat` with `initialMessages={[]}` `initialSpec={{}}` |
| Signed-in `/hire/[id]/candidates` | `href=/hire/${requestId}` | Real request — this path is fine |

Guest chat state lives in React `useState` only. Matches are in
`sessionStorage` (`abtalks-hire-guest-matches`). Spec + transcript are
not. So back-nav correctly reloads matches *if they go to `/hire/matches`*,
and correctly wipes the conversation on `/hire`.

“New search” already resets in-memory state. That must stay the wipe.

Signed-in recruiters already persist via `TalentRequest` +
`/hire/[requestId]`. **Do not** write guest storage over that path
(`persist === true`).

### 2.3 Ten questions

`HIRE_SLOTS` in `src/lib/validations/hire.ts`:

`title → seniority → mustHaveStack → evidencePriority → salary →
employmentType → workMode → locationCity → noticePeriodDays → experience`

Plan 078 already calls `skipUnfilledIntake` when the first message is a
searchable brief. The long form only runs when they start with a role
(“backend engineer”) or tap chips. Those six later slots are the grind.

### 2.4 Cart vanished — not a CSS bug

`MatchCard` only renders `ShortlistButton` when `match.programMemberId`
is set:

```tsx
{match.programMemberId && (
  <ShortlistButton memberId={match.programMemberId} … />
)}
```

Plan 077 made that deliberate: `RecruiterShortlistItem.memberId` is a
**hard FK to `ProgramMember`**. Claude / 60-day / hackathon have
`programMemberId: null`. After those pools became the default search,
almost every card lost the button. Request intro still works (it uses
`candidateRef`).

`ShortlistCart` checkout still does
`encodeCandidateRef("PROGRAM", memberId)` for every row. Putting a
Claude `userId` into `memberId` would either fail the FK or address the
wrong person. **Never do that.**

Guest cart is `localStorage` keyed on `memberId`. Merge-on-signin calls
`ensureShortlisted(userId, memberId)` — PROGRAM only.

---

## 3. Files to touch

| File | New / edit | Note |
|---|---|---|
| `src/components/hire/match-card.tsx` | edit | Type scale; always show cart when `candidateRef` exists |
| `src/components/talent/shortlist-button.tsx` | edit | Accept `candidateRef`; PROGRAM stays on the existing action |
| `src/components/hire/guest-cart.ts` | edit | Key on `candidateRef`; read old `memberId` rows as `PROGRAM:<id>` |
| `src/components/hire/guest-cart-view.tsx` | edit | Pass `candidateRef` through |
| `src/components/hire/shortlist-cart.tsx` | edit | Checkout uses stored `candidateRef`, never force `PROGRAM` |
| `src/components/hire/hire-chrome.tsx` | edit | Approved count = DB PROGRAM + local non-PROGRAM (no double count) |
| `src/app/talent/shortlist/page.tsx` | edit | Approved page unions DB rows + local non-PROGRAM rows |
| `src/components/hire/merge-guest-cart.tsx` | edit | Merge only `PROGRAM:` refs into DB; leave the rest in localStorage |
| `src/components/hire/scout-chat.tsx` | edit | Persist / restore guest session; New search clears it |
| `src/components/hire/guest-session.ts` | **new** | `sessionStorage` for guest spec + transcript + flags |
| `src/features/hire/scout-conversation.ts` | edit | Apply default-skipped slots on every turn |
| `src/lib/validations/hire.ts` | edit | Export `DEFAULT_SKIPPED_SLOTS` only — **do not remove** `HIRE_SLOTS` |
| `src/features/hire/score-candidate.test.ts` | edit | Default-skip + cart-ref decode cases (pure) |
| `docs/CHANGELOG.md` | edit | One pending-reconcile line |
| `docs/plans/079-hire-card-session-cart-intake.md` | this file | — |

No Prisma, no migration, no `src/auth.ts`, no middleware.

---

## 4. Server vs Client

| Piece | Where |
|---|---|
| Card type + cart button | Client (`MatchCard`, `ShortlistButton`) |
| Guest session + guest cart | Client (`sessionStorage` / `localStorage`) |
| Default-skipped slots | Server (`runScoutTurn`) so chips and `nextSlot` agree |
| PROGRAM toggle / merge | Existing server actions — unchanged signature for `memberId` |
| Request intro / bulk request | Already `candidateRef` — unchanged |

No new Server→Client function/icon props. `candidateRef` is already a
string on the card.

---

## 5. Steps

### 5.1 Card type — `match-card.tsx` only

Bump, do not redesign:

- Chip row: `text-xs` → `text-sm`
- Track / tier / “out of 100” / detail headings: `text-[11px]` → `text-xs`
- Coverage + disclaimers: `text-[11px]` → `text-xs`
- Leave title `text-lg` and score `text-3xl`
- Leave padding and chip colours (including stack highlight from 078)

Also fix the list key in `match-results.tsx` while there:
`${m.programMemberId ?? "unknown"}-${i}` collides when every Claude card
has a null member id. Use `m.candidateRef` (already unique). Display-only.

### 5.2 Guest session restore

New `guest-session.ts` (mirror `guest-matches-store.ts`):

```ts
type GuestScoutSession = {
  spec: JobSpec;
  messages: { role: "user" | "assistant"; content: string; options?: … }[];
  summary: string;
  readyToSearch: boolean;
  searched: boolean;
};
```

`sessionStorage` key `abtalks-hire-guest-session`. Same-tab back-nav only.
Not `localStorage` (shared computers). No names — cards already have none.

`ScoutChat` when `persist === false`:

1. On mount (`useEffect`, after paint — avoid hydration mismatch): if a
   session exists, hydrate spec / messages / summary / flags. Re-read
   matches from `readGuestMatches()` so we do not duplicate that blob.
2. After every successful guest turn and every guest search, write the
   session.
3. **New search** (existing button): clear session + matches, then reset
   state as it does today.
4. `persist === true` (signed-in `/hire/[requestId]`): do not read or
   write this key.

`/hire/matches` “Back to the requirement” stays `href="/hire"`. `/hire`
now hydrates. Do not invent a new route.

`HirePage` stays a server component with empty initials. Hydration is
client-side, same pattern as `GuestMatchesPage`.

### 5.3 Fewer questions — skip, do not delete

Do **not** remove entries from `HIRE_SLOTS`. Deleting them breaks
`isSlotFilled`, `hireProgress`, `applyUnderstood`, saved `extra.skipped`,
and the standing “Change the budget” chip.

Export:

```ts
export const DEFAULT_SKIPPED_SLOTS: HireSlot[] = [
  "evidencePriority",
  "employmentType",
  "workMode",
  "locationCity",
  "noticePeriodDays",
  "experience",
];
```

`applyDefaultSkipped(spec)` at the **top** of `runScoutTurn`, before
`nextSlot`:

- If a slot is already filled, leave it (old requests / typed “remote”).
- If already in `extra.skipped`, leave it.
- Otherwise append it to `extra.skipped`.

What they still get asked, in order: **role → seniority → stack →
budget** (budget already has Skip). Then search.

Plan 078 `skipUnfilledIntake` on a searchable brief still skips the rest,
including these. No change to that branch.

Gender / IIT / city refuses unchanged. AI may still *write* workMode if
they type “remote”; skipped only means we do not *ask*.

Client `OPENING` in `scout-chat.tsx` stays the role question. Do not add
new chips there.

### 5.4 Cart on every source — no schema

**Invariant:** never write a Claude / 60-day / hackathon id into
`RecruiterShortlistItem.memberId`.

Guest cart item becomes:

```ts
type GuestCartItem = {
  candidateRef: string; // PROGRAM:… | CLAUDE:… | CHALLENGE_60:… | HACKATHON:…
  jobRole: string;
  totalScore: number;
};
```

Read path: if a stored row still has `memberId` and no `candidateRef`,
treat it as `PROGRAM:${memberId}` so in-flight guest carts survive.

`ShortlistButton`:

- Required: `candidateRef`, `jobRole`, `totalScore`
- Optional: `programMemberId`
- `!approved` → always `toggleGuestCart` by `candidateRef`
- `approved && programMemberId` → existing `toggleShortlistAction({ memberId })`
- `approved && !programMemberId` → same guest localStorage (signed-in
  overlay). Do not call `toggleShortlistAction`

`MatchCard`: render the button whenever `match.candidateRef` is set
(always). Pass both ids. Keep Request intro as the second action.

`ShortlistCart` / `CartRow`: add `candidateRef`. Checkout and pending
checkout use that string. **Delete** the
`encodeCandidateRef("PROGRAM", id)` mapping on this path.

Approved `/talent/shortlist`:

- DB rows from `getShortlist` → `candidateRef = PROGRAM:${memberId}`
- Plus localStorage rows whose ref is **not** `PROGRAM:`
- Do not list a PROGRAM ref twice

`mergeGuestCart`:

- `PROGRAM:` refs → existing `ensureShortlisted` (strip prefix → memberId)
- other refs stay in localStorage
- Do not send Claude ids to `ensureShortlisted`

`hire-chrome` count:

- Guest: `readGuestCart().length`
- Approved: `serverCartCount +` localStorage non-PROGRAM length

Request intro and `placeBulkEngagementRequestAction` already resolve
`candidateRef` against the right table. Do not touch them.

`/talent/members/[id]` `ShortlistButton` is PROGRAM-only — pass
`encodeCandidateRef("PROGRAM", id)` and keep `memberId`. That page is
unchanged for students.

---

## 6. Guardrails for Cursor (DO NOT)

- Do **not** migrate. Do **not** make `RecruiterShortlistItem.memberId`
  nullable in this pass.
- Do **not** put a `User.id` or enrollment id into `memberId`.
- Do **not** remove or reorder `HIRE_SLOTS`. Only default-skip.
- Do **not** skip `title`, `seniority`, `mustHaveStack`, or `salary`.
- Do **not** write guest session when `persist === true`.
- Do **not** make “New search” restore the old session.
- Do **not** change middleware, `auth.ts`, OTP, seats, `requireRecruiter`.
- Do **not** hide Request intro, View, or the header Cart link.
- Do **not** change scoring, pool-brief, or which pool a prompt searches.
- Do **not** invent cities, names, or colleges on cards.
- Do **not** add new abstraction files beyond `guest-session.ts`.
- When a type error contradicts this plan, trust the error.

---

## 7. DB safety

None. No schema, no migration, no seed. Guest cart / session are browser
storage only.

---

## 8. Verification

Manual, guest first, then an approved recruiter. Do not declare done on
a screenshot.

**Cards**

1. Run “india claude challenge 30 days only 5”. Chips and track label
   larger than today, still one card width, no wrap explosion on a phone
   viewport.
2. Same on a PROGRAM card and a hackathon card.

**Session**

3. Guest: search, confirm inline results, click **View N more**, then
   **Back to the requirement**. Transcript, spec pill, and results
   section must still be there — not “What role are you hiring for?”.
4. Click **New search**. Blank opening question. `/hire/matches` empty.
5. Signed-in `/hire/[requestId]`: refresh still loads DB messages. Guest
   session must not overwrite it.

**Questions**

6. New guest chat, type `backend engineer` (no pool brief). Next
   questions: seniority → stack → budget. Stop. No evidence / engagement
   / city / notice / experience chips.
7. Type `students from india who has done claude challenge for atleast
   30 days only 5`. Still searches immediately, no form restart (078).
8. Type `female candidates from india`. Still hard no, nothing written.

**Cart**

9. Guest Claude card: **Add to cart** visible. Click → toast, header
   Cart badge 1, `/talent/shortlist` shows that AB-####.
10. Remove from cart → badge 0.
11. Guest PROGRAM card (US cohort search): still adds; after sign-in,
    merge still copies PROGRAM rows into `RecruiterShortlistItem`.
12. Guest Claude card in cart, then sign-in: Claude row still in cart
    (localStorage), **not** inserted into `RecruiterShortlistItem`.
    Checkout still places a `TalentEngagementRequest` via `candidateRef`.
13. Approved recruiter, US-cohort card: existing DB shortlist path
    unchanged (add / remove / note / request).
14. `/talent/members/[id]` star/cart still works for a program member.

**Must still pass**

- `npx tsx src/features/hire/score-candidate.test.ts`
- `npx tsc --noEmit` if the executor’s machine can run it
- Files changed = the list in §3, nothing under `src/auth.ts`,
  `middleware.ts`, `prisma/`

---

## 9. Commit message

```
fix(hire): readable cards, restore guest session, shorter intake, cart on every track

Claude cards hid Add to cart because the button required a ProgramMember
id. Back-to-requirement remounted an empty Scout. Intake still walked
ten slots when the recruiter only named a role.

Cards bump chip/label type one step. Guest spec+transcript persist in
sessionStorage and hydrate /hire. Six low-value slots are default-
skipped, not deleted. Cart keys on candidateRef; ProgramMember FK is
untouched.
```
