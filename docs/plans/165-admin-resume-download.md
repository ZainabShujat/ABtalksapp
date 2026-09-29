# 165 — Admin résumé download (Global Search → candidate)

## 1. Goal
Let a Platform Admin actually **download a candidate's stored résumé PDF** from
the admin console. Today the file name is rendered as dead text and there is no
admin-reachable download path at all; the only route that serves a résumé file
is owner-scoped.

## 2. Current behavior

**Where the file name shows.** Global Search (`/admin/search`) returns candidate
rows that link to `/admin/students/[id]`. That page renders
`CandidateCareerSections`, whose **Resume** block
(`src/components/admin/candidate-career-sections.tsx:392-436`) shows:

- `Fact "Status"` — `detail.resume.status`
- `Fact "File"` — `detail.resume.fileName` as **plain text, not a link** ← the complaint
- `Fact "Source"` — `detail.resume.sourceUrl` (candidate-entered link, if any)
- `Fact "Profile URL"` — `profile.resumeUrl` (candidate-entered link, if any)

The Global Search results page itself (`src/app/admin/search/page.tsx`) shows no
résumé information whatsoever.

**Why the file is not reachable.** `src/features/resume/storage.ts` stores every
résumé in a **private** Vercel Blob store (`access: "private"`, DB holds a
pathname, never a URL). The single reader is
`GET /api/profile/resume/file` — it takes **no parameters** and resolves the
pathname from `session.user.id` via `getOwnResumeFilePath`. Its own header
comment says admins "reach résumés through the admin surfaces" — that admin
surface was never built. `grep readResumeFile` confirms one non-test caller.

**The trap to avoid.** `ResumeView.downloadPath`
(`src/features/resume/view.ts:73`) is hard-coded to `/api/profile/resume/file`
and is already present on the admin detail payload (`AdminCandidateDetail.resume`
is a `ResumeView`). Wiring that field into the admin UI would hand the admin
**their own** résumé, or a 404 — a silent wrong-file bug, not an error. The
admin surfaces must never link `resume.downloadPath`.

**Available building blocks (used as-is, not modified):**
- `getOwnResumeFilePath(userId)` (`features/resume/service.ts:395`) — despite the
  name it performs no ownership check; it maps a userId to
  `{ pathname, fileName }`. Public API of Zainab's module, called not edited.
- `readResumeFile(pathname)` (`features/resume/storage.ts:148`) — private blob →
  `{ stream, contentType, size }`.
- `getAdminContext()` (`lib/admin-auth.ts`) — returns `null` instead of
  redirecting, which is what a fetchable route needs.
- `writeAudit(tx, input)` (`features/admin/audit.ts`) — `prisma` satisfies
  `Prisma.TransactionClient`, so it can be called outside a transaction.
- `User.resume` is a 1-1 relation to `CandidateResume`, so the Global Search
  candidate query can learn whether a file exists with **no extra round trip**.

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/app/api/admin/candidates/[userId]/resume/route.ts` | `[new]` | Admin-gated binary download of one candidate's stored résumé. |
| `src/features/admin/get-admin-candidate-detail.ts` | `[edit]` | Add `resumeDownloadHref: string \| null` to `AdminCandidateDetail`. |
| `src/components/admin/candidate-career-sections.tsx` | `[edit]` | Resume block: render the file name as a download link when a stored file exists. |
| `src/features/admin/search-admin-console.ts` | `[edit]` | Select `resume: { blobPathname, fileName }` on the candidate query; expose `resumeFileName` + `hasResumeFile`. |
| `src/app/admin/search/page.tsx` | `[edit]` | Candidate results get a "Résumé" download link. |
| `src/features/admin/admin-resume-download.test.ts` | `[new]` | Source-reading invariant suite (same style as `features/admin/audit.test.ts`). |
| `package.json` | `[edit]` | `"test:admin-resume-download"` script. |
| `.github/CODEOWNERS` | `[edit]` | New Platform Admin section claiming the new route (rule 13). |

No schema change. No migration. No new dependency.

## 4. Server vs Client

Every file touched is **Server**:

- `src/app/api/admin/candidates/[userId]/resume/route.ts` — Route Handler,
  `export const runtime = "nodejs"` (blob SDK + stream).
- `src/features/admin/get-admin-candidate-detail.ts` — server module.
- `src/components/admin/candidate-career-sections.tsx` — **Server Component**
  today (no `"use client"`, see its header comment). It **stays** a Server
  Component: the change adds an `<a>`, nothing interactive.
- `src/app/admin/search/page.tsx` — Server Component.

No Server→Client prop passing is introduced. No functions, icons or class
instances cross a boundary. `ExternalLink` is already imported in
`candidate-career-sections.tsx`; add `Download` from `lucide-react` **in that
same server file** (rendered server-side, never passed as a prop).

## 5. Steps

### 5.1 `src/app/api/admin/candidates/[userId]/resume/route.ts` `[new]`

A Route Handler rather than a Server Action because the response is a binary
stream. Write it with a header comment that states why it takes a userId while
`/api/profile/resume/file` deliberately does not.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/features/admin/audit";
import { getOwnResumeFilePath } from "@/features/resume/service";
import { readResumeFile } from "@/features/resume/storage";

export const runtime = "nodejs";

const paramsSchema = z.object({ userId: z.string().min(1).max(64) });
```

`GET(request, { params }: { params: Promise<{ userId: string }> })`, in this
order — each failure returns JSON in the standard envelope, never a redirect:

1. `const admin = await getAdminContext();` → `null` ⇒ `403`
   `{ ok: false, message: "Not authorised." }`.
   **Do not use `requireAdmin()`** — it `redirect()`s, which turns a failed
   download into an HTML page with a 200-ish status.
2. `const parsed = paramsSchema.safeParse(await params);` → failure ⇒ `400`.
3. Load the target: `prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } })`.
   Missing ⇒ `404`. `deletedAt !== null` ⇒ `404`
   `{ ok: false, message: "No résumé file stored" }` — a deleted candidate's
   document is not downloadable. (`CandidateResume` is **not** cleared by
   `features/admin/anonymize-user.ts`; this check is what stops that gap from
   becoming a download. See §10.)
4. `const file = await getOwnResumeFilePath(userId);` → `null` ⇒ `404`.
5. `const blob = await readResumeFile(file.pathname);` → `null` ⇒ `404`.
6. **Audit before streaming**, so a download that is served is always recorded:
   ```ts
   await writeAudit(prisma, {
     actorUserId: admin.userId,
     adminUserId: admin.userId,
     targetUserId: userId,
     entityType: "CandidateResume",
     entityId: userId,
     actionType: "DOWNLOAD_CANDIDATE_RESUME",
     reason: "Admin console résumé download",
   });
   ```
   Wrap in `try/catch`; on failure `logger.error("[admin-resume] audit failed", …)`
   and **still serve the file** — a broken audit write must not deny an admin a
   document they are authorised to read. (`formatAdminActionType` humanises the
   action type generically, so the actions feed needs no label table entry.)
7. Respond, mirroring the owner route's header hygiene but as an **attachment**:
   ```ts
   const safeName = (file.fileName || "resume.pdf").replace(/["\\\r\n]/g, "");
   return new NextResponse(blob.stream, {
     headers: {
       "content-type": blob.contentType || "application/pdf",
       "content-length": String(blob.size),
       "content-disposition": `attachment; filename="${safeName}"`,
       "cache-control": "private, no-store",
       "x-content-type-options": "nosniff",
     },
   });
   ```

**Rate limiting — deliberate decision, do not "fix" it.** No `assertRateLimit`
call. Every existing bucket in `RateLimitBucket` is wrong for this path
(`EXPORT` is 10 per 15 minutes — an admin reviewing a shortlist would hit it),
and a new bucket means a Prisma enum value and a migration, which is out of
scope for this plan. The controls here are the admin gate plus one `AdminAction`
row per served download, which makes abuse visible in the actions feed. If a
limiter is wanted later it is an `ADMIN_RESUME_DOWNLOAD` bucket + migration, its
own plan.

### 5.2 `src/features/admin/get-admin-candidate-detail.ts` `[edit]`

- Add to the `AdminCandidateDetail` type, with a comment saying why it is not
  `resume.downloadPath`:
  ```ts
  /**
   * Admin-scoped download href, or null when no file is stored.
   * NOT `resume.downloadPath` — that constant points at the owner-only
   * `/api/profile/resume/file`, which would serve the ADMIN's own résumé.
   */
  resumeDownloadHref: string | null;
  ```
- In the returned object, next to `resume`:
  ```ts
  resumeDownloadHref: resume?.downloadPath
    ? `/api/admin/candidates/${encodeURIComponent(userId)}/resume`
    : null,
  ```
  `resume.downloadPath` is non-null exactly when `CandidateResume.blobPathname`
  is set, so this is a free presence test — **no new query**.

### 5.3 `src/components/admin/candidate-career-sections.tsx` `[edit]`

Only the `Fact label="File"` line inside the Resume block changes. Keep the
existing `Fact label="Status"`, `"Source"` and `"Profile URL"` rows exactly as
they are.

```tsx
{detail.resume.fileName ? (
  <Fact label="File">
    {detail.resumeDownloadHref ? (
      <a
        className="inline-flex items-center gap-1 text-[#03535F] underline"
        href={detail.resumeDownloadHref}
      >
        {detail.resume.fileName} <Download className="size-3" />
      </a>
    ) : (
      detail.resume.fileName
    )}
  </Fact>
) : null}
```

Then, still inside `{detail.resume ? …}` and **after** the `"Profile URL"` fact,
add the case the current markup has no answer for — a stored file with no
recorded file name:

```tsx
{detail.resumeDownloadHref && !detail.resume.fileName ? (
  <Fact label="File">
    <a
      className="inline-flex items-center gap-1 text-[#03535F] underline"
      href={detail.resumeDownloadHref}
    >
      Download résumé <Download className="size-3" />
    </a>
  </Fact>
) : null}
```

Import `Download` from `lucide-react` alongside `CheckCircle2, ExternalLink`.
No `target="_blank"` / `rel="noreferrer"`: this is a same-origin attachment
response, not an outbound link.

### 5.4 `src/features/admin/search-admin-console.ts` `[edit]`

In the `prisma.user.findMany` candidate query, add to `select`:

```ts
resume: { select: { blobPathname: true, fileName: true } },
```

Then in the `namedCandidates` map, add two flat fields and **drop the raw
`resume` object from what is returned** — the page needs a boolean and a string,
not a blob pathname on a rendered payload:

```ts
const namedCandidates = candidates.map(({ resume, ...c }) => ({
  ...c,
  hasResumeFile: Boolean(resume?.blobPathname),
  resumeFileName: resume?.fileName ?? null,
  studentProfile: { /* unchanged */ },
}));
```

Leave the recruiter, job and assessment queries untouched.

### 5.5 `src/app/admin/search/page.tsx` `[edit]`

`ResultList` currently takes `items: Array<{ href; title; meta }>` and wraps the
whole row in one `<Link>`. A download link cannot nest inside that anchor, so:

1. Widen the item type with an optional trailing action:
   ```ts
   items: Array<{
     href: string;
     title: string;
     meta: string;
     action?: { href: string; label: string };
   }>;
   ```
2. In the `<li>`, keep the existing `<Link>` exactly as it is and render the
   action as a **sibling**, not a child:
   ```tsx
   <li key={`${item.href}-${item.title}`} className="flex items-center gap-3">
     <Link href={item.href} className="block flex-1 py-3 hover:underline">
       {/* unchanged title + meta */}
     </Link>
     {item.action ? (
       <a
         href={item.action.href}
         className="shrink-0 text-xs text-[#03535F] underline"
       >
         {item.action.label}
       </a>
     ) : null}
   </li>
   ```
   Other `ResultList` call sites pass no `action` and render identically.
3. In the Candidates `ResultList`, map the new field:
   ```ts
   action: row.hasResumeFile
     ? {
         href: `/api/admin/candidates/${encodeURIComponent(row.id)}/resume`,
         label: "Résumé",
       }
     : undefined,
   ```
   Leave `title` and `meta` unchanged — do **not** put the file name in `meta`.

### 5.6 `src/features/admin/admin-resume-download.test.ts` `[new]`

Source-reading suite, copying the harness at the top of
`src/features/admin/audit.test.ts` (`readFileSync` + `assert` + `suite`, exit
non-zero on failure). Assert, over
`src/app/api/admin/candidates/[userId]/resume/route.ts`:

- `getAdminContext()` is called and `requireAdmin` never appears (no redirect on
  a fetch path).
- `403` is returned for a null admin context.
- `deletedAt` is checked.
- `writeAudit` is called with `actionType: "DOWNLOAD_CANDIDATE_RESUME"`.
- `attachment; filename=` and `"cache-control": "private, no-store"` are present.
- `"public"` never appears in a cache-control string in the file.

And one cross-file assertion that protects the trap in §2, over
`src/components/admin/candidate-career-sections.tsx` and
`src/app/admin/search/page.tsx`:

- neither file contains `downloadPath` (the admin surfaces must never link the
  owner route).

### 5.7 `package.json` `[edit]`

Add next to the other admin test scripts:

```
"test:admin-resume-download": "tsx src/features/admin/admin-resume-download.test.ts",
```

### 5.8 `.github/CODEOWNERS` `[edit]`

The file currently only carries Zainab's sections. Append a new section at the
**end** (last match wins, and these paths do not overlap the existing lines):

```
# ------------------------------------------------------------------------------
# 4. Platform Admin / Candidate Search Domain
# ------------------------------------------------------------------------------
/src/app/api/admin/candidates/                      @byteninjaa0
/src/app/admin/search/                              @byteninjaa0
/src/features/admin/search-admin-console.ts         @byteninjaa0
/src/features/admin/admin-resume-download.test.ts   @byteninjaa0
```

`@byteninjaa0` is taken from the `origin` remote (github.com/byteninjaa0/ABtalksapp).
Do **not** claim `/src/app/admin/` or `/src/features/admin/` wholesale: that
would override Zainab's `/src/app/admin/resume-imports/`,
`/src/app/admin/hire/`, `/src/app/admin/recruiters/` and
`/src/app/admin/mock-interview/` lines.

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT edit anything under `src/features/resume/`**, `src/repositories/resume-import.ts`,
  `src/repositories/candidate-resume.ts`, `src/app/api/profile/resume/`, or
  `src/app/admin/resume-imports/`. Those are **Zainab's** module (CODEOWNERS
  §1). This plan **calls** `getOwnResumeFilePath` and `readResumeFile` and
  changes neither. If something looks like it needs a change there, stop and
  report — do not edit.
- **DO NOT change `/api/profile/resume/file/route.ts`** and do not add a
  parameter to it. `features/resume/resume.test.ts:1699` asserts that route
  reads no caller-supplied parameter; the new admin route is a separate file and
  that suite must keep passing untouched.
- **DO NOT render `resume.downloadPath` on any admin surface.** It is the
  owner-only constant; it would serve the admin their own file.
- **DO NOT** make the blob public, construct a public blob URL, or pass a blob
  pathname to the client. The pathname stays server-side; the client sees only
  `/api/admin/candidates/<userId>/resume`.
- **DO NOT** accept a pathname, file name or blob URL as a route parameter. The
  only input is the candidate's userId, and the pathname is resolved server-side
  from that row. A caller-supplied path is a private-store read primitive.
- **DO NOT** use `requireAdmin()` in the route handler (it redirects).
- **DO NOT** add `"use client"` to `candidate-career-sections.tsx` or
  `src/app/admin/search/page.tsx`, and do not pass the `Download` icon as a prop.
- **DO NOT** touch `middleware.ts`, `auth.config.ts` or `auth.ts`. The route is
  gated in its own handler; the edge bundle is not involved.
- **DO NOT** add a new `RateLimitBucket` enum value or a migration (see §5.1).
- **DO NOT** add new abstraction files — no `admin-resume.ts` helper, no shared
  "download link" component. Only the files in §3 appear.
- **DO NOT** widen `searchAdminConsole` beyond the candidate query, and do not
  return `blobPathname` from it.
- **DO NOT** use `console.error` — `lib/logger.ts` only.
- **DO NOT** change any existing `Fact` row, link, or the Global Search result
  title/meta text.
- **DO NOT** return a full Prisma record; every new query uses `select`.

## 7. DB safety

Not applicable — **no schema change, no migration, no data write other than one
`AdminAction` row per download** through the existing `writeAudit`.

## 8. Verification

**Build / typecheck / tests (all must pass):**

```bash
npx tsc --noEmit && npm run build
```
```bash
npm run test:admin-resume-download && npm run test:audit && npx tsx src/features/resume/resume.test.ts
```
`resume.test.ts` is the one that would catch an accidental edit inside Zainab's
module — it must pass **unchanged**.

**Manual, signed in as a Platform Admin:**

1. Seed or pick a candidate who has actually **uploaded a PDF** (a
   `CandidateResume` row with `blobPathname` set) — a candidate whose résumé is
   only a URL must stay unchanged, showing "Source"/"Profile URL" and no
   download.
2. `/admin/search?q=<their name>` → the Candidates card shows a **Résumé** link
   beside the row. Click it → the PDF downloads with the stored file name.
3. Click the row title → `/admin/students/<id>` → Resume block → the **File**
   value is now a link with a download icon → downloads the same PDF.
4. `/admin/actions` (admin actions feed) → a new "Download candidate resume"
   entry naming the admin and the candidate.
5. Sign in as a **non-admin** candidate, hit
   `/api/admin/candidates/<otherUserId>/resume` directly → `403` JSON, no file.
   Signed out → `403` JSON.
6. Hit the route with a nonsense userId → `404` JSON. Hit it for a candidate
   with **no** résumé file → `404` JSON.
7. Confirm `/api/profile/resume/file` still serves the signed-in candidate their
   own résumé from `/profile` (unchanged path).
8. Confirm a candidate with a résumé **URL only** shows no download link on
   either surface.

**Exactly these files should differ** (`git status`): the 8 in §3 and nothing
else. In particular `src/features/resume/**` must be untouched.

## 9. Commit message

```
feat(admin): download a candidate's stored résumé from the admin console

The private blob store had exactly one reader, /api/profile/resume/file, and it
resolves the pathname from the session — so an admin looking at a candidate saw
the résumé's file name as dead text with no way to open it.

Adds an admin-gated GET /api/admin/candidates/[userId]/resume that resolves the
pathname server-side from the candidate's own row, refuses deleted accounts,
writes one AdminAction per served download and streams the PDF as an attachment.
Global Search candidate results and the admin candidate detail page link to it.

The admin surfaces deliberately do not use ResumeView.downloadPath: that
constant points at the owner-only route and would have served the admin their
own file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## 10. Out of scope — follow-ups worth filing

- **`anonymize-user.ts` does not clear `CandidateResume`.**
  `src/features/admin/anonymize-user.ts` nulls `CandidateProfile.resumeUrl` but
  deletes neither the `CandidateResume` row nor the blob, so an anonymised
  candidate still has a parsed résumé and a stored PDF carrying their phone,
  email and home city. Step 5.1's `deletedAt` check keeps this route from
  serving them; the underlying retention gap is a data-requests / résumé-module
  question (Zainab + data-requests), not this plan.
- **No rate limit on the new route** — see the decision note in §5.1.
- **Recruiter-side résumé download** (`/hire`) is untouched and remains
  unavailable; that is Zainab's contact-unlock domain.
