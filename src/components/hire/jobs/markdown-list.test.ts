/**
 * Job-description list editing — behavioural test.
 *
 *   npx tsx src/components/hire/jobs/markdown-list.test.ts
 */
import { applyListEnter, applyListToggle } from "./markdown-list";

let passed = 0;
let failed = 0;

function eq(name: string, got: string, want: string) {
  if (got === want) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(
      `  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`,
    );
  }
}

console.log("\nmarkdown-list: toolbar toggle");
eq(
  "selecting two lines numbers them 1., 2. (was 1., 1.)",
  applyListToggle("j\njb", 0, 4, "number").text,
  "1. j\n2. jb",
);
eq("cursor on one line → 1.", applyListToggle("hello", 2, 2, "number").text, "1. hello");
eq("toggles off when all numbered", applyListToggle("1. j\n2. jb", 0, 10, "number").text, "j\njb");
eq("bullets → numbers replaces the marker", applyListToggle("- a\n- b", 0, 7, "number").text, "1. a\n2. b");
eq("numbers → bullets", applyListToggle("1. a\n2. b", 0, 9, "bullet").text, "- a\n- b");
eq("bullets on every selected line", applyListToggle("a\nb\nc", 0, 5, "bullet").text, "- a\n- b\n- c");
eq(
  "continues numbering from the line above",
  applyListToggle("1. a\n2. b\nc", 10, 10, "number").text,
  "1. a\n2. b\n3. c",
);
eq("blank line inside a selection stays blank", applyListToggle("a\n\nb", 0, 4, "number").text, "1. a\n\n2. b");
eq(
  "selection ending after a newline skips the next line",
  applyListToggle("a\nb", 0, 2, "number").text,
  "1. a\nb",
);
eq("partly numbered → all numbered", applyListToggle("1. a\nb", 0, 6, "number").text, "1. a\n2. b");

console.log("\nmarkdown-list: Enter continuation");
eq("after '1. j' → '2. '", applyListEnter("1. j", 4)?.text ?? "null", "1. j\n2. ");
eq("after '9) x' → '10) '", applyListEnter("9) x", 4)?.text ?? "null", "9) x\n10) ");
eq("after '- a' → '- '", applyListEnter("- a", 3)?.text ?? "null", "- a\n- ");
eq("on an empty item → leaves the list", applyListEnter("1. a\n2. ", 8)?.text ?? "null", "1. a\n");
eq("on a plain line → no change (null)", String(applyListEnter("hello", 5)), "null");
eq("keeps indentation", applyListEnter("  - a", 5)?.text ?? "null", "  - a\n  - ");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
