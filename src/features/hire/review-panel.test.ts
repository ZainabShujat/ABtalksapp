/**
 * Candidate review panel — T-239 / TC-R-007. Run with:
 *   npm run test:review-panel
 *
 * No network, no database, no DOM. Two halves: the resize maths and the
 * next/previous contract are exercised directly, and the wiring that only
 * exists in JSX and CSS is held in place by source assertions — the same
 * approach as `project-state.test.ts`, because this repo has no DOM runner.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PANEL_MAX,
  PANEL_MIN,
  PANEL_STEP,
  PANEL_WIDTH_KEY,
  clampPanelWidth,
  maxPanelWidth,
  neighbourIndex,
  stepPanelWidth,
} from "./review-panel";

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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/app/hire/hire-scout.css");
const scoutChat = read("src/components/hire/scout-chat.tsx");
const inspector = read("src/components/hire/candidate-inspector.tsx");
const resizer = read("src/components/hire/panel-resizer.tsx");
const report = read("src/components/hire/candidate-evidence-report.tsx");
const evidencePage = read("src/app/hire/evidence/page.tsx");

// A roomy desk, where PANEL_MAX is reachable: 720 / 0.6 = 1200.
const WIDE = 1600;

console.log("\nresize bounds");

suite("clamps to the fixed floor and ceiling", () => {
  assert(clampPanelWidth(10, WIDE) === PANEL_MIN, "below min must clamp to min");
  assert(clampPanelWidth(9999, WIDE) === PANEL_MAX, "above max must clamp to max");
  assert(clampPanelWidth(500, WIDE) === 500, "a width inside the range is kept");
});

suite("rounds fractional pointer positions", () => {
  assert(clampPanelWidth(500.4, WIDE) === 500, "500.4 must round to 500");
  assert(clampPanelWidth(500.6, WIDE) === 501, "500.6 must round to 501");
});

suite("never takes more than 60% of the window", () => {
  // 1280px laptop: 60% is 768, so PANEL_MAX (720) still applies.
  assert(maxPanelWidth(1280) === 720, "1280px window caps at PANEL_MAX");
  // 1100px: 60% is 660, tighter than PANEL_MAX.
  assert(maxPanelWidth(1100) === 660, "1100px window caps at 660");
  assert(clampPanelWidth(720, 1100) === 660, "drag past the share cap is pinned");
});

suite("the viewport share never squeezes below the floor", () => {
  // 400px window: 60% is 240, under PANEL_MIN. The floor has to win, or the
  // panel would clamp to a negative-feeling sliver.
  assert(maxPanelWidth(400) === PANEL_MIN, "the floor outranks the share cap");
  assert(clampPanelWidth(500, 400) === PANEL_MIN, "and clamping follows it");
});

suite("survives NaN, Infinity and a zero viewport", () => {
  assert(clampPanelWidth(Number.NaN, WIDE) === PANEL_MIN, "NaN falls back to min");
  assert(
    clampPanelWidth(Number.POSITIVE_INFINITY, WIDE) === PANEL_MAX,
    "Infinity clamps to max",
  );
  assert(maxPanelWidth(0) === PANEL_MAX, "an unmeasured window uses PANEL_MAX");
  assert(maxPanelWidth(Number.NaN) === PANEL_MAX, "NaN viewport uses PANEL_MAX");
});

console.log("\nkeyboard resize");

suite("the grip is on the left, so left widens and right narrows", () => {
  assert(
    stepPanelWidth(500, "ArrowLeft", WIDE) === 500 + PANEL_STEP,
    "ArrowLeft must widen the panel",
  );
  assert(
    stepPanelWidth(500, "ArrowRight", WIDE) === 500 - PANEL_STEP,
    "ArrowRight must narrow the panel",
  );
});

suite("Home and End go to the bounds for this window", () => {
  assert(stepPanelWidth(500, "Home", WIDE) === PANEL_MIN, "Home is the floor");
  assert(stepPanelWidth(500, "End", WIDE) === PANEL_MAX, "End is the ceiling");
  assert(
    stepPanelWidth(500, "End", 1100) === 660,
    "End respects the viewport share, not the constant",
  );
});

suite("stepping off either end stays in range", () => {
  assert(
    stepPanelWidth(PANEL_MIN, "ArrowRight", WIDE) === PANEL_MIN,
    "cannot step below the floor",
  );
  assert(
    stepPanelWidth(PANEL_MAX, "ArrowLeft", WIDE) === PANEL_MAX,
    "cannot step above the ceiling",
  );
});

suite("an out-of-range starting width is normalised first", () => {
  assert(
    stepPanelWidth(9999, "ArrowRight", WIDE) === PANEL_MAX - PANEL_STEP,
    "a stored oversize width steps down from the ceiling, not from itself",
  );
});

console.log("\nnext / previous");

suite("walks the result set in order", () => {
  assert(neighbourIndex(5, 2, 1) === 3, "next from 2 of 5 is 3");
  assert(neighbourIndex(5, 2, -1) === 1, "previous from 2 of 5 is 1");
});

suite("stops at both ends", () => {
  assert(neighbourIndex(5, 0, -1) === null, "previous at the first is null");
  assert(neighbourIndex(5, 4, 1) === null, "next at the last is null");
  assert(neighbourIndex(1, 0, 1) === null, "a single result has no next");
  assert(neighbourIndex(1, 0, -1) === null, "a single result has no previous");
});

suite("an unknown or filtered-out candidate has no neighbours", () => {
  // openIndex is -1 when the open card was filtered out — e.g. "Hide rejected"
  // while its candidate is open. Both arrows must go dead rather than jump.
  assert(neighbourIndex(5, -1, 1) === null, "index -1 has no next");
  assert(neighbourIndex(5, -1, -1) === null, "index -1 has no previous");
  assert(neighbourIndex(0, 0, 1) === null, "an empty list has no neighbours");
  assert(neighbourIndex(5, 5, -1) === null, "an out-of-range index is refused");
});

console.log("\npanel width is wired to the right CSS rules");

suite("the screen-2 reserved column reads --hire-panel-w", () => {
  // Upstream keeps the panel column present on the results screen even with
  // nothing open. If only the open state honoured the width, the layout would
  // jump on every open and close.
  assert(
    /\.hire-app--results \.scout__body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--hire-panel-w/.test(css),
    "the always-present results column must follow the recruiter's width too",
  );
});

suite("both open-state grid rules read --hire-panel-w", () => {
  assert(
    /\.scout__body\.is-open\s*\{[^}]*grid-template-columns:\s*1fr var\(--hire-panel-w/.test(css),
    "the base .scout__body.is-open rule must use the variable",
  );
  assert(
    /\.hire-app--results \.scout__body\.is-open\s*\{[^}]*var\(--hire-panel-w/.test(css),
    "the desk .hire-app--results rule must use the variable",
  );
});

suite("the true closed state and the mobile overlay do NOT", () => {
  // Distinct from the screen-2 reserved column above. A stored width in either
  // of these would hold a gap open where the panel is meant to be absent
  // (pre-results) or fullscreen (<=1100px).
  assert(
    /\.scout__body\s*\{[^}]*grid-template-columns:\s*1fr 0fr/.test(css),
    "the closed state must stay a literal 1fr 0fr",
  );
  assert(
    /\.scout__body\.is-open\s*\{\s*grid-template-columns:\s*0fr 1fr;\s*\}/.test(css),
    "the <=1100px overlay rule must stay a literal 0fr 1fr",
  );
});

suite("the grip exists and is hidden below the desk breakpoint", () => {
  assert(css.includes(".hire-detail__grip"), "the grip needs styles");
  assert(
    /\.hire-detail\s*\{[^}]*position:\s*relative/.test(css),
    ".hire-detail must be positioned so the grip can anchor to it",
  );
  const mobile = css.slice(css.indexOf("@media (max-width: 1100px)"));
  assert(
    /\.hire-detail__grip\s*\{\s*display:\s*none/.test(mobile),
    "the grip must be hidden where the panel is a fullscreen overlay",
  );
});

suite("the drag disables the grid transition", () => {
  assert(
    /\.scout__body\.is-resizing\s*\{[^}]*transition:\s*none/.test(css),
    "a 280ms transition on grid-template-columns makes the drag lag",
  );
});

suite("the Filters menu clears the result cards", () => {
  // `hire-results-in` animates a transform on both .scout__toolbar and
  // .chat-output, making each a stacking context — which trapped the menu's
  // z-index inside the toolbar and let the later sibling paint over it.
  assert(
    /\.scout__toolbar\s*\{[^}]*position:\s*relative[^}]*z-index:\s*40/.test(css),
    "the toolbar must be lifted, or the Filters menu hides behind the cards",
  );
  // Must stay under the fullscreen panel (95) and the shortlist bar (90).
  const z = /\.scout__toolbar\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
  assert(z != null && Number(z[1]) < 90, "the toolbar must stay below the panel and podbar");
});

suite("the results column reserves its scrollbar gutter", () => {
  assert(
    /\.chat-output\s*\{[^}]*scrollbar-gutter:\s*stable/.test(css),
    "without a stable gutter the restored scrollTop lands on a different card",
  );
});

console.log("\nscroll position is captured and restored");

suite("the mark is taken only on the first open", () => {
  const code = stripComments(scoutChat);
  assert(code.includes("savedScroll"), "scout-chat must hold a saved scroll ref");
  assert(
    /if\s*\(!openMatch\)\s*savedScroll\.current\s*=/.test(code),
    "next/previous must not overwrite the mark taken before the panel opened",
  );
});

suite("closing restores it, guarded on the right transition", () => {
  const code = stripComments(scoutChat);
  assert(code.includes("closeMatchPanel"), "there must be a close helper");
  assert(
    code.includes('onClose={closeMatchPanel}'),
    "the panel's onClose must go through the restoring helper",
  );
  assert(
    code.includes('propertyName !== "grid-template-columns"'),
    "the transitionend listener must ignore other properties or it fires mid-reflow",
  );
});

suite("the auto-scroll effect is not re-triggered by the panel", () => {
  // Adding openMatch here would yank the thread to the bottom on every open,
  // which is precisely the behaviour this ticket removes.
  const deps = scoutChat.slice(scoutChat.indexOf("behavior: pending ?"));
  const firstDeps = deps.slice(0, deps.indexOf("]"));
  assert(
    !firstDeps.includes("openMatch"),
    "openMatch must not be a dependency of the scroll-to-bottom effect",
  );
});

console.log("\npanel wiring");

suite("next/previous are still rendered and disabled at the ends", () => {
  assert(
    inspector.includes("disabled={!onPrev}") && inspector.includes("disabled={!onNext}"),
    "both arrows must disable when there is no neighbour",
  );
});

suite("the full report is a page, not a section of the panel", () => {
  // The resume used to be embedded in the panel, under its own tab, which made
  // the same evidence render twice a few inches apart. It is now one page, and
  // "•••" is the only way to it.
  assert(
    inspector.includes("evidenceResumeHref"),
    "the ••• escape hatch to /hire/evidence must remain",
  );
  assert(
    !inspector.includes('data-section="resume"') &&
      !inspector.includes("EvidenceResumeBody"),
    "the panel must not re-embed the report it links to",
  );
  assert(
    evidencePage.includes("CandidateEvidenceReport") &&
      evidencePage.includes("requireRecruiter"),
    "/hire/evidence renders the report behind the recruiter gate",
  );
});

suite("the report omits absences instead of printing them", () => {
  // The old sheet was a labelled grid, so a candidate with no graded projects
  // read as a page of "Not shared" and "None recorded". Every one of these
  // strings is a sentence about a missing row, printed under a person's name.
  const banned = [
    "No verified evidence",
    "None recorded",
    "Not shared",
    "No work experience",
    "No skills declared",
    "Not disclosed",
    "has not declared",
  ];
  const copy = stripComments(report);
  for (const phrase of banned) {
    assert(
      !copy.includes(phrase),
      `the report must not print "${phrase}"; omit the block instead`,
    );
  }
  assert(
    !copy.includes("—"),
    "no em dashes in recruiter-facing report copy",
  );
  assert(
    !/\bAB-[0-9?]/.test(copy),
    "the AB-#### reference is not shown on the report",
  );
});

suite("the report reuses the shared wording and the panel's loaders", () => {
  for (const helper of [
    "recruiterSummary",
    "recruiterRoleLabel",
    "verifiedEvidenceFacts",
  ]) {
    assert(
      report.includes(helper),
      `${helper} is the one wording path; the report must not invent another`,
    );
  }
  for (const loader of [
    "loadInspectorWorkHistoryAction",
    "loadInspectorExternalLinksAction",
    "loadInspectorTrackEvidenceAction",
    "loadInspectorSkillEvidenceAction",
  ]) {
    assert(
      report.includes(loader),
      `${loader} keeps the report and the panel on the same data`,
    );
  }
  assert(
    report.includes("UnlockContactDialog") &&
      report.includes("revealContactAction"),
    "contact stays behind the existing unlock path",
  );
});

suite("the grip is mounted outside the scrolling region", () => {
  const aside = inspector.slice(inspector.indexOf('<aside className="hire-detail'));
  const gripAt = aside.indexOf("<PanelResizer />");
  const scrollAt = aside.indexOf('className="hire-detail__scroll"');
  assert(gripAt > -1, "the panel must mount PanelResizer");
  assert(
    gripAt < scrollAt,
    "the grip must sit before the scroll container, or it scrolls away",
  );
});

suite("the resizer persists under a namespaced key and adds no dependency", () => {
  assert(
    PANEL_WIDTH_KEY.startsWith("abtalks-hire-"),
    "storage keys are namespaced with the rest of the desk",
  );
  assert(
    resizer.includes("readStoredPanelWidth") && resizer.includes("writeStoredPanelWidth"),
    "the grip must restore and persist the width",
  );
  assert(
    !resizer.includes("react-resizable-panels") && !resizer.includes("vaul"),
    "the grip is hand-rolled; no new dependency",
  );
});

suite("touched components log through no console and touch no prisma", () => {
  for (const [name, src] of [
    ["candidate-inspector", inspector],
    ["panel-resizer", resizer],
    ["candidate-evidence-report", report],
  ] as const) {
    const code = stripComments(src);
    assert(!code.includes("console."), `${name} must not log to console`);
    assert(!code.includes("prisma."), `${name} must not reach prisma`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
