/**
 * One-off builder for `prisma/content/colleges.json`.
 *
 * Run locally, commit the output. NEVER run this from `npm run build`,
 * `build:deploy` or `postinstall`.
 *
 *   npx tsx scripts/build-colleges-dataset.ts
 *
 * Merges two pinned public datasets and applies the hand-maintained overlay in
 * `prisma/content/colleges-known.json`. Matching between the overlay and the
 * source data is EXACT ONLY — see the note above `applyOverlay`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCES = {
  aishe:
    "https://raw.githubusercontent.com/PriyanKishoreMS/colleges-api/3de6fcaec0a6d89ddf207612996317c309d2ab3d/data/colleges.csv",
  aicte:
    "https://raw.githubusercontent.com/anburocky3/indian-colleges-data/3a34eda392a284e3c87b93ad2981dacb9bc0a470/data/institutions.json",
} as const;

/** Expected overlay resolution. The build fails if these drift. */
const EXPECTED = { curated: 215, exact: 112, govAlias: 24, inserted: 81 } as const;

const CACHE_DIR = join(process.cwd(), ".cache");
const OVERLAY_PATH = process.env.OVERLAY_PATH ?? "prisma/content/colleges-known.json";
const OUT_PATH = process.env.OUT_PATH ?? "prisma/content/colleges.json";

type KnownCollege = {
  name: string;
  aliases: string[];
  state: string;
  city: string;
  tier: 1 | 2;
  govAliases?: string[];
};

/**
 * `nameKey` and `searchText` are NOT stored here — the seed script derives both,
 * so the search-text format has exactly one definition and lives next to the
 * query that consumes it. Storing them doubled the file (15.3 MB → 6.1 MB).
 */
type CollegeRow = {
  name: string;
  state: string | null;
  district: string | null;
  city: string | null;
  aliases: string[];
  tier: number;
};

// ---------------------------------------------------------------- fetching

/** raw.githubusercontent.com 429s under repeated fetches, so cache on disk. */
async function fetchCached(url: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${createHash("sha1").update(url).digest("hex")}.raw`);
  if (existsSync(file)) return readFileSync(file, "utf8");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  writeFileSync(file, body);
  return body;
}

// ----------------------------------------------------------- normalization

const ACRONYMS = new Set([
  "IIT","NIT","IIIT","IIM","IISC","IISER","NIFT","AIIMS","BITS","VIT","SRM","KIIT",
  "PSG","BMS","RV","MIT","DTU","NSUT","IIEST","MNNIT","MANIT","VNIT","SVNIT","NITK",
  "PES","MSRIT","SSN","VJTI","COEP","BIT","LNMIIT","DAIICT","IIITDM","JNTU","JNTUH",
  "JNTUK","JNTUA","GITAM","VTU","AKTU","RTU","MDU","LPU","UPES","SASTRA","AMU","BHU",
  "JMI","JNU","IPU","GGSIPU","NIRMA","NMIMS","SPIT","TCE","CIT","GCT","CET","GEC",
  "REC","UIET","UIT","IET","ITM","IMS","IIMT","ABES","JSS","BMSCE","RVCE","PICT",
  "AISSMS","CUSAT","SOA","CBIT","GRIET","VNRVJIET","MMMUT","HBTU","PDEU","CHARUSAT",
]);
const LOWERCASE = new Set(["of", "and", "for", "the", "in", "at", "to"]);

function smartTitle(name: string): string {
  if (name !== name.toUpperCase()) return name; // mixed case: trust the source
  return name
    .split(" ")
    .map((tok, i) => {
      const core = tok.replace(/[^A-Za-z0-9]/g, "");
      if (!core) return tok;
      if (ACRONYMS.has(core.toUpperCase())) return tok;
      // Short, vowel-less tokens are acronyms: VJTI, SSN, RVCE.
      if (core.length <= 5 && !/[AEIOU]/.test(core.toUpperCase())) return tok;
      const low = tok.toLowerCase();
      if (i > 0 && LOWERCASE.has(low)) return low;
      return low.replace(/[a-z]+/g, (m) => m[0].toUpperCase() + m.slice(1));
    })
    .join(" ")
    .replace(/'S\b/g, "'s");
}

/** Order matters — see plan 066 §5 step 2.2. */
function cleanName(raw: string): string | null {
  let n = raw.normalize("NFKC").trim();
  if (n.startsWith("#")) return null; // "#Name?" spreadsheet artifact
  n = n.replace(/^["']+|["']+$/g, "").trim();
  n = n.replace(/\s+/g, " ");
  n = n.replace(/^\d{4,}\s*[-–]\s*/, "");            // leading institute code
  n = n.replace(/\s*[-–]?\s*\b\d{6}\b\s*$/, "");     // trailing pin code
  n = n.replace(/\s*,\s*$/, "");
  n = n.split(/\b(?:Address:|District:|Taluka:)/i)[0].trim();
  n = n.replace(/\s*,\s*$/, "");
  if (n.length > 200) {
    const cut = n.slice(0, 200);
    const lastSpace = cut.lastIndexOf(" ");
    n = (lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trim();
  }
  if (n.length < 4) return null;
  return smartTitle(n);
}

/**
 * AISHE gives "Imphal West", AICTE gives "WEST GODAVARI". Both land on the
 * dropdown's secondary line, so normalize the casing and drop AICTE's
 * "DISTRICT" suffix.
 */
function titleCasePlace(raw: string | null): string | null {
  const s = (raw ?? "").trim().replace(/\s+DISTRICT$/i, "").trim();
  if (!s) return null;
  return s
    .split(/(\s+|-)/)
    .map((part) =>
      /^\s+$|^-$/.test(part)
        ? part
        : part.length <= 3 && part === part.toUpperCase() && !/[AEIOU]/i.test(part)
          ? part.toUpperCase()
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

const alnum = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const mergeKey = (name: string, district: string | null) =>
  `${alnum(name)}|${alnum(district)}`;

// ------------------------------------------------------------------ csv

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

// ---------------------------------------------------------------- merging

type Draft = {
  name: string;
  state: string | null;
  district: string | null;
  city: string | null;
  aliases: string[];
  tier: number;
};

function upsert(map: Map<string, Draft>, draft: Draft): void {
  const key = mergeKey(draft.name, draft.district);
  const existing = map.get(key);
  if (!existing) { map.set(key, draft); return; }
  existing.state ??= draft.state;
  existing.district ??= draft.district;
  existing.city ??= draft.city;
}

/**
 * EXACT MATCH ONLY — no fuzzy, no similarity threshold, no "closest match".
 * Token-overlap scoring rates "IIT Kharagpur" against "IIT Ropar" at 0.60 and
 * "IIT Hyderabad" against "Institute of Management Technology, Hyderabad" at
 * 0.60; every workable threshold silently merges distinct institutions. Where
 * the source spells a name differently, that spelling is listed verbatim in the
 * overlay's `govAliases`.
 */
function applyOverlay(map: Map<string, Draft>, known: KnownCollege[]) {
  const byName = new Map<string, Draft[]>();
  for (const d of map.values()) {
    const k = alnum(d.name);
    const list = byName.get(k);
    if (list) list.push(d);
    else byName.set(k, [d]);
  }

  let exact = 0, govAlias = 0, inserted = 0;

  for (const k of known) {
    const targets: Draft[] = [];

    const direct = byName.get(alnum(k.name));
    if (direct) { targets.push(...direct); exact++; }

    let absorbedByAlias = false;
    for (const govName of k.govAliases ?? []) {
      const hit = byName.get(alnum(govName));
      if (!hit) throw new Error(`govAlias not found in source data: "${govName}"`);
      targets.push(...hit);
      absorbedByAlias = true;
    }
    if (absorbedByAlias) govAlias++;

    if (targets.length === 0) {
      upsert(map, {
        name: k.name,
        state: k.state,
        district: k.city,
        city: k.city,
        aliases: k.aliases,
        tier: k.tier,
      });
      inserted++;
      continue;
    }

    for (const t of targets) {
      const govName = t.name;
      t.name = k.name; // curated name always wins
      t.aliases = [...new Set([...t.aliases, ...k.aliases, govName])].filter(
        (a) => alnum(a) !== alnum(k.name),
      );
      t.city ??= k.city;
      t.state ??= k.state;
      t.tier = Math.min(t.tier, k.tier);
    }
  }

  return { exact, govAlias, inserted };
}

// ------------------------------------------------------------------ main

async function main() {
  console.log("· downloading sources (cached in .cache/)");
  const [aisheCsv, aicteJson] = await Promise.all([
    fetchCached(SOURCES.aishe),
    fetchCached(SOURCES.aicte),
  ]);

  const aishe = parseCsv(aisheCsv);
  const aicte = (JSON.parse(aicteJson) as Record<string, string>[]).filter(
    (r) => typeof r.institute_name === "string",
  );
  console.log(`  AISHE rows: ${aishe.length}   AICTE rows: ${aicte.length}`);

  const map = new Map<string, Draft>();
  let skipped = 0;

  for (const r of aishe) {
    const name = cleanName(r.name ?? "");
    if (!name) { skipped++; continue; }
    upsert(map, {
      name,
      state: r.state?.trim() || null,
      district: titleCasePlace(r.district ?? null),
      city: titleCasePlace(r.city ?? null),
      aliases: [],
      tier: 3,
    });
  }

  // AICTE has no state column — derive it from the most common state per district.
  const districtState = new Map<string, Map<string, number>>();
  for (const r of aishe) {
    const d = (r.district ?? "").trim().toUpperCase();
    if (!d || !r.state) continue;
    const counts = districtState.get(d) ?? new Map<string, number>();
    counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
    districtState.set(d, counts);
  }
  const stateForDistrict = (d: string): string | null => {
    const counts = districtState.get(d.trim().toUpperCase());
    if (!counts) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  for (const r of aicte) {
    const name = cleanName(r.institute_name ?? "");
    if (!name) { skipped++; continue; }
    const district = titleCasePlace(r.district ?? null);
    upsert(map, {
      name,
      state: district ? stateForDistrict(district) : null,
      district,
      city: null,
      aliases: [],
      tier: 3,
    });
  }
  console.log(`  merged: ${map.size} unique (skipped ${skipped} unusable names)`);

  const known = JSON.parse(readFileSync(OVERLAY_PATH, "utf8")) as KnownCollege[];
  const stats = applyOverlay(map, known);
  console.log(
    `  overlay: ${known.length} curated → ${stats.exact} exact, ` +
      `${stats.govAlias} via govAliases, ${stats.inserted} inserted`,
  );

  if (
    known.length !== EXPECTED.curated ||
    stats.exact !== EXPECTED.exact ||
    stats.govAlias !== EXPECTED.govAlias ||
    stats.inserted !== EXPECTED.inserted
  ) {
    throw new Error(
      `overlay resolution drifted from ${JSON.stringify(EXPECTED)} — ` +
        `a source dataset or the overlay changed. Re-verify before shipping.`,
    );
  }

  // AISHE and AICTE spell districts differently for the same institution
  // ("North West" vs "NORTH WEST DELHI", "Bangalore Rural" vs "BANGALORE
  // URBAN"), so a curated institution can survive the merge as two rows. Collapse
  // those by name+state. Only for curated rows: 40 distinct gov rows are named
  // exactly "Government Polytechnic" and their district is what tells them apart.
  const collapsed = new Map<string, Draft>();
  const out: Draft[] = [];
  for (const d of map.values()) {
    if (d.tier >= 3) { out.push(d); continue; }
    const key = `${alnum(d.name)}|${alnum(d.state)}`;
    const prev = collapsed.get(key);
    if (!prev) { collapsed.set(key, d); out.push(d); continue; }
    prev.aliases = [...new Set([...prev.aliases, ...d.aliases])];
    prev.city ??= d.city;
    prev.district ??= d.district;
  }
  const droppedDupes = map.size - out.length;

  const rows: CollegeRow[] = out
    .map((d) => ({
      name: d.name,
      state: d.state,
      district: d.district,
      city: d.city,
      aliases: d.aliases,
      tier: d.tier,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const curated = rows.filter((r) => r.tier < 3).length;
  if (curated !== EXPECTED.curated) {
    throw new Error(`expected ${EXPECTED.curated} curated rows, got ${curated}`);
  }

  // nameKey must be unique — the seed relies on it for idempotency.
  const keys = new Set(rows.map((r) => mergeKey(r.name, r.district)));
  if (keys.size !== rows.length) {
    throw new Error(`nameKey collision: ${rows.length - keys.size} duplicate keys`);
  }

  // Omit nulls and defaults — repeating `"city":null,"aliases":[],"tier":3` on
  // 54k rows costs ~2 MB of pure key overhead. The seed re-applies the defaults.
  const json = JSON.stringify(rows, (key, value) => {
    if (value === null) return undefined;
    if (key === "aliases" && Array.isArray(value) && value.length === 0) return undefined;
    if (key === "tier" && value === 3) return undefined;
    return value;
  });
  writeFileSync(OUT_PATH, json);
  console.log(
    `✓ wrote ${OUT_PATH}: ${rows.length} rows ` +
      `(${curated} curated, ${droppedDupes} cross-source duplicates collapsed, ` +
      `${(json.length / 1e6).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
