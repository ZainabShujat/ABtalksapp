import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type CollegeOption = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
};

type CollegeSearchRow = CollegeOption & { city: string | null };

function tokenize(query: string): string[] {
  return query
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    .slice(0, 6);
}

const alnum = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function placeTokens(row: CollegeSearchRow): Set<string> {
  return new Set(
    [row.city, row.district, row.state]
      .map(alnum)
      .filter((t) => t.length >= 3),
  );
}

function splitLocationSuffix(name: string): { stem: string; place: string } | null {
  const comma = name.lastIndexOf(",");
  if (comma < 8) return null;
  const stem = name.slice(0, comma).trim();
  const place = name.slice(comma + 1).trim();
  if (alnum(stem).length < 8) return null;
  if (place.length === 0 || place.split(/\s+/).length > 4) return null;
  return { stem, place };
}

/**
 * AISHE and AICTE often list the same campus twice: "ABES Engineering College"
 * and "ABES Engineering College, Ghaziabad". Drop the location-suffixed twin.
 * Do not collapse identical names in different districts (40 "Government
 * Polytechnic" rows) unless the suffix itself names that row's place.
 */
function collapseLocationDupes(rows: CollegeSearchRow[]): CollegeSearchRow[] {
  const drop = new Set<string>();

  const byAlnumName = new Map<string, CollegeSearchRow[]>();
  for (const row of rows) {
    const key = alnum(row.name);
    const arr = byAlnumName.get(key) ?? [];
    arr.push(row);
    byAlnumName.set(key, arr);
  }

  for (const group of byAlnumName.values()) {
    if (group.length < 2) continue;
    const keeper = group[0]!;
    for (const extra of group.slice(1)) {
      const sameState =
        alnum(keeper.state).length > 0 &&
        alnum(keeper.state) === alnum(extra.state);
      if (sameState || !keeper.state || !extra.state) drop.add(extra.id);
    }
  }

  for (const qualified of rows) {
    if (drop.has(qualified.id)) continue;
    const split = splitLocationSuffix(qualified.name);
    if (!split) continue;
    const stemKey = alnum(split.stem);
    const placeKey = alnum(split.place);
    const stems = rows.filter(
      (row) => !drop.has(row.id) && row.id !== qualified.id && alnum(row.name) === stemKey,
    );
    if (stems.length === 0) continue;

    const placeMatch = stems.find((stem) => {
      const tokens = placeTokens(stem);
      if (placeKey.length >= 3 && tokens.has(placeKey)) return true;
      if (stems.length === 1 && tokens.size === 0) return true;
      return false;
    });
    if (placeMatch) drop.add(qualified.id);
  }

  return rows.filter((r) => !drop.has(r.id));
}

export async function searchColleges(query: string): Promise<CollegeOption[]> {
  const tokens = tokenize(query);
  const first = tokens[0];
  if (!first || first.length < 2) {
    return [];
  }

  const tokenClauses = tokens.map(
    (token) => Prisma.sql`"searchText" LIKE ${"% " + token + "%"}`,
  );

  try {
    const rows = await prisma.$queryRaw<CollegeSearchRow[]>`
      SELECT "id", "name", "state", "district", "city"
      FROM "College"
      WHERE "isActive" = true
        AND ${Prisma.join(tokenClauses, " AND ")}
      ORDER BY
        "tier" ASC,
        CASE WHEN "searchText" LIKE ${" " + first + "%"} THEN 0 ELSE 1 END ASC,
        length("name") ASC,
        "name" ASC
      LIMIT 40
    `;
    return collapseLocationDupes(rows)
      .slice(0, 20)
      .map(({ id, name, state, district }) => ({ id, name, state, district }));
  } catch (error) {
    logger.error("[college] search failed", { error: String(error) });
    return [];
  }
}
