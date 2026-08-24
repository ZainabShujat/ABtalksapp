# 081 — Sample cards for unmet demand, and chips that follow the conversation

> **Implementer: Grok.** Read §0 before writing a line. This plan touches a
> working hiring surface; the constraints in §9 are not suggestions.

## 0. Read this first

**What you are building — two things, one goal.**

1. **Sample cards.** When a real search returns nothing, show illustrative cards
   built from the recruiter's own stated requirement, so the conversation ends
   with something concrete instead of a blank page — and so the recruiter can
   send a request that tells ABTalks exactly what they wanted.
2. **Adaptive chips.** The quick-reply pills under the chat are a fixed set
   today. Make them follow what Scout actually just asked.

**The point of the sample card is demand capture, not decoration.** The owner's
words: *"request ho sake tabhi hame pata chalega ki recruiter ki requirement kya
hai aur ham unke requirement ko pura kar sake."* So the request button on a
sample card is the feature. What must never happen is a recruiter believing a
sample card is a real person.

**Before you write anything**, read these files end to end. They are the ones
you will touch or must not break:

```
src/components/hire/match-card.tsx        the card contract + every action on it
src/components/hire/match-results.tsx     the list renderer
src/components/hire/scout-chat.tsx        the chat, the chips, the empty state
src/features/hire/scout-chips.ts          suggestChips — chips today
src/features/hire/to-public-match.ts      the one mapper that strips identity
src/features/hire/candidate-ref.ts        encode/decodeCandidateRef + the whitelist
src/app/actions/hire-actions.ts           runMatchAction, requestCohortTrainAction
src/app/actions/hire-guest-actions.ts     runGuestMatchAction (writes nothing)
src/features/hire/demand-board.ts         what admin already sees
prisma/schema.prisma                      model TalentRequest (lines 984-1014)
```

## 1. Goal

Turn an empty result into a captured requirement, and make the chips reflect the
question on screen.

## 2. What already exists — do not rebuild it

This is the most important section. Roughly 70% of the demand-capture machinery
is already in the repo, and a from-scratch implementation would duplicate it.

| Already built | Where | Use it for |
|---|---|---|
| The full requirement, persisted | `TalentRequest` — title, seniority, `mustHaveStack`, `niceToHaveStack`, salary, `minExperience`/`maxExperience`, `workMode`, `extra` | The sample card reads from this; the request writes to it |
| "Tell me when someone like this exists" | `TalentRequest.alertWhenAvailable` | The sample-card request sets this |
| An action that already does exactly that | `requestCohortTrainAction` in `hire-actions.ts:480` | **Reuse. Do not write a new action for the signed-in path.** |
| Aggregated unmet demand for admin | `getDemandBoard()` → `/admin/hire` | The requests you capture appear here already, grouped by stack token |
| Guest → sign-in → place the request they already clicked | `pending-checkout.ts` + `MergeGuestCart` | The guest path for the sample card |
| An identity-stripping mapper | `toPublicMatch()` | The shape a card must arrive in |
| A ref whitelist that rejects unknown sources | `decodeCandidateRef` → `isKnownTrack` | **The safety this whole feature rests on — see §4.1** |

Verified: `decodeCandidateRef("SAMPLE:abc")` returns `null` today, while
`decodeCandidateRef("PROGRAM:abc")` resolves. That is not an accident to work
around; it is the guarantee to build on.

## 3. Current behaviour

**Chips.** `suggestChips(spec, ready)` in `scout-chips.ts` returns one of five
fixed sets, chosen by the first unfilled field in a fixed order (stack →
seniority → salary), plus a `readyChips()` set once a search is possible. The
model has no say in them. If Scout asks something outside that ladder — "which
evidence matters most to you?" — the chips underneath still say *Change the
stack / Change the budget*, which is what the owner is complaining about.

**Empty result.** `scout-chat.tsx:734` renders a lone "Train this cohort for me"
button for signed-in recruiters, and `scout-chat.tsx:765` renders the words
*"No matches yet"* for guests. A recruiter who has just described a role in
detail gets a sentence and a dead end.

**Guest demand is not captured at all.** `hire-guest-actions.ts:92` says so in a
comment: *"Nothing is written — a guest search is not demand."* That is a
deliberate past decision and it directly blocks the owner's goal. §6 resolves it
through the existing pending-checkout rail rather than by writing guest rows.

## 4. Design

### 4.1 The safety the whole feature rests on

A sample card carries `candidateRef: "SAMPLE:<uuid>"`.

Because `decodeCandidateRef` validates the prefix against the track registry and
`SAMPLE` is not a track, **every existing consumer already refuses it**:

- `guestCartProgramIds()` skips it → it can never enter a merge
- `resolveEligibleCandidates()` cannot resolve it → no engagement row
- `placeEngagementRequestAction` rejects it → no introduction
- `refPublicId()` returns `AB-????` → no fake reference id that looks real

You get this for free. **Do not add `SAMPLE` to the registry, and do not relax
the whitelist.** If a sample card ever needs to be actionable, that action goes
through the demand path in §6, never the candidate path.

### 4.2 What a sample card shows

Everything on it comes from the recruiter's own words, already parsed into the
spec. Nothing is invented about a person, because there is no person.

For *"python developer, 8 years experience, ML also"*:

```
┌─────────────────────────────────────────────────────┐
│  SAMPLE PROFILE · nobody is being shown here        │  ← permanent banner
│                                                     │
│  Python developer                                   │  ← spec.title
│  8+ years · ML                                      │  ← experience + niceToHave
│                                                     │
│  You asked for:  python · ml                        │  ← spec.mustHaveStack
│                                                     │
│  This is what a match would look like. Nobody in    │
│  the pool fits it yet.                              │
│                                                     │
│  [ Tell ABTalks I need this ]                       │  ← the demand button
└─────────────────────────────────────────────────────┘
```

**Rules for the content, all mandatory:**

- No score, no tier, no rank number. Those are rankings of real evidence.
- No mission counts, commit days, project scores or interview figures — not even
  plausible ones. The card states the *requirement*, never fabricated evidence.
- No `AB-####` reference id. That format means a real person.
- The banner is not dismissible and not a tooltip.

### 4.3 Adaptive chips

Two changes, and the second matters more:

**(a) Fixed sets stay as the fallback.** They are correct when Scout is asking a
standard question, and they cost nothing.

**(b) The agent may supply its own chips.** Add a seventh tool,
`offer_options`, that Scout calls when it asks something the fixed ladder does
not cover. The tool takes 2–4 short labels and a value for each, validates them
(length, count, no protocol prefixes it does not own), and stores them on the
turn context. `turnFor` prefers agent-supplied chips when present.

This is the honest fix. Deriving chips from another keyword map would move the
problem rather than solve it: the model is the only thing that knows what it just
asked.

## 5. Files to touch

| Path | | Note |
|---|---|---|
| `src/features/hire/sample-card.ts` | **[new]** | Build a `MatchCardData`-shaped sample from a `JobSpec`. Pure — no DB, no model, no `server-only`. |
| `src/components/hire/sample-card-notice.tsx` | **[new]** | The banner + demand button. Client. |
| `src/components/hire/match-card.tsx` | [edit] | Accept `variant: "real" \| "sample"`. In sample mode: hide score, tier, evidence stats, shortlist, intro button and the member link; render the banner. **Change nothing about the real path.** |
| `src/components/hire/match-results.tsx` | [edit] | Accept `samples?: MatchCardData[]`. Render them only when `matches.length === 0`. Never interleave. |
| `src/components/hire/scout-chat.tsx` | [edit] | On a search with zero matches, build samples from `spec` and pass them down. Replaces the bare "No matches yet". |
| `src/features/hire/scout-chips.ts` | [edit] | `suggestChips` takes an optional `agentChips` and prefers it. |
| `src/features/hire/scout-tools.ts` | [edit] | Add the `offer_options` tool (seventh). |
| `src/features/hire/scout-agent.ts` | [edit] | Carry `ctx.offeredChips` out of the agent result. |
| `src/features/hire/scout-conversation.ts` | [edit] | Pass agent chips into `suggestChips`. |
| `src/lib/validations/hire.ts` | [edit] | Zod schema for `offer_options` args. `scoutTurnSchema` **unchanged**. |
| `src/app/actions/hire-actions.ts` | [edit] | One small action: `recordSampleDemandAction` (§6). |
| `src/features/hire/sample-card.test.ts` | **[new]** | Offline tests. |

**No schema change. No migration. No seed.** `TalentRequest` already holds
everything.

## 6. The request path — how demand is actually captured

This is the feature. Two cases.

**Signed-in recruiter.** There is already a `TalentRequest` row for the
conversation (`sendScoutMessageAction` creates it). The sample-card button calls
a new thin action `recordSampleDemandAction(requestId)` which:

- sets `alertWhenAvailable = true` and `status = ACTIVE` (same as
  `requestCohortTrainAction`)
- writes one `TalentRequestMessage` with `role: "system"` recording that the
  demand came from a sample card, so admin can tell it apart from a normal ask
- returns `{ ok: true }`

It appears on `/admin/hire` and in `getDemandBoard()` **with no further work** —
the board groups by `mustHaveStack` token, which is exactly the requirement.

*You may prefer to just call `requestCohortTrainAction` and skip the new action.
Do not: it is gated on `requireApprovedRecruiter`, and a pending recruiter is
precisely who we want to hear from. Copy its body, gate on
`requireRegisteredRecruiter` instead (already exists in
`hire-request-actions.ts:48`), and log the source.*

**Guest.** There is no `TalentRequest` and guests write nothing. Do **not**
change that. Instead reuse the existing rail:

1. Guest clicks the button on a sample card.
2. Save the spec to localStorage under a new key
   `abtalks-hire-pending-demand`, modelled exactly on `pending-checkout.ts`.
3. Send them to register/sign in — the same flow the cart already uses.
4. `MergeGuestCart` (which already runs post-sign-in on `/hire` and `/talent`)
   reads the pending demand, creates the `TalentRequest` via the action above,
   clears the key.

Reuse `pending-checkout.ts` as the template — same shape, same guards, same
storage discipline. Do not invent a second mechanism.

## 7. Steps

**Step 1 — `sample-card.ts`.** Export
`buildSampleCards(spec: JobSpec, count?: number): MatchCardData[]`.

- Returns `[]` when the spec has neither a title nor a stack. A sample card with
  nothing in it is worse than an empty state.
- Default `count` 1. Cap at 3. These are illustrations, not a list.
- `candidateRef: \`SAMPLE:${crypto.randomUUID()}\`` — new each call.
- `programMemberId: null`, `score: 0`, `tier: "NONE"`, `evidence: { skills: spec.mustHaveStack ?? [] }`, `rationale: null`, `gaps: []`.
- `jobRole` from `spec.title`; when absent, derive from the stack
  (`"Python developer"`), never "Candidate".
- When `count > 1`, vary only the *emphasis order* of the stated skills. Do not
  invent different people.

**Step 2 — `sample-card-notice.tsx`.** The banner and the button. Copy exactly:

> **Sample profile.** Nobody in the pool matches this yet. Tell us and we'll
> find or train someone — you'll hear from us when they exist.

Button label: **Tell ABTalks I need this**. On success, replace the button with
*"Noted — we'll be in touch."* Never a toast that vanishes; this is the moment
the recruiter's intent was captured and they should see it persist.

**Step 3 — `match-card.tsx`.** Add `variant?: "real" | "sample"` defaulting to
`"real"`. Guard the sample branch at the top of the component and return early
with a distinct, simpler card. **Do not thread conditionals through the existing
render** — a `variant === "sample"` check inside twelve places is how the real
card breaks.

**Step 4 — `match-results.tsx`.** Add `samples?: MatchCardData[]`. Render only
when `matches.length === 0`. Keep them in a separate `<ul>` with its own heading
so they can never read as results.

**Step 5 — `scout-chat.tsx`.** Both paths (signed-in `runMatchAction`, guest
`runGuestMatchAction`) already know `matchCount`. When it is 0 and the spec has
content, call `buildSampleCards(spec)` and pass to `MatchResults`. Leave the
existing "Train this cohort for me" button where it is — it serves approved
recruiters on the request page and is not what you are replacing.

**Step 6 — `offer_options` tool.** In `scout-tools.ts`:

```
name: "offer_options"
args: { options: { label: string; value: string }[] }   // 2–4
```

Validate: 2–4 items, label ≤ 40 chars, value ≤ 120, reject any value starting
`action:` / `edit:` / `skip:` / `salary:` (those are engine protocol and the
model must not forge them). Store on `ctx.offeredChips`. Description must say:
*"Call this when you ask something the standard quick replies do not cover. The
recruiter can always type instead."*

**Step 7 — thread the chips.** `scout-agent.ts` returns `offeredChips`;
`scout-conversation.ts` passes them into `suggestChips(spec, ready, agentChips)`;
`suggestChips` returns them when non-empty, else the existing sets. `isChipValue`
must accept an agent-supplied value or tapping it will fall through to the model.

**Step 8 — `recordSampleDemandAction`** per §6.

**Step 9 — guest pending-demand** per §6.

**Step 10 — tests** per §8.

## 8. Testing — you own this, and it must be evidence

Run every command and paste real output. "Should work" is not a result.

**Offline, no network, no database** — `src/features/hire/sample-card.test.ts`,
in the style of `scout-agent.test.ts` (plain `tsx`, `assert`, a pass count). Add
`"test:sample": "NODE_OPTIONS=--conditions=react-server tsx src/features/hire/sample-card.test.ts"`.

Assertions, all required:

1. `buildSampleCards({})` → `[]`
2. `buildSampleCards({ title: "Python developer", mustHaveStack: ["python","ml"], minExperience: 8 })` → 1 card whose `evidence.skills` is exactly `["python","ml"]`
3. Every ref matches `/^SAMPLE:/`
4. **`decodeCandidateRef(card.candidateRef) === null`** — the safety property
5. `guestCartProgramIds([sampleAsCartItem])` → `[]`
6. No sample card carries a non-zero `score`, a `tier` other than `"NONE"`, a `programMemberId`, or any of `missionsPassed` / `commitDayCount` / `projectScores`
7. `count: 5` is capped at 3
8. `offer_options` rejects 1 option, rejects 5, rejects `value: "action:search"`, accepts 3 valid ones
9. `suggestChips(spec, ready, agentChips)` returns the agent chips when present and the fixed set when not

**Live** — `npm run test:scout -- --live` must still pass unchanged. If any of
its 52 assertions break, you changed something you should not have.

**Manual, in the browser** — do all of these and report what you saw:

| # | Do this | Must happen |
|---|---|---|
| 1 | Guest at `/hire`: *"python developer, 8 years experience, ML also"*, then search | Zero real matches → sample card with `python · ml`, "8+ years", the banner |
| 2 | Look for a score, tier, rank or `AB-####` on it | **None present** |
| 3 | Look for shortlist / cart / "Request introduction" | **None present** |
| 4 | Click "Tell ABTalks I need this" as a guest | Sent to sign-in; after signing in the demand is recorded, no second click needed |
| 5 | Signed-in recruiter, same flow | `TalentRequest.alertWhenAvailable` true, visible on `/admin/hire` |
| 6 | A search that **does** return real candidates | **No sample card anywhere** — this is the one that must not regress |
| 7 | Scout asks a non-standard question | Chips reflect it, and typing still works |
| 8 | Tap an agent-supplied chip | Handled without a model round trip |
| 9 | Run the guest cart flow from plan 080 (shortlist → sign in) | Unchanged |

**Regression** — `npx tsc --noEmit`, `npm run build`, `npm run lint`,
`npm run test:hire-score`, `npm run test:scout`. Report each exit code.

## 9. Guardrails — DO NOT

- **DO NOT add `SAMPLE` to `TRACKS` or `track-registry.ts`.** The whitelist
  rejecting it is the entire safety model.
- **DO NOT** give a sample card a score, tier, rank, `AB-####` id, mission count,
  commit day count, project score or interview figure. Not even a realistic one.
- **DO NOT** render a sample card when `matches.length > 0`, and never in the
  same list as real matches.
- **DO NOT** let a sample card reach `ShortlistButton`, `RequestIntroButton`,
  `placeEngagementRequestAction`, `placeBulkEngagementRequestAction`,
  `mergeGuestCartAction`, or `/talent/members/[id]`.
- **DO NOT** modify `to-public-match.ts`, `candidate-ref.ts`, `score-candidate.ts`,
  `search-candidates.ts`, `explain-matches.ts`, `pool-brief.ts`, `scout-graph.ts`
  or anything under `src/features/hire/track-*`. Nothing in this plan requires it.
- **DO NOT** change `scoutTurnSchema`, `MatchCardData`'s existing fields, or
  either Server Action's return type. Add, never alter.
- **DO NOT** make guest searches write to the database. Guest demand goes through
  pending-demand → sign-in, exactly like the cart.
- **DO NOT** touch `prisma/schema.prisma` or run any `db:*` script. There is no
  schema change here. If you believe there is, stop and say so.
- **DO NOT** invent a second demand-capture mechanism. `TalentRequest` +
  `alertWhenAvailable` + `getDemandBoard` already exist and admin already reads
  them.
- **DO NOT** add a keyword map to make chips adaptive. That is what
  `offer_options` is for.
- Result envelope `{ ok, data } | { ok, message }`; Zod at every boundary
  including tool args; strict TS, no `any`; `lib/logger.ts`, never
  `console.error`; Prisma queries always use `select`.
- Keep the edge path clean — nothing here may be imported by `middleware.ts` or
  `auth.config.ts`.

## 10. DB safety

Not applicable — no schema change, no migration, no seed, no backfill. The one
write is `TalentRequest.alertWhenAvailable` / `status`, both existing columns
already written by `requestCohortTrainAction`.

## 11. Design conformance

**Pattern reused:** the existing card shell and chip row. The sample card is a
*reduced* card, not a new component family — same container, same type scale,
most elements simply absent.

**New pattern — declare it:** the **sample banner**. A full-width strip at the
top of the card carrying a warning tone, non-dismissible. This is the one new
pattern in this plan and it must be added to `docs/design-system.md` §5 in the
same PR, not invented in the component.

**Tokens:** banner uses the amber treatment already used for the privacy notice
in `scout-chat.tsx:772` — border `amber-500/30`, background `amber-500/10`, text
`amber-900 dark:amber-100`. Everything else from `globals.css`. **No new token.**

**Accent:** spent once, on *Tell ABTalks I need this*. The banner is a warning
tone and does not count as accent.

**Standing violations to avoid** (the repo's known failure modes): no rounded
corners beyond the existing card radius, no centered headings, no 1px hairline
borders, no `dark:` variants outside the token system, no gradients or glass, no
second font, no accent-coloured body text, no unthemed shadcn defaults.

**Copy voice:** plain and specific, no apology. "Nobody in the pool matches this
yet" — not "Unfortunately we couldn't find…".

## 12. Commit message

```
feat(hire): sample cards turn an empty search into captured demand

A recruiter who described a role in detail and matched nobody got the words
"No matches yet" and a dead end. The requirement they had just spelled out
was thrown away at exactly the moment it was most worth knowing.

An empty search now shows illustrative cards built from their own stated
requirement — the role, the stack, the experience band — with a button that
records it against the existing TalentRequest and surfaces it on the demand
board admin already reads.

Sample cards carry a SAMPLE: ref, which the candidate whitelist already
rejects, so they cannot be shortlisted, cannot be introduced, and cannot
reach a member page. They carry no score, no tier and no evidence figures:
the card states the requirement and never invents a person.

Chips follow the conversation too — the agent can offer its own quick
replies through a new offer_options tool when it asks something the fixed
ladder does not cover.
```

## 13. If you disagree with any of this

Say so before implementing. Two things in particular are worth pushing back on
if the code tells you otherwise:

- §6's claim that `MergeGuestCart` is the right place to drain a pending demand.
  Verify it actually runs for a *pending* recruiter — the layouts mount it for
  `approved || pending`, and plan 080 changed its retry behaviour.
- §4.1's claim that every consumer already rejects a `SAMPLE:` ref. Prove it
  yourself for each consumer listed rather than trusting this document.

A wrong assumption caught before implementation costs nothing. Found after, it
costs the owner another day.
