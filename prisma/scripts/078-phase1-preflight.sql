-- Read-only preflight for plan 078 Phase 1 production DDL.
-- Must all be 0 (or explained) before ADD CONSTRAINT / new FKs.

SELECT 'job_orphan_createdByAdminId' AS check, count(*)::int AS n
FROM "Job" j
WHERE j."createdByAdminId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = j."createdByAdminId");

SELECT 'recruiter_orphan_approvedByAdminId' AS check, count(*)::int AS n
FROM "RecruiterProfile" r
WHERE r."approvedByAdminId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = r."approvedByAdminId");

SELECT 'notification_orphan_createdByAdminId' AS check, count(*)::int AS n
FROM "Notification" n
WHERE n."createdByAdminId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = n."createdByAdminId");

SELECT 'hackathon_removal_orphan_removedByUserId' AS check, count(*)::int AS n
FROM "HackathonRemoval" h
WHERE h."removedByUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = h."removedByUserId");

SELECT 'certificate_orphan_userId' AS check, count(*)::int AS n
FROM "Certificate" c
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = c."userId");

SELECT 'synergy_orphan_userId' AS check, count(*)::int AS n
FROM "SynergyEvent" s
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = s."userId");

SELECT 'shortlist_orphan_memberId' AS check, count(*)::int AS n
FROM "RecruiterShortlistItem" i
WHERE NOT EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m.id = i."memberId");

SELECT to_regclass('public."CandidateProfile"') AS candidate_profile_table;
SELECT to_regclass('public."ProgramEnrollment"') AS program_enrollment_table;
SELECT to_regclass('public."MigrationRun"') AS migration_run_table;
