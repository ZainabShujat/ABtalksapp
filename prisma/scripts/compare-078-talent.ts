/**
 * Read-only TALENT pre-flip pack: intended recruiter pool vs CandidateVisibility
 * eligibility. Does not write. PHASE2_ALLOW_PRODUCTION=1 + direct URL required.
 *
 * Intended searchable set:
 *   ProgramMember users
 *   ∪ post-2b platform_default (non-cohort) users
 * Historical non-cohort users stay closed. openToWork is not a gate.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function one<T extends Record<string, unknown>>(sql: string): Promise<T> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql);
  if (!rows[0]) throw new Error(`Expected a row: ${sql.slice(0, 120)}`);
  return rows[0];
}

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

async function main() {
  assertChildBranch();

  const first2b = await prisma.migrationRun.findFirst({
    where: { step: "2b-visibility", ok: true, finishedAt: { not: null } },
    orderBy: { finishedAt: "asc" },
    select: { finishedAt: true },
  });
  if (!first2b?.finishedAt) {
    throw new Error("No successful 2b-visibility MigrationRun; cannot classify post-launch.");
  }
  const cutoffIso = first2b.finishedAt.toISOString();
  log("2b_cutoff", cutoffIso);

  const v4b = await prisma.$queryRawUnsafe<
    Array<{
      userId: string;
      status: string;
      memberCreatedAt: Date;
      userCreatedAt: Date;
      searchableByRecruiters: boolean | null;
      consentSource: string | null;
      withdrawnAt: Date | null;
      recruiterVisibilityConsentAt: Date | null;
      hasCandidateProfile: boolean;
    }>
  >(`
    SELECT m."userId",
           m.status::text AS status,
           m."createdAt" AS "memberCreatedAt",
           u."createdAt" AS "userCreatedAt",
           v."searchableByRecruiters",
           v."consentSource",
           v."withdrawnAt",
           m."recruiterVisibilityConsentAt",
           EXISTS (
             SELECT 1 FROM "CandidateProfile" cp WHERE cp."userId" = m."userId"
           ) AS "hasCandidateProfile"
      FROM "ProgramMember" m
      JOIN "User" u ON u.id = m."userId"
      LEFT JOIN "CandidateVisibility" v ON v."userId" = m."userId"
     WHERE NOT EXISTS (
       SELECT 1 FROM "CandidateVisibility" v2
        WHERE v2."userId" = m."userId"
          AND v2."searchableByRecruiters" = true
     )
     ORDER BY m."createdAt" ASC
  `);
  log("v4b_not_searchable_members", v4b);

  const pool = await one<{
    program_members_distinct: number;
    program_member_rows: number;
    searchable_members: number;
    members_not_searchable: number;
    members_missing_visibility_row: number;
    searchable_visibility: number;
    platform_default_non_member: number;
    platform_default_non_member_after_2b: number;
    platform_default_non_member_before_2b: number;
    historical_non_cohort_exposed: number;
    searchable_missing_profile: number;
    visibility_leak: number;
    withdrawn_searchable_flag: number;
  }>(`
    SELECT
      (SELECT COUNT(DISTINCT m."userId")::int FROM "ProgramMember" m)
        AS program_members_distinct,
      (SELECT COUNT(*)::int FROM "ProgramMember")
        AS program_member_rows,
      (SELECT COUNT(DISTINCT m."userId")::int FROM "ProgramMember" m
        JOIN "CandidateVisibility" v ON v."userId" = m."userId"
       WHERE v."searchableByRecruiters" = true)
        AS searchable_members,
      (SELECT COUNT(DISTINCT m."userId")::int FROM "ProgramMember" m
        WHERE NOT EXISTS (
          SELECT 1 FROM "CandidateVisibility" v
           WHERE v."userId" = m."userId" AND v."searchableByRecruiters" = true
        )) AS members_not_searchable,
      (SELECT COUNT(DISTINCT m."userId")::int FROM "ProgramMember" m
        WHERE NOT EXISTS (
          SELECT 1 FROM "CandidateVisibility" v WHERE v."userId" = m."userId"
        )) AS members_missing_visibility_row,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        WHERE v."searchableByRecruiters" = true AND v."withdrawnAt" IS NULL)
        AS searchable_visibility,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        WHERE v."searchableByRecruiters" = true
          AND v."withdrawnAt" IS NULL
          AND v."consentSource" = 'platform_default'
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId"))
        AS platform_default_non_member,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        JOIN "User" u ON u.id = v."userId"
        WHERE v."searchableByRecruiters" = true
          AND v."withdrawnAt" IS NULL
          AND v."consentSource" = 'platform_default'
          AND u."createdAt" >= TIMESTAMPTZ '${cutoffIso}'
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId"))
        AS platform_default_non_member_after_2b,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        JOIN "User" u ON u.id = v."userId"
        WHERE v."searchableByRecruiters" = true
          AND v."withdrawnAt" IS NULL
          AND v."consentSource" = 'platform_default'
          AND u."createdAt" < TIMESTAMPTZ '${cutoffIso}'
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId"))
        AS platform_default_non_member_before_2b,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        JOIN "User" u ON u.id = v."userId"
        WHERE v."searchableByRecruiters" = true
          AND v."withdrawnAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId")
          AND (
            v."consentSource" IS DISTINCT FROM 'platform_default'
            OR u."createdAt" < TIMESTAMPTZ '${cutoffIso}'
          )) AS historical_non_cohort_exposed,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        WHERE v."searchableByRecruiters" = true
          AND v."withdrawnAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "CandidateProfile" cp WHERE cp."userId" = v."userId"))
        AS searchable_missing_profile,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        WHERE v."searchableByRecruiters" = true
          AND v."consentSource" IS DISTINCT FROM 'platform_default'
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId"))
        AS visibility_leak,
      (SELECT COUNT(*)::int FROM "CandidateVisibility" v
        WHERE v."searchableByRecruiters" = true AND v."withdrawnAt" IS NOT NULL)
        AS withdrawn_searchable_flag
  `);
  log("pool", pool);

  const historicalExposed = await prisma.$queryRawUnsafe<
    Array<{
      userId: string;
      consentSource: string | null;
      userCreatedAt: Date;
      hasProfile: boolean;
      hasEnrollment: boolean;
      hasHackathon: boolean;
    }>
  >(`
    SELECT v."userId",
           v."consentSource",
           u."createdAt" AS "userCreatedAt",
           EXISTS (SELECT 1 FROM "CandidateProfile" cp WHERE cp."userId" = v."userId") AS "hasProfile",
           EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."userId" = v."userId") AS "hasEnrollment",
           EXISTS (SELECT 1 FROM "HackathonParticipant" h WHERE h."userId" = v."userId") AS "hasHackathon"
      FROM "CandidateVisibility" v
      JOIN "User" u ON u.id = v."userId"
     WHERE v."searchableByRecruiters" = true
       AND v."withdrawnAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId")
       AND (
         v."consentSource" IS DISTINCT FROM 'platform_default'
         OR u."createdAt" < TIMESTAMPTZ '${cutoffIso}'
       )
     ORDER BY u."createdAt" ASC
     LIMIT 20
  `);
  log("historical_non_cohort_exposed_rows", historicalExposed);

  const missingProfile = await prisma.$queryRawUnsafe<
    Array<{
      userId: string;
      consentSource: string | null;
      isMember: boolean;
      userCreatedAt: Date;
    }>
  >(`
    SELECT v."userId",
           v."consentSource",
           EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId") AS "isMember",
           u."createdAt" AS "userCreatedAt"
      FROM "CandidateVisibility" v
      JOIN "User" u ON u.id = v."userId"
     WHERE v."searchableByRecruiters" = true
       AND v."withdrawnAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "CandidateProfile" cp WHERE cp."userId" = v."userId")
     ORDER BY u."createdAt" ASC
     LIMIT 20
  `);
  log("searchable_missing_profile_rows", missingProfile);

  const recruiter = await one<{
    recruiter_profiles: number;
    approved_recruiters: number;
    organization_members: number;
    legacy_shortlist: number;
    talent_lists: number;
    talent_list_items: number;
    recruiter_reviews: number;
    published_reviews: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM "RecruiterProfile") AS recruiter_profiles,
      (SELECT COUNT(*)::int FROM "RecruiterProfile" WHERE approved) AS approved_recruiters,
      (SELECT COUNT(*)::int FROM "OrganizationMember") AS organization_members,
      (SELECT COUNT(*)::int FROM "RecruiterShortlistItem") AS legacy_shortlist,
      (SELECT COUNT(*)::int FROM "TalentList") AS talent_lists,
      (SELECT COUNT(*)::int FROM "TalentListItem") AS talent_list_items,
      (SELECT COUNT(*)::int FROM "RecruiterReview") AS recruiter_reviews,
      (SELECT COUNT(*)::int FROM "RecruiterReview" WHERE "isPublished") AS published_reviews
  `);
  log("recruiter_accounts", recruiter);

  const intendedSearchable =
    pool.program_members_distinct + pool.platform_default_non_member_after_2b;
  log("intended_vs_new", {
    intended_searchable: intendedSearchable,
    new_searchable_visibility: pool.searchable_visibility,
    v4b_gap: pool.members_not_searchable,
    note:
      "intended = all ProgramMember users + post-2b platform_default non-members; V4b gap is ProgramMembers not yet searchable",
  });

  const failures: string[] = [];
  if (pool.visibility_leak !== 0) failures.push("visibilityLeak");
  if (pool.members_missing_visibility_row !== 0) {
    failures.push("membersMissingVisibilityRow");
  }
  if (pool.searchable_missing_profile !== 0) {
    failures.push("searchableMissingProfile");
  }
  if (recruiter.legacy_shortlist !== recruiter.talent_list_items) {
    failures.push("shortlistDelta");
  }

  log("preflip_failures", failures);
  log(
    "v4b_classification",
    v4b.length === 0
      ? "none"
      : "ProgramMember with pre-existing closed CandidateVisibility; dual-write used to skip existing rows",
  );

  if (failures.length > 0 || pool.members_not_searchable !== 0) {
    throw new Error(
      `TALENT compare failed: ${JSON.stringify({
        failures,
        members_not_searchable: pool.members_not_searchable,
        intendedSearchable,
      })}`,
    );
  }
  console.log("TALENT compare: clean.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
