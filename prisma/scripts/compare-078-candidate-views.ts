/**
 * Compare StudentProfile (flag-OFF view) vs CandidateProfile + profile-owned
 * children (flag-ON view). Does not write. Expected diffs: 2a extras where
 * StudentProfile is null and CandidateProfile is filled.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

type DiffRow = {
  field: string;
  bothFilledDiffer: number;
  spNullCpFilled: number;
  spFilledCpNull: number;
};

async function count(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM (${sql}) q`,
  );
  return rows[0]?.n ?? 0;
}

async function main() {
  assertChildBranch();

  const fields: DiffRow[] = [];

  async function scalar(
    field: string,
    spCol: string,
    cpCol: string,
  ): Promise<void> {
    const bothFilledDiffer = await count(`
      SELECT sp."userId"
      FROM "StudentProfile" sp
      JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
      WHERE sp.${spCol} IS NOT NULL
        AND cp.${cpCol} IS NOT NULL
        AND sp.${spCol} IS DISTINCT FROM cp.${cpCol}
    `);
    const spNullCpFilled = await count(`
      SELECT sp."userId"
      FROM "StudentProfile" sp
      JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
      WHERE sp.${spCol} IS NULL AND cp.${cpCol} IS NOT NULL
    `);
    const spFilledCpNull = await count(`
      SELECT sp."userId"
      FROM "StudentProfile" sp
      JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
      WHERE sp.${spCol} IS NOT NULL AND cp.${cpCol} IS NULL
    `);
    fields.push({ field, bothFilledDiffer, spNullCpFilled, spFilledCpNull });
  }

  await scalar("fullName", '"fullName"', '"fullName"');
  await scalar("phone", '"phone"', '"phone"');
  await scalar("linkedinUrl", '"linkedinUrl"', '"linkedinUrl"');
  await scalar("githubUsername", '"githubUsername"', '"githubUsername"');
  await scalar("resumeUrl", '"resumeUrl"', '"resumeUrl"');
  await scalar("referralCode", '"referralCode"', '"referralCode"');

  const collegeDiffer = await count(`
    SELECT sp."userId"
    FROM "StudentProfile" sp
    JOIN "CandidateEducation" e ON e.id = 'edu_sp_' || sp."userId"
    WHERE sp.college IS DISTINCT FROM NULLIF(e."institutionName", 'Not specified')
  `);
  const collegeMissingEdu = await count(`
    SELECT sp."userId"
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE (sp.college IS NOT NULL OR sp."collegeId" IS NOT NULL OR sp."graduationYear" IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM "CandidateEducation" e WHERE e.id = 'edu_sp_' || sp."userId"
      )
  `);
  const expMissing = await count(`
    SELECT sp."userId"
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE (sp.organization IS NOT NULL OR sp.role IS NOT NULL OR sp."yearsExperience" IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM "CandidateExperience" e WHERE e.id = 'exp_sp_' || sp."userId"
      )
  `);
  const extraEduSp = await count(`
    SELECT "userId"
    FROM "CandidateEducation"
    WHERE id LIKE 'edu_sp_%'
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  `);
  const extraExpSp = await count(`
    SELECT "userId"
    FROM "CandidateExperience"
    WHERE id LIKE 'exp_sp_%'
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  `);
  const missingSkills = await count(`
    SELECT sp."userId"
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE cardinality(sp.skills) > 0
      AND NOT EXISTS (
        SELECT 1 FROM "CandidateSkill" cs WHERE cs."userId" = sp."userId"
      )
  `);

  const unexpected = fields.filter(
    (f) =>
      f.field === "fullName" || f.field === "referralCode"
        ? f.bothFilledDiffer > 0 || f.spFilledCpNull > 0
        : f.bothFilledDiffer > 0,
  );

  console.log(
    JSON.stringify(
      {
        scalars: fields,
        collegeDiffer,
        collegeMissingEdu,
        expMissing,
        extraEduSp,
        extraExpSp,
        missingSkills,
        expected2aExtras: fields
          .filter((f) =>
            ["phone", "linkedinUrl", "githubUsername", "resumeUrl"].includes(
              f.field,
            ),
          )
          .map((f) => ({ field: f.field, spNullCpFilled: f.spNullCpFilled })),
      },
      null,
      2,
    ),
  );

  if (
    unexpected.length > 0 ||
    collegeMissingEdu !== 0 ||
    expMissing !== 0 ||
    extraEduSp !== 0 ||
    extraExpSp !== 0 ||
    missingSkills !== 0
  ) {
    throw new Error("Candidate OFF-vs-ON comparison has unexpected diffs");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
