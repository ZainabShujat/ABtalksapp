/**
 * Plan 165 — the admin résumé download route.
 *   npm run test:admin-resume-download
 *
 * Source-reading, like `audit.test.ts`: these are invariants about how the
 * route is written, not about what a request returns. The one that matters most
 * is the last suite — the admin surfaces must never link `resume.downloadPath`,
 * because that constant points at the owner-only route and would quietly serve
 * an admin their OWN résumé instead of the candidate's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Comments stripped, so an assertion reads the code rather than the prose
 * explaining it — this file's header names `requireAdmin` precisely to say why
 * the route does not use it.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

console.log("\nPlan 165 admin résumé download");

const ROUTE = "src/app/api/admin/candidates/[userId]/resume/route.ts";
const route = code(ROUTE);

suite("gated by the admin context, never by a redirect", () => {
  assert(route.includes("getAdminContext()"), "does not call getAdminContext");
  assert(
    !route.includes("requireAdmin"),
    "uses requireAdmin, which redirects instead of returning a status",
  );
  assert(route.includes("{ status: 403 }"), "no 403 for a non-admin");
});

suite("the only caller-supplied input is a user id", () => {
  assert(route.includes("paramsSchema"), "the route param is not validated");
  assert(route.includes("safeParse"), "no Zod parse at the boundary");
  assert(
    !route.includes("searchParams"),
    "reads a query parameter — the userId is the only input",
  );
  assert(
    !/pathname:\s*(raw|parsed|params|input)/.test(route),
    "a caller-supplied blob pathname reaches storage",
  );
  assert(
    route.includes("getOwnResumeFilePath(userId)"),
    "the pathname is not resolved server-side from the candidate's row",
  );
});

suite("a deleted candidate's résumé is not served", () => {
  assert(route.includes("deletedAt"), "deletedAt is not checked");
  assert(route.includes("{ status: 404 }"), "no 404 path");
});

suite("every served download is audited", () => {
  assert(route.includes("writeAudit("), "does not call writeAudit");
  assert(
    route.includes('actionType: "DOWNLOAD_CANDIDATE_RESUME"'),
    "the audit row has no stable action type",
  );
  assert(route.includes("targetUserId: userId"), "the audit row names no target");
  assert(route.includes("reason:"), "the audit row has no reason");
});

suite("the response is a private attachment, never cacheable", () => {
  assert(
    route.includes('"content-disposition": `attachment; filename='),
    "not served as an attachment",
  );
  assert(
    route.includes('"cache-control": "private, no-store"'),
    "the response is not marked private, no-store",
  );
  assert(
    route.includes('"x-content-type-options": "nosniff"'),
    "no nosniff header",
  );
  assert(
    !/cache-control"?\s*:\s*"[^"]*public/.test(route),
    "a public cache-control value exists",
  );
});

suite("the admin surfaces never link the owner-only download path", () => {
  for (const rel of [
    "src/components/admin/candidate-career-sections.tsx",
    "src/app/admin/search/page.tsx",
  ]) {
    assert(
      !code(rel).includes("downloadPath"),
      `${rel} links resume.downloadPath — that serves the admin their own file`,
    );
  }
});

suite("global search does not put a blob pathname on the payload", () => {
  const search = code("src/features/admin/search-admin-console.ts");
  assert(search.includes("hasResumeFile"), "no résumé presence flag");
  assert(
    search.includes("candidates.map(({ resume, ...c })"),
    "the raw resume row is not stripped before it is returned",
  );
});

if (failed > 0) {
  console.log(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
