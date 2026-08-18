/**
 * Link existing StudentProfile.college strings to College.id by exact
 * normalized name match only. Never rewrites `college` itself.
 *
 * Usage:
 *   npm run db:backfill:college-id
 */
import { config } from "dotenv";
import { prisma } from "../../src/lib/db";

config({ path: ".env.local" });
config();

const CHUNK_SIZE = 500;

const alnum = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const colleges = await prisma.college.findMany({
    select: { id: true, name: true },
  });

  const byName = new Map<string, string>();
  for (const c of colleges) {
    const key = alnum(c.name);
    if (!byName.has(key)) {
      byName.set(key, c.id);
    }
  }

  const profiles = await prisma.studentProfile.findMany({
    where: { college: { not: null }, collegeId: null },
    select: { id: true, college: true },
  });

  const matched: { id: string; collegeId: string }[] = [];
  const unmatchedCounts = new Map<string, number>();

  for (const p of profiles) {
    const college = p.college;
    if (!college) continue;
    const id = byName.get(alnum(college));
    if (id) {
      matched.push({ id: p.id, collegeId: id });
    } else {
      unmatchedCounts.set(college, (unmatchedCounts.get(college) ?? 0) + 1);
    }
  }

  for (let i = 0; i < matched.length; i += CHUNK_SIZE) {
    const chunk = matched.slice(i, i + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.studentProfile.update({
          where: { id: row.id },
          data: { collegeId: row.collegeId },
          select: { id: true },
        }),
      ),
    );
    console.log(
      `  updated ${Math.min(i + CHUNK_SIZE, matched.length)}/${matched.length}`,
    );
  }

  const unmatchedTotal = profiles.length - matched.length;
  const topUnmatched = [...unmatchedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  console.log(`matched: ${matched.length}`);
  console.log(`unmatched: ${unmatchedTotal}`);
  console.log("30 most common unmatched strings:");
  for (const [name, count] of topUnmatched) {
    console.log(`  ${count}\t${name}`);
  }
}

main()
  .catch((e) => {
    console.error("college-id backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
