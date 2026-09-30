# 158 — Company logo in recruiter settings + numbered pagination for search results

Date: 2026-09-28 · Author: Sohail

---

## 1. Goal

Two gaps a recruiter hits today: there is no way to add a company logo anywhere
in `/hire/settings` (the `Organization.logoUrl` column exists but has **no
reader and no writer** in the whole codebase), and the candidate search results
render as one unbounded scrolling list with no page controls. This plan adds a
logo upload/preview/remove control to the Company Identity card, and numbered
`1 2 3 4` pagination to the search results list.

---

## 2. Current behavior

### 2a. Company logo — the field exists, nothing touches it

- `prisma/schema.prisma:3341` — `Organization.logoUrl String?`.
- `grep -rn "logoUrl" src/` returns **only** the three e-mail templates, which
  build an ABTalks brand logo URL from `appUrl`. Nothing reads or writes
  `Organization.logoUrl`. The column has been dead since it was added.
- `src/app/hire/settings/page.tsx` renders `RecruiterProfileForm`, which has a
  "Company Identity" card with name / website / industry / size / location. No
  logo field.
- `getRecruiterProfileAction` selects `name, websiteUrl, industry, sizeBucket,
  location` from `Organization` — not `logoUrl`.
- The card's own copy already promises "Company details shown on your outreach
  messages and job listings", so a logo belongs here.

**Upload infrastructure that already exists** (this is what the plan reuses, it
invents nothing):

- `@vercel/blob@^2.8.0` is a dependency.
- `src/features/profile/avatar-storage.ts` is the template: a **public** blob
  store, content-addressed path `avatars/<userId>/<sha256>.<ext>`, env read via
  `process.env[NAME]` (mixed-case names survive build-time substitution), token
  passed explicitly so the SDK cannot fall back to the résumé store's
  `BLOB_READ_WRITE_TOKEN`.
- `uploadAvatarAction` in `src/app/actions/candidate-profile-actions.ts:346` is
  the server-side template: size cap, MIME allow-list, **magic-byte sniff** that
  must agree with the declared type, SHA-256 hash, store, delete the previous
  blob, update the row.
- `src/components/profile/avatar-editor.tsx` is the client template: validate,
  downscale on a canvas, `FormData`, `router.refresh()`.
- `/profile` passes `isAvatarStorageConfigured()` down so the control renders
  **disabled and explained** when the env var is missing, rather than absent.
- Env check: `.env.local` has `resume2_READ_WRITE_TOKEN` / `resume2_STORE_ID`
  only. `avatar_READ_WRITE_TOKEN` is **not set locally**, so avatar upload is
  already degraded locally today. Logos will behave identically — see §7.
- `next.config.ts` `images.remotePatterns` allows `i.ytimg.com` only, so blob
  URLs cannot go through `next/image`. Everything renders blob URLs with a plain
  `<img>` / `AvatarImage`. Keep that.

### 2b. Search results — no pagination anywhere

- `src/components/hire/match-results.tsx` is the one results list. It renders
  `matches.map(...)` into a single `<ul>`, with `rank={i + 1}`.
- Three call sites, and **none** of them passes `viewAllHref`, so all three
  render the entire list:
  1. `src/components/hire/scout-chat.tsx:1704` — the desk (`desk` mode), which
     is the main recruiter search surface at `/hire/[requestId]`.
  2. `src/app/hire/[requestId]/candidates/page.tsx:64` — the full-list page.
  3. `src/components/hire/guest-matches-page.tsx:93` — `/hire/matches`, the
     signed-out preview.
- `INITIAL_VISIBLE = 1` and the `viewAllHref` "View N more" link are the only
  existing paging-ish behaviour, and they are currently dead code (no caller).
  **Leave that branch untouched** — it is a different product decision.
- How long is the list? `executeMatchForOwnedRequest` (`hire-actions.ts:374`)
  searches with `{ limit: 20 }`, but `loadRequestMatches` reads
  `TalentRequest.matches` with **no `take`**, and `executeMatchForOwnedRequest`
  deliberately *keeps* SHORTLISTED / REJECTED rows across runs. So a project
  that has been searched a few times accumulates well past 20 rows, all rendered
  at once. This is exactly the case pagination is for.
- Existing in-repo pagination convention: `src/components/admin/
  admin-actions-pagination.tsx` — URL-driven, Prev/Next only, no numbers. That
  one is server-paginated over a Prisma query. The hire desk is different: the
  whole list is already in memory in a client component, so this is **client-side
  pagination**, and it can afford real numbers.
- `src/app/hire/hire-scout.css` is imported by `src/app/hire/layout.tsx:20`, so
  it covers **every** `/hire/*` route — all three call sites can share one class.

---

## 3. Files to touch

### Part A — company logo (⚠ cross-module, see §6)

| File | | Note |
|---|---|---|
| `src/features/hire/org-logo-storage.ts` | `[new]` | Vercel Blob helper for company logos. Path `org-logos/<organizationId>/<sha256>.<ext>`. Reads `logo_READ_WRITE_TOKEN` and falls back to the existing public `avatar_READ_WRITE_TOKEN`. |
| `src/lib/validations/recruiter-profile.ts` | `[edit]` | Add `LOGO_MAX_BYTES`, `LOGO_MIME_TYPES`; add `logoUrl: string \| null` to `RecruiterProfileDetails`. |
| `src/app/actions/recruiter-profile-actions.ts` | `[edit]` | Select `logoUrl` in the org read; add `uploadCompanyLogoAction` + `removeCompanyLogoAction`. |
| `src/components/hire/recruiter-profile-form.tsx` | `[edit]` | Company Logo block inside the existing Company Identity card. |
| `src/app/hire/settings/page.tsx` | `[edit]` | Pass `logoUploadAvailable={isCompanyLogoStorageConfigured()}` to the form. |
| `src/app/hire/hire-scout.css` | `[edit]` | `.hire-logo*` styles for the preview tile. |
| `src/features/hire/recruiter-profile.test.ts` | `[edit]` | New suites for the logo actions. |

### Part B — search pagination (owned)

| File | | Note |
|---|---|---|
| `src/components/hire/match-pagination.ts` | `[new]` | Pure `pageItems()` helper — the windowed `1 … 4 5 6 … 12` number list. Separate from the `"use client"` component only so it is testable by `tsx`. |
| `src/components/hire/match-results.tsx` | `[edit]` | Slice the list per page, absolute ranks, render the pager. |
| `src/app/hire/hire-scout.css` | `[edit]` | `.scout-pager*` styles. |
| `src/features/hire/match-pagination.test.ts` | `[new]` | Windowing + clamping assertions. |
| `package.json` | `[edit]` | `"test:hire-pagination"` script (repo convention: one script per suite). |

No Prisma schema change. No migration. See §7.

---

## 4. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `src/app/hire/settings/page.tsx` | **Server** | Already `async`, already calls `requireRecruiter()`. Will now also call `isCompanyLogoStorageConfigured()` (server-only module) and pass a **boolean** down. |
| `RecruiterProfileForm` | **Client** (`"use client"`, existing) | Receives `initialData` (plain object, now with `logoUrl: string \| null`) and `logoUploadAvailable: boolean`. |
| `org-logo-storage.ts` | **server-only** | `import "server-only"` at the top, exactly like `avatar-storage.ts`. Never imported from a client component. |
| `MatchResults` | **Client** (`"use client"`, existing) | Pagination is local `useState`. No prop-shape change, no new props — so the three call sites need **zero** edits. |
| `match-pagination.ts` | **Neutral** | Pure functions over numbers. No `"use client"`, no `server-only`; importable from both. |

**Server → Client boundary:** only primitives and plain JSON cross it
(`logoUrl: string | null`, `logoUploadAvailable: boolean`). No functions, no
icon components, no class instances. `File`/`FormData` travel client → server
through the Server Action, which is the same path `uploadAvatarAction` uses.

---

## 5. Steps

### Part A — company logo

**A1. `src/features/hire/org-logo-storage.ts` `[new]`**

Mirror `src/features/profile/avatar-storage.ts`. Header comment must state the
two decisions explicitly: (a) the store is **public** because settings and any
future outreach/job surface render `<img src>` directly, and (b) it reuses the
avatar store rather than demanding a new one to provision, with
`logo_READ_WRITE_TOKEN` checked first so the stores can be split later without
touching callers.

```ts
import "server-only";
import { del, put } from "@vercel/blob";
import { logger } from "@/lib/logger";

/** Preferred, then the existing PUBLIC avatar store. Mixed case on purpose —
 *  read through process.env[NAME] so build-time substitution cannot inline it. */
const TOKEN_ENVS = ["logo_READ_WRITE_TOKEN", "avatar_READ_WRITE_TOKEN"] as const;

function blobToken(): string | undefined { /* first non-empty of TOKEN_ENVS */ }

export function isCompanyLogoStorageConfigured(): boolean;
export function companyLogoPathname(organizationId: string, contentHash: string, ext: string): string;
  //  -> `org-logos/${organizationId}/${contentHash}.${ext}`
export function isOurCompanyLogoUrl(url: string): boolean;  // pathname includes "/org-logos/"
export async function storeCompanyLogoFile({ organizationId, contentHash, ext, bytes, mimeType }): Promise<string | null>;
export async function deleteCompanyLogoBlob(url: string): Promise<void>;
```

`storeCompanyLogoFile` passes `{ token, access: "public", contentType,
addRandomSuffix: false, allowOverwrite: true }`, returns `result.url`, and — copy
this from `avatar-storage.ts` — catches the `"public access on a private store"`
message and logs a specific, actionable error instead of a generic failure.
Return `null` on every failure path; never throw at the caller.

**A2. `src/lib/validations/recruiter-profile.ts` `[edit]`**

Append, do not reorder anything that exists:

```ts
/** 2 MB, same ceiling as a candidate avatar. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** SVG is excluded deliberately: it is a script-bearing document format and the
 *  store is public. PNG/WebP cover transparent logos. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
```

Add `logoUrl: string | null;` to the `RecruiterProfileDetails` type. Do **not**
add `logoUrl` to `updateRecruiterProfileSchema` — the text form must not be able
to set an arbitrary URL on the org; the logo is written only by the upload
action, from a blob URL the server itself produced.

**A3. `src/app/actions/recruiter-profile-actions.ts` `[edit]`**

1. In `getRecruiterProfileAction`, add `logoUrl: true` to the
   `prisma.organization.findUnique` `select`, and `logoUrl: org?.logoUrl ?? null`
   to the returned object.
2. Add `uploadCompanyLogoAction(formData: FormData)`. Order of operations,
   copied from `uploadAvatarAction`:
   - `const workspace = await requireRecruiterWorkspace(); if (!workspace.ok) return workspace;`
     — **no caller-supplied ids**, same as every other action in this file.
   - `if (!isCompanyLogoStorageConfigured())` → `logger.warn` + `{ ok: false,
     message: "Logo upload is not available right now." }`.
   - `formData.get("file")` must be a `File` with `size > 0`.
   - `file.size > LOGO_MAX_BYTES` → "That file is too large. Please choose an
     image under 2 MB."
   - `file.type === "image/svg+xml" || !LOGO_MIME_TYPES.includes(file.type)` →
     "Please choose a PNG, JPEG, or WebP image."
   - Read `arrayBuffer()` inside try/catch.
   - **Magic-byte sniff**, and require `sniffed.mime === file.type`. Reuse the
     same byte patterns as `candidate-profile-actions.ts` — copy the helper into
     this file as a local `sniffImageType`; do **not** export it from the
     candidate-profile action file (that is Shivansh's module, see §6) and do not
     create a shared util file for it.
   - `createHash("sha256")` over the bytes.
   - Read the org's current `logoUrl`, `storeCompanyLogoFile(...)`, and if the
     old URL `isOurCompanyLogoUrl(old) && old !== url`, `deleteCompanyLogoBlob(old)`.
   - `prisma.organization.update({ where: { id: organizationId }, data: { logoUrl: url }, select: { id: true } })`.
   - `revalidatePath("/hire/settings"); revalidatePath("/hire");`
   - Return `{ ok: true, message: "Company logo updated." }`.
3. Add `removeCompanyLogoAction()`: same workspace guard, read current
   `logoUrl`, set it to `null`, then `deleteCompanyLogoBlob` if
   `isOurCompanyLogoUrl`. Delete the blob **after** the DB write — a stale blob
   is harmless, a row pointing at a deleted blob is a broken image.
4. Every failure path: `logger.error` with `{ userId, organizationId, error:
   safeErrorMessage(error) }`. No `console.*`.

**A4. `src/components/hire/recruiter-profile-form.tsx` `[edit]`**

Signature becomes:

```ts
export function RecruiterProfileForm({
  initialData,
  logoUploadAvailable = false,
}: { initialData: RecruiterProfileDetails; logoUploadAvailable?: boolean })
```

Add local state `logoUrl` (seeded from `initialData.logoUrl`), `logoPending`,
`logoError`. Add a `useRef<HTMLInputElement>` and a hidden
`<input type="file" accept="image/png,image/jpeg,image/webp">`.

Insert a **Company Logo** block as the first child of the Company Identity
`CardContent`, above the name/website grid:

- Left: a 72×72 rounded tile. `logoUrl ? <img src={logoUrl} alt="" className="hire-logo__img" /> :`
  a `<Building2 className="size-6 text-muted-foreground" />` placeholder.
- Right: label "Company Logo", a hint line ("PNG, JPEG or WebP · up to 2 MB ·
  shown on your outreach and job posts"), and two buttons — "Upload logo" /
  "Replace" (`dsButtonVariants({ variant: "outline", size: "sm" })`, triggers the
  file input) and, only when `logoUrl` is set, "Remove".
- When `logoUploadAvailable` is false: both buttons `disabled`, plus a `title`
  and a visible muted line "Logo upload is unavailable right now." — same
  treatment as `AvatarEditor`'s `unavailable` prop. Do not hide the control.

`onPick(file)`, client-side before upload:

1. Reject `image/svg+xml`, any name ending `.svg`, and anything outside the
   allow-list → inline error, no request.
2. Reject `> 2 MB` → inline error.
3. Downscale on a canvas: **fit inside 512×512 preserving aspect ratio** (a logo
   is not square — do **not** copy `squareJpeg`'s centre-crop), transparent
   background, export `canvas.toBlob(cb, "image/png")`. PNG, not JPEG: JPEG
   would flatten a transparent logo onto black.
4. `FormData` with `file` → `uploadCompanyLogoAction`. On `ok`, set `logoUrl`
   from the returned url and show the existing green success banner; on failure
   set `logoError`. Always clear `inputRef.current.value` in `finally`.

The logo buttons must be `type="button"` — the whole block lives inside the
profile `<form>`, and a bare `<button>` there would submit it.

The existing "Save Changes" submit path and `updateRecruiterProfileAction` call
are **unchanged**: the logo saves immediately on pick, like the avatar does.

**A5. `src/app/hire/settings/page.tsx` `[edit]`**

Import `isCompanyLogoStorageConfigured` from `@/features/hire/org-logo-storage`
and pass `logoUploadAvailable={isCompanyLogoStorageConfigured()}` to
`<RecruiterProfileForm />`. Nothing else on this page changes.

**A6. `src/app/hire/hire-scout.css` `[edit]`**

Append `.hire-logo`, `.hire-logo__tile`, `.hire-logo__img` (72px, `object-fit:
contain`, rounded, `border: 1px solid var(--border)`, checkered-neutral
background so a white logo is still visible in dark mode), `.hire-logo__meta`.
Append to the end of the file — do not reorganise the sheet.

### Part B — search pagination

**B1. `src/components/hire/match-pagination.ts` `[new]`**

```ts
/** Results per page in the recruiter search list. */
export const MATCHES_PER_PAGE = 10;

export type PageItem = number | "gap";

/** 1-based page numbers with at most `window` numbers around `page`,
 *  first and last always present, elided runs collapsed to one "gap". */
export function pageItems(page: number, totalPages: number, window = 1): PageItem[];

/** totalPages for a list length — at least 1, so an empty list is page 1 of 1. */
export function pageCount(total: number, perPage = MATCHES_PER_PAGE): number;

/** Clamp into [1, totalPages]. Used on render, so a shrinking list cannot
 *  strand the user on a page that no longer exists. */
export function clampPage(page: number, totalPages: number): number;
```

`pageItems(1, 4)` → `[1,2,3,4]` (no gaps under ~7 pages);
`pageItems(6, 12)` → `[1,"gap",5,6,7,"gap",12]`.

**B2. `src/components/hire/match-results.tsx` `[edit]`**

- Import `useMemo`, `useRef` (already imports `useState`, `useEffect`).
- `const [page, setPage] = useState(1);`
- The pager applies to the **full-list** mode only:
  ```ts
  const paged = !viewAllHref && matches.length > MATCHES_PER_PAGE;
  const totalPages = paged ? pageCount(matches.length) : 1;
  const current = clampPage(page, totalPages);
  const start = paged ? (current - 1) * MATCHES_PER_PAGE : 0;
  const visible = viewAllHref
    ? matches.slice(0, INITIAL_VISIBLE)
    : paged
      ? matches.slice(start, start + MATCHES_PER_PAGE)
      : matches;
  ```
  `hidden` keeps meaning "what the viewAllHref link hides", so compute it from
  `matches.length - INITIAL_VISIBLE` in that branch only — it must **not** start
  counting the other pages, or the dead "View N more" link would start lying.
- **Ranks stay absolute:** `rank={start + i + 1}` for both `DeskMatchCard` and
  `MatchCard`. A candidate must not be "#1" on page 3.
- Reset to page 1 when the underlying list changes — but `scout-chat.tsx` builds
  `matches` with `.map()` on every render, so a `useEffect` on the array itself
  would fire forever. Key it on the refs instead:
  ```ts
  const refsKey = useMemo(() => matches.map((m) => m.candidateRef).join("|"), [matches]);
  useEffect(() => { setPage(1); }, [refsKey]);
  ```
  This is what makes a new search, a search-tab switch, and the "Hide rejected"
  checkbox all land on page 1.
- The existing `rememberEvidence(matches)` effect keeps taking the **whole**
  list, not `visible` — the evidence cache must not shrink to one page.
- Render the pager after the `<ul>`, only when `paged`:
  ```tsx
  <nav className="scout-pager" aria-label="Search results pages">
    <button type="button" className="scout-pager__step" disabled={current === 1}
            onClick={() => goTo(current - 1)} aria-label="Previous page">…</button>
    {pageItems(current, totalPages).map((it, i) =>
      it === "gap"
        ? <span key={`gap-${i}`} className="scout-pager__gap" aria-hidden>…</span>
        : <button key={it} type="button"
                  className={cn("scout-pager__n", it === current && "is-current")}
                  aria-current={it === current ? "page" : undefined}
                  aria-label={`Page ${it}`}
                  onClick={() => goTo(it)}>{it}</button>)}
    <button type="button" className="scout-pager__step" disabled={current === totalPages}
            onClick={() => goTo(current + 1)} aria-label="Next page">…</button>
    <span className="scout-pager__count">
      {start + 1}–{Math.min(start + MATCHES_PER_PAGE, matches.length)} of {matches.length}
    </span>
  </nav>
  ```
- `goTo(n)` sets the page **and** scrolls the list back to the top:
  ```ts
  const listRef = useRef<HTMLUListElement>(null);
  function goTo(n: number) {
    setPage(clampPage(n, totalPages));
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  ```
  Do this in the click handler, **not** in an effect on `page` — an effect would
  also fire on the reset-to-1 above and yank the desk around after every search.
- `type="button"` on every pager button. The desk renders inside interactive
  chrome; a default-submit button there is a real bug.

**B3. `src/app/hire/hire-scout.css` `[edit]`**

Append `.scout-pager` (flex, wrap, `gap: 6px`, `margin-top: 16px`, centred),
`.scout-pager__n` (min 34px square, rounded, `border: 1px solid var(--border)`),
`.scout-pager__n.is-current` (primary fill), `.scout-pager__step`,
`.scout-pager__gap`, `.scout-pager__count` (muted, `margin-inline-start: auto`,
drops below on narrow screens). Follow the existing token names already used in
this sheet (`--h-ink`, `--border`) rather than inventing new ones.

**B4. `src/features/hire/match-pagination.test.ts` `[new]` + `package.json` `[edit]`**

Same shape as the other suites in `src/features/hire/*.test.ts` (`assert`,
`suite`, `passed/failed` counters, `process.exit(1)`). Cover:
`pageCount(0) === 1`; `pageCount(10) === 1`; `pageCount(11) === 2`;
`pageItems` never repeats a number and never puts two gaps side by side;
first and last page are always present; `clampPage(9, 3) === 3`;
`clampPage(0, 3) === 1`. Plus a source assertion that `match-results.tsx` uses
`rank={start + i + 1}` (the absolute-rank rule is the one thing a future edit is
most likely to silently break).

Script: `"test:hire-pagination": "tsx src/features/hire/match-pagination.test.ts"`.

---

## 6. Guardrails for Cursor (DO NOT)

**Ownership — read this first.**

- **Part B (pagination) is in Sohail's own area** (candidate search / search
  ranking presentation). Proceed.
- **Part A (company logo) is a CROSS-MODULE CHANGE into Zainab's module**
  (recruiter profile / company identity). It must not be started until Zainab
  has approved it. The declaration is in §10.
- **DO NOT touch `src/features/notification/**` or any other locked
  notification path.** Nothing in this plan needs them. If something looks like
  it does, stop and output `NOTIFICATION MODULE LOCKED — approval required from
  Manuvrtti`.
- **DO NOT** edit `src/app/actions/candidate-profile-actions.ts`,
  `src/features/profile/avatar-storage.ts` or
  `src/components/profile/avatar-editor.tsx`. They are Shivansh's (candidate
  profile). They are the *template* to copy from, not files to refactor, widen,
  or extract a shared helper out of. Duplicating `sniffImageType` is the
  intended outcome.
- **DO NOT** surface the logo on job posts, outreach e-mails, the recruiter
  account menu, or the hire sidebar. Those are Manuvrtti's and Zainab's
  surfaces, out of scope, and each needs its own approval. This plan's only
  render site is `/hire/settings`.

**Technical**

- **DO NOT** change the Prisma schema or write a migration. `Organization
  .logoUrl` already exists and is already `String?`.
- **DO NOT** add `logoUrl` to `updateRecruiterProfileSchema` or to any text
  input. The only writer is the upload action, and the only value it writes is a
  URL the server got back from `put()`.
- **DO NOT** accept SVG, and do not skip the magic-byte sniff or the
  `sniffed.mime === file.type` equality check. Declared type alone is attacker
  input.
- **DO NOT** trust `formData` for identity. Both new actions resolve the
  workspace through `requireRecruiterWorkspace()` and take no id from the
  client. There is an existing test that greps for `input.organizationId` —
  keep it passing.
- **DO NOT** call `del()` before the DB write in the remove path.
- **DO NOT** import `org-logo-storage.ts` (or anything `server-only`) from
  `recruiter-profile-form.tsx`. The boolean is resolved on the page.
- **DO NOT** touch `middleware.ts`, `auth.config.ts` or `auth.ts`. Nothing here
  goes near the edge bundle.
- **DO NOT** add `requireRole` / `requireAdmin` anywhere. `/hire/settings`
  already has `requireRecruiter()`; `/hire/matches` is deliberately public
  (signed-out guest preview) and must stay that way.
- **DO NOT** paginate by refetching. The list is already fully in memory in a
  client component; there is no server round trip in Part B and no new action.
- **DO NOT** change `MatchResults`' props. The three call sites must not need
  edits — if a call site needs editing, the pagination was put in the wrong
  place.
- **DO NOT** break the `viewAllHref` / `INITIAL_VISIBLE` branch, and do not
  delete it because it currently has no caller.
- **DO NOT** make rank relative to the page.
- **DO NOT** put the page-reset or the scroll in a `useEffect` on `page`.
- **DO NOT** introduce `any`. `PageItem` is `number | "gap"`.
- **DO NOT** use `console.*`; use `lib/logger.ts`.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>`; use
  `buttonVariants` / `dsButtonVariants` on the element directly.
- **DO NOT** add files beyond the two `[new]` entries in §3.

---

## 7. DB safety

**No schema change and no migration.** `Organization.logoUrl` already exists as
`String?` and is currently written by nothing, so the only data effect is that
some rows gain a URL where they previously held `NULL`. No backfill, no seed
change, no destructive statement. A commit checkpoint and a Neon branch snapshot
are therefore not required for this plan.

**Infrastructure precondition (Part A only).** Blob storage must be reachable or
the control renders disabled:

- If `logo_READ_WRITE_TOKEN` is set, logos go to that store.
- Else if `avatar_READ_WRITE_TOKEN` is set, logos go to the existing **public**
  avatar store under `org-logos/`.
- Else the control renders disabled with "Logo upload is unavailable right now."

Confirm before shipping: `avatar_READ_WRITE_TOKEN` and `avatar_STORE_ID` exist
in the Vercel production environment, and that store was created **public**. The
résumé store (`resume2_*`) is private and **must not** be used or widened.
Locally, `.env.local` has neither token today, so the expected local result is
the disabled state — that is the feature working, not a bug.

---

## 8. Verification

**Build / typecheck / lint**

```
npx tsc --noEmit
npm run lint
npm run build
```

**Suites**

```
npm run test:recruiter-profile     # existing suites + the new logo suites
npm run test:hire-pagination       # new
npm run test:hire-score            # unchanged; proves ranking was not touched
```

**Manual — logo (`/hire/settings`, signed in as a recruiter)**

1. With no blob token set: the Company Logo block renders, buttons are disabled,
   the explanation line is visible. Nothing crashes, nothing is hidden.
2. With a token set: upload a PNG → the tile shows it without a reload, the
   success banner appears. Hard-refresh → still there (proves the DB write).
3. Upload a transparent PNG → the downscale keeps transparency (not a black box).
4. Upload a wide, non-square logo → it is letterboxed inside the tile, **not**
   centre-cropped.
5. Rename a `.svg` to `.png` and upload → rejected by the byte sniff, with the
   PNG/JPEG/WebP message.
6. Upload a > 2 MB file → rejected client-side, no request fires.
7. "Remove" → tile returns to the placeholder, survives a refresh.
8. Change Company Name and press **Save Changes** → name saves and the logo is
   still there (the two paths do not clobber each other).
9. Sign in as a second recruiter in another org → their logo tile is empty.
   Recruiter A's logo never appears for recruiter B.

**Manual — pagination (`/hire/[requestId]`, a project with > 10 matches)**

10. Results show 10 cards and a `1 2 3 …` pager with an "N–M of T" count.
11. Click page 2 → the next 10 render, the list scrolls back to its top, and the
    first card is ranked **11**, not 1.
12. Toggle "Hide rejected" while on page 3 → the list jumps back to page 1 and
    the counts match the filtered length.
13. Run a new search in the same project → back to page 1.
14. `/hire/[requestId]/candidates` and `/hire/matches` show the same pager.
15. A project with ≤ 10 matches shows **no** pager at all.
16. Open a candidate from page 2 → the inspector opens the right person and the
    list is still on page 2 behind it.
17. Keyboard: tab to a page number, press Enter; the current page carries
    `aria-current="page"`.
18. 375 px viewport: the pager wraps, no horizontal scroll.

**Exactly these files should have changed**

```
docs/plans/158-recruiter-logo-and-search-pagination.md   [new]
src/features/hire/org-logo-storage.ts                    [new]
src/components/hire/match-pagination.ts                  [new]
src/features/hire/match-pagination.test.ts               [new]
src/lib/validations/recruiter-profile.ts
src/app/actions/recruiter-profile-actions.ts
src/components/hire/recruiter-profile-form.tsx
src/app/hire/settings/page.tsx
src/components/hire/match-results.tsx
src/app/hire/hire-scout.css
src/features/hire/recruiter-profile.test.ts
package.json
```

`git status` must show nothing else. In particular: no `prisma/` change, no
`middleware.ts`, no `src/features/notification/**`, no
`src/app/actions/candidate-profile-actions.ts`.

---

## 9. Commit message

```
feat(hire): company logo in recruiter settings + paginated search results

Organization.logoUrl existed with no reader and no writer. Adds an
upload / preview / remove control to the Company Identity card, backed by
Vercel Blob on the existing public avatar store under org-logos/. Server
action resolves the workspace itself, sniffs magic bytes, rejects SVG and
caps at 2 MB; the control renders disabled and explained when no blob
token is configured.

Search results rendered as one unbounded list. MatchResults now pages at
10 per page with numbered controls, absolute ranks across pages, and a
reset to page 1 whenever the underlying result set changes. Client-side
only — the list was already fully in memory, so no new query and no call
site changes.
```

---

## 10. CROSS-MODULE CHANGE REQUIRED

```
Owner:   Zainab
Module:  Recruiter profile / Company identity
Files:   src/app/actions/recruiter-profile-actions.ts   [edit]
         src/components/hire/recruiter-profile-form.tsx [edit]
         src/lib/validations/recruiter-profile.ts       [edit]
         src/app/hire/settings/page.tsx                 [edit]
         src/features/hire/recruiter-profile.test.ts    [edit]
         src/features/hire/org-logo-storage.ts          [new]

Why the change is required:
  Organization.logoUrl has existed in the schema since the org model landed
  and has never had a reader or a writer. The Company Identity card is the
  only place a recruiter can edit company details, so the logo control has
  to live there — there is no route to it from a module I own.

Proposed change:
  Additive only. One new server-only blob helper; two new server actions
  (upload / remove) that resolve the workspace through
  requireRecruiterWorkspace() and accept no caller-supplied ids; one new
  logoUrl field on RecruiterProfileDetails; one new Company Logo block
  inside the existing Company Identity card. No existing field, validation
  rule, action signature or save path changes. updateRecruiterProfileSchema
  is NOT extended — the logo is writable only from a server-produced blob
  URL, never from form text.

Security impact (Sohail review, per rule 8):
  Public blob store, so no private data is exposed by URL. Uploads are
  MIME-allow-listed and magic-byte sniffed with a declared-type equality
  check; SVG is refused. 2 MB cap client- and server-side, under the 5 MB
  server-action body limit. Path is org-logos/<organizationId>/<sha256>.<ext>,
  built entirely from server-resolved values — no caller-controlled path
  segment, so no traversal and no cross-org overwrite. Workspace isolation
  is unchanged and still enforced in exactly one place.
```

Part B (pagination) is inside my own module and is not blocked by this.
