# 108 — Profile: Inter, nav bold, ABTalks placeholder, Skills option box

Polish the `/profile` wizard: Inter instead of Instrument Sans, bold the selected left-nav title, Experience company placeholder `ABTalks`, and a Skills section with curated 2026 quick-adds plus a designed option box and Other.

## 1. Goal

Make the wizard match dashboard type, make the current step obvious on the left card, and let candidates add skills in one tap from a 2026 list — or type a custom name via Other — without breaking recruiter search (claims still persist as `Skill` ids).

## 2. Current behavior

- Only the left card forces Instrument: `.pw-profile-card, .pw-profile-card *` in `src/components/profile/profile-wizard.css` uses `var(--font-hub-instrument-sans)`. Inter is already loaded as `--font-inter` in `src/app/layout.tsx`.
- Selected nav item is `.pw-check-item.pw-current` at **font-weight 500**. Completed items are already 700.
- Experience company placeholder is `e.g. Zunno AI` in `src/components/profile/experience-section.tsx`.
- Skills already has Quick adds, but they come from **live popularity** (`getPopularSkills(10)` in `src/app/profile/page.tsx`). The search dropdown uses generic shadcn Autocomplete classes in `src/components/profile/skill-combobox.tsx`. Empty query shows **no** list. There is no Other path; `saveSkillClaims` only accepts active catalog `cuid`s.

**Catalog rule (keep):** do not store free-text on `CandidateSkill`. Other must resolve or create a `Skill` row (slug fold), then claim that id. Same slug logic as `resolveOrCreateSkillId` in `src/repositories/dual-write.ts` (lines 719–775). **Do not edit `dual-write.ts`.** Copy the slug + find-or-create into `features/skill/` so profile does not import dual-write.

## 3. Files to touch

- `docs/plans/108-profile-type-skills-nav.md` `[new]` — this plan.
- `src/components/profile/profile-wizard.css` `[edit]` — Inter on `.pw-root`; current-step 700; option-box + Other field styles.
- `src/components/profile/experience-section.tsx` `[edit]` — placeholder `e.g. ABTalks`.
- `src/lib/candidate-vocab.ts` `[edit]` — `PROFILE_QUICK_SKILLS` constant (curated names).
- `src/features/skill/search-skills.ts` `[edit]` — `getSkillsByNames`; stop using popularity for this page.
- `src/features/skill/resolve-skill.ts` `[new]` **server-only** — slug + find-or-create; returns `SkillOption`.
- `src/lib/validations/candidate-profile.ts` `[edit]` — `resolveSkillSchema` (`name` trimmed, 1–80 chars).
- `src/app/actions/candidate-profile-actions.ts` `[edit]` — `resolveSkillAction`.
- `src/app/profile/page.tsx` `[edit]` — pass `getSkillsByNames(PROFILE_QUICK_SKILLS)` instead of `getPopularSkills(10)`.
- `src/components/profile/skill-combobox.tsx` `[edit]` — empty-query shows curated list; Other row; `pw-*` popup (no shadcn popover look).
- `src/components/profile/skills-section.tsx` `[edit]` — quick-adds from curated prop; Other chip + custom field; call `resolveSkillAction`.
- `docs/CHANGELOG.md` `[edit]` — one Pending reconcile line for the Other mint rule.

## 4. Server vs Client

- `page.tsx` stays a Server Component; passes resolved `SkillOption[]` into `SkillsSection` (plain data only).
- `SkillsSection`, `SkillCombobox` stay `"use client"`.
- `resolve-skill.ts` is server-only; the client only calls `resolveSkillAction`.

## 5. Steps

### 1. Font → Inter

On `.pw-root` set `font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif`.

Replace the Instrument block (`.pw-profile-card, .pw-profile-card *`) so it inherits Inter (delete the Instrument stack, or point it at `--font-inter`). Do not unload Instrument from `layout.tsx` (other surfaces use it).

### 2. Selected nav title bold

In `.pw-check-item.pw-current` set `font-weight: 700` and `color: #111827`. Keep `.pw-current.pw-completed` green + 700.

### 3. Company placeholder

In `experience-section.tsx` only: `placeholder="e.g. ABTalks"`.

### 4. Curated 2026 list

Add `PROFILE_QUICK_SKILLS` (readonly string[]) to `candidate-vocab.ts`, this exact set (order preserved):

Python, JavaScript, TypeScript, Java, C++, SQL, Go, Rust, React, Next.js, Node.js, HTML/CSS, Tailwind CSS, Machine Learning, Deep Learning, PyTorch, TensorFlow, Pandas, NumPy, Scikit-learn, NLP, Generative AI, LLMs, Prompt Engineering, RAG, LangChain, LangGraph, OpenAI API, Anthropic Claude, Hugging Face, Vector Databases, Agents, AWS, Azure, GCP, Docker, Kubernetes, Git, GitHub, PostgreSQL, MongoDB, Redis, Spark, Power BI, Tableau, Figma, Excel

`getSkillsByNames(names)` in `search-skills.ts`: `findMany` where `isActive` and (`name` in names **or** `slug` in slugified names), case-insensitive name match. Return `SkillOption[]` in **list order**, skipping names with no row (chips still render from the constant; click will resolve). Remove `getPopularSkills` from the profile page only; leave the function in place if unused, or delete it if this was the sole caller (it is).

### 5. Option box + Quick adds + Other

**Quick adds:** chips for every name in `PROFILE_QUICK_SKILLS` not already selected, plus a trailing **Other** chip (`pw-quick-chip pw-quick-other`, dashed border). Wrap; `max-height: 120px; overflow-y: auto` on `.pw-quick-row` so the 555px card still leaves room for the tag box.

**Option box** (the combobox popup — this is the designed control):

- Hide the shadcn `bg-popover` / `ring-foreground` classes.
- New CSS: `.pw-skill-popup` (white, 12px radius, `1px solid var(--pw-border)`, `var(--pw-shadow-card)`, max-height 240px, overflow-y auto, padding 6px), `.pw-skill-option` (14px Inter, 8px radius, padding 8px 10px; hover/highlighted: `--pw-orange-soft` bg and `--pw-orange` text), category muted on the right.
- On **empty query**, list the curated names (from a `catalog` prop = the same `SkillOption[]` plus unmatched labels as `{ id: "", name, slug: "", categoryName: null }`). Last row: **Other**.
- On **typed query**, keep `/api/skills/search` results, still append Other.
- Choosing a catalog row calls existing `add()`. Choosing Other does not add a skill; it opens the custom field.

**Other field:** when Other is selected (chip or list), show a row: `PwInput` placeholder `Type a skill name` + Add button (reuse `.pw-tag-add`). Submit (click or Enter):

1. If the trimmed name matches an already-selected skill (case-insensitive), do nothing.
2. If it matches a loaded catalog option, `add` that option.
3. Else call `resolveSkillAction({ name })`. On `{ ok: true, data: SkillOption }`, `add` it. On failure, show the action message under the input.

Then clear the input; keep Other open so they can add another.

`resolveSkillAction`: auth required; Zod; `resolveOrCreateSkill(name)` using the dual-write slug fold; return `{ ok: true, data: SkillOption }` or `{ ok: false, message }`. Prisma `Skill.create` on miss. No `revalidatePath` (client already has the option).

Save path unchanged: `saveSkillsAction` still sends `skillId` cuids.

### 6. CHANGELOG

Under `## Pending reconcile`, one line:

`2026-09-03 [rule] /profile Other skill path find-or-creates Skill rows (slug fold) so custom names stay recruiter-searchable`

No other docs. No schema migration.

## 6. Guardrails for Cursor (DO NOT)

- Do not edit `CLAUDE.md`, `docs/project-context.md`, `dual-write.ts`, `DashboardShell`, header, footer, `layout.tsx` fonts, or `globals.css`.
- Do not add a new font family.
- Do not store skill names without a `Skill` id.
- Do not mint a Skill on every keystroke; only on Other Add.
- Do not change `@media (max-width: 1024px)` stacking or the 555px desktop card heights.
- Do not add files other than those listed.
- If `npx tsc --noEmit` fails, stop and report the error.

## 7. Verification

- Desktop `/profile`: both cards Inter (not Instrument). Jumping steps bolds only the current left title (700); incomplete current is charcoal, completed current stays green.
- Experience: company placeholder `e.g. ABTalks`.
- Skills: quick-add chips for the 2026 list; Other chip; focusing the search opens the cream/white option box with the full list + Other; typing filters; picking a chip/option adds a tag; Other then type `LangGraph` (or a made-up name) + Add claims it after save; reload keeps it. ≤1024 still stacks.
- `npx tsc --noEmit` passes.

## 8. Commit message

`Profile wizard: Inter, bold current step, ABTalks placeholder, 2026 skill picks`
