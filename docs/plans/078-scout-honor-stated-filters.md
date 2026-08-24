# Plan 078 — Scout acts on the brief it was given

> **Owner addendum:** whatever they ask — cohort, Claude, hackathon,
> submissions, India or US — Scout must search that way, not restart the form.

> **Branch:** `fix/hire-scout-conversation`
> **Trigger:** recruiter typed *“students from india who has done claude challenge for atleast 30 days only 5 candidate”*. Scout refused location, ignored the 30-day and 5-person asks, and dumped the role chips again.

---

## 1. Goal

If a recruiter already stated a searchable brief (which pool, how many days,
how many people), Scout must **search that**, not restart a 9-slot form. Role
chips stay available; they stop being a gate.

## 2. Current behaviour (verified in code)

Message hits `findUnsupported` in `capabilities.ts`.

| Phrase | What happens |
|---|---|
| `from india` | Always matches `candidate_location`. Reply: *nobody has shared a location*. `locationCity` is locked so the rest of the sentence cannot write it. |
| `claude challenge` | Refused **only if** `HIRE_CHALLENGE_POOL` is off. Flag on → not refused — but **nothing writes a Claude-only filter**. Search still unions program + challenge. |
| `atleast 30 days` | No slot. `asRoleTitle` **rejects** any string containing `at least`. Not stored. Search uses the env floor (10), not 30. |
| `only 5` | No slot. Search still aims for `MIN_RESULTS = 5` *minimum*, not a cap. |

Then `nextSlot(spec)` is still `title`, so `turnFor` prints *What role are you hiring for?* plus the same five chips. Plan 076 made the location notice *additive*; it did **not** stop re-asking the first unanswered form field. That is the “ziddi” loop.

India is the wrong refuse here. This product’s challenge pool *is* Indian students. Treating “from India” like “from the US” (a field nobody filled) is why the first sentence dies.

## 3. Target behaviour

Same first message:

> The searchable Claude-challenge pool is Indian students. I’ll take people with **≥30 verified days**, rank on evidence, and show **5**.

Then **run the search** (or one confirm chip: *Search 5 Claude-challenge profiles*). No role question unless they did not specify a pool/days brief.

If they later say “backend, Java”, that revises the same spec and re-ranks. It does not wipe the 30-day / Claude / 5 filters.

| Ask | We can actually do | Scout says |
|---|---|---|
| Claude challenge, ≥30 days | `buildChallengeDossierSet({ minDays: 30 })`, skip program pool | “Claude challenge, 30+ days.” |
| Only 5 | `searchCandidates(spec, { limit: 5 })` as a **cap** | “Showing 5.” |
| From India | Implicit for this pool. Optional: `userType === STUDENT` | “This pool is Indian students — not filtering by city.” |
| From US / London | Still a real gap | Honest refuse, **then still apply** Claude + 30 + 5. |
| Gender / caste / religion | Never | Hard refuse, stop. |

## 4. Files

No schema, no migration. Filters live on `JobSpec.extra` (already JSON).

- `[edit] src/lib/validations/hire.ts` — `extra.poolSource`, `extra.minEvidenceDays`, `extra.resultLimit`
- `[edit] src/features/hire/capabilities.ts` — India is not `candidate_location`; keep US/UK/city refuses
- `[edit] src/features/hire/scout-conversation.ts` — offline parser; skip title when a pool brief is complete; `action: "search"`
- `[edit] src/features/hire/search-candidates.ts` — honour those extras
- `[edit] src/features/hire/challenge-dossier.ts` — already takes `minDays`; pass the spec override (`max(flag.minDays, extra.minEvidenceDays)`)
- `[edit] src/features/hire/score-candidate.test.ts` — parser + search-cap cases
- `[edit] src/components/hire/scout-chat.tsx` — only if `action: "search"` is not already fired from the engine (it is, via existing client path)

## 5. Server vs Client

All of this is server (`runScoutTurn`, `searchCandidates`). Client already runs search when the turn has `action: "search"`. No new client props except the summary string already shown.

## 6. Steps

1. **Parser, no model.** One function `extractPoolBrief(msg)`:
   - Claude / 60-day / challenge → `poolSource: "CLAUDE"`
   - cohort / program → `PROGRAM`
   - `at least N days` / `N+ days` / `min N` → `minEvidenceDays` (clamp 1–60)
   - `only N` / `top N` / `N candidates` → `resultLimit` (clamp 1–20)
   - Write into `spec.extra`. Never into `title`.
2. **India is audience, not a filter.** If the only location word is India/Indian, do **not** hit `candidate_location`. One short notice: this pool is Indian students. US / UK / a city still refuses, and the rest of the sentence still parses.
3. **Searchable-enough.** If `poolSource === "CLAUDE"` and `minEvidenceDays` is set, mark `title` skipped (`skip:title` / “Any role”) and return `readyToSearch: true` with `action: "search"`. Do not walk seniority → stack → salary.
4. **Search honouring extras.** Claude-only → do not load program dossiers. `minEvidenceDays` → challenge query floor. `resultLimit` → slice **after** rank, as a cap (today `MIN_RESULTS` pads up; a stated “only 5” wins).
5. **Keep later intake optional.** Chips for role/stack still exist on the standing prompt after results. Changing them re-ranks with the same pool extras.
6. **Protected attributes unchanged.** Gender / caste / religion still short-circuit.

## 7. Guardrails (DO NOT)

- DO NOT invent candidate cities or mark India as a verified location field.
- DO NOT put name / college / country on the card.
- DO NOT lower the env floor below `HIRE_CHALLENGE_POOL` (30 can raise 10; 5 cannot lower it).
- DO NOT skip the protected-attribute refuse.
- DO NOT add a Prisma migration.
- DO NOT make the model choose filters — parser + search only.

## 8. Verification

1. First message exactly: *students from india who has done claude challenge for atleast 30 days only 5 candidate* → **search runs**, 5 Claude cards, each with ≥30 days on the card copy. No second “What role are you hiring for?”
2. Same message with flag **off** → honest “challenge pool is off”, no fake 5 cards.
3. *from the US, claude challenge 30 days* → refuse US, **still** search Claude ≥30.
4. *backend java* after that → re-rank those 30-day people, still capped at 5.
5. Chip “Any role” / a role title still works for people who did not state a pool.
6. `npx tsc --noEmit`; scoring tests still 16/16 plus new parser/cap cases.

## 9. Commit message

`fix(hire): honour Claude-day and result-count briefs instead of re-asking the role`
