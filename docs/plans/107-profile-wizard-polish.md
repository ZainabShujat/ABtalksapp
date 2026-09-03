# 107 — /profile wizard: viewport layout, performance panel, leave dialog, avatar upload, celebration

Follow-on to `106-profile-wizard-redesign.md`, which is **implemented** (commit
`6c5593f` "profile v2"). This plan is five deltas on top of the shipped wizard.

> **Numbering note.** Two plans carry the number 106: this wizard's plan and
> `106-resume-upload-parsing-and-strength.md`. `docs/CHANGELOG.md` uses "Plan
> 106" to mean the **résumé** plan. Neither file is renamed here — duplicates
> already exist in `docs/plans/` (103 appears four times, 105 twice) — but cite
> them by filename, not by number.

## 1. Goal

Five changes: the wizard fills the viewport so the footer sits below the fold;
the profile card regains the Profile performance panel from the design; the
unsaved-changes prompt becomes a real dialog instead of `window.confirm`; the
avatar pencil works, backed by a public Vercel Blob store; and the 100%
celebration sequences properly (green sweep → orange → "Profile Complete").

## 2. Current behavior

`/profile` renders `ProfileWizard` inside `DashboardShell`. **Ten** steps —
Basic Information, Experience, Education, Projects, Mock Interview, Skills,
Certifications, Résumé, Links, Career Preferences. Résumé arrived with the
résumé plan and is a real step with upload, parsing and a strength score.

What is wrong today, matched to each request:

| Symptom | Cause |
|---|---|
| Cards look small; footer visible without scrolling | `.pw-profile-card` is a fixed `height: 629px`, `.pw-workspace` is `align-items: start`, and `.pw-root` has no height floor — so the content block is shorter than the viewport and `DashboardFooter` rides up into view. |
| No Profile performance panel | `106` explicitly told Cursor not to port `.performance-*` ("the reference HTML has no performance panel — that CSS is dead"). The panel exists in the Figma inspo but not in `docs/reference-profile/index.html`. **This plan reverses that instruction.** |
| Browser alert on Previous | `profile-wizard.tsx:82` — `if (dirty && !window.confirm(LEAVE_MESSAGE)) return;` |
| Pencil does nothing | It was never built (`106` C1 omitted it). `.pw-avatar` is inside a container marked `aria-hidden`. |
| Celebration reads muddled | `setBarFinished(true)` and the width change fire in the same tick, so the green→orange keyframe animation runs *during* the 0.7s width sweep instead of after it. |

Also present and worth fixing while here: the footer's Next button lives
**outside** the form and has no access to `useSectionSave`'s `saving` flag, so a
double-click fires the save action twice.

Existing infrastructure this plan builds on:

- `@vercel/blob` ^2.8.0 is installed; `src/features/resume/storage.ts` is the house pattern — explicit token, project-specific env names, content-addressed pathname, graceful degradation when unconfigured.
- `src/components/ui/dialog.tsx` (shadcn on Base UI) exports `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`.
- `User.image` already exists (`String?`) and already feeds the profile card, `DashboardSidebar` and `DashboardHeader`.

## 3. Decisions taken (confirmed)

| # | Decision |
|---|---|
| E1 | **Profile performance panel ships with placeholder values** — Search appearances `1`, Recruiter actions `0`, hard-coded, replaced when tracking is built. |
| E2 | **A new PUBLIC Vercel Blob store** for avatars, its own env vars, following `features/resume/storage.ts` exactly. The résumé store stays private and is not touched. |
| E3 | **The avatar URL persists to `User.image`.** No schema change. One photo everywhere — profile card, sidebar, header. |
| E4 | **Three-button leave dialog**: Yes = save then leave · No = discard then leave · Cancel = stay. Applies to Previous **and** checklist jumps. |

### One flag on E1

The panel will tell every candidate "Search appearances 1" when nothing
measures it. It is a small, near-empty number rather than an inflated one, so
the exposure is low — but it is still a claim the product cannot currently
back. Mitigation, which the design already has room for: the inspo's ⓘ icon in
the panel header carries a tooltip. Use it to say so plainly —

> "Recruiter activity tracking is rolling out. These figures will start moving
> once it is live."

That keeps the panel in place, as asked, without the numbers reading as
measured. If you would rather they read as empty until real, change the two
constants to `0` / `0` — one line, §5.2.

## 4. Files to touch

### New

| Path | Note |
|---|---|
| `src/features/profile/avatar-storage.ts` | `[new]` **Server-only.** Public blob read/write/delete for avatars. Mirrors `features/resume/storage.ts`. |
| `src/components/profile/avatar-editor.tsx` | `[new]` **Client.** The pencil button, hidden file input, client-side square downscale, upload call, pending state. |
| `src/components/profile/leave-dialog.tsx` | `[new]` **Client.** The three-button unsaved-changes dialog. |

### Edited

| Path | Note |
|---|---|
| `src/components/profile/profile-wizard.css` | `[edit]` Viewport-fill layout; port `.performance-*`, `.avatar-edit`, `.photo-input`; sequence the celebration. |
| `src/components/profile/profile-wizard.tsx` | `[edit]` Replace `window.confirm`; pending-target navigation; `saving` in context; sequenced celebration; `role="progressbar"`; focus on step change. |
| `src/components/profile/profile-card.tsx` | `[edit]` Mount `AvatarEditor`; fix the `aria-hidden` wrapper; render the performance panel; `aria-current="step"`. |
| `src/components/profile/wizard-context.tsx` | `[edit]` Add `saving: boolean` and `setSaving`. |
| `src/components/profile/use-section-save.ts` | `[edit]` Report `saving` into the wizard context so the footer button can disable. |
| `src/app/actions/candidate-profile-actions.ts` | `[edit]` Add `uploadAvatarAction(formData: FormData)`. Does not go through `runSection` — it takes a `File`, not a Zod object. |
| `src/app/profile/page.tsx` | `[edit]` Pass `performance`, `avatarUploadEnabled`. |
| `.env.example` | `[edit]` Document the two new vars. |

**No schema change. No migration. `prisma/` is not touched.**

## 5. Steps

### 5.1 Viewport fill and the footer

`DashboardShell` is `min-h-svh` flex-column: `DashboardHeader` (sticky,
`h-[72px]` + 1px bottom border) → `<div className="flex-1">{children}</div>` →
`DashboardFooter`. Give the wizard a height floor of exactly the remaining
viewport and the footer lands just past the fold.

In `profile-wizard.css`:

1. Add to the `.pw-root` token block: `--pw-shell-offset: 73px;` (72px header + 1px border). Comment it as tied to `dashboard-header.tsx` so a header change is traceable.
2. ```css
   .pw-root { min-height: calc(100svh - var(--pw-shell-offset)); display: flex; flex-direction: column; }
   ```
   `svh`, not `vh` — `DashboardShell` already uses `min-h-svh`, and `vh` on mobile leaves a gap the size of the browser chrome.
3. `.pw-workspace` — `flex: 1; min-height: 0;` and **`align-items: stretch`** (was `start`).
4. `.pw-profile-card` — drop the fixed `height: var(--pw-profile-card-h)`; use `min-height: var(--pw-profile-card-h)` and let stretch do the rest. Keep `overflow: hidden`.
5. `.pw-checklist` already has `flex: 1 1 auto; justify-content: space-between`, so it absorbs the extra height and the ten items re-space themselves. The performance panel (§5.2) pins to the bottom with `margin-top: auto`.
6. `.pw-form-card` already `min-height: min(var(--pw-form-card-h), 100%)`; under stretch it fills. No change.
7. **Below 1024px**, undo it: in the existing `@media (max-width: 1024px)` block set `.pw-root { min-height: 0 }` and `.pw-profile-card { min-height: 0 }`. On a phone the cards stack, and a viewport-height floor would otherwise open a large empty gap under the profile card.

Do **not** touch `DashboardFooter` or `DashboardShell` — the footer moving below
the fold is a consequence of the content height, not a change to the footer.

### 5.2 Profile performance panel

Port the `.performance-*` rules from `docs/reference-profile/style.css` (lines
~336–362) into `profile-wizard.css` with `pw-` prefixes: `.pw-performance-section`
(`margin-top: auto`, `background: #FDF5F1`, `border-radius: 18px`, `padding: 16px`),
`.pw-performance-header`, `.pw-performance-grid` (`1fr 1px 1fr`), `.pw-grid-divider`,
`.pw-col-label`, `.pw-col-value` (26px, 800, orange) with its `.pw-dot` and
`.pw-chev`. Include the `@media (max-width: 600px)` single-column variant.

In `page.tsx`, above the component:

```ts
/**
 * Placeholder figures — nothing measures these yet.
 *
 * Search appearances needs a write when a candidate is returned by a /hire
 * search; recruiter actions needs one when a recruiter opens or shortlists
 * them. Neither exists. When that tracking lands, replace this constant with
 * the real read and delete this comment — no other file needs to change.
 */
const PROFILE_PERFORMANCE = { searchAppearances: 1, recruiterActions: 0 } as const;
```

Pass it to `ProfileWizard` → `ProfileCard` as a plain object. Render the ⓘ with
the tooltip copy from §3, as a `title` attribute plus `aria-label` (no tooltip
library — this is one string).

### 5.3 Leave dialog

**`wizard-context.tsx`** — extend the contract:

```ts
export type WizardCtx = {
  formId: string;
  onSaved: () => void;
  setDirty: (dirty: boolean) => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
};
```

**`use-section-save.ts`** — it already owns a local `saving` state; also push it
into the context so the footer can read it. Guard with the existing
`useProfileWizard()`; every section runs inside the provider, so no optional
path is needed.

**`leave-dialog.tsx`** — a controlled `Dialog` built from `@/components/ui/dialog`:

- `DialogTitle` "Save your changes?"
- `DialogDescription` "You have unsaved changes in this section."
- `DialogFooter`: **Cancel** (ghost, closes and stays) · **No** (outline, "Don't save") · **Yes** (primary, "Save"). Yes is the default focus.
- Props: `open`, `onOpenChange`, `onSave`, `onDiscard`, `onCancel`.
- Escape and overlay click both resolve to **Cancel** — the safe outcome.

**`profile-wizard.tsx`** — replace `requestLeave`:

```ts
const [pendingTarget, setPendingTarget] = useState<number | null>(null);
const pendingRef = useRef<number | null>(null);

function requestLeave(next: number) {
  if (next === index) return;
  if (!dirty) { setIndex(next); return; }
  setPendingTarget(next);           // opens the dialog
}
```

- **Cancel** → `setPendingTarget(null)`. Nothing else.
- **No** → `setDirty(false); setIndex(pendingTarget!); setPendingTarget(null);`
- **Yes** → `pendingRef.current = pendingTarget; setPendingTarget(null);` then `document.getElementById(PW_FORM_ID)?.requestSubmit()`. Do **not** navigate here.

`onSaved` becomes the single navigation point:

```ts
function onSaved() {
  const target = pendingRef.current;
  pendingRef.current = null;
  setDirty(false);
  if (target !== null) setIndex(target);
  else if (!last) setIndex((i) => i + 1);
}
```

Two traps to close, both real:

- **Failed validation.** RHF never calls the submit handler, so `onSaved` never runs and the user correctly stays put with errors showing. But `pendingRef` is left set. If they then fix the field and press **Next**, they would jump to the stale target instead of advancing. So: **the Next button clears `pendingRef.current = null` before submitting.** Clear it on `index` change too.
- **Double submit.** The footer's Next must be `disabled={saving}` and read "Saving…" while the action is in flight, using the new context flag. Without this, two clicks fire two writes.

Out of scope, deliberately: no `beforeunload` guard. Closing the tab with
unsaved edits will not warn — the browser's own dialog cannot be styled and
this was not the option chosen.

### 5.4 Avatar upload

**Provisioning (you, not Cursor):** create a **public** Vercel Blob store and
set `avatar_READ_WRITE_TOKEN` and `avatar_STORE_ID`. Public matters: the profile
card renders `<img src>` directly, and a private store would need a proxy route
and would hide the photo from signed-out and recruiter views.

**`src/features/profile/avatar-storage.ts`** — copy the shape of
`features/resume/storage.ts`, changing only what must change:

- `TOKEN_ENV = "avatar_READ_WRITE_TOKEN"`, `STORE_ID_ENV = "avatar_STORE_ID"`. Read via `process.env[NAME]` bracket access, same reason as the résumé file.
- Keep `storeBindingMatches()` — it catches a token pointing at a different store, which otherwise authenticates fine and writes where nobody is looking.
- `put(pathname, buffer, { token, access: "public", contentType, addRandomSuffix: false, allowOverwrite: true })`.
- `avatarPathname(userId, contentHash, ext)` → `avatars/${userId}/${contentHash}.${ext}`. Content-addressed and built only from server-side values, so no user input steers the path.
- `deleteAvatarBlob(url)` — `del()` accepts the URL form.
- `isAvatarStorageConfigured()`.

**`uploadAvatarAction(formData: FormData)`** in `candidate-profile-actions.ts`:

1. `auth()`; reject without a session.
2. Pull `formData.get("file")`; reject if not a `File`.
3. **Size** ≤ **2 MB**. The client downscales first, so anything larger is a client that skipped it.
4. **Type**: allow `image/jpeg`, `image/png`, `image/webp` **only**. Explicitly reject SVG — an SVG served from our own origin is a script-execution vector.
5. **Sniff the magic bytes** and reject on mismatch. `file.type` is client-supplied and must never be the only check: `FF D8 FF` (JPEG), `89 50 4E 47` (PNG), `RIFF....WEBP` (WebP).
6. `sha256` the bytes → pathname → `storeAvatarFile`.
7. Before writing, if the current `User.image` is a URL in our avatar store, `deleteAvatarBlob` it. Content-addressing means a new photo is a new path, so without this every replacement leaks a blob.
8. `prisma.user.update({ where: { id }, data: { image: url }, select: { id: true } })`.
9. `revalidatePath("/profile")`; return the standard `{ ok: true } | { ok: false, message }`.
10. When storage is unconfigured, return `{ ok: false, message: "Photo upload is not available right now." }` and `logger.warn` — never throw.

**`avatar-editor.tsx`** (client):

- Pencil `<button type="button" aria-label="Change profile photo">` + a visually hidden `<input type="file" accept="image/jpeg,image/png,image/webp">`.
- On pick: draw to a canvas, centre-crop to a square, resize to **512×512**, export `image/jpeg` at `0.85`. This is what keeps the upload small and the stored asset uniform; the server still re-validates.
- `FormData` → `uploadAvatarAction` → on success `router.refresh()`, on failure `toast.error(message)` (sonner is already the house toaster).
- Disable the button and show a spinner while in flight.
- Render nothing when `avatarUploadEnabled` is false.

**`profile-card.tsx`**: the pencil sits inside `.pw-ring-wrap`, which is fine,
but `.pw-avatar` currently carries `aria-hidden` — **move that attribute onto
the `<img>`/initials element only**, so the button is not inside a hidden
subtree and stays reachable by keyboard and screen reader.

**CSS**: port `.avatar-edit` and `.photo-input` from the reference (~lines
231–245) as `.pw-avatar-edit` / `.pw-photo-input`.

**No `next.config` change** — the card uses a plain `<img>`, not `next/image`,
so `remotePatterns` does not apply. If anyone later switches to `next/image`,
that is when the blob host must be allowed.

### 5.5 Celebration sequencing

Today the width change and the colour keyframe start together. Sequence them:

1. On the transition to 100, let the width sweep run first (`transition: width 0.7s ease` — already there; this is the "swipe right").
2. Listen for `transitionend` on the bar (property `width`), with a `750ms` timeout as a fallback for the case where the bar was already full and no transition fires. Then add `pw-finished`, which runs the existing green → bright green → warm orange keyframes.
3. 500ms after `pw-finished`, show the "Profile Complete" pill (already the behaviour; keep it, chained off step 2 rather than off the score change).
4. Loading a profile that is *already* at 100 keeps the current `pw-restored` path: final state, no replay.
5. Under `prefers-reduced-motion: reduce`, skip to the finished state and the pill with no sweep and no glow. The stylesheet's blanket reduced-motion rule kills the animation but the JS chain still waits on a `transitionend` that will not come — the timeout fallback in step 2 covers it, so this needs no extra branch, but verify it.

### 5.6 Accessibility and polish (the scope of "cleaner")

Concrete and bounded — do these and nothing more:

- Progress bar: `role="progressbar"`, `aria-valuenow={score}`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label="Profile completion"`.
- On step change, move focus to the section `<h2>` (`tabIndex={-1}`). Today focus is dropped on the body after every Next, which strands keyboard and screen-reader users.
- Checklist: `aria-current="step"` on the active item; a visually hidden "Step N of 10" inside each button.
- Footer Next: `disabled={saving}`, label "Saving…" while in flight (§5.3).
- Keep the section body's focus-visible rings intact — do not remove outlines anywhere.

## 6. Server vs Client

| Component | Kind |
|---|---|
| `page.tsx` | **Server** — passes `performance` (plain object) and `avatarUploadEnabled` (boolean) |
| `avatar-storage.ts` | **Server-only** (`import "server-only"`, same as the résumé module) |
| `uploadAvatarAction` | **Server Action** |
| `ProfileWizard`, `ProfileCard`, `AvatarEditor`, `LeaveDialog` | **Client** |

Server→Client props stay primitives and plain objects. `AvatarEditor` imports
the action directly — a Server Action reference is not a function prop crossing
the boundary.

## 7. DB safety

**No schema change, no migration, no seed.** The only write is
`prisma.user.update` on the existing `User.image` column, with an explicit
`select`.

**Two new environment variables** — this is the deployment-affecting part:

| Var | Required? | Without it |
|---|---|---|
| `avatar_READ_WRITE_TOKEN` | for uploads | The pencil does not render; everything else on `/profile` is unaffected. |
| `avatar_STORE_ID` | no (checked only) | The token/store correspondence check is skipped. |

The store must be created with **public** access. A private store accepts the
token, then rejects every `access: "public"` write — the same failure mode the
résumé module logs explicitly. Reproduce that error-message handling.

## 8. Guardrails for Cursor (DO NOT)

- **DO NOT touch `prisma/schema.prisma` or write a migration.** `User.image` already exists.
- **DO NOT use `window.confirm`, `window.alert` or `window.prompt` anywhere in this feature.** The dialog is a component. This is the whole point of §5.3.
- **DO NOT add a `beforeunload` handler.** Explicitly out of scope.
- **DO NOT touch the résumé blob module or its env vars.** `resume2_*` stays private and unmodified; avatars get their own store. Never widen the résumé store to public — résumés carry a phone number, an email and a home city.
- **DO NOT accept SVG avatars**, and **do not trust `file.type`** — sniff the magic bytes server-side. A client can claim any MIME.
- **DO NOT do the image resize only on the client.** The client downscale is for upload size; the server still enforces type and byte ceiling. Both, not either.
- **DO NOT modify `DashboardShell`, `DashboardHeader` or `DashboardFooter`.** The footer moves because the content is taller, not because the footer changed.
- **DO NOT invent Profile performance numbers beyond the two constants in §5.2**, and do not wire them to a random or time-based value to look alive.
- **DO NOT navigate inside the dialog's Yes handler.** Navigation happens once, in `onSaved`, or the failed-validation case silently jumps.
- **DO NOT forget to clear `pendingRef` on Next and on `index` change** — the stale-target bug in §5.3 is easy to reintroduce.
- **DO NOT introduce global CSS.** Everything stays inside `.pw-root`.
- **DO NOT use `console.error`** — `lib/logger.ts`, server-side only.
- **DO NOT add `any`.** Strict TS.
- **DO NOT create files beyond the three in §4.**

## 9. Verification

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
`profile.test.ts` must pass **unmodified** — this plan changes no completeness
weight, no Zod schema, no repository read shape.

### Manual

**Layout**
1. At 1920×1080 and 1440×900: the two cards fill the viewport under the header; the footer is **not** visible without scrolling; scrolling down reveals it.
2. The profile card's checklist spreads to fill, with the performance panel pinned at the bottom — no dead space, nothing clipped.
3. At 820px and 375px: cards stack, no tall empty gap under the profile card, footer follows normally.

**Performance panel**
4. Shows Search appearances 1, Recruiter actions 0. Hovering ⓘ gives the tracking-not-live copy.

**Leave dialog**
5. Edit a field, click Previous → styled dialog, no browser alert. **Cancel** stays put with edits intact. **No** goes back and the edit is gone. **Yes** saves, then goes back.
6. Clear a required field, click Previous → **Yes** → dialog closes, validation error shows, you stay on the section. Now fix the field and click **Next** → it advances **forward one step**, not back to the previous target. *(This is the stale-target trap — check it explicitly.)*
7. Same three behaviours when jumping via the checklist.
8. With no unsaved edits, Previous and checklist jumps move immediately with no dialog.
9. Double-click Next → one save, not two; the button reads "Saving…" and is disabled in flight.

**Avatar**
10. With the env vars set: pencil → pick a JPEG → photo appears on the profile card, and in the sidebar and header after the refresh.
11. Re-upload a different photo → replaces it; the previous blob is deleted (check the store).
12. A `.svg` and a 5 MB file are both rejected with a clear toast.
13. Rename a `.txt` to `.jpg` and upload → **rejected server-side** by the magic-byte check.
14. With `avatar_READ_WRITE_TOKEN` unset: the pencil does not render and nothing else on the page breaks.
15. Keyboard: Tab reaches the pencil and Enter opens the picker — confirms the `aria-hidden` fix.

**Celebration**
16. Take a profile from <100 to 100: the bar sweeps right in green, *then* turns orange, *then* the "Profile Complete" pill appears. Not all at once.
17. Reload at 100%: final orange state and the pill, no replay.
18. `prefers-reduced-motion: reduce`: reaches the finished state and the pill with no animation and no hang.

**Accessibility**
19. A screen reader announces the progress bar value and "Step N of 10"; focus lands on the section heading after each step change.

### Files that should have changed
The three new files in §4, plus exactly: `profile-wizard.css`,
`profile-wizard.tsx`, `profile-card.tsx`, `wizard-context.tsx`,
`use-section-save.ts`, `candidate-profile-actions.ts`, `src/app/profile/page.tsx`,
`.env.example`. **Nothing under `prisma/`, nothing in `globals.css`, nothing in
`src/components/dashboard-hub/`, nothing in `src/features/resume/`.**

## 10. Commit message

```
feat(profile): viewport layout, performance panel, leave dialog, avatar upload

Five changes on the profile wizard shipped in "profile v2".

- The wizard fills the viewport under the header, so the dashboard footer sits
  below the fold and appears on scroll. Reverted below 1024px, where the cards
  stack.
- Profile performance panel returns to the profile card. Search appearances and
  recruiter actions are placeholder constants — nothing measures them yet, and
  the info tooltip says so.
- Previous and checklist jumps with unsaved edits now open a real dialog
  (Save / Don't save / Cancel) instead of window.confirm. Saving navigates only
  after the write succeeds, so failed validation keeps you on the section.
- The avatar pencil works: client-side square downscale, server-side type,
  size and magic-byte validation, stored in a new public Vercel Blob store and
  written to User.image. Needs avatar_READ_WRITE_TOKEN.
- The 100% celebration sequences properly — green sweep, then orange, then the
  Profile Complete pill.

Also fixes a double-submit: the footer Next button now disables while a section
save is in flight.

No schema change, no migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
