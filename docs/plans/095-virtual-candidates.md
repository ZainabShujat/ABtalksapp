# 095 — Virtual candidates (demand-based profiles)

## Goal

When the pool cannot answer a recruiter's requirement, show the requirement
itself as a profile — clearly labelled, never a person — and let the recruiter
ask us to source it. Turn empty searches into demand we can act on.

## What already existed

Most of the recruiter-facing half. This plan extends it rather than replacing
it:

| Need | Already in the codebase |
|---|---|
| Requirement-shaped card on an empty search | `features/hire/sample-card.ts` |
| Cannot be shortlisted or introduced | `SAMPLE:` prefix, refused by `resolveEligibleCandidates` |
| Requirement entity | `TalentRequest` (title, stack, experience, location, notice, employment) |
| "Tell me when someone appears" | `TalentRequest.alertWhenAvailable` + `features/hire/run-hire-alerts.ts` |
| Admin queue | `/admin/hire` |
| Demand aggregation | `features/hire/demand-board.ts` |

## What this adds

- `match-config.ts` — `HIRE_MATCH_THRESHOLD` (default 70) and
  `hasSufficientRealMatches`. The desk previously fell back only on *zero*
  results; a lone 41-scoring near-miss counted as an answer.
- `requirement-fingerprint.ts` — order-independent signature. Expands MERN,
  collapses JS/TS/Node/Postgres aliases, folds the metros, bands experience,
  and deliberately ignores salary.
- `virtual-candidate.ts` — pure generation. No name, no contact, no employer,
  no institution, no score.
- `virtual-candidate-store.ts` — persistence, dedup, status machine, audit trail.
- `VirtualCandidate` / `VirtualCandidateRequest` / `VirtualCandidateEvent`.
- Recruiter card + request form; admin sourcing queue.

## Open conflict, recorded deliberately

`features/hire/locked-preview.ts` (shipped in `bf96e8c`, behind
`HIRE_PRO_PREVIEW`, default off) **fabricates person names, emails, phone
shapes, cities and degrees** — `FIRST`/`LAST`/`CITY`/`DEGREE` word lists and
`${first}.${last}@example.com`.

That is incompatible with the rule this feature is built on: never fabricate an
identity. The file argues its own case — it is a blurred *format* preview, the
`SAMPLE:` ref keeps it out of the engagement path, and the copy says the pool is
empty. It was left untouched here because it is another team's merged decision,
not because the conflict was resolved.

**It needs an owner-level decision.** If the answer is that virtual profiles
never carry invented identity, `locked-preview.ts` has to change or go.

## Migration

`prisma/migrations/20260826120000_virtual_candidates/` — additive only. No
existing table altered, every FK onto an existing table nullable with
`ON DELETE SET NULL`.

**Not applied.** The working `DATABASE_URL` points at production (12,805 users).
Apply on a Neon branch first, verify, then production.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `HIRE_MATCH_THRESHOLD` | `70` | score at which a real candidate answers the requirement alone |
| `HIRE_MIN_MATCHES` | `1` | how many such candidates suppress the virtual card |

## Tests

`npm run test:virtual` — 25 cases: fingerprint stability and order-independence,
alias and metro folding, salary exclusion, similarity bounds, no-identity
assertions on the generated profile, threshold configuration and fallback, and
the full status machine including terminal states and resumable sourcing.
