# 066 — College dropdown (searchable, all-India list + "Other")

## 1. Goal

Replace the free-text **College** input at registration and on the profile with a
searchable dropdown backed by a canonical list of 54,651 Indian institutions,
with an always-available "use what I typed" escape hatch. This kills the spelling
chaos in `StudentProfile.college` (which today feeds the leaderboard, admin
students table, CSV exports, recruiter profiles and certificates) and makes
"students per college" a real, groupable number.

---

## 2. Current behavior

- `StudentProfile.college` is `String?`, written from a plain `<Input>` in three
  places: [registration-form.tsx:377](src/app/register/registration-form.tsx:377),
  [profile-form.tsx:150](src/app/profile/profile-form.tsx:150), and
  [hackathon/registration-form.tsx:419](src/components/hackathon/registration-form.tsx:419)
  (which writes `HackathonParticipant.college`, a required `String`).
- Zod validates it as `z.string().trim().min(1).max(200)` in
  [register.ts](src/lib/validations/register.ts) and
  [profile.ts:42](src/lib/validations/profile.ts:42). No normalization anywhere.
- The string is read back verbatim by `get-leaderboard.ts`, `get-students.ts`,
  `admin-export-actions.ts`, `get-recruiter-profile.ts`, `issue-certificate.ts`.
  **Nothing does an exact-match lookup or `groupBy` on it today**, so introducing
  a canonical list breaks no existing query.
- There is no combobox/typeahead primitive in `src/components/ui/` — but
  `@base-ui/react@1.4.1` ships `autocomplete` (already a dependency; `select.tsx`
  is built on the same package).
- All three consumer routes (`/register`, `/profile`, `/hackathon/register`) are
  in `protectedPaths` in [middleware.ts](middleware.ts) — the search endpoint can
  safely require a session.

### Data research (already done — findings drive the design)

Two public datasets were downloaded and analysed; both are needed because
**neither one alone is usable**:

| Source | Rows | Unique | Has state? | Snapshot |
|---|---|---|---|---|
| AISHE college list (`PriyanKishoreMS/colleges-api@3de6fca`, `data/colleges.csv`) | 43,121 | 42,821 | yes (36) + district + city | 2022-12-18 |
| AICTE institutions (`anburocky3/indian-colleges-data@3a34eda`, `data/institutions.json`, MIT) | 39,267 | 12,772 by name+district | district only | 2025-10-30 |

Merged and deduped: **54,582 unique institutions** (~41.9k AISHE-only, ~11.5k
AICTE-only, ~1.2k in both).

**The critical finding:** raw government data is not searchable by the names
students actually type. Substring search over the merged set returns **zero
results** for `IIT Bombay`, `NIT Trichy`, `BITS Pilani`, `DTU` and `VJTI`.
Causes, all verified:

- 8 of 23 IITs are absent entirely (Hyderabad, Tirupati, Palakkad, Bhilai, Goa,
  Jammu, Dharwad, ISM Dhanbad). NIT Trichy and NIT Surathkal are absent too.
- Present ones carry stale or misspelled names: `Indian Institute of Technology,
  Mumbai` (not Bombay), `…, Chennai` (not Madras), `…, Kaharagpur` (sic).
- No acronyms anywhere — nobody types "Veermata Jijabai Technological Institute".

So the pipeline needs a **curated overlay**, already built and validated:
[docs/plans/assets/066-colleges-known.json](docs/plans/assets/066-colleges-known.json)
— 215 entries (all 23 IITs, 31 NITs, 28 IIITs, IISc/IISERs/IIST/ISI/NISER, BITS
campuses, and ~110 well-known state/private institutions) with `aliases`, `state`,
`city`, `tier` (1 = top-of-mind, 2 = well-known; everything else defaults to 3)
and `govAliases`.

Against the merged set that file resolves to: **112 absorbed by exact name match,
24 absorbed via `govAliases`, 81 inserted as new rows** → final table **54,651 rows**
(6.27 MB, 1.1 MB gzipped).

`govAliases` exists because **fuzzy matching must not be used**: token-overlap
scoring rates "IIT Kharagpur" ↔ "IIT Ropar" at 0.60 and "IIT Hyderabad" ↔
"Institute of Management Technology, Hyderabad" at 0.60. Every workable threshold
mis-merges distinct institutions. All 24 `govAliases` strings were verified to
exist verbatim in the source data.

---

## 3. Files to touch

**Data pipeline**
- `scripts/build-colleges-dataset.ts` — `[new]` one-off builder, **already written
  and verified**: copy `docs/plans/assets/066-build-colleges-dataset.ts` verbatim.
- `prisma/content/colleges-known.json` — `[new]` copy of
  `docs/plans/assets/066-colleges-known.json` verbatim (the hand-maintained overlay).
- `prisma/content/colleges.json` — `[new]` generated output, committed (6.27 MB,
  1.1 MB gzipped in git).
- `prisma/seed-colleges.ts` — `[new]` chunked idempotent seed into `College`.
- `prisma/scripts/backfill-profile-college-id.ts` — `[new]` link existing profiles.
- `package.json` — `[edit]` add `db:seed:colleges` and `db:backfill:college-id`.

**Schema**
- `prisma/schema.prisma` — `[edit]` add `College` model; add `collegeId String?` to
  `StudentProfile`.

**Server**
- `src/features/college/search-colleges.ts` — `[new]` the one raw-SQL search query.
- `src/app/api/colleges/search/route.ts` — `[new]` GET handler (session-gated).

**Client**
- `src/components/shared/college-combobox.tsx` — `[new]` the reusable field.
- `src/app/register/registration-form.tsx` — `[edit]` swap the `<Input>`.
- `src/app/profile/profile-form.tsx` — `[edit]` swap the `<Input>`.
- `src/components/hackathon/registration-form.tsx` — `[edit]` swap the `<Input>`.

**Validation + persistence**
- `src/lib/validations/register.ts` — `[edit]` accept optional `collegeId`.
- `src/lib/validations/profile.ts` — `[edit]` accept optional `collegeId`.
- `src/app/actions/registration-actions.ts` — `[edit]` read `collegeId` from FormData.
- `src/app/actions/profile-actions.ts` — `[edit]` read `collegeId` from FormData.
- `src/features/registration/complete-registration.ts` — `[edit]` persist `collegeId`.
- `src/features/profile/update-profile.ts` — `[edit]` persist `collegeId`.

**Out of scope (do not touch):** `src/components/workshop/RegistrationForm.tsx`
(its field is an optional combined "College / Company" free-text on a public page),
`HackathonParticipant` schema (keeps its `college` string only — the combobox just
makes that string canonical), and every read path listed in §2 (they keep reading
`college`).

---

## 4. Server vs Client

| Component / module | Kind | Notes |
|---|---|---|
| `college-combobox.tsx` | **Client** (`"use client"`) | Owns debounce + `fetch`. Receives only strings and callbacks from its parents, which are already client components. |
| `registration-form.tsx` | Client (already) | No new boundary crossing. |
| `profile-form.tsx` | Client (already) | No new boundary crossing. |
| `hackathon/registration-form.tsx` | Client (already) | No new boundary crossing. |
| `api/colleges/search/route.ts` | **Server** (Route Handler) | Reads session, calls the feature, returns JSON. |
| `search-colleges.ts` | **Server** | `import "server-only"`. Raw SQL via Prisma. |
| `build-colleges-dataset.ts`, `seed-colleges.ts`, backfill | Node scripts | Never imported by app code. |

No Server→Client prop passing is introduced. No functions, icons or class
instances cross a boundary.

**Why a Route Handler and not a Server Action:** the house rule is *mutations* go
through Server Actions. This is a read on a hot typing path — a GET gives real
parallelism (Server Action calls are serialized by the client router), plus
`Cache-Control` reuse across users typing the same prefix. State this in the file
header comment so the exception is not mistaken for drift.

---

## 5. Steps

### Step 1 — `prisma/content/colleges-known.json`
Copy `docs/plans/assets/066-colleges-known.json` byte-for-byte. Do not regenerate,
reorder or reformat it. Entry shape:

```ts
type KnownCollege = {
  name: string;          // canonical display name — always wins over gov data
  aliases: string[];     // what students actually type ("IIT Bombay", "IITB")
  state: string;
  city: string;
  tier: 1 | 2;           // search rank; gov-only rows default to 3
  govAliases?: string[]; // exact gov-data spellings this entry absorbs
};
```

### Step 2 — `scripts/build-colleges-dataset.ts`

**This script is already written and verified — copy
[docs/plans/assets/066-build-colleges-dataset.ts](docs/plans/assets/066-build-colleges-dataset.ts)
verbatim.** It has been run end-to-end against both live sources and produces
54,651 rows with the overlay resolving exactly 112 / 24 / 81; it asserts those
counts and throws if a source dataset drifts. Do not rewrite it from the rules
below — they are here to explain what it does, not to be re-implemented.

Run once locally (`npx tsx scripts/build-colleges-dataset.ts`); the output is
committed. It must **not** run during build or deploy.

1. Download, pinned by commit SHA (fail loudly on non-200):
   - `https://raw.githubusercontent.com/PriyanKishoreMS/colleges-api/3de6fcaec0a6d89ddf207612996317c309d2ab3d/data/colleges.csv`
   - `https://raw.githubusercontent.com/anburocky3/indian-colleges-data/3a34eda392a284e3c87b93ad2981dacb9bc0a470/data/institutions.json`

   `raw.githubusercontent.com` rate-limits (HTTP 429) under repeated fetches —
   cache both downloads under `.cache/` and reuse if present.

2. Normalize every name, in this order:
   - NFKC normalize, trim, strip wrapping quotes, collapse whitespace;
   - drop a leading `^\d{4,}\s*[-–]\s*` institute code (165 rows);
   - drop a trailing 6-digit pin code and a trailing comma;
   - cut everything from the first `Address:` / `District:` / `Taluka:` marker (126 rows);
   - hard-cap at 200 characters, truncating at the last word boundary
     (15 rows exceed it; the existing Zod `max(200)` would otherwise reject them);
   - skip names shorter than 4 characters and the single `#Name?` Excel artifact.

3. Case: if a name is entirely uppercase, title-case it, keeping tokens that are
   in the acronym set or that are ≤5 chars with no vowel (VJTI, SSN, RVCE) as-is,
   and lowercasing `of/and/for/the/in/at`. Names already in mixed case are left
   exactly as the source has them. Render `'S` as `'s`.

4. Merge key: `upper(alnum(name)) + "|" + upper(alnum(district))`. On collision,
   union the sources and fill any blank `state` / `district` / `city` / `type`.

5. AICTE rows have no state. Derive it from the AISHE data: build a
   `district(upper) → most-common state` map and apply it. Leave `state` null when
   the district is unknown (~2,400 rows).

6. Apply the curated overlay:
   - **exact normalized name match** (`upper(alnum(name))`) → the gov row is
     absorbed: curated `name` becomes the display name, the gov name is appended
     to `aliases`, `tier` and `city` come from the curated entry;
   - each string in `govAliases` → same absorption, matched **verbatim**;
   - no match → insert the curated entry as a new row with `state`/`city` from the
     curated entry and `district = city`.
   - **No fuzzy, no similarity threshold, no "closest match".** If a curated entry
     matches nothing, it is an insert — that is the correct outcome.
   - Assert the counts and fail the build if they drift: 112 exact, 24 govAlias,
     81 inserts, 215 total curated entries.

7. Collapse curated rows that survived as two entries because the two sources
   spell the district differently ("North West" vs "NORTH WEST DELHI",
   "Bangalore Rural" vs "BANGALORE URBAN") — dedupe **tier < 3 rows only**, by
   name + state. Never for tier 3: 40 gov rows are named exactly "Government
   Polytechnic" and district is the only thing distinguishing them. 12 rows
   collapse here.

8. Title-case `district` and `city` from both sources and strip AICTE's
   " DISTRICT" suffix — they render on the dropdown's secondary line, and raw
   AISHE ("Imphal West") next to raw AICTE ("WEST GODAVARI") looks broken.

9. Write `prisma/content/colleges.json` as an array of
   `{ name, state, district, city, aliases, tier }`, sorted by name, omitting
   nulls, empty `aliases` and the default `tier: 3` (that omission alone is worth
   ~2 MB). **`nameKey` and `searchText` are deliberately not stored** — the seed
   derives both, so the search-text format has one definition, next to the query
   that consumes it. Expect **54,651 rows, 6.27 MB**.

### Step 3 — `prisma/schema.prisma`

```prisma
model College {
  id         String   @id @default(cuid())
  /// upper(alnum(name)) + "|" + upper(alnum(district)) — dedupe + idempotent seed
  nameKey    String   @unique
  name       String
  state      String?
  district   String?
  city       String?
  /// Common names and acronyms students type ("IIT Bombay", "IITB").
  aliases    String[] @default([])
  /// 1 = top-of-mind, 2 = well-known, 3 = everything else. Primary search sort.
  tier       Int      @default(3)
  /// Space-padded, uppercased, alphanumeric-only haystack. See seed script.
  searchText String
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
}
```

In `StudentProfile`, directly after `college`:

```prisma
  /// Set when the student picked a listed college. Null = free-text ("Other").
  /// Deliberately a plain column, not a relation — `college` stays the display
  /// value everywhere, so no read path has to join.
  collegeId                   String?
```

Add no index on `searchText`. At 54,651 short rows a sequential scan with
`LIMIT 20` is a few milliseconds, and the `LIKE '% X%'` patterns can only use a
`pg_trgm` GIN index, which Prisma cannot express without the
`postgresqlExtensions` preview feature. If search latency ever shows up in
practice, that is the upgrade path — not now.

### Step 4 — `prisma/seed-colleges.ts` + `package.json`
- Read `prisma/content/colleges.json`, re-applying the omitted defaults
  (`aliases ?? []`, `tier ?? 3`, missing fields → `null`).
- Derive the two computed columns here — this is their only definition:

  ```ts
  const alnum = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const nameKey = `${alnum(r.name)}|${alnum(r.district)}`;

  // Leading AND trailing space are load-bearing: the search matches
  // `LIKE '% ' || token || '%'`, which is what stops "lpu" from also hitting
  // "Jabalpur" and "Bhagalpur" (442 false positives, measured).
  const searchText = ` ${[r.name, ...aliases, r.city ?? "", r.district ?? ""]
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()} `;
  ```
- `createMany({ data: chunk, skipDuplicates: true })` in chunks of **2,000**
  (~28 batches) — one `createMany` with 54k rows will exceed the parameter limit.
- Idempotent via `nameKey @unique` + `skipDuplicates`; re-running is a no-op.
- Support `--force` to `deleteMany({})` first (for a rebuilt dataset).
- Log progress every chunk and the final `College` count.
- Scripts: `"db:seed:colleges": "tsx prisma/seed-colleges.ts"` and
  `"db:backfill:college-id": "tsx prisma/scripts/backfill-profile-college-id.ts"`.

### Step 5 — `src/features/college/search-colleges.ts`

```ts
import "server-only";
```

`searchColleges(query: string): Promise<CollegeOption[]>` where
`CollegeOption = { id: string; name: string; state: string | null; district: string | null }`.

- Tokenize: uppercase, replace non-alphanumerics with spaces, split, drop empties,
  **take at most 6 tokens**. Return `[]` if the first token is shorter than 2 chars.
- Build one AND-ed condition per token — `"searchText" LIKE '% ' || $token || '%'`.
  The leading `% ` is what makes `lpu` match "Lovely Professional University"
  instead of also matching "Jaba**lpu**r" and "Bhaga**lpu**r" (442 false hits when
  measured without it).
- Order by `tier ASC`, then rows whose `searchText` starts with `' ' || firstToken`
  first, then `length(name) ASC`, then `name ASC`. `LIMIT 20`.
- Use `Prisma.sql` / `$queryRaw` with parameter binding for every token. Tokens are
  alphanumeric-only after tokenizing, so no `%`/`_` escaping is needed — but bind
  them anyway; never interpolate.
- Wrap in try/catch, log via `lib/logger.ts`, return `[]` on failure. Search is
  never allowed to break a registration.

### Step 6 — `src/app/api/colleges/search/route.ts`
- `GET`, `?q=` (Zod: string, max 100, trimmed).
- Require a session via the project's normal server-side `auth()` call; return
  `401` otherwise. **Do not** add `requireRole` / `requireAdmin` — students are the
  callers.
- Result envelope `{ ok: true, data }` / `{ ok: false, message }`, same as everywhere.
- `Cache-Control: private, max-age=300` — the list is static between seeds.
- Header comment explaining the Route-Handler-not-Server-Action choice (§4).

### Step 7 — `src/components/shared/college-combobox.tsx`
Client component built on `Autocomplete` from `@base-ui/react/autocomplete`.

Props:
```ts
type Props = {
  id?: string;
  value: string;                                    // the college NAME (display + submitted)
  onChange: (name: string, collegeId: string | null) => void;
  placeholder?: string;
  "aria-invalid"?: boolean;
};
```

Behaviour:
- `<Autocomplete.Root mode="none" filter={null} items={results} value={value}
  onValueChange={…}>` — `mode="none"` + `filter={null}` disables Base UI's internal
  filtering; the server is the filter.
- Debounce **250 ms**. Keep an `AbortController` in a ref and abort the previous
  request on each new one; ignore `AbortError`. Drop responses that arrive for a
  stale query.
- Typing calls `onChange(text, null)` immediately — the typed text is always the
  submitted value, so a slow or failed search never blocks the form.
- Picking an item calls `onChange(item.name, item.id)`.
- Render `state` (and `district` when it differs) as dimmed secondary text on each
  row — 40 rows are named exactly "Government Polytechnic" and 24 exactly
  "Government Polytechnic College"; the location is the only thing that
  disambiguates them.
- `<Autocomplete.Empty>`: *"No match — press Enter to use "{typed text}""*. This is
  the "Other" path; it needs no separate option, and there must be no explicit
  "Other" item in the list.
- Reuse the `Input` styling from `src/components/ui/input.tsx` for the trigger and
  the popup styling conventions from `src/components/ui/select.tsx`. Do not modify
  either file, and do not add a new `src/components/ui/*` primitive.

### Step 8 — wire the three forms
Identical shape in each; only the form plumbing differs.

1. **`src/app/register/registration-form.tsx`** — add `collegeId: string` to
   `RegistrationFormValues` (default `""`). Replace the `<Input id="college">`
   block with `<Controller name="college">` rendering `<CollegeCombobox>`; its
   `onChange` does `field.onChange(name)` + `setValue("collegeId", id ?? "")`.
   In the submit handler, after `fd.append("college", …)`, append
   `collegeId`. The existing `userType` reset at line 187–189 must also clear
   `collegeId`.
2. **`src/app/profile/profile-form.tsx`** — same, appending `collegeId` next to
   the existing `fd.append("college", v.college)`.
3. **`src/components/hackathon/registration-form.tsx`** — same `<FormField>`
   wrapper, `<CollegeCombobox>` inside `<FormControl>`. **Only the name is
   submitted** — `HackathonParticipant` gains no `collegeId` column, so discard the
   id here. Keep `autoComplete="organization"`.

### Step 9 — validation + persistence
- `register.ts`: add `collegeId: z.union([z.literal(""), z.string().cuid()]).default("")`
  to `studentFields`. Leave `college` exactly as it is.
- `profile.ts`: same field on `updateStudentProfileSchema`.
- `registration-actions.ts` / `profile-actions.ts`: read `collegeId` from FormData
  alongside `college`, same trim-to-string treatment.
- `complete-registration.ts` (line ~149) and `update-profile.ts` (line ~73): write
  `collegeId: input.collegeId || null`. In the professional branch of
  `complete-registration.ts` (line ~166) set `collegeId: null` next to `college: null`.

### Step 10 — `prisma/scripts/backfill-profile-college-id.ts`
- Load every `StudentProfile` with `college != null` and `collegeId == null`
  (`select: { id, college }`).
- Match on `upper(alnum(college))` against a `Map` built from all `College` rows.
  **Exact match only** — same rule as Step 2.6, same reason.
- Update matches in chunks inside a transaction. **Never rewrite `college` itself** —
  what the student typed stays as their display value.
- Print matched / unmatched counts and the 30 most common unmatched strings; those
  are the candidates for the next curated-overlay pass.

### Step 11 — optional, only if Steps 1–10 are green
Read-only admin view of free-text entries: `StudentProfile` rows with
`collegeId == null`, grouped by normalized `college`, ordered by count. It turns
the "Other" long tail into the input for the next overlay update. Skip it if
anything above is unfinished.

---

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT** fuzzy-match, similarity-score or "closest match" anything, in either
  the build script or the backfill. Exact normalized match plus explicit
  `govAliases` only. Measured: token-overlap rates IIT Kharagpur ↔ IIT Ropar at
  0.60. A wrong merge silently rewrites a student's college.
- **DO NOT** ship the college list to the client. It is 5 MB (0.94 MB gzipped) and
  the audience is on mobile data. No import of `colleges.json` from anything under
  `src/`, and no `generateStaticParams`-style prerendering of it.
- **DO NOT** touch `middleware.ts` or `auth.config.ts`. Nothing here goes near the
  Edge bundle.
- **DO NOT** put `requireRole` / `requireAdmin` on the search route — students are
  the callers; a session check is the whole gate.
- **DO NOT** make `collegeId` a Prisma relation or add a foreign key. `college`
  (the string) stays the display value on every read path, so no join is needed
  and merging duplicate `College` rows later stays cheap.
- **DO NOT** change the `college` field's type, nullability, or `max(200)`
  validation, and do not rename or normalize existing stored values.
- **DO NOT** modify `src/components/ui/*`, and do not add a new primitive there —
  the combobox lives in `src/components/shared/`.
- **DO NOT** add an explicit "Other" entry to the list or a separate "my college
  isn't listed" toggle. Free typing already is the escape hatch; a second control
  is one more thing to get wrong on a phone.
- **DO NOT** block submit on the search request. If the fetch fails, times out, or
  returns nothing, the typed text is submitted as-is.
- **DO NOT** run the dataset builder or the seed from `npm run build`,
  `build:deploy`, or `postinstall`. It is a one-off local command.
- **DO NOT** use `<Button asChild>` / `<Button render={<Link>}>` anywhere in the
  new UI, and use `lib/logger.ts` rather than `console.error`.
- **DO NOT** re-download from `raw.githubusercontent.com` on every run — it returns
  HTTP 429 under repeated fetches. Cache locally.

---

## 7. DB safety

Schema and bulk data both change, so checkpoint before touching the database:

1. `git status` clean, then commit everything up to Step 2 (dataset + scripts, no
   schema change yet). **Record the commit hash in the PR description.**
2. Take a **Neon branch snapshot** of production before running any migration, and
   note the branch name next to that commit hash.
3. `npx prisma migrate dev --name college_catalog` — creates `College` and adds
   `StudentProfile.collegeId`. Both changes are purely additive: one new table, one
   new nullable column. No existing column is altered or dropped. Read the
   generated SQL before applying and confirm there is no `DROP` or `ALTER … TYPE`.
4. `npm run db:seed:colleges` — 54,651 inserts in 28 chunks. Verify with
   `SELECT count(*) FROM "College";` (expect 54,651) and
   `SELECT count(*) FROM "College" WHERE tier < 3;` (expect 215).
5. `npm run db:backfill:college-id` — read-modify-write on `StudentProfile` only,
   only ever setting `collegeId` from null. Run it on a Neon branch first and
   confirm the matched/unmatched split looks sane before production.
6. Production deploy runs `prisma migrate deploy` via `build:deploy` as usual; the
   seed and backfill are run by hand afterwards, in that order.

Rollback: drop the `College` table and the `collegeId` column. No other data is
touched, so no restore is needed for the app to keep working.

---

## 8. Verification

**Build / typecheck**
- `npx prisma generate` then `npm run build` — clean.
- `npm run lint` — clean. Strict TS, no `any`, especially around `$queryRaw`.

**Search correctness** — the queries below were run against the built dataset using
the exact ranking in Step 5, and **all 20 pass** (full scan of 54,651 rows: ~5 ms
per query, which is why Step 3 skips the index). Re-run them against the real
database after seeding; each must return the right institution **first**:

| Type | Expected top result |
|---|---|
| `IIT Bombay` | Indian Institute of Technology Bombay |
| `iit b` | an IIT, not "Bhilai Institute of Technology" |
| `NIT Trichy` | National Institute of Technology Tiruchirappalli |
| `BITS Pilani` | Birla Institute of Technology and Science, Pilani |
| `DTU` | Delhi Technological University |
| `VJTI` | Veermata Jijabai Technological Institute |
| `IIIT Hyderabad` | International Institute of Information Technology, Hyderabad |
| `lpu` | Lovely Professional University — and **1 result**, not 442 |
| `iit kgp` | Indian Institute of Technology Kharagpur |
| `nit surathkal` | National Institute of Technology Karnataka, Surathkal |
| `vit vellore` | Vellore Institute of Technology, Vellore |
| `iisc` / `coep` / `kiit` / `psg` / `thapar` | the obvious institution, first |
| `government polytechnic` | 20 rows, visibly distinguished by district + state |

**Manual, on a phone-sized viewport**
1. `/register` as a new student: type 3 characters, confirm results appear without
   layout jump, pick one, submit → `StudentProfile.college` holds the canonical
   name and `collegeId` is set.
2. `/register` with a college that is not listed: type a full name, ignore the
   dropdown, submit → saved verbatim with `collegeId = null`.
3. Kill the network (DevTools offline), type into the field, submit → still saves.
4. `/profile`: existing student's college pre-fills, editing and saving works,
   switching to a listed college sets `collegeId`.
5. `/hackathon/register`: field works; participant row has the canonical string.
6. Registration as a **professional**: no college field, no `collegeId`, submits fine.
7. Leaderboard, `/admin/students`, and the CSV export still render college exactly
   as before for pre-existing users.

**Files that should have changed** — exactly the 19 in §3, plus one new directory
`prisma/migrations/<ts>_college_catalog/`. If anything under
`src/components/ui/`, `middleware.ts`, `auth.config.ts`, or any read path in §2
shows up in `git status`, something went wrong.

---

## 9. Commit message

```
feat(college): searchable all-India college dropdown with free-text fallback

Replace the free-text college input at registration, profile and hackathon
signup with a server-backed searchable dropdown over 54,651 institutions
merged from the AISHE college list and AICTE institution data, plus a
215-entry curated overlay (IITs/NITs/IIITs/IISc/BITS and well-known state
and private institutions) carrying acronyms and common names.

Raw government data alone is unsearchable by the names students type -
"IIT Bombay", "NIT Trichy", "BITS Pilani", "DTU" and "VJTI" all return
nothing against it, and 8 of 23 IITs are missing entirely. The overlay is
matched to the source data by exact name only, never fuzzily.

Adds the College table and StudentProfile.collegeId (nullable, no FK -
college stays the display string on every read path, so free text is still
accepted and nothing needs to join). Typing always wins over the dropdown,
so a slow or failed search can never block a registration.
```
