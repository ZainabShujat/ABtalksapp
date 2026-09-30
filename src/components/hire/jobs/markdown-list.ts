/**
 * List editing for the job-description markdown textarea
 * (job-form-client.tsx). Pure string functions — no React, no DOM — so they
 * run under a plain `tsx` test: `npx tsx src/components/hire/jobs/markdown-list.test.ts`.
 */

/** Markdown list markers at the start of a line: `1. ` / `1) ` and `- ` / `* ` / `+ `. */
const NUMBER_MARKER = /^([ \t]*)(\d+)([.)])[ \t]+/;
const BULLET_MARKER = /^([ \t]*)([-*+])[ \t]+/;

export type ListKind = "bullet" | "number";
export type TextEdit = { text: string; selStart: number; selEnd: number };

/**
 * Bullet / numbered list button. Applies to every line the selection
 * touches (not just the first), numbers them 1., 2., 3. — continuing from a
 * numbered line directly above — and toggles off when every line already
 * has that marker. Switching bullets ↔ numbers replaces the old marker.
 */
export function applyListToggle(
  text: string,
  selStart: number,
  selEnd: number,
  kind: ListKind,
): TextEdit {
  const blockStart = text.lastIndexOf("\n", selStart - 1) + 1;
  // A selection ending right after a newline does not include the next line.
  const effEnd =
    selEnd > selStart && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
  const nl = text.indexOf("\n", effEnd);
  const blockEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(blockStart, blockEnd).split("\n");

  const re = kind === "number" ? NUMBER_MARKER : BULLET_MARKER;
  const filled = lines.filter((l) => l.trim());
  const allOn = filled.length > 0 && filled.every((l) => re.test(l));

  let n = 1;
  if (kind === "number" && blockStart > 0) {
    const prevStart = text.lastIndexOf("\n", blockStart - 2) + 1;
    const prev = text.slice(prevStart, blockStart - 1).match(NUMBER_MARKER);
    if (prev) n = Number(prev[2]) + 1;
  }

  const nextLines = lines.map((line) => {
    if (allOn) return line.replace(re, "$1");
    // Blank lines inside a multi-line selection stay blank.
    if (!line.trim() && lines.length > 1) return line;
    const bare = line.replace(NUMBER_MARKER, "$1").replace(BULLET_MARKER, "$1");
    const indent = bare.match(/^[ \t]*/)?.[0] ?? "";
    const body = bare.slice(indent.length);
    return kind === "number" ? `${indent}${n++}. ${body}` : `${indent}- ${body}`;
  });

  const replaced = nextLines.join("\n");
  const blockEndAfter = blockStart + replaced.length;
  return {
    text: text.slice(0, blockStart) + replaced + text.slice(blockEnd),
    // Multi-line: keep the whole block selected. One line: cursor at its end.
    selStart: lines.length > 1 ? blockStart : blockEndAfter,
    selEnd: blockEndAfter,
  };
}

/**
 * Enter inside a list item starts the next one ("3. foo" → "4. ",
 * "- foo" → "- "). Enter on an empty item ends the list. Returns null when
 * the cursor is not in a list item (plain newline).
 */
export function applyListEnter(text: string, pos: number): TextEdit | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const nlAfter = text.indexOf("\n", pos);
  const lineEnd = nlAfter === -1 ? text.length : nlAfter;
  const line = text.slice(lineStart, lineEnd);

  const num = line.match(NUMBER_MARKER);
  const bullet = num ? null : line.match(BULLET_MARKER);
  const marker = num ?? bullet;
  if (!marker || pos < lineStart + marker[0].length) return null;

  if (!line.slice(marker[0].length).trim()) {
    // Empty item: remove its marker and leave the list.
    return {
      text: text.slice(0, lineStart) + text.slice(lineEnd),
      selStart: lineStart,
      selEnd: lineStart,
    };
  }
  const nextMarker = num
    ? `${num[1]}${Number(num[2]) + 1}${num[3]} `
    : `${marker[1]}${bullet?.[2] ?? "-"} `;
  const insert = `\n${nextMarker}`;
  const at = pos + insert.length;
  return {
    text: text.slice(0, pos) + insert + text.slice(pos),
    selStart: at,
    selEnd: at,
  };
}
