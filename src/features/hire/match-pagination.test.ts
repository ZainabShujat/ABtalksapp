/**
 * Plan 158 — numbered pagination for the recruiter search results list.
 *
 * The windowing arithmetic and the one invariant a future edit is most likely
 * to break silently: a candidate's rank is their rank in the whole result set,
 * not their position on the page they happen to land on.
 *
 * Run: npm run test:hire-pagination
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MATCHES_PER_PAGE,
  clampPage,
  pageCount,
  pageItems,
  type PageItem,
} from "@/components/hire/match-pagination";

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

function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const show = (items: PageItem[]) => items.join(",");

console.log("\nPlan 158 — search results pagination");

// =========================================================================
// 1. pageCount
// =========================================================================

suite("an empty list is page 1 of 1, never page 1 of 0", () => {
  assert(pageCount(0) === 1, "0 results must still be one page");
});

suite("a list that exactly fills a page does not spill into a second", () => {
  assert(pageCount(MATCHES_PER_PAGE) === 1, `${MATCHES_PER_PAGE} results is one page`);
  assert(pageCount(MATCHES_PER_PAGE + 1) === 2, "one over the cap is two pages");
});

suite("pageCount rounds up", () => {
  assert(pageCount(25, 10) === 3, "25 over 10 is 3 pages");
  assert(pageCount(30, 10) === 3, "30 over 10 is 3 pages");
});

suite("pageCount survives nonsense input rather than returning 0 or NaN", () => {
  assert(pageCount(-5) === 1, "a negative length is one page");
  assert(pageCount(Number.NaN) === 1, "NaN is one page");
  assert(pageCount(10, 0) === 1, "a zero page size is one page");
});

// =========================================================================
// 2. clampPage — the list shrinks under the user
// =========================================================================

suite("a page past the end clamps to the last page", () => {
  assert(clampPage(9, 3) === 3, "page 9 of 3 must clamp to 3");
});

suite("a page below 1 clamps to 1", () => {
  assert(clampPage(0, 3) === 1, "page 0 must clamp to 1");
  assert(clampPage(-4, 3) === 1, "a negative page must clamp to 1");
});

suite("clampPage never returns 0 for an empty list", () => {
  assert(clampPage(1, 0) === 1, "an empty list is page 1");
});

// =========================================================================
// 3. pageItems — the 1 2 3 4 row
// =========================================================================

suite("a short list is spelled out with no ellipsis", () => {
  assert(show(pageItems(1, 4)) === "1,2,3,4", `got ${show(pageItems(1, 4))}`);
  assert(show(pageItems(3, 6)) === "1,2,3,4,5,6", `got ${show(pageItems(3, 6))}`);
});

suite("a long list elides to first, a window, and last", () => {
  assert(
    show(pageItems(6, 12)) === '1,gap,5,6,7,gap,12',
    `got ${show(pageItems(6, 12))}`,
  );
});

suite("the current page is always present", () => {
  for (let total = 1; total <= 30; total++) {
    for (let page = 1; page <= total; page++) {
      const items = pageItems(page, total);
      assert(items.includes(page), `page ${page} of ${total} missing from its own row`);
    }
  }
});

suite("the first and last pages are always reachable", () => {
  for (let total = 1; total <= 30; total++) {
    for (let page = 1; page <= total; page++) {
      const items = pageItems(page, total);
      assert(items.includes(1), `page 1 missing at ${page}/${total}`);
      assert(items.includes(total), `page ${total} missing at ${page}/${total}`);
    }
  }
});

suite("numbers ascend, never repeat, and no two gaps ever touch", () => {
  for (let total = 1; total <= 40; total++) {
    for (let page = 1; page <= total; page++) {
      const items = pageItems(page, total);
      let previous = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item === "gap") {
          assert(items[i - 1] !== "gap", `two gaps touch at ${page}/${total}`);
          assert(i > 0 && i < items.length - 1, `a gap is an edge at ${page}/${total}`);
          continue;
        }
        assert(item > previous, `out of order at ${page}/${total}: ${show(items)}`);
        previous = item;
      }
    }
  }
});

suite("a gap never replaces a single page — that would be no shorter", () => {
  for (let total = 1; total <= 40; total++) {
    for (let page = 1; page <= total; page++) {
      const items = pageItems(page, total);
      for (let i = 1; i < items.length - 1; i++) {
        if (items[i] !== "gap") continue;
        const before = items[i - 1] as number;
        const after = items[i + 1] as number;
        assert(
          after - before > 2,
          `gap hides only page ${before + 1} at ${page}/${total}: ${show(items)}`,
        );
      }
    }
  }
});

suite("a page argument outside the range still yields a valid row", () => {
  assert(show(pageItems(99, 4)) === "1,2,3,4", `got ${show(pageItems(99, 4))}`);
  assert(pageItems(0, 12).includes(1), "page 0 clamps into the row");
});

// =========================================================================
// 4. The invariants that live in the component
// =========================================================================

suite("rank is absolute across pages, not relative to the page", () => {
  const src = source("src/components/hire/match-results.tsx");
  assert(
    !src.includes("rank={i + 1}"),
    "rank={i + 1} renumbers every page from 1 — it must be offset by the page start",
  );
  assert(
    src.includes("rank={start + i + 1}"),
    "rank must be start + i + 1",
  );
});

suite("the evidence cache is fed the whole list, not the visible page", () => {
  const src = source("src/components/hire/match-results.tsx");
  assert(
    src.includes("rememberEvidence(matches)"),
    "rememberEvidence must take `matches`; feeding it `visible` breaks the " +
      "inspector for any candidate the recruiter paged past",
  );
});

suite("the page resets on the refs key, not on the matches array", () => {
  const src = source("src/components/hire/match-results.tsx");
  assert(
    src.includes("const refsKey") && src.includes("seenRefsKey !== refsKey"),
    "scout-chat rebuilds `matches` every render — resetting on the array loops",
  );
  assert(
    !src.includes("useEffect(() => {\n    setPage(1);"),
    "the reset is an adjustment during render, not a cascading effect",
  );
});

suite("the viewAllHref branch is untouched by paging", () => {
  const src = source("src/components/hire/match-results.tsx");
  assert(
    src.includes("const paged = !viewAllHref"),
    "paging must be disabled whenever viewAllHref is set",
  );
  assert(
    src.includes("matches.slice(0, INITIAL_VISIBLE)"),
    "the one-card + View N more branch must survive",
  );
});

suite("every pager control is type=button", () => {
  const src = source("src/components/hire/match-results.tsx");
  const pager = src.slice(src.indexOf('className="scout-pager"'));
  const buttons = pager.split("<button").length - 1;
  const typed = pager.split('type="button"').length - 1;
  assert(buttons > 0, "the pager must render buttons");
  assert(
    typed >= buttons,
    `${buttons} pager buttons but ${typed} type="button" — a default-submit ` +
      "button inside the desk chrome is a real bug",
  );
});

suite("the pager is announced to assistive tech", () => {
  const src = source("src/components/hire/match-results.tsx");
  assert(src.includes('aria-label="Search results pages"'), "the nav needs a label");
  assert(src.includes('aria-current={item === current ? "page" : undefined}'),
    "the current page must carry aria-current");
});

suite("the pager has styles on the sheet every /hire route loads", () => {
  const css = source("src/app/hire/hire-scout.css");
  for (const cls of [
    ".scout-pager",
    ".scout-pager__n",
    ".scout-pager__step",
    ".scout-pager__gap",
    ".scout-pager__count",
  ]) {
    assert(css.includes(cls), `${cls} is missing from hire-scout.css`);
  }
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
