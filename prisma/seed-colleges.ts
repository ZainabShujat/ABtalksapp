import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { prisma } from "../src/lib/db";

config({ path: ".env.local" });
config();

type CollegeJsonRow = {
  name: string;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  aliases?: string[];
  tier?: number;
};

const CHUNK_SIZE = 2_000;
const DATA_PATH = join(process.cwd(), "prisma/content/colleges.json");

const alnum = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function deriveComputed(r: {
  name: string;
  district: string | null;
  city: string | null;
  aliases: string[];
}) {
  const nameKey = `${alnum(r.name)}|${alnum(r.district)}`;

  // Leading AND trailing space are load-bearing: the search matches
  // `LIKE '% ' || token || '%'`, which is what stops "lpu" from also hitting
  // "Jabalpur" and "Bhagalpur" (442 false positives, measured).
  const searchText = ` ${[r.name, ...r.aliases, r.city ?? "", r.district ?? ""]
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()} `;

  return { nameKey, searchText };
}

async function main() {
  const force = process.argv.includes("--force");
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as CollegeJsonRow[];

  if (!Array.isArray(raw)) {
    throw new Error("prisma/content/colleges.json must be an array");
  }

  if (force) {
    const deleted = await prisma.college.deleteMany({});
    console.log(`--force: deleted ${deleted.count} existing College rows`);
  }

  const data = raw.map((row) => {
    const aliases = row.aliases ?? [];
    const district = row.district ?? null;
    const city = row.city ?? null;
    const { nameKey, searchText } = deriveComputed({
      name: row.name,
      district,
      city,
      aliases,
    });
    return {
      nameKey,
      name: row.name,
      state: row.state ?? null,
      district,
      city,
      aliases,
      tier: row.tier ?? 3,
      searchText,
    };
  });

  const chunks = Math.ceil(data.length / CHUNK_SIZE);
  let inserted = 0;
  for (let i = 0; i < chunks; i++) {
    const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const result = await prisma.college.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
    console.log(
      `  chunk ${i + 1}/${chunks}: +${result.count} (running inserted ${inserted})`,
    );
  }

  const total = await prisma.college.count();
  const curated = await prisma.college.count({ where: { tier: { lt: 3 } } });
  console.log(
    `College seed done. inserted this run: ${inserted}; total: ${total}; tier < 3: ${curated}`,
  );
}

main()
  .catch((e) => {
    console.error("College seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
