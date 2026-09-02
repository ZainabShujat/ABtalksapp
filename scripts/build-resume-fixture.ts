/**
 * Generates the end-to-end résumé fixture PDF.
 *
 * The fixture is a real, text-based PDF — the same thing a candidate uploads —
 * built here rather than committed as an opaque binary so the content it tests
 * is reviewable in a diff and reproducible on any machine.
 *
 * Its whole point is LINK VARIETY. Every link on it is written the way a link
 * actually appears on a real résumé, and each one exercises a different branch
 * of `normalizeUrl` / `normalizeLinkedinUrl` / `normalizeGithubUrl` /
 * `extractUrlsFromText`:
 *
 *   - LinkedIn without a scheme            linkedin.com/in/asha-menon
 *   - GitHub as a bare handle line         github.com/ashamenon
 *   - Portfolio with a scheme              https://asha.dev
 *   - Project repo labelled "Repo:"        https://github.com/...
 *   - Project demo as a bare host          ledgerly.vercel.app
 *   - Project links inline, parenthesised  (github.com/... , atlas.pages.dev)
 *   - A project whose links are LABEL TEXT ONLY ("GitHub", "Live Demo") —
 *     these must NOT survive as URLs
 *   - An http:// link that must be upgraded to https://
 *
 * Run: npm run build:resume-fixture
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = join(
  process.cwd(),
  "src",
  "features",
  "resume",
  "fixtures",
  "sample-resume.pdf",
);

/** `[text, size, style]`. An empty string is a blank line. */
type Line = [string, number, "regular" | "bold"];

const LINES: Line[] = [
  ["ASHA MENON", 20, "bold"],
  ["Backend Engineer | Distributed Systems & Data Platforms", 11, "regular"],
  ["Bengaluru, Karnataka  |  asha.menon@example.com  |  +91 98450 12345", 9, "regular"],
  // Deliberately scheme-less, the way contact lines are usually typed.
  ["linkedin.com/in/asha-menon  |  github.com/ashamenon  |  https://asha.dev", 9, "regular"],
  ["", 9, "regular"],

  ["SUMMARY", 12, "bold"],
  [
    "Backend engineer with 3 years building Python and Go services for high-volume data",
    9,
    "regular",
  ],
  [
    "pipelines. Focused on reliability, query performance and developer tooling.",
    9,
    "regular",
  ],
  ["", 9, "regular"],

  ["EXPERIENCE", 12, "bold"],
  ["Backend Engineer, Nimbus Technologies Pvt. Ltd.            Mar 2023 - Present", 10, "bold"],
  [
    "- Built a FastAPI ingestion service in Python handling 40,000 events per day",
    9,
    "regular",
  ],
  [
    "- Reduced PostgreSQL p95 query latency by 45% by adding partial indexes",
    9,
    "regular",
  ],
  [
    "- Cut Docker image size by 60%, shortening deploys from 9 minutes to 3",
    9,
    "regular",
  ],
  ["", 9, "regular"],
  ["Junior Engineer, Bytecraft Labs                            Jun 2022 - Feb 2023", 10, "bold"],
  [
    "- Shipped a Redis caching layer that removed 30% of database reads",
    9,
    "regular",
  ],
  ["- Migrated 12 services to AWS and documented a rollback path for each", 9, "regular"],
  ["", 9, "regular"],

  ["PROJECTS", 12, "bold"],
  // Explicit Repo:/Live: labels, demo as a bare host.
  ["Ledgerly - double-entry ledger with a SQL query console", 10, "bold"],
  ["  Repo: https://github.com/ashamenon/ledgerly    Live: ledgerly.vercel.app", 9, "regular"],
  ["  - Designed the append-only schema and wrote 120 property tests over it", 9, "regular"],
  ["  Tech: Python, PostgreSQL, Docker", 9, "regular"],
  ["", 9, "regular"],
  // Bare GitHub host + an http:// demo that must be upgraded to https.
  ["Pulse - real-time deployment status dashboard", 10, "bold"],
  ["  github.com/ashamenon/pulse  |  http://pulse-demo.netlify.app", 9, "regular"],
  ["  - Streams build events over websockets to a React front end", 9, "regular"],
  ["  Tech: TypeScript, React, Node.js, Redis", 9, "regular"],
  ["", 9, "regular"],
  // Links only inline, inside parentheses, in the prose.
  [
    "Atlas - static site generator for API docs (github.com/ashamenon/atlas), deployed",
    10,
    "bold",
  ],
  ["  at atlas.pages.dev for the internal docs portal.", 9, "regular"],
  ["  - Generates OpenAPI reference pages from a single spec file", 9, "regular"],
  ["  Tech: Go, Markdown", 9, "regular"],
  ["", 9, "regular"],
  // Label text only. Nothing here may become a URL.
  ["Kettle - CLI for seeding local databases", 10, "bold"],
  ["  GitHub | Live Demo", 9, "regular"],
  ["  - Generates referentially consistent fixtures from a schema", 9, "regular"],
  ["  Tech: Go", 9, "regular"],
  ["", 9, "regular"],

  ["EDUCATION", 12, "bold"],
  ["B.Tech, Computer Science - PES University, Bengaluru        2018 - 2022", 10, "regular"],
  ["CGPA: 8.7/10", 9, "regular"],
  ["", 9, "regular"],

  ["SKILLS", 12, "bold"],
  ["Languages: Python, Go, TypeScript, SQL", 9, "regular"],
  ["Frameworks: FastAPI, React, Node.js", 9, "regular"],
  ["Databases: PostgreSQL, Redis, MongoDB", 9, "regular"],
  ["Cloud & Tools: AWS, Docker, Kubernetes, Git", 9, "regular"],
  ["", 9, "regular"],

  ["CERTIFICATIONS", 12, "bold"],
  ["AWS Certified Developer - Associate (2024)", 9, "regular"],
];

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Asha Menon - Resume");
  pdf.setAuthor("Asha Menon");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]); // A4
  const margin = 48;
  let y = 842 - margin;

  for (const [text, size, style] of LINES) {
    if (y < margin + size) {
      page = pdf.addPage([595, 842]);
      y = 842 - margin;
    }
    if (text.length > 0) {
      page.drawText(text, {
        x: margin,
        y,
        size,
        font: style === "bold" ? bold : regular,
        color: rgb(0.1, 0.1, 0.12),
      });
    }
    y -= size + 5;
  }

  const bytes = await pdf.save();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`Wrote ${OUT} (${bytes.length} bytes)`);
}

void main();
