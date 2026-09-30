/**
 * Field verification (issue #695 and follow-up).
 *
 * The model reads the rendered page and can misread it — it once returned
 * "contactsuysahgupta" for "contactsuyashgupta". Everything it COPIED from the
 * résumé is therefore checked against the document's own text layer and link
 * annotations:
 *
 *   - found as written            → kept
 *   - a near-miss of document text → replaced by the document's spelling
 *   - not found at all            → kept, and listed in `unverified` so a human
 *                                    checks it (import → NEEDS_REVIEW)
 *
 * Fields the model WRITES rather than copies (headline, summary, career level,
 * primary domain, years of experience, project description) are judgement, not
 * text, and are not checked here.
 *
 * Pure: the caller extracts `DocumentEvidence` (see `extractEvidence` in
 * parse.ts) so this file is testable without a PDF.
 */
import { normalizeEmail } from "@/features/resume/import/email";
import type { ParsedResume } from "@/features/resume/types";

export type DocumentEvidence = {
  /** The PDF's text layer, pages joined. Empty for a scan. */
  text: string;
  /** Link-annotation targets (`https://…`, `mailto:…`). */
  links: string[];
};

export type FieldCorrection = { field: string; from: string; to: string };

export type VerificationReport = {
  corrections: FieldCorrection[];
  unverified: string[];
  /** False when the document had no usable text layer (scan / photo). */
  hadText: boolean;
};

/** Below this, the text layer is treated as missing (a scanned résumé). */
const MIN_TEXT_CHARS = 80;

/* ─── Text primitives ────────────────────────────────────────────────────── */

/** Letters and digits only, lowercased: spacing, case and punctuation ignored. */
function compact(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Edit distance where swapping two adjacent letters counts as ONE edit (optimal
 * string alignment) — the model's typical misreading ("suysah" for "suyash").
 * Capped: returns `cap + 1` as soon as it is exceeded.
 */
export function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevMin = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    // A swap reaches back two rows, so both must be past the cap to stop early.
    if (rowMin > cap && prevMin >= cap) return cap + 1;
    prevMin = rowMin;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Edits allowed before a value counts as "not in the document". */
function allowedEdits(len: number): number {
  if (len < 4) return 0;
  if (len < 40) return Math.min(3, Math.max(1, Math.floor(len * 0.15)));
  return Math.ceil(len * 0.1);
}

type Doc = {
  compact: string;
  /** Document words in reading order, with their compact form. */
  words: { raw: string; c: string }[];
  urls: string[];
  emails: string[];
  phones: string[];
};

function buildDoc(ev: DocumentEvidence): Doc {
  // Re-join words hyphenated across a line break ("Assess-\nments").
  const text = ev.text.normalize("NFKC").replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2");
  const words = text
    .split(/\s+/)
    .map((raw) => raw.replace(/^[^\p{L}\p{N}(+#.@]+|[,;:.]+$/gu, ""))
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, c: compact(raw) }))
    .filter((w) => w.c.length > 0);

  const textUrls = text.match(/\b(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;)]*)?/gi) ?? [];
  const urls = [...ev.links.filter((l) => !/^mailto:/i.test(l)), ...textUrls.filter((u) => u.includes("/") || /^www\./i.test(u))];

  const emails = new Set<string>();
  for (const l of ev.links) {
    if (!/^mailto:/i.test(l)) continue;
    const e = normalizeEmail(safeDecode(l.slice(7).split("?")[0] ?? ""));
    if (e) emails.add(e);
  }
  for (const m of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
    const e = normalizeEmail(m);
    if (e) emails.add(e);
  }

  const phones = (text.match(/\+?\d[\d\s\-().]{7,}\d/g) ?? [])
    .map((p) => p.trim())
    .filter((p) => p.replace(/\D/g, "").length >= 8);

  return { compact: words.map((w) => w.c).join(""), words, urls, emails: [...emails], phones };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

type Match = { kind: "exact" } | { kind: "snap"; to: string } | { kind: "missing" };

/**
 * Find `value` in the document text. Exact on the compact form, otherwise the
 * closest run of document words within `allowedEdits`, returned in the
 * document's own spelling.
 */
function matchText(value: string, doc: Doc): Match {
  const v = compact(value);
  if (v.length === 0) return { kind: "exact" };
  if (doc.compact.includes(v)) return { kind: "exact" };

  const cap = allowedEdits(v.length);
  if (cap === 0) return { kind: "missing" };

  const valueWords = value.split(/\s+/).map(compact).filter(Boolean);
  const k = Math.max(1, valueWords.length);
  // Long values: only start windows where one of the first two words matches,
  // which keeps a bullet-point search linear in the document length.
  const anchors = k > 4 ? new Set(valueWords.slice(0, 2)) : null;

  let best: { d: number; to: string } | null = null;
  for (let i = 0; i < doc.words.length; i++) {
    if (anchors && !anchors.has(doc.words[i]!.c) && !(i > 0 && anchors.has(doc.words[i - 1]!.c))) continue;
    for (let n = Math.max(1, k - 2); n <= k + 2 && i + n <= doc.words.length; n++) {
      const span = doc.words.slice(i, i + n);
      const d = editDistance(v, span.map((w) => w.c).join(""), cap);
      if (d <= cap && (!best || d < best.d)) best = { d, to: span.map((w) => w.raw).join(" ") };
    }
  }
  return best ? { kind: "snap", to: best.to } : { kind: "missing" };
}

function urlKey(u: string): string {
  return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/#?]+$/, "");
}

function matchUrl(value: string, doc: Doc): Match {
  const key = urlKey(value);
  if (key.length === 0) return { kind: "exact" };
  let best: { d: number; to: string } | null = null;
  for (const u of doc.urls) {
    const d = editDistance(key, urlKey(u), 3);
    if (d === 0) return { kind: "exact" };
    if (d <= 3 && (!best || d < best.d)) best = { d, to: /^https?:\/\//i.test(u) ? u : `https://${u}` };
  }
  return best ? { kind: "snap", to: best.to } : { kind: "missing" };
}

function matchPhone(value: string, doc: Doc): Match {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return { kind: "exact" };
  const tail = digits.slice(-10);
  let best: { d: number; to: string } | null = null;
  for (const p of doc.phones) {
    const pd = p.replace(/\D/g, "");
    if (pd.endsWith(tail) || tail.endsWith(pd.slice(-10))) {
      return pd.slice(-10) === tail ? { kind: "exact" } : { kind: "snap", to: p };
    }
    const d = editDistance(tail, pd.slice(-10), 1);
    if (d <= 1 && (!best || d < best.d)) best = { d, to: p };
  }
  return best ? { kind: "snap", to: best.to } : { kind: "missing" };
}

function matchEmail(value: string, doc: Doc): Match {
  const n = normalizeEmail(value);
  if (!n) return { kind: "missing" };
  if (doc.emails.includes(n)) return { kind: "exact" };
  const near = doc.emails.find((e) => editDistance(n, e, 3) <= 3);
  return near ? { kind: "snap", to: near } : { kind: "missing" };
}

/* ─── The walk over ParsedResume ─────────────────────────────────────────── */

type Matcher = (value: string, doc: Doc) => Match;

/**
 * Verify every copied field of `data` against the document. Returns the
 * corrected résumé; never adds or removes a field.
 */
export function verifyParsedResume(
  data: ParsedResume,
  evidence: DocumentEvidence,
): { data: ParsedResume; report: VerificationReport } {
  const report: VerificationReport = { corrections: [], unverified: [], hadText: true };
  const doc = buildDoc(evidence);

  if (evidence.text.replace(/\s+/g, "").length < MIN_TEXT_CHARS) {
    report.hadText = false;
    report.unverified.push("whole résumé (no text layer — scanned or image PDF)");
    return { data, report };
  }

  const check = (field: string, value: string | null, m: Matcher): string | null => {
    if (value === null || value.trim() === "") return value;
    const r = m(value, doc);
    if (r.kind === "snap" && r.to !== value) {
      report.corrections.push({ field, from: value, to: r.to });
      return r.to;
    }
    if (r.kind === "missing") report.unverified.push(field);
    return value;
  };
  const checkList = (field: string, values: string[], m: Matcher = matchText): string[] =>
    values.map((v, i) => check(`${field}[${i}]`, v, m) ?? v);
  /** Multi-line text (internship summary): one check per line. */
  const checkLines = (field: string, value: string | null): string | null =>
    value === null
      ? null
      : value
          .split("\n")
          .map((line, i) => {
            const bare = line.replace(/^\s*[-•◦*]\s*/, "");
            const fixed = check(`${field} line ${i + 1}`, bare, matchText) ?? bare;
            return line.slice(0, line.length - line.trimStart().length) + line.trimStart().replace(bare, fixed);
          })
          .join("\n");

  const out: ParsedResume = {
    ...data,
    candidateName: check("name", data.candidateName, matchText),
    email: check("email", data.email, matchEmail),
    phone: check("phone", data.phone, matchPhone),
    location: check("location", data.location, matchText),
    linkedin: check("linkedin", data.linkedin, matchUrl),
    github: check("github", data.github, matchUrl),
    portfolio: check("portfolio", data.portfolio, matchUrl),
    website: check("website", data.website, matchUrl),
    skills: checkList("skills", data.skills),
    technicalSkills: checkList("technicalSkills", data.technicalSkills),
    softSkills: checkList("softSkills", data.softSkills),
    programmingLanguages: checkList("programmingLanguages", data.programmingLanguages),
    frameworks: checkList("frameworks", data.frameworks),
    databases: checkList("databases", data.databases),
    cloudPlatforms: checkList("cloudPlatforms", data.cloudPlatforms),
    tools: checkList("tools", data.tools),
    certifications: checkList("certifications", data.certifications),
    achievements: checkList("achievements", data.achievements),
    languages: checkList("languages", data.languages),
    projects: data.projects.map((p, i) => ({
      ...p,
      title: check(`projects[${i}].title`, p.title, matchText),
      technologies: checkList(`projects[${i}].technologies`, p.technologies),
      github: check(`projects[${i}].github`, p.github, matchUrl),
      demo: check(`projects[${i}].demo`, p.demo, matchUrl),
      contributions: checkList(`projects[${i}].contributions`, p.contributions),
    })),
    experience: data.experience.map((e, i) => ({
      ...e,
      title: check(`experience[${i}].title`, e.title, matchText),
      company: check(`experience[${i}].company`, e.company, matchText),
      duration: check(`experience[${i}].duration`, e.duration, matchText),
      responsibilities: checkList(`experience[${i}].responsibilities`, e.responsibilities),
      achievements: checkList(`experience[${i}].achievements`, e.achievements),
      technologies: checkList(`experience[${i}].technologies`, e.technologies),
    })),
    education: data.education.map((e, i) => ({
      ...e,
      degree: check(`education[${i}].degree`, e.degree, matchText),
      branch: check(`education[${i}].branch`, e.branch, matchText),
      institution: check(`education[${i}].institution`, e.institution, matchText),
      year: check(`education[${i}].year`, e.year, matchText),
      cgpa: check(`education[${i}].cgpa`, e.cgpa, matchText),
    })),
    internships: data.internships.map((it, i) => ({
      ...it,
      company: check(`internships[${i}].company`, it.company, matchText),
      role: check(`internships[${i}].role`, it.role, matchText),
      duration: check(`internships[${i}].duration`, it.duration, matchText),
      summary: checkLines(`internships[${i}].summary`, it.summary),
    })),
  };
  return { data: out, report };
}

/**
 * Every email the document itself contains (mailto links + text), for the
 * import's identity decision. The model's `all_emails` is corrected against
 * these: a near-miss is replaced, a genuinely different address is kept so two
 * real addresses still reach a human as a conflict.
 */
export function reconcileEmails(
  modelAll: readonly string[],
  evidence: DocumentEvidence,
): string[] {
  const doc = buildDoc(evidence);
  const fixed = modelAll.map((e) => {
    const r = matchEmail(e, doc);
    return r.kind === "snap" ? r.to : e;
  });
  return [...new Set([...doc.emails, ...fixed])];
}
