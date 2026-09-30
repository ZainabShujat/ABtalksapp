/**
 * Paging arithmetic for the recruiter search results list.
 *
 * Kept out of `match-results.tsx` only so it can be exercised by `tsx` without
 * dragging a `"use client"` component and the whole card tree into the test.
 * Pure functions over numbers — no React, no DOM, no server imports.
 */

/** Results per page in the recruiter search list. */
export const MATCHES_PER_PAGE = 10;

export type PageItem = number | "gap";

/**
 * Pages either side of the current one that are always spelled out. Below
 * `2 * window + 5` total pages every number fits without an ellipsis, which is
 * why a 4-page list renders as a plain `1 2 3 4`.
 */
const DEFAULT_WINDOW = 1;

/** Total pages for a list length. At least 1, so an empty list is page 1 of 1. */
export function pageCount(total: number, perPage: number = MATCHES_PER_PAGE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(perPage) || perPage <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage));
}

/**
 * Clamp a page into `[1, totalPages]`.
 *
 * Applied on render rather than only on click: the list shrinks under the user
 * — "Hide rejected", a new search, a tab switch — and a stale page number must
 * never strand them on an empty list.
 */
export function clampPage(page: number, totalPages: number): number {
  const last = Math.max(1, Math.floor(totalPages));
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), last);
}

/**
 * The page numbers to render, first and last always present, elided runs
 * collapsed to a single `"gap"`.
 *
 * `pageItems(1, 4)`  -> [1, 2, 3, 4]
 * `pageItems(6, 12)` -> [1, "gap", 5, 6, 7, "gap", 12]
 */
export function pageItems(
  page: number,
  totalPages: number,
  window: number = DEFAULT_WINDOW,
): PageItem[] {
  const last = Math.max(1, Math.floor(totalPages));
  const current = clampPage(page, last);
  const span = Math.max(0, Math.floor(window));

  // first + last + current + its window either side + two gaps. Any list this
  // short is cheaper to read in full than to elide.
  if (last <= 2 * span + 5) {
    return Array.from({ length: last }, (_, i) => i + 1);
  }

  const wanted = new Set<number>([1, last, current]);
  for (let i = 1; i <= span; i++) {
    if (current - i >= 1) wanted.add(current - i);
    if (current + i <= last) wanted.add(current + i);
  }

  const numbers = [...wanted].sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const n of numbers) {
    // A single missing page is written out rather than hidden behind a gap that
    // would be no shorter than the number it replaces.
    if (previous > 0 && n - previous === 2) {
      items.push(previous + 1);
    } else if (previous > 0 && n - previous > 2) {
      items.push("gap");
    }
    items.push(n);
    previous = n;
  }
  return items;
}
