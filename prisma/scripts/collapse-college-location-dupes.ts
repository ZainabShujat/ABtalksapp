/**
 * Deactivate AISHE/AICTE location-suffix twins in College
 * ("ABES Engineering College" vs "ABES Engineering College, Ghaziabad").
 * Remaps StudentProfile.collegeId onto the keeper. Never rewrites `college`.
 *
 * Usage:
 *   npx tsx prisma/scripts/collapse-college-location-dupes.ts
 */
import { config } from "dotenv";
import { prisma } from "../../src/lib/db";

config({ path: ".env.local" });
config();

const alnum = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type Row = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
  city: string | null;
  aliases: string[];
};

function placeTokens(row: Row): Set<string> {
  return new Set(
    [row.city, row.district, row.state]
      .map(alnum)
      .filter((t) => t.length >= 3),
  );
}

function splitLocationSuffix(
  name: string,
): { stem: string; place: string } | null {
  const comma = name.lastIndexOf(",");
  if (comma < 8) return null;
  const stem = name.slice(0, comma).trim();
  const place = name.slice(comma + 1).trim();
  if (alnum(stem).length < 8) return null;
  if (place.length === 0 || place.split(/\s+/).length > 4) return null;
  return { stem, place };
}

function searchTextFor(r: {
  name: string;
  aliases: string[];
  city: string | null;
  district: string | null;
}): string {
  return ` ${[r.name, ...r.aliases, r.city ?? "", r.district ?? ""]
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()} `;
}

async function main() {
  const rows = await prisma.college.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      state: true,
      district: true,
      city: true,
      aliases: true,
    },
  });

  const byAlnumName = new Map<string, Row[]>();
  for (const row of rows) {
    const key = alnum(row.name);
    const arr = byAlnumName.get(key) ?? [];
    arr.push(row);
    byAlnumName.set(key, arr);
  }

  const dropToKeep = new Map<string, string>();
  const keepAliases = new Map<string, Set<string>>();

  function noteDrop(drop: Row, keepId: string) {
    if (drop.id === keepId || dropToKeep.has(drop.id)) return;
    dropToKeep.set(drop.id, keepId);
    const set = keepAliases.get(keepId) ?? new Set();
    set.add(drop.name);
    for (const alias of drop.aliases) set.add(alias);
    keepAliases.set(keepId, set);
  }

  for (const qualified of rows) {
    const split = splitLocationSuffix(qualified.name);
    if (!split) continue;
    const stemKey = alnum(split.stem);
    const placeKey = alnum(split.place);
    const stems = byAlnumName.get(stemKey) ?? [];
    if (stems.length === 0) continue;

    const placeMatch = stems.find((stem) => {
      if (stem.id === qualified.id) return false;
      const tokens = placeTokens(stem);
      if (placeKey.length >= 3 && tokens.has(placeKey)) return true;
      if (stems.length === 1 && tokens.size === 0) return true;
      return false;
    });
    if (placeMatch) noteDrop(qualified, placeMatch.id);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));

  console.log(`deactivating ${dropToKeep.size} location-suffix twins`);

  const dropsByKeep = new Map<string, string[]>();
  for (const [dropId, keepId] of dropToKeep) {
    const arr = dropsByKeep.get(keepId) ?? [];
    arr.push(dropId);
    dropsByKeep.set(keepId, arr);
  }

  let done = 0;
  for (const [keepId, dropIds] of dropsByKeep) {
    await prisma.studentProfile.updateMany({
      where: { collegeId: { in: dropIds } },
      data: { collegeId: keepId },
    });
    await prisma.college.updateMany({
      where: { id: { in: dropIds } },
      data: { isActive: false },
    });
    done += dropIds.length;
    if (done % 50 === 0 || done === dropToKeep.size) {
      console.log(`  ${done}/${dropToKeep.size}`);
    }
  }

  for (const [keepId, extraNames] of keepAliases) {
    const keeper = byId.get(keepId);
    if (!keeper) continue;
    const aliases = [...new Set([...keeper.aliases, ...extraNames])];
    await prisma.college.update({
      where: { id: keepId },
      data: {
        aliases,
        searchText: searchTextFor({
          name: keeper.name,
          aliases,
          city: keeper.city,
          district: keeper.district,
        }),
      },
      select: { id: true },
    });
  }

  const stillActive = await prisma.college.count({ where: { isActive: true } });
  const inactive = await prisma.college.count({ where: { isActive: false } });
  console.log(`done. active=${stillActive} inactive=${inactive}`);
}

main()
  .catch((e) => {
    console.error("collapse-college-location-dupes failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
