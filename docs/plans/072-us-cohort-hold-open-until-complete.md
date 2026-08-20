# 072 — Keep US AI cohort open until Day 31 is done

## 1. Goal

The live **AI Cohort USA** row (19 enrolled) froze at `endsAt` **20 Aug 2026, 5:20 AM IST**. Keep everyone’s progress. Allow mission submits again until **every remaining ENROLLED/COMPLETED member has a passed Day 31 mission**; then freeze. **AI Cohort India Aug 26** still freezes on its `endsAt` (3 Sep).

## 2. Current behavior

- [`isCohortFrozen`](src/features/program/progression.ts) is `now > cohort.endsAt` (UTC instant). That already rejects US submits in [`submitMissionRun`](src/features/program/missions.ts) and [`reviewMission`](src/features/program/mentor.ts).
- Calendar unlock is already at Day 31 (US `startsAt` is 18 Jul). Sequential pass-to-unlock still applies. No calendar restart.
- India is a different `ProgramCohort` (`requiresJoinCode: false`). Open `/program` apply does not hit the US join code.
- Interview unlock still uses `now > endsAt` in [`interview.ts`](src/features/program/interview.ts). US `endsAt` stays in the past, so that path stays unlocked. Leave it alone.

## 3. Files to touch

- [`docs/plans/072-us-cohort-hold-open-until-complete.md`](docs/plans/072-us-cohort-hold-open-until-complete.md) `[new]` this plan
- [`src/features/program/constants.ts`](src/features/program/constants.ts) `[edit]` `PROGRAM_HOLD_OPEN_COHORT_NAME = "AI Cohort USA"`
- [`src/features/program/progression.ts`](src/features/program/progression.ts) `[edit]` async freeze; all-passed Day 31 query
- [`src/features/program/missions.ts`](src/features/program/missions.ts) `[edit]` `await isCohortFrozen`; select `id/name/status/endsAt`
- [`src/features/program/mentor.ts`](src/features/program/mentor.ts) `[edit]` same
- [`src/components/program/program-cohort-panel.tsx`](src/components/program/program-cohort-panel.tsx) `[edit]` one helper line under Ends when the open US cohort is selected
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) `[edit]` one pending-reconcile line

## 4. Server vs Client

- `progression.ts`, `missions.ts`, `mentor.ts` — server-only.
- `program-cohort-panel.tsx` — Client. Import `PROGRAM_HOLD_OPEN_COHORT_NAME` from constants (already client-safe; dashboard already imports that file). Pass no new functions across the boundary. `overview.name` / `overview.status` already exist.

## 5. Steps

1. In `constants.ts`, add `PROGRAM_HOLD_OPEN_COHORT_NAME = "AI Cohort USA"`.
2. In `progression.ts`, keep a tiny sync `isCohortPastEndsAt` (`now > endsAt`). Replace `isCohortFrozen` with async:

```ts
export async function isCohortFrozen(cohort: {
  id: string;
  name: string;
  status: ProgramCohortStatus;
  endsAt: Date;
}): Promise<boolean> {
  if (
    cohort.name === PROGRAM_HOLD_OPEN_COHORT_NAME &&
    (cohort.status === "ENROLLING" || cohort.status === "ACTIVE")
  ) {
    const incomplete = await prisma.programMember.count({
      where: {
        cohortId: cohort.id,
        status: { in: ["ENROLLED", "COMPLETED"] },
        missionSubmissions: {
          none: { dayNumber: PROGRAM_TOTAL_DAYS, passed: true },
        },
      },
    });
    return incomplete === 0;
  }
  return isCohortPastEndsAt(cohort);
}
```

Day 31 complete = `passed: true` on that day. SKIPPED does not count. DROPPED members are ignored (admin escape hatch). Zero ENROLLED/COMPLETED members → frozen.

3. `submitMissionRun` / `reviewMission`: select `cohort.id`, `name`, `status`, `endsAt`; `await isCohortFrozen(...)`. Freeze check stays **before** the write so the last Day-31 pass still lands.
4. Cohort panel: if `overview?.name === PROGRAM_HOLD_OPEN_COHORT_NAME` and status is ENROLLING or ACTIVE, under the Ends field add muted helper: `Submissions stay open until every enrolled member has passed Day 31.` Reuse existing `Label` / muted body. No new pattern. No accent.
5. Changelog one line under Pending reconcile: `2026-08-20 [rule] US AI cohort (name "AI Cohort USA") stays unfrozen until every ENROLLED/COMPLETED member has passed Day 31; India still freezes on endsAt`.
6. After deploy: in Admin → Program, set the live US cohort status from **ENROLLING → ACTIVE** (existing `setCohortStatus`). That stops join-code enrolls from growing the “must finish” set. Do not change `startsAt` / `endsAt` / submissions.

## 6. Guardrails for Cursor (DO NOT)

- Do NOT reset member progress, waive days, or change `startsAt`.
- Do NOT change India `endsAt` or apply hold-open to any other cohort name.
- Do NOT add schema, migrations, env vars, or a hardcoded cohort id.
- Do NOT run `npm run db:*` or any production UPDATE except via Admin status (step 6).
- Do NOT change `interview.ts` (leave unlock on `endsAt`).
- Do NOT change commit-cron `endsAt` windows.
- Do NOT touch middleware or `auth.config.ts`.
- Do NOT invent a new freeze helper file; keep it in `progression.ts`.

## 7. DB safety

No migration. The only production data change is the existing Admin status flip (ENROLLING → ACTIVE) after the code is live. Ask before any other Neon write.

## 8. Verification

- US member who is mid-curriculum can submit again; message “This cohort has ended — submissions are closed.” is gone until all 19 have passed Day 31.
- India member still bound by 3 Sep `endsAt` (no code path by name).
- After the last US Day-31 pass, the next mission run returns the ended message.
- Marking a straggler DROPPED in admin allows freeze without them passing Day 31.
- `npx tsc --noEmit` and `npm run build` pass.
- Files changed: only those in §3.

## 9. Commit message

```
fix(program): keep US AI cohort open until every member passes Day 31
```

**Design conformance:** Admin helper reuses the cohort form `Label` + muted description under Ends. Tokens: existing foreground/muted. Accent is not spent. No new pattern.
