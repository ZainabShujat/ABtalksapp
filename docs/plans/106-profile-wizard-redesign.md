# 106 — /profile redesign: the profile-completion wizard

Reference build: `docs/reference-profile/` (`index.html`, `style.css`,
`script.js`). Static HTML/CSS/JS, Figma frame `1323:5` (1920 × 900).

## 1. Goal

Replace the stacked-accordion `/profile` with the reference's completion
wizard: a left profile card (clay progress ring, percentage badge, section
checklist) beside a form card that shows **one section at a time** with
Previous / Next. The page becomes only that — no Evidence section, no Account
blocks. No schema changes, no new tables.

## 2. Current behavior

`src/app/profile/page.tsx` (528 lines, Server Component) renders inside
`DashboardShell` and stacks **ten** `ProfileSection` collapsibles, each holding
a client form with its own Save button, plus an Account group underneath.

- Data comes from `getCandidateDetail(userId)` (`src/repositories/candidate-detail.ts`) — canonical 078 candidate tables, not flag-branched.
- Each section saves independently: `useSectionSave` → the matching action in `src/app/actions/candidate-profile-actions.ts` → Zod schema in `src/lib/validations/candidate-profile.ts` → repository write → `revalidatePath("/profile")` + `router.refresh()`.
- Completion is server-computed: `computeCompleteness(detail, { hasAny })` in `src/features/profile/completeness.ts` returns a weighted `score` (0–100, capped; weights sum to 125) and nine `SectionStatus` rows. Rendered by `ProfileStrength`.
- Shared form primitives live in `src/components/profile/fields.tsx` and are built on shadcn `Input` / `Select` / `Textarea` / `Checkbox`.
- **Nothing outside `/profile` imports any of these files.** Verified: the only cross-directory importer of `@/components/profile/*` is `src/app/profile/page.tsx`, and `./fields` is imported only by the eight section components. This is what makes editing them in place safe.

The sidebar and topbar the reference draws **already exist** — `DashboardShell`
→ `DashboardSidebar`, and `NAV_ITEMS` in
`src/components/dashboard-hub/nav-items.ts` is already
Dashboard / Workshops / Marketplace / Jobs / Achievements / Profile, in that
order. None of the reference's shell markup gets ported.

## 3. Decisions taken (confirmed) and their consequences

| # | Decision |
|---|---|
| D1 | **Full wizard.** One section per screen, Previous / Next in the card footer, checklist jumps freely. |
| D2 | **Completion stays server-computed.** The ring reads `computeCompleteness().score`; ticks read per-section `complete`. Nothing about "I clicked Next" is stored anywhere — no localStorage, no new column. |
| D3 | **No References section, no DB changes.** The reference's tenth step is dropped; the wizard has **nine** steps. No migration, no `CandidateReference` table. |
| D4 | **No Evidence & achievements, no Account block.** `EvidenceSection`, `ProfileStrength`, the Refer & earn card, My redemptions and `SoundPreferences` come off the page. Their component files stay in the repo, unimported. |
| D5 | **Resume upload is UI only.** The drop-zone in Basic Information renders, validates type and size client-side, and shows the chosen filename — and persists nothing. Wiring (upload + profile autofill) is a later plan. |
| D6 | **Skills keep the catalog.** `SkillCombobox` against `Skill` rows stays, restyled as the reference's chips + Quick adds + dashed empty box. Self-rating and the verified badge are preserved. Free-text skills would make those candidates undiscoverable in `/hire`. |
| D7 | **Page-scoped CSS file**, following `landing.css` / `hire-scout.css`: tokens under a `.pw-root` scope, `pw-` class prefix, imported by the wizard component. Form controls become design-native, not shadcn. |

### Consequences that follow from the above, flagged for confirmation

These are not in the reference and not covered by an answer above. Each is a
one-line change if the call goes the other way.

| # | Call taken | Why |
|---|---|---|
| C1 | **Avatar pencil is omitted.** | A photo picker that silently discards the photo is worse than no control. It returns with the upload plan (D5's follow-up). |
| C2 | **Accent is `#E05226`, not the reference's `#F15A3A`.** | The reference expects its *own* sidebar to be `#F15A3A`; ours stays platform orange `#E05226`. Two oranges 12 px apart in the same viewport reads as a bug. This is the one deliberate colour deviation. |
| C3 | **Topbar Reset / "Refill Complete Form" buttons are dropped.** | Test harness for the static prototype. |
| C4 | **Chat FAB is dropped.** | `ENABLE_CHATBOT` has its own surface; `DashboardShell` carries no FAB anywhere else. |
| C5 | **`primaryPersona` stays in Basic Information.** | `basicInfoSchema` requires it and it is the card's subtitle ("Student"). The reference has no such field, so it is placed at the head of the city/state row. |
| C6 | **The college picker stays in Education.** | It writes `collegeId` against the 54,651-row `College` catalog. The reference draws a plain text field; ours keeps the search, styled as one 12-col field. |
| C7 | **Extra links stay in Links.** | `CandidateLink` rows (type + label + url) below the four fixed fields. The reference has only the four. |
| C8 | **The card is allowed to scroll.** | The reference is engineered for `overflow:hidden` at 1920 × 900 with its own 64 px topbar and no footer. Inside `DashboardShell` (header + footer + different padding) that is unreachable without hiding chrome. The height media queries are ported as spacing tighteners, not as a no-scroll guarantee, and `fitBody()` / `.scrollable` are not ported. |

## 4. The nine steps

Order is the reference's, minus References.

| # | Step | Checklist source | Saves? |
|---|---|---|---|
| 1 | Basic Information | `SectionKey "basic"` | yes → `saveBasicInfoAction` |
| 2 | Experience | `"experience"` | yes → `saveExperienceAction` |
| 3 | Education | `"education"` | yes → `saveEducationAction` |
| 4 | Projects | `"projects"` | yes → `saveProjectsAction` |
| 5 | Mock Interview | derived: `attempts.length > 0` | **no** — read-only |
| 6 | Skills | `"skills"` | yes → `saveSkillsAction` |
| 7 | Certifications | `"certifications"` | yes → `saveCertificationsAction` |
| 8 | Links | `"links"` | yes → `saveLinksAction` |
| 9 | Career Preferences | `"preferences"` | yes → `savePreferencesAction` |

`computeCompleteness` also returns an `"evidence"` row. It carries weight 0, so
dropping it from the checklist changes no score. **Do not edit
`completeness.ts`** — filter at the call site.

Mock Interview has no completeness key. It shows the reference's amber warning
mark when there are no attempts and a green tick when there is at least one —
both derived from real data, consistent with D2.

## 5. Files to touch

### New

| Path | Note |
|---|---|
| `src/components/profile/profile-wizard.css` | `[new]` Page-scoped design system: `--pw-*` tokens under `.pw-root`, `pw-` classes. The port of `docs/reference-profile/style.css`. |
| `src/components/profile/profile-wizard.tsx` | `[new]` **Client.** Owns step index, renders the workspace grid, the profile card, the form-card header/body/footer, celebration. Provides `ProfileWizardContext`. Imports the CSS. |
| `src/components/profile/wizard-context.tsx` | `[new]` **Client.** `ProfileWizardProvider` + `useProfileWizard()` → `{ formId, onSaved, setDirty }`. Exists so section components receive callbacks without a function crossing the Server→Client boundary. |
| `src/components/profile/profile-card.tsx` | `[new]` **Client.** Ring SVG (gradient + clay filters, r = 48.5), avatar, name / persona / last-updated, percentage badge, checklist. |
| `src/components/profile/wizard-fields.tsx` | `[new]` **Client.** Design-native primitives: `PwField`, `PwInput`, `PwTextarea` (with counter), `PwSelect`, `PwMonthYear`, `PwCheckbox`, `PwCheckGroup`, `PwTogglePanel`, `PwTags`, `PwFileDrop` (inert, D5), `PwNote`, `PwEntryCard`, `PwAddMore`, `PwRow`. |

### Edited

| Path | Note |
|---|---|
| `src/app/profile/page.tsx` | `[edit]` Cut to the wizard: fetch, build the nine step descriptors, render `<ProfileWizard>`. Drops the header card, `ProfileStrength`, `EvidenceSection` and the whole Account group. |
| `src/repositories/candidate-detail.ts` | `[edit]` Add `updatedAt: Date` to the `CandidateDetail` type and to the `select` in `getCandidateDetail`. Additive; no schema change. |
| `src/components/profile/basic-info-section.tsx` | `[edit]` Reference field set + layout; wizard context; resume drop-zone (inert). |
| `src/components/profile/experience-section.tsx` | `[edit]` Entry cards, `+ Add More`, wizard context. |
| `src/components/profile/education-section.tsx` | `[edit]` Same, plus `GradeType` mapping. |
| `src/components/profile/projects-section.tsx` | `[edit]` Same, plus tech-stack chips. |
| `src/components/profile/skills-section.tsx` | `[edit]` Chips + Quick adds + dashed empty box + muted note; keeps the catalog. |
| `src/components/profile/certifications-section.tsx` | `[edit]` Entry cards, section intro copy. |
| `src/components/profile/links-section.tsx` | `[edit]` Leading-icon rows; extra links below. |
| `src/components/profile/preferences-section.tsx` | `[edit]` Toggle panel, tags, check group, work mode, notice period, available-from, relocate. |
| `src/components/profile/mock-interviews-section.tsx` | `[edit]` Reference note copy + primary CTA when empty; existing attempt list otherwise. Stays a Server Component. |
| `src/components/profile/fields.tsx` | `[edit]` **Delete `SectionActions` only.** The wizard footer owns Prev/Next and `PwAddMore` owns "+ Add More", so it has no callers left. Everything else in the file stays until each section stops importing it. |
| `src/features/profile/profile.test.ts` | `[edit]` **One line.** `detailFixture()` builds a full `CandidateDetail` literal, so it needs the `updatedAt` added in §7.7 or `tsc` fails. No assertion changes — see §10. |

### Deleted — last, and only after §10 passes

| Path | Note |
|---|---|
| `docs/reference-profile/index.html` | `[delete]` |
| `docs/reference-profile/style.css` | `[delete]` |
| `docs/reference-profile/script.js` | `[delete]` |
| `docs/reference-profile/` | `[delete]` the now-empty directory |

The prototype is the source of truth **while porting** — §7.1 reads
`style.css` rule group by rule group and §7.5 mirrors the builders in
`script.js`. It comes out only once the React implementation is verified. See
§7.9 for the gate.

### Not touched, and deliberately left unimported

`evidence-section.tsx`, `profile-strength.tsx`, `profile-section.tsx`,
`referral-card.tsx`, `copy-code-button.tsx`, `copy-referral-link-button.tsx`,
`sound-preferences.tsx` — per D4 they stay in the repo, off the page.
`features/profile/completeness.ts`, `candidate-profile-actions.ts`,
`validations/candidate-profile.ts`, `use-section-save.ts`, `skill-combobox.tsx`
— unchanged, and that is the point: this is a presentation change.

## 6. Server vs Client

| Component | Kind |
|---|---|
| `src/app/profile/page.tsx` | **Server** |
| `MockInterviewsSection` | **Server** (rendered by the page, handed to the client wizard as a `ReactNode` in a step descriptor) |
| `ProfileWizard`, `ProfileCard`, `wizard-fields.tsx`, `wizard-context.tsx` | **Client** |
| The eight editable section components | **Client** (already `"use client"`) |

**Server → Client prop passing.** `ProfileWizard` receives:

```ts
type WizardStep = {
  key: string;            // "basic" | "experience" | …
  title: string;
  description: string;
  checklist: "basic" | "experience" | "education" | "projects" | "mock"
           | "skills" | "certifications" | "links" | "preferences";
  complete: boolean;      // resolved on the server
  attention: boolean;     // amber mark when incomplete (mock only)
  savable: boolean;       // false for step 5
  node: React.ReactNode;  // the pre-rendered section
};
```

plus `score: number`, `fullName: string`, `personaLabel: string`,
`imageUrl: string | null`, `updatedAtIso: string`.

Every field is a primitive, an array of primitives, or an already-rendered
element. **No functions, no Lucide icon components, no `Date` objects, no class
instances cross the boundary** — `updatedAt` crosses as an ISO string and is
formatted client-side.

All nine `node`s are serialised on every load (the current page already renders
all ten sections), but **only the active step is mounted**, so eight forms that
render today stop hydrating.

Callbacks travel the other way through React context, not props:
`ProfileWizardProvider` is inside the client wizard, and each section — itself a
client component — reads it with `useProfileWizard()`.

## 7. Steps

### 7.1 `profile-wizard.css` — port the stylesheet

1. Create the file. Scope every token to `.pw-root` (precedent: `.abtalks-landing` in `landing.css`).
2. Tokens, renamed from the reference's `:root` block:
   `--pw-orange:#E05226` (C2), `--pw-orange-soft:#FFECE3`, `--pw-green:#27B95A`,
   `--pw-green-deep:#1E9E4A`, `--pw-text:#273142`, `--pw-muted:#6B7280`,
   `--pw-border:#E5E7EB`, `--pw-card-radius:24px`, `--pw-profile-card-w:326px`,
   `--pw-ws-gap:27px`, `--pw-shadow-card`.
3. Port these rule groups, renaming each class with a `pw-` prefix:
   workspace grid · profile card · ring (`.ring-bg` / `.ring-fg` + the
   `clayRingGrad` / `clayRing` / `clayTrack` filters) · pct badge · ring check ·
   user details · checklist (including `clayPop`, `drawTick`, the completed
   clay disc, `.attention`, `.current`) · form card · section header +
   `.section-progress` + `profileComplete` keyframes · complete pill · rows and
   the 12-col row rules · field / label / req / verified / counter / helper ·
   inputs, select, textarea, `:focus`, `.filled`, `.invalid`, `.error-msg` ·
   checkbox · date-pair · note / section-intro · btn-action · tags (input row,
   add button, quick adds, chips, boxed empty) · file drop · check group ·
   toggle panel + switch · field-linked · entries / entry-head / entry-remove /
   add-more · form-actions + `.pw-btn` variants · the `prefers-reduced-motion`
   block.
4. **Do not port**: `.app`, `.sidebar`, `.topbar`, `.topbar-tools`, `.tool-btn`, `.fab`, `.mobile-menu-btn`, `.scrim`, `.avatar` (and its base64 PNG), `.avatar-edit`, `.photo-input`, `.performance-*` (the reference HTML has no performance panel — that CSS is dead), `body{overflow:hidden}`, `html,body` resets.
5. Media queries: port 1500 / 1280 / 1024 / 820 / 600 for **layout**, and 880 / 860 / 790 / 760 / 730 / 660 for **spacing only** (C8). Drop the `.workspace{padding-bottom:68px}` FAB reservation (C4).
6. Fonts: the profile card uses Instrument Sans via the existing
   `--font-hub-instrument-sans` variable (registered in `src/app/layout.tsx` as
   `hubInstrumentSans`). Do **not** add a Google Fonts `<link>` — the face is
   self-hosted. Note it ships 400/700 only, so a `600` in the port renders as
   700; use 700 where the reference asks for 600 on the card.

### 7.2 `wizard-context.tsx`

```ts
type WizardCtx = {
  formId: string;                     // constant "pw-section-form"
  onSaved: () => void;                // advance (or finish on the last step)
  setDirty: (dirty: boolean) => void; // for the leave-guard
};
```

Export `ProfileWizardProvider` and `useProfileWizard()`. `useProfileWizard()`
throws outside a provider — every section now runs inside the wizard, so a
missing provider is a bug, not a mode.

### 7.3 `profile-card.tsx`

- Ring: `viewBox="0 0 112 112"`, `r=48.5`, `strokeDasharray = 2π·48.5`,
  `strokeDashoffset = C · (1 − score/100)`. Port the two `feDropShadow` filters
  and the gradient verbatim. **Give each `<defs>` id a `useId()` suffix** — the
  reference's bare `clayRingGrad` / `clayRing` / `clayTrack` are document-global
  and would collide with any other inline SVG on the page.
- Avatar: `imageUrl` when present, otherwise the two-letter initials fallback
  (reuse the `initials()` helper currently in `page.tsx` — move it here). No
  pencil (C1). Drop the reference's base64 PNG entirely.
- Percentage badge → `score`; `.show` on the ring check and `.full` on the
  badge at exactly 100.
- Name (underlined, as drawn), persona label, "Last updated …" from
  `updatedAtIso` — format client-side with `Intl.RelativeTimeFormat`.
- Checklist: nine buttons from the step descriptors. Mark = green clay disc when
  `complete`, amber triangle when `attention && !complete`, thin grey circle
  otherwise. `.current` on the active index. Click → `onJump(i)`.

### 7.4 `profile-wizard.tsx`

1. `const [index, setIndex] = useState(initialIndex)` where `initialIndex` is the first step with `complete === false`, else `0`. Computed on the server and passed in — do not recompute from a `useEffect`, which would flash step 1.
2. Layout: `.pw-root > .pw-workspace` grid — `326px | minmax(0,1fr)`, gap 27px — holding `<ProfileCard>` and the form card.
3. Form card header: `.pw-section-progress` bar with `width: {score}%`, `H2` = `${index + 1}. ${title}`, description, and the "Profile Complete" pill.
4. Body: render **only** `steps[index].node`, wrapped in the provider.
5. Footer: Previous (disabled at index 0 — the reference keeps the slot and hides the control via `visibility`) and Next. On the last step Next reads **Save** and takes the green variant.
   - `savable === true` → `<button type="submit" form={formId}>`. The section's own `<form id={formId}>` handles submit, so RHF validation runs and the existing action fires. **No ref plumbing, no imperative submit.**
   - `savable === false` (Mock Interview) → `<button type="button" onClick={advance}>`.
6. `onSaved`: if not the last step, `setIndex(i + 1)`. On the last step, stay put — `useSectionSave` has already fired `router.refresh()`, so the score updates in place.
7. Celebration: an effect that fires when `score` transitions to 100 — add `.finished` to the progress bar, `.celebrate` to the ring wrap, and `.show` to the pill after 500 ms. Guard with a ref so it plays once per mount. When the page **loads** already at 100, apply the finished visual state without replaying the animation (the reference's `applyCompletedVisualState`).
8. Leave guard: Previous and checklist jumps discard unsaved edits in the active step (nothing is persisted between steps — D2). When `dirty`, confirm first with a plain `window.confirm`; do not build a dialog for this.
9. `import "./profile-wizard.css";` at the top.

### 7.5 `wizard-fields.tsx`

Design-native replacements for the shadcn primitives. Each mirrors one reference
builder in `script.js`:

- `PwRow` — the 12-col grouping (`buildFieldGroup`). Takes `cols`.
- `PwField` — label + `*` + optional `Verified` badge + optional counter + control + helper + error (`.pw-error-msg`, shown via `.has-error`).
- `PwInput` / `PwTextarea` — add `.filled` while non-empty (the reference's warm border), clear `.invalid` on input. `PwTextarea` wires the character counter.
- `PwSelect` — native `<select>` with the reference's inline chevron background-image.
- `PwMonthYear` — the `.pw-date-pair`, months as `1…12` and years from `now + 6` down to 1975, matching the reference. Values stay `number | null` so the existing Zod `MONTH` / `YEAR` coercion is untouched.
- `PwCheckbox`, `PwCheckGroup`, `PwTogglePanel` (title + text + switch).
- `PwTags` — chip input: Enter or `,` commits, optional `+` button (`noAddButton` for Skills), optional Quick adds row, optional dashed boxed empty state with `emptyText`.
- `PwEntryCard` — `Entry N` heading + remove ✕; `PwAddMore` — the text-only `+ Add More`.
- `PwNote` — `.pw-note` / `.pw-note-muted`.
- `PwFileDrop` — **inert (D5).** Click or drag-drop, validates extension against `accept` and size against `maxSizeMB`, then renders filename + formatted size + Replace / ✕. Holds the `File` in local state and **submits nothing**. Add a one-line comment at the top of the component saying so, and give it a visible sub-label ("Saved when resume upload ships") so nobody reads it as working storage.

### 7.6 Section components — one pass each

For every editable section, the same five edits. **The RHF wiring, the payload
shape and the action call do not change.**

1. `const { formId, onSaved, setDirty } = useProfileWizard();`
2. `<form id={formId} onSubmit={handleSubmit(async (v) => { if (await save(v)) onSaved(); })}>`
3. `useEffect(() => setDirty(formState.isDirty), [formState.isDirty, setDirty]);`
4. Delete the `<SectionActions>` element. Repeatable sections render `<PwAddMore>` at the end of the body instead.
5. Swap shadcn primitives for the `Pw*` equivalents and wrap fields in `PwRow` at the reference's column widths.

Per-section specifics:

**Basic Information** — rows: `Full name (6) · Phone (6)` | `I am a (4) · City (4) · State / region (4)` | `Country code (4) · Headline (8)` | `Resume (12)` | `About (12)`. Phone carries the green `Verified` badge when `phoneVerified`. Country code `maxLength=2`. About counter 2000, matching `nullableText(2000)`. Persona placement is C5.

**Experience** — `Company (6) · Role (6)` | `Employment type (6) · Location (6)` | `Currently working here (12)` | `Starting from (6) · Ending in (6)` | `Description (12)`. Keep the existing behavior where ticking `isCurrent` nulls the end date; the reference hides the field with `visibility:hidden` — do the same so the grid does not reflow.

**Education** — `School / College (12)` | `Degree (6) · Department (6)` | `Currently studying here (12)` | `Starting from (6) · Ending in (6)` | `Score type (6) · Score (6)` | `Description (12)`. School keeps the college picker (C6). Score type maps reference → `GradeType`: `CGPA_10 → CGPA_10`, `CGPA_4 → GPA_4`, `PERCENTAGE → PERCENTAGE`, `GRADE → GRADE`, and also offer `OTHER`. Label them from `GRADE_TYPE_LABELS` in `src/lib/candidate-vocab.ts`; **do not hard-code the reference's raw enum strings into the UI.** "Ending in" writes `endMonth` + `graduationYear`, unchanged.

**Projects** — `Project name (12)` | `Description (12)` | `Tech stack (12, PwTags)` | `GitHub (6) · Live URL (6)`. Tech-stack helper: "Descriptive only — this does not add to your skills."

**Mock Interview** — when empty, the reference's note plus a `.pw-btn-action` primary linking to `/mock-interviews` (mic icon). When there are attempts, keep today's preview list and the link to the full history. Stays a Server Component, so no context, no form.

**Skills** — `SkillCombobox` in the tag input slot (no `+` button; typing searches the catalog). Selected skills render as chips: name · compact proficiency select · verified badge when `verified` · remove ✕. Quick adds come from the existing `getPopularSkills(10)`. Empty state is the dashed box, "No skills yet. Add at least three." — which matches `MIN_SKILLS = 3` in `completeness.ts`. Below, the muted note about self-rating vs verified, verbatim from the reference.

**Certifications** — section intro verbatim, then `Name (6) · Issuer (6)` | `Issued (6) · Expires (6)` | `Credential URL (12)`.

**Links** — four `field-linked` rows (leading icon, 12-col each): LinkedIn (briefcase), GitHub (code), Portfolio (globe), Résumé (file). GitHub helper: "Username or full profile URL — both are stored as your username." Résumé helper: "Visible to you and admins. Recruiters see it only if you allow it." Extra `CandidateLink` rows follow as entry cards (C7).

**Career Preferences** — `Open to work (PwTogglePanel, 12)` | `Preferred roles (12, tags)` | `Preferred locations (12, tags)` | `Opportunity type (12, check group)` | `Work mode (6) · Notice period (6)` | `Available from (6) · Willing to relocate (6, inline)`. Opportunity type options come from `OPPORTUNITY_TYPE_LABELS`, work mode from `WORK_MODES` — **not** from the reference's hard-coded arrays, which omit "Flexible".

### 7.7 `candidate-detail.ts`

Add `updatedAt: true` to the `select` in `getCandidateDetail` and
`updatedAt: Date` to `CandidateDetail`. The column already exists on
`CandidateProfile` — this is a read-shape change, **not** a schema change. Keep
the `select` explicit (never a full-record return).

`getCandidateDetail` has exactly one caller (`page.tsx`), and `CandidateDetail`
has two other consumers: `completeness.ts` (takes it as a parameter — unaffected
by an added field) and `profile.test.ts` (**builds the literal — needs the one
line in §10**).

If the "Last updated …" line on the profile card is not wanted, drop this whole
step and the test edit with it: nothing else in the plan depends on `updatedAt`.

### 7.8 `page.tsx`

1. Keep the auth guard, the `user` lookup, the missing-`detail` fallback and the `DashboardShell` wrapper with `showSectionNav={false}`.
2. Drop from the `Promise.all`: `getPopularSkills` stays (Skills needs it); **drop** `getMyRedemptions`, `prisma.referral.count` and `headers()` — the referral link and redemptions are gone (D4). Keep `getProfileEvidence` **only** if `computeCompleteness` still needs `{ hasAny }` — it does, and `evidence` is weight 0, so pass `{ hasAny: evidence.hasAny }` and use nothing else from it.
3. Keep `getHistory(userId).catch(...)` and its comment — the MockInterview tables are still absent on production and the page must not 500.
4. Build the nine `WizardStep` descriptors, each with its pre-rendered `node`, and compute `initialIndex`.
5. `return <ProfileWizard … />`.
6. Delete: the header `Card`, `ProfileStrength`, `ProfileSection` usage, `EvidenceSection`, the entire Account `<div>`, and every import those were the only user of.

### 7.9 Teardown — remove the reference prototype

**Last step. Gated on §10 passing in full — all four build gates green and all
sixteen manual checks done.** Not before: §7.1 and §7.5 are ports, and deleting
the source mid-port means re-deriving the clay filters, the keyframes and the
eight height breakpoints from a screenshot.

```bash
rm -rf docs/reference-profile
```

**The three files are staged but not yet committed** — `git status` shows `A `,
and `git ls-tree HEAD -- docs/reference-profile` is empty. Which command is
correct depends on whether they have been committed by the time you get here,
so check first:

```bash
git ls-tree -r --name-only HEAD -- docs/reference-profile
```

- **Output is non-empty** (they were committed): `git rm -r docs/reference-profile`. The deletion is a normal tracked change, shows in the diff, and is **fully recoverable** from history afterwards.
- **Output is empty** (still only staged): `git rm -r --cached docs/reference-profile && rm -rf docs/reference-profile`. Because they never reached a commit, the blobs become unreferenced and this is **effectively unrecoverable** — `git fsck --lost-found` may still find them until the next `gc`, and nothing else will.

Either way:

- Delete the **directory**, not just the three files. An empty `docs/reference-profile/` is worse than either outcome: git cannot track an empty directory, so it silently persists on one machine and nowhere else.
- If in doubt, prefer committing the reference **before** deleting it: one commit that adds it, one that removes it, and the prototype stays in history for anyone who later asks what the port was made from. That is the safer sequence and costs nothing.
- Nothing imports these files — they are static prototype assets under `docs/`, outside the Next build. Removing them cannot break `npm run build`. Re-run the build anyway (§10) if anything else moved in the same pass.
- The plan you are reading is the durable record of what the prototype specified. Do not copy chunks of `style.css` or `script.js` into it as a hedge — §7 already carries every decision that mattered.

## 8. Guardrails for Cursor (DO NOT)

- **DO NOT touch `prisma/schema.prisma`, write a migration, or run any `db:*` script.** There is no DB work in this plan (D3). If a field seems to be missing, stop and ask — do not add a column.
- **DO NOT add a References section**, a `CandidateReference` model, or a References checklist item.
- **DO NOT build resume or photo upload.** No `@vercel/blob`, no S3 client, no `/api/upload`, no new env var. The drop-zone is inert by design (D5).
- **DO NOT modify** `src/features/profile/completeness.ts`, `src/app/actions/candidate-profile-actions.ts`, `src/lib/validations/candidate-profile.ts`, or `src/components/profile/use-section-save.ts`. The wizard is a presentation change over the existing save pipeline. If a payload seems not to fit, the section component is wrong, not the schema.
- **DO NOT delete** `evidence-section.tsx`, `profile-strength.tsx`, `profile-section.tsx`, `referral-card.tsx`, `copy-code-button.tsx`, `copy-referral-link-button.tsx` or `sound-preferences.tsx`. They stay in the repo, unimported (D4).
- **DO NOT replace the catalog skill picker with free-text tags.** `/hire` searches on `CandidateSkill` rows; free text would silently drop these candidates out of recruiter search (D6).
- **DO NOT port the reference's sidebar, topbar, Reset / Refill buttons, chat FAB, mobile menu, scrim, or the base64 avatar PNG.** `DashboardShell` supplies the shell and its nav already matches.
- **DO NOT add a Google Fonts `<link>` for Instrument Sans.** It is self-hosted at `--font-hub-instrument-sans`.
- **DO NOT introduce global CSS.** Every rule belongs inside `.pw-root` in `profile-wizard.css`. Do not add anything to `globals.css`.
- **DO NOT pass functions, Lucide icon components, `Date` objects or class instances** from `page.tsx` into `ProfileWizard`. Callbacks go through `wizard-context.tsx`; `updatedAt` crosses as an ISO string.
- **DO NOT use `<Button asChild>` or `<Button render={<Link>}>`.** Where a shadcn button survives at all, use `buttonVariants` directly on the `<Link>` (Base UI button semantics). The wizard's own buttons are plain `<button>` with `pw-` classes.
- **DO NOT reach for `useEffect` to drive the step index, and DO NOT persist step state to `localStorage`.** Completion is server-truth (D2).
- **DO NOT reintroduce the reference's `fitBody()` / `.scrollable` logic or `body{overflow:hidden}`.** The page scrolls (C8).
- **DO NOT create new abstraction files beyond the five listed in §5.** No `use-wizard-step.ts`, no `wizard-steps.ts` registry, no `section-config.ts` — the step array is built inline in `page.tsx`.
- **DO NOT use `console.error`.** `lib/logger.ts` only, and only on the server.
- **DO NOT add `any`.** Strict TS.
- **DO NOT delete `docs/reference-profile/` until §10 passes in full** (§7.9). The files are staged but may not be committed — check `git ls-tree HEAD` first and pick the right command, because in the uncommitted case the delete is effectively irreversible. And **do not copy it into `src/`, `public/`, or anywhere in the build** to "keep a copy": it is a prototype, not an asset, and a stray `index.html` or `script.js` under `src/` will be picked up by lint and by future greps as if it were live code.

## 9. DB safety

**Not applicable — this plan changes no schema, writes no migration, and runs no
seed or backfill.** The only repository edit (§7.7) adds an existing column to a
`select`. No Neon branch, no snapshot, no commit checkpoint needed.

## 10. Verification

### Build gates
```bash
npx tsc --noEmit
```
```bash
npm run lint
```
```bash
npm run build
```
```bash
npm run test:profile
```
`profile.test.ts` is **not a vitest suite** — it is a `tsx` script with its own
`assert` / `suite` helpers and a `process.exit(1)`. Run it through the npm
script; `npx vitest run` will not execute it.

It needs **exactly one edit**, and no more: `detailFixture()` (~line 454) builds
a full `CandidateDetail` object literal, so the `updatedAt` added in §7.7 must
be added there too — `updatedAt: new Date("2026-01-01T00:00:00Z"),`. Without it
`npx tsc --noEmit` fails on a missing property.

Nothing else in that file may change. In particular these assertions must still
pass untouched, because they are the invariants this plan promises not to
disturb:

- `computeCompleteness`: `evidence` has weight 0; the score is capped at 100.
- `candidate-detail.ts`: whole arrays selected, no `take: 1`, legacy mirrors still written, `studentProfile` never read as a source of truth.
- `page.tsx`: still contains `getCandidateDetail`, still contains no `studentProfile`. **Both survive the §7.8 rewrite — verify they still hold after gutting the page.**

If any assertion beyond the fixture line needs changing, stop: something
outside this plan's scope was changed.

### Manual, signed in as a student with a `CandidateProfile`

1. `/profile` opens on the first incomplete section, not always section 1.
2. The ring, the `%` badge and the checklist ticks agree with what is actually saved. Reload after a save: the number is the same (it comes from the DB, not from having clicked Next).
3. Next on Basic Information with Full name cleared → inline error, focus moves to the field, **the step does not advance**.
4. Next with valid data → toast, the section saves, the wizard advances, and the ring moves if that section just became complete.
5. Previous returns without saving; with unsaved edits it confirms first.
6. Checklist clicks jump to any section, including forward past incomplete ones.
7. Experience / Education / Projects / Certifications: `+ Add More` adds an entry, ✕ removes it, removing the only entry clears it rather than deleting it.
8. Ticking "Currently working here" hides "Ending in" without the grid reflowing; saving stores a null end date.
9. Skills: typing searches the catalog, Quick adds insert, chips remove, an already-verified skill still shows its badge, the dashed empty box appears at zero skills.
10. Resume drop-zone: picking a PDF shows name and size; a `.txt` and a 6 MB file are both rejected with the reference's error copy; **reloading loses it** — that is correct (D5).
11. Mock Interview: with no attempts, the note plus the CTA; with attempts, the list. Next advances without saving.
12. Career Preferences: Next reads **Save**, is green, and does not advance. Reaching 100% plays the header sweep, the ring glow and the "Profile Complete" pill once. Reload at 100% shows the finished state with no replay.
13. `/profile` shows **no** Evidence section, no Refer & earn, no redemptions, no sound preferences (D4).
14. Widths 1920 / 1440 / 1280 / 1024 / 820 / 375: the two-column grid collapses to one at 1024, the 3-col rows go 2-col at 820 and 1-col at 600, and nothing overflows horizontally.
15. `prefers-reduced-motion: reduce` — no ring animation, no celebration sweep.
16. Console is clean: no hydration warning, no duplicate-SVG-id warning, no "function passed to Client Component" error.

### Files that should have changed
The five new files in §5, plus exactly: `src/app/profile/page.tsx`,
`src/repositories/candidate-detail.ts`, `src/components/profile/fields.tsx`,
the nine section components, and the single fixture line in
`src/features/profile/profile.test.ts`. **Nothing under `prisma/`, nothing in
`globals.css`, nothing else in `src/features/`, and nothing in
`src/app/actions/` or `src/lib/validations/`.**

### Then, and only then
Run §7.9 — delete `docs/reference-profile/`, choosing the command by whether
the files reached a commit. Confirm afterwards that `docs/reference-profile` no
longer exists on disk **and** that it is gone from the index
(`git ls-files docs/reference-profile` returns nothing).

## 11. Commit message

```
feat(profile): rebuild /profile as the completion wizard

Replaces the stacked accordion with the reference design: a profile card
carrying the clay progress ring, percentage and section checklist, beside a
form card that shows one section at a time with Previous/Next.

- Nine steps, one per screen; Next validates and saves that section through
  the existing server action, then advances.
- Completion stays server-computed from computeCompleteness — the ring and
  the ticks report what is actually saved, not which steps were visited.
- Page-scoped profile-wizard.css (.pw-root, --pw-* tokens), following the
  landing.css / hire-scout.css pattern.
- Skills keep the catalog picker; free-text skills would drop candidates out
  of /hire search.
- Evidence & achievements and the Account blocks come off the page; their
  components stay in the repo.
- Resume drop-zone renders but persists nothing — upload and profile autofill
  land in a later plan.

The static prototype under docs/reference-profile/ is removed now that the
React implementation supersedes it.

No schema change, no migration. The section save pipeline (actions, Zod
schemas, repositories, completeness weights) is untouched; profile.test.ts
changes by one fixture line only, for the added updatedAt field.
```
