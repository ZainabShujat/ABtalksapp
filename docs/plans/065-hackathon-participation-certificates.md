# 065 — Hackathon participation certificates (ViCoDathon 2026)

## 1. Goal

Issue `ABT-HK-XXXXX` participation certificates to every hackathon participant whose
team submitted **both** a GitHub repo URL and a live URL, rendered onto
`public/certificates/vicodathon-certificate.pdf`, and surface them on `/achievements`
alongside any Claude Challenge certificate (most recent first).

Issuance is a **one-shot bulk script** you run yourself. There is no self-claim button,
no admin button, and no email in this plan.

---

## 2. Current behavior

The certificate system already exists and is live, built for exactly one track:

- `Certificate` model already supports this — `type` enum already has `HACKATHON`,
  `domain` and `enrollmentId` are both nullable. **No schema change is needed.**
- `CERTIFICATE_TYPES.HACKATHON.code` is already `"HK"`, and `CERT_ID_PATTERN`
  (`/^ABT-[A-Z]{2}-[23456789A-HJ-NP-Z]{5}$/`) already accepts `ABT-HK-XXXXX`.
  `generateCertificateId(CertificateType.HACKATHON)` works today, untouched.
- `renderCertificatePdf()` is hard-wired to the Claude track: it imports
  `CLAUDE_CERT_LAYOUT` directly, calls `loadCertificateTemplate()` with no arguments,
  and stamps a "verify authenticity at" URL line the hackathon artwork does not have.
- `loadCertificateTemplate()` resolves exactly one file and caches it in a single
  module-level `cached` variable. `CERTIFICATE_TEMPLATE_URL` / `CERTIFICATE_TEMPLATE_PATH`
  are global env overrides — and **`.env.local` already sets `CERTIFICATE_TEMPLATE_PATH`
  to the Claude template**, so any per-type work must not read those globally.
- `/verify/[certificateId]/page.tsx` and `/achievements` render Claude-shaped fields
  unconditionally: `Track` (from `domain`, which is `null` for hackathon → renders `—`),
  `Days completed` and `Longest streak` (absent from hackathon metadata → render `0`).
- `/verify/[certificateId]/download/route.ts` hardcodes the filename prefix
  `ABTalks-Claude-Challenge-`.
- `getAchievements()` already does `orderBy: { issuedAt: "desc" }`, so "most recent
  certificate first" is already the behavior — this plan only has to not break it.
- `/achievements` is auth-gated in `middleware.ts` (signed-in, no role requirement),
  so hackathon participants can already reach it. `/verify/*` is public.

### Template measurements (already taken — do not re-derive by eye)

Measured directly out of `public/certificates/vicodathon-certificate.pdf` by decoding its
content stream, so these are exact, not estimated from a screenshot.

| Property | Value |
|---|---|
| Page size | **1113 × 795 pt** (aspect 1.400) |
| MediaBox | `x: 0, y: 8.040002, w: 1113, h: 794.999998` |
| Accent purple (all labels) | `rgb(0.549, 0.3216, 1)` = `#8C52FF` |
| Body/headline white | `rgb(1, 1, 1)` |

Anchor elements, in absolute PDF user-space points:

| Element | x span | baseline / y | size |
|---|---|---|---|
| `CERTIFICATE ID` label (text) | 948.7 → ~1039.6 | y = 751.3 | 9.5 |
| `DATE OF ISSUE` label (text) | 58.0 → ~139.3 | y = 64.6 | 8.8 |
| `SCAN TO VERIFY` label (text) | 960.6 → ~1055.5 | y = 63.5 | 9.5 |
| Name underline (image `X15`) | 313.5 → 814.5 | visible line at y ≈ 381 | — |
| Signature name `ANIL BAJPAI` | 511.6 → ~601 | y = 131.6 | 13.1 |

Label right edges marked `~` are derived from glyph advance and are accurate to ±2 pt —
close enough to start from, and the debug grid in Step 9 is the final check.

Confirmed clear (no artwork ink) and therefore safe to draw into: the top-right block
above the `CERTIFICATE ID` label, and the bottom-right block above `SCAN TO VERIFY` up
to y ≈ 300.

> **Coordinate convention.** The existing renderer draws at `x: width * xRatio`,
> `y: height * baselineYRatio`, so a ratio is `absolutePdfCoordinate / pageSize` —
> **not** a fraction of the visible page measured from its bottom edge. Because this
> MediaBox starts at `y = 8.04`, ratio `0` is 8.04 pt *below* the visible bottom edge.
> That is correct and intentional; the Claude template has the same quirk (`y = 7.29`).
> Do not "fix" it.

---

## 3. Files to touch

**Certificate feature**

| File | | Note |
|---|---|---|
| `src/features/certificate/constants.ts` | `[edit]` | Add `HACKATHON_CERT_LAYOUT`, a shared `CertificateLayout` type with per-stamp `align`/`bold`, `CERTIFICATE_LAYOUTS` and `CERTIFICATE_TEMPLATES` maps, `fileSlug` on `CertificateTypeConfig`, and real ViCoDathon strings for `HACKATHON`. |
| `src/features/certificate/template-source.ts` | `[edit]` | Take a `CertificateType`; cache per resolved path/URL in a `Map`. |
| `src/features/certificate/render-certificate-pdf.ts` | `[edit]` | Take a `type`; look up layout + template; support left-aligned stamps and a null verify-URL line; export `toWinAnsiSafe`. |
| `src/features/certificate/issue-hackathon-certificate.ts` | `[new]` | Eligibility check + idempotent `Certificate` insert. |
| `src/features/certificate/get-certificate.ts` | `[edit]` | Return `type`, a `statusLabel`, and a generic `details` array; drop `domainLabel`/`daysCompleted`/`longestStreak` from the view. |
| `src/features/certificate/get-achievements.ts` | `[edit]` | Same shape change: generic `stats` array + `statusLabel`. |

**Routes & components**

| File | | Note |
|---|---|---|
| `src/app/verify/[certificateId]/download/route.ts` | `[edit]` | Pass `type` to the renderer; per-type download filename. |
| `src/app/verify/[certificateId]/page.tsx` | `[edit]` | Render `details` + `statusLabel` instead of the four hardcoded Claude rows. |
| `src/components/certificate/achievement-card.tsx` | `[edit]` | Render `stats` + `statusLabel` instead of the four hardcoded Claude rows. |

**Script**

| File | | Note |
|---|---|---|
| `prisma/scripts/backfill-hackathon-certificates.ts` | `[new]` | Mirrors `backfill-certificates.ts`: `--dry-run`, listing, 5 s pause, summary. |
| `package.json` | `[edit]` | Add `db:backfill:certificates:hackathon`. |

**Not touched:** `prisma/schema.prisma`, any migration, `middleware.ts`, `auth.ts`,
`auth.config.ts`, anything under `src/app/hackathon/`, `src/components/ui/`.

---

## 4. Server vs Client

Everything here is server-side or a Server Component. **No new client component, and no
new Server→Client prop passing.**

| File | Kind |
|---|---|
| `src/features/certificate/*` | Server-only modules (`import "server-only"` — keep it on the new file too) |
| `src/app/verify/[certificateId]/page.tsx` | Server Component (unchanged) |
| `src/app/verify/[certificateId]/download/route.ts` | Route handler, `runtime = "nodejs"` (unchanged) |
| `src/app/achievements/page.tsx` | Server Component (unchanged) |
| `src/components/certificate/achievement-card.tsx` | Server Component — **do not add `"use client"`** |
| `src/components/certificate/certificate-preview-panel.tsx` | Client — **not touched**; it already takes only two string props |
| `src/components/certificate/copy-verify-link-button.tsx` | Client — **not touched**; still receives one string prop |
| `prisma/scripts/backfill-hackathon-certificates.ts` | Plain Node script (tsx), not Next.js |

The one boundary to keep clean: `AchievementCard` (Server) renders `CopyVerifyLinkButton`
(Client). The new `stats` prop is an array of `{ label: string; value: string }` — plain
strings only. **No icons, no functions, no Date objects, no class instances** in `stats`
or `details`; pre-format every value to a string on the server.

---

## 5. Steps

### Step 1 — `src/features/certificate/constants.ts`

**1a.** Add `fileSlug` to `CertificateTypeConfig` and fill in the real event strings.
`title` and `subtitle` are what `/achievements` and `/verify` display, so `HACKATHON`
must stop saying "ABTalks Hackathon".

```ts
type CertificateTypeConfig = {
  /** The XX segment of ABT-XX-XXXXX. */
  code: string;
  title: string;
  subtitle: string;
  /** Used to build the download filename. ASCII, hyphenated, no spaces. */
  fileSlug: string;
};

export const CERTIFICATE_TYPES: Record<CertificateType, CertificateTypeConfig> = {
  CLAUDE_CHALLENGE: {
    code: "CC",
    title: "60-Day Claude Challenge",
    subtitle: "Claude AI Mastery Track",
    fileSlug: "Claude-Challenge",
  },
  HACKATHON: {
    code: "HK",
    title: "ViCoDathon 2026",
    subtitle: "India's AI Vibe Coding Hackathon",
    fileSlug: "ViCoDathon-2026",
  },
  COHORT: { code: "CH", title: "ABTalks Cohort", subtitle: "Cohort Program", fileSlug: "Cohort" },
  WORKSHOP: { code: "WS", title: "ABTalks Workshop", subtitle: "Workshop", fileSlug: "Workshop" },
};
```

Use a straight ASCII apostrophe in `"India's ..."` (double-quoted string), not a curly `’`.

**1b.** Add the shared layout types above `CLAUDE_CERT_LAYOUT`:

```ts
type RGB = { r: number; g: number; b: number };

type CenteredStamp = {
  align: "center";
  centerXRatio: number;
  baselineYRatio: number;
  fontSize: number;
  bold: boolean;
  color: RGB;
};

type LeftStamp = {
  align: "left";
  xRatio: number;
  baselineYRatio: number;
  fontSize: number;
  bold: boolean;
  color: RGB;
};

export type CertificateTextStamp = CenteredStamp | LeftStamp;

export type CertificateLayout = {
  certificateId: CertificateTextStamp;
  issuedOn: CertificateTextStamp;
  name: CenteredStamp & { minFontSize: number; maxWidthRatio: number };
  qr: { xRatio: number; yRatio: number; sizeRatio: number };
  /** Null when the artwork has no "verify authenticity at" line (hackathon). */
  verifyText: LeftStamp | null;
};
```

**1c.** Adapt `CLAUDE_CERT_LAYOUT` to the new shape. **Every existing numeric value stays
exactly as it is** — this is purely additive: `align: "center"` on `issuedOn`,
`certificateId` and `name`; `align: "left"` on `verifyText`; and `bold` matching what the
current renderer hardcodes — `issuedOn: false`, `certificateId: true`, `name: true`,
`verifyText: false`. Leave `contentCenterXRatio` and the existing block comment in place.

**1d.** Add the hackathon layout. Every ratio below is derived from the measurement table
in §2; the comment on each line records the arithmetic so it can be re-checked.

```ts
/** Sampled straight out of the ViCoDathon artwork's content stream. */
const HK_INK: RGB = { r: 1, g: 1, b: 1 };            // #FFFFFF — values
const HK_ACCENT: RGB = { r: 0.549, g: 0.3216, b: 1 }; // #8C52FF — the artwork's label purple

/**
 * ViCoDathon 2026 overlay layout. Page box is 1113 × 795 pt with MediaBox y = 8.04,
 * so ratios are `absolutePdfCoordinate / pageSize` (see the coordinate note in plan 065).
 *
 * FOUR stamp targets, all anchored to artwork the template already draws:
 *   1. Certificate ID — centred UNDER the "CERTIFICATE ID" label (top right)
 *   2. Date of issue  — left-aligned to the RIGHT of "DATE OF ISSUE", same baseline
 *   3. Recipient name — centred on the underline rule, sitting just above it
 *   4. QR code        — centred on and directly ABOVE the "SCAN TO VERIFY" label
 *
 * There is no verify-URL text line in this artwork; `verifyText` is null.
 */
export const HACKATHON_CERT_LAYOUT = {
  certificateId: {
    align: "center",
    /** Label spans x 948.7–1039.6 → centre 994.2. 994.2 / 1113. */
    centerXRatio: 0.89321,
    /** 17 pt below the label baseline (751.3) → 734.3. 734.3 / 795. */
    baselineYRatio: 0.92365,
    fontSize: 12,
    bold: true,
    color: HK_INK,
  },
  issuedOn: {
    align: "left",
    /** 12 pt right of the label's right edge (~139.3) → 151.3. 151.3 / 1113. */
    xRatio: 0.13594,
    /** SAME baseline as the "DATE OF ISSUE" label (64.6). 64.6 / 795. */
    baselineYRatio: 0.08126,
    fontSize: 10,
    bold: false,
    color: HK_INK,
  },
  name: {
    align: "center",
    /** Underline rule spans x 313.5–814.5 → centre 564.0. 564.0 / 1113. */
    centerXRatio: 0.50674,
    /** 14 pt above the rule (y ≈ 381) so descenders clear it → 395. 395 / 795. */
    baselineYRatio: 0.49686,
    fontSize: 30,
    minFontSize: 16,
    /** Rule is 501 pt wide; 460 pt keeps ~20 pt of air at each end. 460 / 1113. */
    maxWidthRatio: 0.41330,
    bold: true,
    color: HK_INK,
  },
  qr: {
    /** Bottom-left corner. Centred on the label centre (1008.05) → 1008.05 − 38. */
    xRatio: 0.87157,
    /** 12 pt above the label's cap height (63.5 + ~6.8 ≈ 70.3) → 82.3. 82.3 / 795. */
    yRatio: 0.10352,
    /** 76 pt square. 76 / 1113. */
    sizeRatio: 0.06829,
  },
  verifyText: null,
} as const;
```

`HK_ACCENT` is exported/kept even though no stamp uses it yet — it documents the artwork
palette. If TypeScript flags it as unused, prefix the declaration with a
`/** …palette reference… */` comment and export it rather than deleting it.

**1e.** Add the two lookup maps at the bottom of the file:

```ts
export const CERTIFICATE_LAYOUTS: Partial<Record<CertificateType, CertificateLayout>> = {
  CLAUDE_CHALLENGE: CLAUDE_CERT_LAYOUT,
  HACKATHON: HACKATHON_CERT_LAYOUT,
};

/**
 * Per-type template source. Env overrides are DELIBERATELY per type — `.env.local`
 * already sets CERTIFICATE_TEMPLATE_PATH to the Claude artwork, so a shared override
 * would render hackathon certificates on the wrong template.
 */
export const CERTIFICATE_TEMPLATES: Partial<
  Record<CertificateType, { defaultPath: string; urlEnv: string; pathEnv: string }>
> = {
  CLAUDE_CHALLENGE: {
    defaultPath: "public/certificates/claude-certificate-template.pdf",
    urlEnv: "CERTIFICATE_TEMPLATE_URL",
    pathEnv: "CERTIFICATE_TEMPLATE_PATH",
  },
  HACKATHON: {
    defaultPath: "public/certificates/vicodathon-certificate.pdf",
    urlEnv: "HACKATHON_CERTIFICATE_TEMPLATE_URL",
    pathEnv: "HACKATHON_CERTIFICATE_TEMPLATE_PATH",
  },
};
```

Keep `certificateDomainLabel` exactly as it is.

### Step 2 — `src/features/certificate/template-source.ts`

Take a `CertificateType`, and key the cache by resolved path or URL so the two templates
cannot evict each other.

```ts
import type { CertificateType } from "@prisma/client";
import { CERTIFICATE_TEMPLATES } from "./constants";

const cache = new Map<string, { bytes: Uint8Array; mtimeMs: number | null }>();

export async function loadCertificateTemplate(
  type: CertificateType,
): Promise<Uint8Array> { … }
```

Body, in order:

1. `const config = CERTIFICATE_TEMPLATES[type];` — if missing, `logger.error` + throw
   `new Error("Certificate template not configured")`.
2. `const url = process.env[config.urlEnv];` — if set, `fetch(url, { cache: "no-store" })`
   exactly as today, then `cache.set(url, { bytes, mtimeMs: null })`. Return early.
3. Otherwise `path.resolve(process.cwd(), process.env[config.pathEnv] ?? config.defaultPath)`.
4. `stat` for `mtimeMs`; return `cache.get(absolutePath)!.bytes` on an mtime hit;
   otherwise `readFile`, `cache.set(absolutePath, …)`, return.

Keep the existing `logger.error("Certificate template not configured", { … })` calls and
the thrown-message text unchanged — the download route already surfaces it as a 500.
Delete the module-level `cached` variable and the `DEFAULT_PUBLIC_TEMPLATE` constant
(the default now lives in `CERTIFICATE_TEMPLATES`).

### Step 3 — `src/features/certificate/render-certificate-pdf.ts`

**3a.** Export the sanitizer so the backfill script can pre-flight names with the exact
same rule the renderer enforces:

```ts
export function toWinAnsiSafe(name: string): string { … }   // body unchanged
```

**3b.** Add `type` to the input and resolve layout + template from it:

```ts
export async function renderCertificatePdf(input: {
  type: CertificateType;
  recipientName: string;
  certificateId: string;
  /** Already formatted IST string, e.g. "12 Mar 2026". Formatted by the caller. */
  issuedOn: string;
  verifyUrl: string;
  /** Draws a calibration grid over the page. Dev only. */
  debugGrid?: boolean;
}): Promise<Uint8Array>
```

```ts
const layout = CERTIFICATE_LAYOUTS[input.type];
if (!layout) {
  throw new Error(`No certificate layout for type ${input.type}`);
}
const pdfDoc = await PDFDocument.load(await loadCertificateTemplate(input.type), {
  updateMetadata: false,
});
```

**3c.** Replace `drawCentered` with one stamp helper that handles both alignments:

```ts
function drawStamp(text: string, stamp: CertificateTextStamp) {
  const font = stamp.bold ? boldFont : regularFont;
  const x =
    stamp.align === "center"
      ? width * stamp.centerXRatio - font.widthOfTextAtSize(text, stamp.fontSize) / 2
      : width * stamp.xRatio;
  page.drawText(text, {
    x,
    y: height * stamp.baselineYRatio,
    size: stamp.fontSize,
    font,
    color: rgb(stamp.color.r, stamp.color.g, stamp.color.b),
  });
}
```

Then `drawStamp(issuedOn, layout.issuedOn)` and `drawStamp(certificateId, layout.certificateId)`.

**3d.** Name block: unchanged logic, but read `layout.name` and use
`layout.name.bold ? boldFont : regularFont` and `layout.name.color` instead of the
hardcoded `bold` / near-black.

**3e.** QR: unchanged, reading `layout.qr`. **Keep `color: { dark: "#000000FF", light:
"#FFFFFFFF" }`.** The white quiet zone is what makes the code scannable on this dark
artwork — do not make it transparent or invert it.

**3f.** Verify-URL line: wrap in `if (layout.verifyText) { … }` so the hackathon template
skips it.

**3g.** Metadata: `pdfDoc.setSubject(\`${CERTIFICATE_TYPES[input.type].title} Certificate\`)`
instead of the hardcoded `"60-Day Claude Challenge Certificate"`. `setTitle`, `setAuthor`,
`setKeywords`, `setProducer` unchanged.

**3h.** Leave `drawCalibrationGrid` exactly as it is — it draws in the same coordinate
space as the stamps, so it stays a valid calibration reference on this template.

### Step 4 — `src/features/certificate/issue-hackathon-certificate.ts` `[new]`

```ts
import "server-only";
import { CertificateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateCertificateId } from "./generate-certificate-id";

/** Stamped into metadata so a future event can be told apart from this one. */
export const HACKATHON_EVENT_KEY = "vicodathon-2026";

export type HackathonCertificateResult =
  | { ok: true; data: { certificateId: string; alreadyIssued: boolean } }
  | { ok: false; message: string };

export async function ensureHackathonCertificate(
  userId: string,
): Promise<HackathonCertificateResult>
```

Body, in order:

1. Look up the participant, one query, `select` only what is needed:

```ts
const participant = await prisma.hackathonParticipant.findUnique({
  where: { userId },
  select: {
    fullName: true,
    isLeader: true,
    team: {
      select: {
        id: true,
        teamCode: true,
        teamName: true,
        entryType: true,
        submission: {
          select: {
            repoUrl: true,
            liveUrl: true,
            aiLogUrl: true,
            updatedAt: true,
            problem: { select: { title: true } },
          },
        },
      },
    },
  },
});
```

2. `if (!participant) return { ok: false, message: "Not registered for the hackathon" };`
3. `const submission = participant.team.submission;`
   `if (!submission) return { ok: false, message: "Team has no submission" };`
4. **Eligibility — repo AND live URL, both non-empty after trim:**

```ts
const repoUrl = submission.repoUrl.trim();
const liveUrl = submission.liveUrl.trim();
if (!repoUrl || !liveUrl) {
  return { ok: false, message: "Submission is missing a repo URL or a live URL" };
}
```

`HackathonSubmission.repoUrl` / `liveUrl` are NOT NULL and store `""` for "not provided"
(see the schema comment) — so the trim check is the whole rule. Do **not** add URL-shape
validation; the dry run prints the URLs for eyeballing instead.

5. Idempotency — there is no DB unique constraint for this (see §7), so check first:

```ts
const existing = await prisma.certificate.findFirst({
  where: { userId, type: CertificateType.HACKATHON },
  select: { certificateId: true },
});
if (existing) {
  return { ok: true, data: { certificateId: existing.certificateId, alreadyIssued: true } };
}
```

6. Name — `participant.fullName.trim()`; if empty, return
   `{ ok: false, message: "Participant has no name on their hackathon registration" }`.
   (Not expected: the column is NOT NULL and set at registration.)
7. Create, inside `try/catch`:

```ts
const certificateId = await generateCertificateId(CertificateType.HACKATHON);
const created = await prisma.certificate.create({
  data: {
    certificateId,
    userId,
    type: CertificateType.HACKATHON,
    recipientName: fullName,
    domain: null,          // hackathon is not a challenge track
    enrollmentId: null,
    issuedAt: new Date(),
    metadata: {
      event: HACKATHON_EVENT_KEY,
      teamId: participant.team.id,
      teamCode: participant.team.teamCode,
      teamName: participant.team.teamName,
      entryType: participant.team.entryType,
      isLeader: participant.isLeader,
      problemTitle: submission.problem?.title ?? null,
      repoUrl,
      liveUrl,
      submittedAt: submission.updatedAt.toISOString(),
    },
  },
  select: { certificateId: true },
});
return { ok: true, data: { certificateId: created.certificateId, alreadyIssued: false } };
```

On error: `logger.error("Could not issue hackathon certificate", { userId, error: String(error) })`
and return `{ ok: false, message: "Could not issue certificate" }`.

Single insert, so **no transaction is needed** here.

### Step 5 — `src/features/certificate/get-certificate.ts`

Replace the Claude-shaped fields with a generic, pre-formatted list.

```ts
export type PublicCertificateView = {
  certificateId: string;
  recipientName: string;
  type: CertificateType;
  title: string;
  subtitle: string;
  issuedOn: string;
  /** "Completed" for the challenge, "Participated" for the hackathon. */
  statusLabel: string;
  /** Extra rows for the details list. Already stringified. */
  details: { label: string; value: string }[];
  isRevoked: boolean;
};
```

Add `type` to the existing `select` (it is already selected — keep it) and build `details`
by type:

- `CLAUDE_CHALLENGE` → `Track` (`certificateDomainLabel(cert.domain)`, only when
  `cert.domain != null`), `Days completed`, `Longest streak` (each only when the metadata
  value is a number). `statusLabel = "Completed"`.
- `HACKATHON` → `Team` (`metadata.teamName` as a string, else `"Solo entry"`),
  `Brief` (`metadata.problemTitle` as a string, else `"—"`). `statusLabel = "Participated"`.
- Any other type → empty `details`, `statusLabel = "Issued"`.

Keep the existing `certificateIdSchema.safeParse` guard, the `metadata` narrowing helper,
and `formatDateIST(cert.issuedAt)` exactly as they are. `certificateDomainLabel` stays
exported and in use.

### Step 6 — `src/features/certificate/get-achievements.ts`

Same shape change, mirroring Step 5:

```ts
export type AchievementView = {
  key: string;
  title: string;
  subtitle: string;
  certificateId: string;
  issuedOn: string;
  statusLabel: string;
  stats: { label: string; value: string }[];
  status: "COMPLETED" | "REVOKED";
};
```

`stats` per type: `CLAUDE_CHALLENGE` → `Days completed`, `Longest streak`;
`HACKATHON` → `Team`, `Brief`; other → `[]`.

**Leave everything else in this file alone** — in particular keep the
`ensureClaudeCertificate(userId)` call in its existing try/catch (a hackathon-only user is
not enrolled, so it returns `{ ok: false }` harmlessly), and keep
`orderBy: { issuedAt: "desc" }`. That ordering is what puts the newer hackathon
certificate above an older Claude one; **do not add a type-based sort on top of it.**

Do **not** call `ensureHackathonCertificate` from here — issuance is the script's job.

### Step 7 — `src/components/certificate/achievement-card.tsx`

In the `<dl>`, keep the `Certificate ID` and `Issued on` rows, then replace the two
hardcoded stat rows with:

```tsx
{achievement.stats.map((stat) => (
  <div key={stat.label}>
    <dt className="text-muted-foreground">{stat.label}</dt>
    <dd className="font-medium">{stat.value}</dd>
  </div>
))}
```

Use `{achievement.statusLabel}` inside the green `Badge` in place of the literal
`Completed`. Everything else — the `Award` icon, the buttons, `CopyVerifyLinkButton`,
the `download` anchor — stays as is. Do not add `"use client"`.

### Step 8 — `src/app/verify/[certificateId]/page.tsx`

In the verified-certificate `<dl>`, keep `Recipient`, `Credential`, `Issued on`,
`Certificate ID` and `Status`; **delete** the `Track` row and the two conditional
`daysCompleted` / `longestStreak` rows, and render `cert.details.map(...)` in their place
using the same `<div><dt/><dd/></div>` markup. Use `{cert.statusLabel}` in the badge.

The not-found and revoked branches are unchanged. `CertificatePreviewPanel` is unchanged.

### Step 9 — `src/app/verify/[certificateId]/download/route.ts`

**9a.** Filename by type:

```ts
function safePdfFilename(fullName: string, cert: { type: CertificateType; certificateId: string }): string {
  const namePart =
    fullName.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "recipient";
  return `ABTalks-${CERTIFICATE_TYPES[cert.type].fileSlug}-${namePart}-${cert.certificateId}.pdf`;
}
```

**9b.** Pass `type: cert.type` into `renderCertificatePdf({ … })`. Everything else — the
404/410 branches, the `UNRENDERABLE_NAME` → 422 branch, the `?inline=1` and `?debug=grid`
handling, `Cache-Control` — stays exactly as it is.

**9c. Calibration pass (do this before moving on).** With `npm run dev` and a real
hackathon certificate ID, open:

```
http://localhost:3000/verify/ABT-HK-XXXXX/download?inline=1&debug=grid
```

The grid draws red vertical lines every 0.05 of page width and blue horizontal lines every
0.05 of page height, labelled with their ratio. Check all four placements against §2 and
nudge only `HACKATHON_CERT_LAYOUT` if something is off:

- Certificate code sits under the `CERTIFICATE ID` label, visually centred on it.
- Date sits to the **right** of `DATE OF ISSUE`, on the same baseline, with a clear gap.
- Name sits just above the underline, centred on the rule (not on the page).
- QR sits directly above `SCAN TO VERIFY`, centred on that label, not overlapping it.

### Step 10 — `prisma/scripts/backfill-hackathon-certificates.ts` `[new]`

Model it on `prisma/scripts/backfill-certificates.ts` — same `dotenv` bootstrapping,
`--dry-run` flag, 5-second pause, `issued/skipped/failed` summary, same `main().catch(…).finally(…)`
shape. `console.log` is correct here (existing scripts use it); `logger` is for `src/`.

Query:

```ts
const teams = await prisma.hackathonTeam.findMany({
  where: { submission: { isNot: null } },
  select: {
    id: true,
    teamCode: true,
    teamName: true,
    entryType: true,
    submission: { select: { repoUrl: true, liveUrl: true } },
    participants: {
      orderBy: { slotIndex: "asc" },
      select: { userId: true, fullName: true, email: true, isLeader: true },
    },
  },
  orderBy: { createdAt: "asc" },
});
```

Then in code:

1. Filter to teams where `repoUrl.trim()` **and** `liveUrl.trim()` are both non-empty.
   Collect the excluded ones separately.
2. Print, per eligible team: team code, team name or `SOLO`, participant count, and the
   two URLs — so you can eyeball them before issuing.
3. Print the excluded teams under a `SKIPPED (incomplete submission)` heading with
   whichever field was blank.
4. **Pre-flight the names**: run every eligible `fullName` through the exported
   `toWinAnsiSafe`. Any that come back empty are listed under
   `UNRENDERABLE NAME — will be skipped`, with the user's email so you can fix the
   registration row. This catches at issue time what would otherwise be a 422 at download
   time.
5. `if (dryRun) { console.log("Dry run — no certificates issued."); return; }`
6. 5-second pause, then loop every eligible participant calling
   `ensureHackathonCertificate(userId)`, skipping the unrenderable-name list, tallying
   `issued` / `skipped` (already issued) / `failed`, printing one line each
   (`OK` / `SKIP` / `FAIL` + name + result).
7. Final summary line, plus a reminder that certificates are live at
   `/verify/<id>` and on `/achievements`.

Import `ensureHackathonCertificate` and `toWinAnsiSafe` with the same relative-path style
the existing script uses (`../../src/features/certificate/…`).

### Step 11 — `package.json`

Add next to the existing backfill script:

```json
"db:backfill:certificates:hackathon": "tsx prisma/scripts/backfill-hackathon-certificates.ts"
```

---

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT touch `prisma/schema.prisma` or create a migration.** `Certificate.domain` and
  `Certificate.enrollmentId` are already nullable and `CertificateType.HACKATHON` already
  exists. This plan has zero schema changes. Do not "helpfully" add
  `@@unique([userId, type])` — see §7 for why that is deliberately out of scope.
- **DO NOT let `CERTIFICATE_TEMPLATE_PATH` / `CERTIFICATE_TEMPLATE_URL` apply to the
  hackathon template.** `.env.local` already points `CERTIFICATE_TEMPLATE_PATH` at the
  Claude artwork; reading it globally would silently render hackathon certificates on the
  wrong template. Env overrides are per type.
- **DO NOT keep a single module-level template cache.** Key it by resolved path/URL, or
  the two templates will evict each other on every alternating request.
- **DO NOT change any number in `CLAUDE_CERT_LAYOUT`.** Adding `align` / `bold` is the
  only permitted edit there. The Claude certificate is live and already calibrated.
- **DO NOT change the QR colours.** `dark: "#000000FF"`, `light: "#FFFFFFFF"` — the white
  quiet zone is what makes it scannable on a dark background.
- **DO NOT read the recipient name from `StudentProfile`.** It is
  `HackathonParticipant.fullName`, the hackathon registration snapshot.
- **DO NOT relax the eligibility rule.** Both `repoUrl` and `liveUrl` must be non-empty
  after `.trim()`. `aiLogUrl` is not part of the rule. Removed participants
  (`HackathonRemoval`) are not eligible — only current `HackathonParticipant` rows.
- **DO NOT create a second renderer file.** `renderCertificatePdf` is parameterised by
  `type`; there is no `render-hackathon-certificate-pdf.ts`. The only new file in `src/`
  is `issue-hackathon-certificate.ts`.
- **DO NOT add a type-based sort in `getAchievements`.** `orderBy: { issuedAt: "desc" }`
  already produces "most recent first" — that is the requested behavior.
- **DO NOT call `ensureHackathonCertificate` from `getAchievements`, a page, or a Server
  Action.** Issuance is the script's job only. Adding a read-path write would also expose
  the missing unique constraint (§7).
- **DO NOT add `requireRole` / `requireAdmin` to `/verify/[certificateId]` or its
  `download` route.** Both are **public** by design — a recruiter with the link must be
  able to verify without an account.
- **DO NOT add `"use client"` to `achievement-card.tsx`.** It is a Server Component that
  renders a client button; keep it that way.
- **DO NOT put icons, functions, dates, or class instances in `stats` / `details`.**
  Plain `{ label: string; value: string }` only.
- **DO NOT touch `middleware.ts`, `auth.ts`, or `auth.config.ts`.** Nothing in this
  feature needs them, and `middleware.ts` must stay free of `@/lib/*` imports.
- **DO NOT use `<Button asChild>` or `<Button render={<Link>}>`.** Existing files already
  use `buttonVariants` on the anchor/`Link`; keep that.
- **DO NOT use `console.error` inside `src/`** — `logger` from `@/lib/logger`.
  `console.log` in `prisma/scripts/*` is correct and matches the existing script.
- **DO NOT run the backfill script, `npx prisma migrate`, or any `db:` command.** Report
  the plan as implemented and let the owner run it.
- **DO NOT create files not listed in §3.** No new helper module for the stats arrays —
  inline them.

---

## 7. DB safety

No schema change and no migration. The script only **INSERTs** `Certificate` rows; it
never updates or deletes.

Before the first real (non-`--dry-run`) execution:

1. Commit the code first, so the tree is clean: `git add -A && git commit`. Note the
   commit hash — the rows created below are traceable to it.
2. Take a Neon branch snapshot of production (point-in-time branch from the console),
   in case the run has to be undone.
3. Run `npm run db:backfill:certificates:hackathon -- --dry-run` first, **always**, and
   read the listing: eligible teams, their repo/live URLs, the skipped-incomplete list,
   and the unrenderable-name list.
4. Only then run it without the flag.

Rollback, if a run turns out wrong: restore the Neon snapshot, or — because every row
this plan creates is `type = 'HACKATHON'` and nothing else writes that type today — delete
them by hand. **This is destructive; run it only against a snapshot you have taken, and
check the `SELECT` count first:**

```sql
SELECT count(*) FROM "Certificate" WHERE type = 'HACKATHON';
```

### Known limitation (deliberate, documented here so it is not rediscovered later)

There is **no DB-level uniqueness** on `(userId, type)` for hackathon certificates —
`enrollmentId @unique` only guards challenge certificates. Idempotency comes from the
`findFirst` check in `ensureHackathonCertificate`, which is sufficient because issuance is
a single-threaded script run by one person. Two concurrent callers could create two rows.

**If a self-claim button, an admin action, or an email-triggered claim is ever added,
that guard becomes insufficient** and this must be revisited first — most likely by adding
a `scopeKey String @default("")` column plus `@@unique([type, userId, scopeKey])`
(scopeKey = the event key for hackathon, the enrollment id for challenge certificates, so
the backfill of existing rows cannot collide). That is out of scope here on purpose: it
would turn a zero-risk additive feature into a production migration.

---

## 8. Verification

**Build / types**

```bash
npx tsc --noEmit
```

```bash
npm run build
```

Both must pass clean. The `AchievementView` / `PublicCertificateView` shape changes are
breaking, so a type error in `achievement-card.tsx` or `verify/[certificateId]/page.tsx`
means Step 7 or Step 8 was missed.

**Manual — hackathon certificate**

1. Locally, ensure at least one `HackathonTeam` has a submission with both `repoUrl` and
   `liveUrl` set, then run `npm run db:backfill:certificates:hackathon -- --dry-run` and
   confirm the listing shows that team and its participants.
2. Run it for real against the **local** DB and note an issued `ABT-HK-XXXXX`.
3. Open `/verify/ABT-HK-XXXXX` — recipient name, `ViCoDathon 2026` credential,
   `Participated` badge, `Team` and `Brief` rows, **no `Track` row**, no
   `Days completed` / `Longest streak`, and the inline PDF preview renders.
4. Open `/verify/ABT-HK-XXXXX/download?inline=1` and check all four placements:
   - `ABT-HK-XXXXX` directly under the `CERTIFICATE ID` label, centred on it
   - the date to the **right** of `DATE OF ISSUE`, same baseline
   - the name centred on the underline and sitting just above it, no overlap
   - the QR directly above `SCAN TO VERIFY`, centred on it, white quiet zone intact
5. **Scan the QR with a phone** — it must open `/verify/ABT-HK-XXXXX`.
6. Downloaded filename is `ABTalks-ViCoDathon-2026-<Name>-ABT-HK-XXXXX.pdf`.
7. `/achievements` as that user shows the hackathon card with `Team` / `Brief` stats.

**Manual — Claude certificate did not regress**

8. Open an existing `ABT-CC-XXXXX` on `/verify` and `/verify/.../download?inline=1`.
   The artwork, all five stamps (including the verify-URL line), the `Track` /
   `Days completed` / `Longest streak` rows and the `Completed` badge must be **pixel-
   identical to before**. Compare against a PDF saved before the change.
9. As a user holding **both** certificates, `/achievements` lists the hackathon one
   **first** (newer `issuedAt`), each card showing its own stat pair.
10. Alternate between a `ABT-CC-` and a `ABT-HK-` download several times in one dev
    session — each must keep rendering on its own artwork (proves the per-path cache).

**Deploy check before running the backfill on production**

11. Push the branch, open the Vercel preview, and load a hackathon certificate's
    `/verify/<id>/download` there. Templates are read from `public/` off the function
    filesystem at runtime (this is how the Claude template already ships — see plan 050),
    so a missing template only surfaces at runtime, never at build time. Confirm the
    preview renders before running the script against production.

**Files that should have changed — nothing else**

```
docs/plans/065-hackathon-participation-certificates.md   [new]
package.json                                             [edit]
prisma/scripts/backfill-hackathon-certificates.ts        [new]
src/app/verify/[certificateId]/download/route.ts         [edit]
src/app/verify/[certificateId]/page.tsx                  [edit]
src/components/certificate/achievement-card.tsx          [edit]
src/features/certificate/constants.ts                    [edit]
src/features/certificate/get-achievements.ts             [edit]
src/features/certificate/get-certificate.ts              [edit]
src/features/certificate/issue-hackathon-certificate.ts  [new]
src/features/certificate/render-certificate-pdf.ts       [edit]
src/features/certificate/template-source.ts              [edit]
```

`prisma/schema.prisma`, `prisma/migrations/`, `middleware.ts`, `auth.ts`,
`auth.config.ts` and everything under `src/app/hackathon/` must be untouched.

---

## 9. Commit message

```
feat(certificate): issue ViCoDathon 2026 participation certificates

Parameterise the certificate renderer by CertificateType so a second
template can be stamped with its own layout, and add hackathon issuance.

- constants: HACKATHON_CERT_LAYOUT measured off the ViCoDathon artwork
  (1113x795pt, MediaBox y=8.04) — code under the CERTIFICATE ID label,
  date right of DATE OF ISSUE on the same baseline, name centred on the
  underline rule, QR above SCAN TO VERIFY
- template-source: per-type template with a per-path cache, so the two
  templates cannot evict each other; env overrides are scoped per type
  because .env.local already pins CERTIFICATE_TEMPLATE_PATH to Claude
- render: left-aligned stamps, optional verify-URL line, per-type subject
- issue-hackathon-certificate: eligible = a current participant whose team
  submitted a non-empty repo URL AND live URL; name snapshot comes from
  HackathonParticipant.fullName
- achievements/verify: generic stats/details rows so a hackathon card no
  longer shows an empty Track and 0 days completed
- backfill script + npm run db:backfill:certificates:hackathon, with a
  --dry-run listing and an unrenderable-name pre-flight

No schema change: Certificate.domain and .enrollmentId are already
nullable and CertificateType.HACKATHON already exists.
```
