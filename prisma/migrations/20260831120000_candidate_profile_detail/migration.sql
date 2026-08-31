-- Detailed candidate profile (Slice 1). Additive, nullable/defaulted,
-- zero-downtime. Touches no existing values and drops nothing.
--
-- Legacy tables (StudentProfile, RecruiterReview) are unchanged and stay
-- authoritative for the flows that still read them.

-- 1. Grade scale for CandidateEducation. Existing `grade` strings keep their
--    meaning; gradeType is null on every pre-existing row.
CREATE TYPE "GradeType" AS ENUM ('PERCENTAGE', 'CGPA_10', 'GPA_4', 'GRADE', 'OTHER');

-- 2. Destinations for CandidateLink.
CREATE TYPE "CandidateLinkType" AS ENUM (
  'PORTFOLIO', 'LINKEDIN', 'GITHUB', 'LEETCODE', 'CODECHEF',
  'CODEFORCES', 'KAGGLE', 'BEHANCE', 'DRIBBBLE', 'OTHER'
);

-- 3. Engagement types a candidate is open to. Multi-select, not a column each.
CREATE TYPE "OpportunityType" AS ENUM (
  'INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE'
);

-- 4. Month precision + richer metadata on education. `startYear` /
--    `graduationYear` / `grade` are retained exactly as they are; a null month
--    means the row keeps the pre-existing year-only precision.
ALTER TABLE "CandidateEducation"
  ADD COLUMN "startMonth"  INTEGER,
  ADD COLUMN "endMonth"    INTEGER,
  ADD COLUMN "gradeType"   "GradeType",
  ADD COLUMN "description" TEXT;

-- 5. Project tech stack. Descriptive only — never normalized into `Skill`, so
--    it can never become skill evidence.
ALTER TABLE "CandidateProjectEntry"
  ADD COLUMN "techStack" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 6. Separate the candidate's claim from accumulated evidence. Withdrawing a
--    claim flips this to false instead of deleting the row: SkillEvidence
--    cascades off CandidateSkill, so a delete would destroy history.
--    Every existing row is a live claim, hence DEFAULT true and backfill true.
ALTER TABLE "CandidateSkill"
  ADD COLUMN "claimedByCandidate" BOOLEAN NOT NULL DEFAULT true;

-- 7. Opportunity types on the existing preference row.
ALTER TABLE "CandidatePreference"
  ADD COLUMN "opportunityTypes" "OpportunityType"[] DEFAULT ARRAY[]::"OpportunityType"[];

-- 8. Arbitrary professional links. LinkedIn / GitHub / portfolio stay as
--    CandidateProfile columns (recruiter surfaces and the legacy mirror read
--    them directly); this holds everything beyond those.
CREATE TABLE "CandidateLink" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      "CandidateLinkType" NOT NULL DEFAULT 'OTHER',
  "label"     TEXT,
  "url"       TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateLink_userId_sortOrder_idx" ON "CandidateLink"("userId", "sortOrder");

ALTER TABLE "CandidateLink"
  ADD CONSTRAINT "CandidateLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
