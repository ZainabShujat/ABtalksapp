# 109 — Profile: phone verify, skills search/tick, Links label

## Goal

Three profile fixes: mandatory phone verification UI on Basic Information; Skills search lists real matches (not only Other) and the left checklist goes green after a successful save of enough skills; Links shows the Label input only when type is Other.

## Current behavior

- Phone: `basic-info-section.tsx` is a plain `PwInput` plus `verified={phoneVerified}` (green badge only). OTP lives in `PhoneVerifyField` / `verifyOtpAction` (India + MSG91; skipped under `next dev` via `isOtpVerificationRequired()`).
- Skills search: when the query is non-empty, `skill-combobox.tsx` uses **only** `/api/skills/search` results. If the API returns nothing (or is slow), the list is just **Other**. Empty query still shows the curated catalog.
- Skills green: completeness needs **≥3** claimed skills (`completeness.ts` `MIN_SKILLS = 3`). Save → `router.refresh()` already recomputes the checklist from the server.
- Links: every extra row always renders Label; Zod already requires label only for `OTHER`.

## Decisions

| # | Call |
|---|---|
| D1 | Reuse `PhoneVerifyField` + `verifyOtpAction`. India OTP when `isOtpVerificationRequired()`; non-India stays enterable without OTP (same as registration). |
| D2 | Verified: phone read-only + green `Verified` only (no Send OTP). Unverified: verify UI, no green badge. |
| D3 | Mandatory: block Basic save/Next until verified when OTP is required and the number is India (or empty under +91). Server enforces the same. |
| D4 | Skills: while typing, merge **client-filtered catalog** with API results (dedupe), then append Other. |
| D5 | Keep `MIN_SKILLS = 3` for the green tick. |
| D6 | Links Label visible only when `type === OTHER`; clear label when leaving Other. |

## Files to touch

- `docs/plans/109-profile-phone-skills-links.md` `[new]`
- `src/components/profile/basic-info-section.tsx` `[edit]`
- `src/app/profile/page.tsx` `[edit]` — pass `otpRequired={isOtpVerificationRequired()}`
- `src/app/actions/candidate-profile-actions.ts` `[edit]` — gate `saveBasicInfoAction`
- `src/features/profile/completeness.ts` `[edit]` — basic needs `phoneVerified` when OTP required
- `src/components/profile/skill-combobox.tsx` `[edit]`
- `src/components/profile/links-section.tsx` `[edit]`
- `src/components/profile/profile-wizard.css` `[edit]` — compact phone-verify layout under `.pw-root`
- `docs/CHANGELOG.md` `[edit]` — one Pending reconcile line for the phone rule

No schema. No `dual-write.ts` / `CLAUDE.md` / `project-context.md` edits.

## Steps

### 1. Phone verify on Basic Information

In `BasicInfoSection`:

- Props: `phoneVerified`, `otpRequired` (from page via `isOtpVerificationRequired()`).
- If `phoneVerified`: keep phone as read-only `PwInput` (or disabled) + `verified` badge only. No OTP chrome.
- If `!phoneVerified`: replace the phone `PwInput` with `PhoneVerifyField` (`verificationRequired={otpRequired}`, defaults from current phone E.164 / national). On `onVerified`: `router.refresh()` so `phoneVerified` flips and the green badge replaces the verify UI.
- Mark Phone required when `otpRequired`. Block form submit / Next if `otpRequired` and still unverified with an India number (mirror registration).
- Scope shadcn/OTP controls under `.pw-phone-verify` in CSS so they fit the wizard (heights, radius, orange accent) without restyling the shared component globally.

In `saveBasicInfoAction`: after Zod, if `isOtpVerificationRequired()`, load candidate `phone` + `phoneVerified` (or `PhoneVerification` row). If the submitted/stored phone is India and not verified → `{ ok: false, message: "Please verify your phone number to continue." }`. Non-India: no gate.

In `computeCompleteness`: when `isOtpVerificationRequired()`, `basicComplete` also requires `detail.phoneVerified`. Hint: “Verify your phone number”. (Dev skips OTP → completeness unchanged on phone.)

### 2. Skills search + green tick

In `SkillCombobox`, for non-empty query `q`:

```
listed = merge(
  catalog.filter(name includes q, not excluded),
  results.filter(not excluded)
) // prefer rows with real ids; dedupe by id then lower(name)
visible = [...listed, OTHER_ITEM]
```

Keep empty-query = full catalog + Other. Keep API fetch as today.

Green tick: no completeness formula change. After fixing search, adding ≥3 skills and saving must refresh the left nav via existing `useSectionSave` → `router.refresh()`. If fewer than 3 are saved, the checklist correctly stays incomplete.

### 3. Links label only for Other

In `LinksSection`, watch `extra.${index}.type`. Render the Label `PwField` only when `type === CandidateLinkType.OTHER`. On type change away from Other, `setValue(..., "", { shouldDirty: true })`. When type is LeetCode/etc., URL alone is enough. Default append stays `LEETCODE`.

### 4. CHANGELOG

One line under `## Pending reconcile`:

`2026-09-03 [rule] /profile Basic Information requires phone OTP when verification is on (India); verified state shows green badge only`

## Guardrails (DO NOT)

- Do not edit `dual-write.ts`, `CLAUDE.md`, `docs/project-context.md`, DashboardShell, or add new font/schema.
- Do not invent a second OTP stack — reuse `PhoneVerifyField` / `verifyOtpAction`.
- Do not lower `MIN_SKILLS` below 3.
- Do not show Label for non-Other link types.
- If `tsc --noEmit` fails, stop and report.

## Verification

- Unverified India phone on `/profile` Basic: Send OTP / verify UI; no green Verified; save/Next blocked until verified (production OTP mode). After verify + refresh: green Verified only, phone locked.
- `next dev` (`otpRequired` false): no OTP gate (existing flag).
- Skills: typing “Py” / “React” lists matching curated + API skills, not only Other; Other still last. Add ≥3, Save → left Skills turns green.
- Links: add link → Label hidden for LeetCode/GitHub/…; choose Other → Label appears and is required on save.

## Commit message

`Profile: mandatory phone verify, fix skills search, Links label for Other only`
