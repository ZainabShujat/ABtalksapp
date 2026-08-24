# 076 — Scout stops being a form: intent routing, honest limits, grounded answers

> **Branch:** `fix/hire-scout-conversation`
> **Trigger:** a real recruiter transcript where Scout answered nine questions correctly, then became useless the moment the recruiter tried to *use* it.
> **Thesis:** Scout is not dumb. It is a slot-filling form with no mode for anything except filling slots — so every message after the last question, and every message that is not an answer, falls into the same "Noted — X it is." hole.

---

## 1. What actually happened (from the transcript)

The intake worked. All nine slots filled cleanly. Then:

| Recruiter said | Scout said | What should have happened |
|---|---|---|
| "give me profiles who are in US in AI engineering" | "Noted — US location it is." | We have **no location data on candidates at all**. Say so. |
| "students from india who completed the claude challenge, seeking software engineer" | "Noted — India and Claude challenge it is." | This is a **different search**. Offer to start one. Also: the Claude track is not searchable yet. |
| "yes" ×4 | four *different* recaps, contradicting each other | Nothing was asked. Ask what they want. |
| "ok then show me" | "Got it — … noted." | **Run the search.** |
| "Change the stack" (a chip we render!) | nothing | Re-open the stack slot. |

Two separate failures, both structural:

1. **There is no post-intake mode.** Once every slot is filled, Scout can only acknowledge.
2. **There is no honesty about limits.** Unsupported filters are "Noted", which is a promise the search cannot keep.

---

## 2. Root causes in the code

### 2.1 `turnFor()` has nothing to say when the spec is complete

`scout-conversation.ts:905`:

```ts
if (!upcoming) {
  return { spec, nextQuestion: ack || null, options: [search, edit:stack], readyToSearch: true, … };
}
```

The model's one-line `ack` is the entire output. And `SCOUT_SYSTEM` forbids it from doing anything useful there:

- *"NEVER ask a question"*
- *"React only to the NEW information"*
- *"Never mention candidates, names, counts, scores or availability"*

So after intake, the only reachable behaviour is a one-line acknowledgement. The transcript is the prompt working exactly as written.

### 2.2 `action:search` is intercepted **client-side only**

`scout-chat.tsx:220` catches the literal string `action:search` before it is sent. Typed English — "show me", "search", "run it", "dikhao" — never becomes that string, so it never triggers a search.

### 2.3 Chip actions are dead once intake finishes

`runScoutTurn` path 1 is guarded by `if (asking && isChipAnswer(...))`. When every slot is filled, `asking` is `null`, so **`edit:stack` is never handled** — it falls through to the model, which says "Noted". That is the "Change the stack" line in the transcript.

### 2.4 `intent: "question"` is declared but never routed

The schema and prompt both define it (`scout-conversation.ts:579`, `:600`). `runScoutTurn` never branches on it — every intent lands in the same `turnFor(spec, ack)`. Combined with *"never mention counts"*, Scout is structurally incapable of answering "how many Python people do you have?".

### 2.5 Every message is assumed to be about the current requirement

There is no notion of "this is a different brief". A fresh requirement gets shredded into whatever slots the model recognises and merged onto the old one — which is how the spec ended up US **and** India **and** AI engineer **and** software engineer at once.

---

## 3. The chosen approach — and why not RAG

The owner asked whether to "lagao RAG". **No.** Nothing here is a retrieval problem:

- Scout is not failing to *find* knowledge; it is failing to *route* a message and to *act*.
- The facts a recruiter asks for (how many, which skills, which tier) are small, structured, and already computable exactly — `poolSnapshot()` and `previewMatch()` are deterministic queries, not documents to embed.
- A vector index over ~50 candidate rows would be slower, fuzzier, and unfalsifiable compared to a `groupBy`.

Also rejected: **a full tool-calling agent loop.** Groq supports it, but it adds two round trips to every turn inside an 8s Server Action budget, and it hands filter selection to the model — the one thing plan 062 §14 forbids.

**Chosen: intent routing + grounded fact injection.**

Compute the relevant facts *before* the model call, put them in the prompt as data, and let the model phrase the answer. Same grounding guarantee as tools, one round trip, no ability for the model to invent a filter.

```
message
  ├─ chip / action        → engine handles directly (no model)
  ├─ pending slot + answer→ existing slot merge  (unchanged, it works)
  └─ everything else      → classify → route
                             ANSWER      → slot merge
                             REVISE      → re-open that slot
                             QUESTION    → answer from injected facts
                             COMMAND     → search / edit / restart
                             NEW_BRIEF   → offer a fresh search
                             UNSUPPORTED → say what we cannot filter on
```

---

## 4. Files to touch

| Path | New/Edit | Server/Client | Note |
|---|---|---|---|
| `src/features/hire/capabilities.ts` | **new** | shared | What Scout can and cannot filter on, and the honest reply for each |
| `src/features/hire/pool-facts.ts` | **new** (restore) | server | `poolSnapshot()` + `previewMatch()` — deleted in `bccd6d1`, justified now |
| `src/features/hire/scout-conversation.ts` | edit | server | Intent routing, post-intake mode, fact injection |
| `src/lib/validations/hire.ts` | edit | shared | `ScoutTurn` gains `action` + `notice` |
| `src/components/hire/scout-chat.tsx` | edit | **Client** | Honour `action` from the server; render `notice` |
| `src/app/actions/hire-actions.ts` | edit | server | Pass the new turn fields through |
| `src/app/actions/hire-guest-actions.ts` | edit | server | Same, guest parity |

**Server → Client:** `ScoutTurn` stays plain JSON. `action` is a string union, `notice` a string.

---

## 5. Phase 1 — Capability registry

`capabilities.ts`, pure, no DB. One list, one truth.

```ts
export type Capability = { id: string; supported: boolean; why?: string; instead?: string };
```

**Supported today:** role/title · must-have and nice-to-have stack (declared skills) · seniority and experience band · evidence priority · budget · employment type · work mode · notice ceiling · verified evidence (missions, clean passes, commit days, projects, interviews) · working languages (mission days passed).

**Not supported, and why:**

| Asked for | Honest reply |
|---|---|
| Candidate country / city ("in the US", "from India") | No candidate has shared a location. `CandidateAvailability` is empty and the field is opt-in. Offer: ask at outreach. |
| "completed the Claude challenge" / 60-day challenge | Only the AI Cohort (`PROGRAM`) is searchable. The challenge tracks need their own consent field — plan 069 §11. |
| College / degree / graduation year as a filter | Declared and sparse; we rank on evidence, not credentials. |
| Gender, age, caste, religion, marital status | Never. Refuse plainly and do not offer a workaround. |

The last row is not a capability gap — it is a line. It gets its own short refusal and no "instead".

**Rule:** an unsupported ask is never written into the spec. Silently accepting it is how "Noted — US location it is" happened.

---

## 6. Phase 2 — Intent routing in `runScoutTurn`

Order matters; cheapest and most certain first.

1. **Engine actions** — `action:*` / `edit:*` / `skip:*` handled **before** any `asking` guard, so they work after intake too. Fixes §2.3.
2. **Chip answer** — unchanged.
3. **Deterministic command detection** — a small regex over search/show/restart verbs in English and Hinglish (`show me`, `search`, `run it`, `find`, `dikhao`, `dikha do`, `chalao`, `start over`, `naya`). No model needed, so it works when Groq is down.
4. **Model classification** for everything else, with intents extended to include `command`, `new_brief`, `unsupported`.
5. **Fallbacks** — unchanged offline path.

### The post-intake mode (the actual fix for the transcript)

When `nextSlot(spec) === null`, `turnFor` no longer emits a bare ack. It emits a **standing prompt** with real options:

```
Ready when you are — I can search now, or change anything above.
[Search verified talent] [Change the stack] [Change the budget] [Start a new search]
```

and `allowFreeText: true`, so a typed question is answered instead of "Noted".

---

## 7. Phase 3 — Grounded answers

When the routed intent is `question` (or `unsupported`), fetch facts first:

```ts
const facts = { snapshot: await poolSnapshot(), preview: await previewMatch(spec) };
```

…and inject them into the model call as a JSON block, with the prompt rules relaxed **only for this branch**:

- The "never mention counts" ban is lifted — but every figure must come from the injected block.
- Reuse the existing grounding guard: a reply introducing a digit not present in the facts is discarded for a deterministic sentence. (`explain-matches.ts:groundedFigures` is the pattern; the same idea, local to this file.)
- After answering, **re-ask the pending question** if there is one, so the flow is not lost.

`poolSnapshot()` is memoised for 60s, so a question costs one extra query at most.

---

## 8. Phase 4 — Typed commands actually run

`ScoutTurn` gains:

```ts
action?: "search" | "reset" | null;   // engine's instruction to the client
notice?: string | null;               // honest limit / capability message
```

`scout-chat.tsx` honours `turn.action === "search"` by calling the existing `runSearch()` — the same function the chip already calls. So "show me", "dikhao" and the button all take one path.

`action: "reset"` starts a fresh spec after confirmation, for `new_brief`.

---

## 9. Guardrails (DO NOT)

1. **DO NOT** remove slot-scoped merging. It fixed a real bug (answers landing in the wrong field) and the intake half of the transcript is correct because of it.
2. **DO NOT** let the model choose filters, rank, or invent a figure. It phrases; the engine decides.
3. **DO NOT** write an unsupported filter into the spec, even as `extra`.
4. **DO NOT** add tool-calling round trips inside the 8s Server Action budget.
5. **DO NOT** build embeddings or a vector store.
6. **DO NOT** break the offline path — every new branch needs a deterministic fallback for when Groq is unreachable.
7. **DO NOT** change `searchCandidates`, scoring, or the dossier. This plan is conversation-layer only.
8. **DO NOT** let guest and signed-in paths drift; both call `runScoutTurn`.
9. Always: Zod at the boundary, result envelope, `lib/logger.ts`, no `any`.

---

## 10. Verification

| # | Check |
|---|---|
| V1 | `tsc --noEmit`, 16/16 scoring tests, production build |
| V2 | Intake flow unchanged — nine slots still fill in order, chips still work |
| V3 | "show me" / "dikhao" / "search" after intake **runs the search** |
| V4 | "Change the stack" chip re-opens the stack question (currently dead) |
| V5 | "how many Python people do you have?" → a real count from the snapshot, no invented digits |
| V6 | "give me profiles in the US" → honest "no candidate has shared a location", spec unchanged |
| V7 | "who completed the Claude challenge" → honest "only the AI Cohort is searchable today" |
| V8 | A fresh brief mid-conversation → offers a new search instead of merging |
| V9 | "yes" with nothing pending → asks what they want, does not recap |
| V10 | Groq unreachable → intake, commands and limits all still work |
| V11 | Protected-attribute request → plain refusal, no workaround offered |
| V12 | Guest `/hire` behaves identically to signed-in |

---

## 11. Commit messages

```
feat(hire): Scout answers questions instead of noting them
feat(hire): typed "show me" runs the search, and chips work after intake
feat(hire): say what we cannot filter on instead of accepting it
```
