import type { CartRow } from "@/components/hire/shortlist-cart";

/**
 * Which project the header shortlist belongs to right now (plan 133).
 *
 * Pure, no React, so the isolation rule can be tested directly.
 */

/**
 * `/hire/<segment>` routes that are pages, not projects.
 *
 * This list decides more than the shortlist scope: `HireChrome` derives `desk`
 * from `projectIdFromPath`, so a page missing here is rendered with the whole
 * project-desk shell — sidebar, journey rail, results grid — around content
 * that is not a project. Every new `/hire/<page>` route belongs here.
 */
const NOT_A_PROJECT = new Set([
  "evidence",
  "requests",
  "messages",
  "matches",
  "create-test",
  "assessments",
  "projects",
  "settings",
  "jobs",
  "credits",
]);

/** The project id in `/hire/<id>` or `/hire/<id>/candidates`, else null. */
export function projectIdFromPath(pathname: string | null | undefined): string | null {
  const match = /^\/hire\/([^/]+)(?:\/candidates)?\/?$/.exec(pathname ?? "");
  if (!match) return null;
  const segment = match[1]!;
  return NOT_A_PROJECT.has(segment) ? null : segment;
}

/**
 * Inside a project: that project's shortlist and nothing else. Outside one:
 * the legacy recruiter-wide saved list, which belongs to no project and is
 * never shown as if it did.
 */
export function scopePodRows(rows: CartRow[], projectId: string | null): CartRow[] {
  return projectId
    ? rows.filter((r) => r.projectRequestId === projectId)
    : rows.filter((r) => !r.projectRequestId);
}
