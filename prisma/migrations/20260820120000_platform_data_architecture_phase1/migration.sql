-- Plan 078 Phase 1 — Expand (additive only).
-- Target: Neon child branch plan-078-phase1 (br-round-mud-amndc39k).
-- Do not apply to production until Phase 1 verification queries pass.

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('CANDIDATE', 'RECRUITER', 'ADMIN', 'INSTRUCTOR', 'MENTOR', 'ORG_ADMIN');

-- CreateEnum
CREATE TYPE "RoleScopeType" AS ENUM ('GLOBAL', 'COHORT', 'ORGANIZATION', 'PROGRAM');

-- CreateEnum
CREATE TYPE "CandidatePersona" AS ENUM ('STUDENT', 'PROFESSIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SkillProficiency" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "ProgramFormat" AS ENUM ('CHALLENGE', 'COHORT', 'COURSE', 'BOOTCAMP', 'WORKSHOP', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "ProgramVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CohortStartMode" AS ENUM ('ROLLING', 'FIXED');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('DRAFT', 'ENROLLING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CODING', 'QUIZ', 'PROJECT', 'ASSIGNMENT', 'CONTENT', 'VIDEO', 'INTERVIEW', 'EXTERNAL_SUBMISSION', 'DAILY_CHALLENGE');

-- CreateEnum
CREATE TYPE "ActivityUnlockRule" AS ENUM ('ALWAYS', 'SEQUENTIAL', 'SCHEDULED', 'PREREQUISITE');

-- CreateEnum
CREATE TYPE "EnrollmentStatusV2" AS ENUM ('APPLIED', 'WAITLISTED', 'ACTIVE', 'COMPLETED', 'DROPPED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AttemptLateness" AS ENUM ('ON_TIME', 'LATE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "EvaluatorType" AS ENUM ('AUTO', 'AI', 'HUMAN', 'EXTERNAL', 'SELF');

-- CreateEnum
CREATE TYPE "DayActivitySource" AS ENUM ('SUBMISSION', 'GITHUB_COMMIT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('COMPLETION', 'DISTINCTION', 'PARTICIPATION', 'PLACEMENT', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "CredentialSourceType" AS ENUM ('PROGRAM_ENROLLMENT', 'COHORT', 'HACKATHON_TEAM', 'WORKSHOP_REGISTRATION', 'ASSESSMENT_REPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PointsSourceType" AS ENUM ('ACTIVITY_ATTEMPT', 'REFERRAL', 'REDEMPTION', 'REDEMPTION_REFUND', 'ADMIN_GRANT', 'RECONCILIATION', 'LEGACY');

-- CreateEnum
CREATE TYPE "AchievementSourceType" AS ENUM ('PROGRAM_ENROLLMENT', 'HACKATHON_TEAM', 'WORKSHOP_REGISTRATION', 'ASSESSMENT_REPORT', 'CREDENTIAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('ACTIVITY_EVALUATION', 'ASSESSMENT_SCORE', 'HACKATHON', 'CREDENTIAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "OrgMemberRole" AS ENUM ('OWNER', 'ADMIN', 'RECRUITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrgMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('SOURCED', 'SHORTLISTED', 'CONTACTED', 'SCREENING', 'INTERVIEWING', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AssessmentReportStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecommendationLevelV2" AS ENUM ('STRONGLY_RECOMMEND', 'RECOMMEND', 'NEUTRAL', 'DO_NOT_RECOMMEND');

-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "Certificate_userId_fkey";

-- DropForeignKey
ALTER TABLE "SynergyEvent" DROP CONSTRAINT "SynergyEvent_userId_fkey";

-- DropForeignKey
ALTER TABLE "RecruiterShortlistItem" DROP CONSTRAINT "RecruiterShortlistItem_memberId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "createdByAdminId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "HackathonRemoval" ALTER COLUMN "removedByUserId" DROP NOT NULL;

-- Orphan actor ids are nulled (not deleted) BEFORE FKs are added (plan 078 §7 Phase 1).
UPDATE "Job" SET "createdByAdminId" = NULL
 WHERE "createdByAdminId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = "Job"."createdByAdminId");

UPDATE "RecruiterProfile" SET "approvedByAdminId" = NULL
 WHERE "approvedByAdminId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = "RecruiterProfile"."approvedByAdminId");

UPDATE "Notification" SET "createdByAdminId" = NULL
 WHERE "createdByAdminId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = "Notification"."createdByAdminId");

UPDATE "HackathonRemoval" SET "removedByUserId" = NULL
 WHERE "removedByUserId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = "HackathonRemoval"."removedByUserId");

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "scopeType" "RoleScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scopeId" TEXT,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "primaryPersona" "CandidatePersona" NOT NULL DEFAULT 'STUDENT',
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerifiedAt" TIMESTAMP(3),
    "locationCity" TEXT,
    "locationRegion" TEXT,
    "countryCode" CHAR(2),
    "linkedinUrl" TEXT,
    "githubUsername" TEXT,
    "portfolioUrl" TEXT,
    "resumeUrl" TEXT,
    "referralCode" TEXT NOT NULL,
    "isReadyForInterview" BOOLEAN NOT NULL DEFAULT false,
    "isCampusAmbassadorCandidate" BOOLEAN NOT NULL DEFAULT false,
    "ambassadorAppliedAt" TIMESTAMP(3),
    "ambassadorDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateVisibility" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "searchableByRecruiters" BOOLEAN NOT NULL DEFAULT false,
    "showEmail" BOOLEAN NOT NULL DEFAULT false,
    "showPhone" BOOLEAN NOT NULL DEFAULT false,
    "showResume" BOOLEAN NOT NULL DEFAULT false,
    "showLinkedin" BOOLEAN NOT NULL DEFAULT true,
    "showGithub" BOOLEAN NOT NULL DEFAULT true,
    "showAssessmentScores" BOOLEAN NOT NULL DEFAULT false,
    "showInterviewResults" BOOLEAN NOT NULL DEFAULT false,
    "showCurrentEmployer" BOOLEAN NOT NULL DEFAULT true,
    "consentSource" TEXT,
    "consentedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEducation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "collegeId" TEXT,
    "degree" TEXT,
    "fieldOfStudy" TEXT,
    "startYear" INTEGER,
    "graduationYear" INTEGER,
    "grade" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateExperience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "organizationId" TEXT,
    "title" TEXT NOT NULL,
    "employmentType" TEXT,
    "locationCity" TEXT,
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "totalMonths" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProjectEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "repoUrl" TEXT,
    "liveUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProjectEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCertification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "credentialUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openToWork" BOOLEAN NOT NULL DEFAULT false,
    "availableFrom" DATE,
    "noticePeriodDays" INTEGER,
    "preferredRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "willingToRelocate" BOOLEAN NOT NULL DEFAULT false,
    "remotePreference" TEXT,
    "expectedSalaryMin" INTEGER,
    "expectedSalaryMax" INTEGER,
    "salaryCurrency" CHAR(3),
    "currentSalary" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SkillCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "selfRated" "SkillProficiency",
    "evidenceScore" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastEvidenceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillEvidence" (
    "id" TEXT NOT NULL,
    "candidateSkillId" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "score" INTEGER,
    "maxScore" INTEGER,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colorToken" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgram" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "format" "ProgramFormat" NOT NULL DEFAULT 'COHORT',
    "heroImageUrl" TEXT,
    "cardImageUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramVersion" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ProgramVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedDurationDays" INTEGER,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "requiredActivityCount" INTEGER NOT NULL DEFAULT 0,
    "changelog" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "programVersionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMode" "CohortStartMode" NOT NULL DEFAULT 'FIXED',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "CohortStatus" NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER,
    "joinCode" TEXT,
    "requiresJoinCode" BOOLEAN NOT NULL DEFAULT false,
    "enrollmentOpensAt" TIMESTAMP(3),
    "enrollmentClosesAt" TIMESTAMP(3),
    "resultsPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "programVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "colorToken" TEXT,
    "startDay" INTEGER,
    "endDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "dayNumber" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "unlockRule" "ActivityUnlockRule" NOT NULL DEFAULT 'SEQUENTIAL',
    "maxAttempts" INTEGER,
    "dueOffsetDays" INTEGER,
    "estimatedMinutes" INTEGER,
    "difficulty" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verificationSpec" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityPrerequisite" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "requiresActivityId" TEXT NOT NULL,

    CONSTRAINT "ActivityPrerequisite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingActivityConfig" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "starterCode" TEXT,
    "setupSql" TEXT,
    "solutionCode" TEXT,
    "timeLimitSec" INTEGER,
    "memoryLimitMb" INTEGER,

    CONSTRAINT "CodingActivityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizActivityConfig" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "passMark" INTEGER NOT NULL DEFAULT 60,
    "sampleSize" INTEGER,
    "shuffle" BOOLEAN NOT NULL DEFAULT true,
    "timeLimitSec" INTEGER,
    "showExplanations" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuizActivityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivityConfig" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "briefMarkdown" TEXT NOT NULL,
    "requiresRepo" BOOLEAN NOT NULL DEFAULT true,
    "requiresWriteup" BOOLEAN NOT NULL DEFAULT true,
    "rubricJson" JSONB,
    "aiGradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxScore" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "ProjectActivityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentActivityConfig" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "bodyMarkdown" TEXT,
    "contentJson" JSONB,
    "assetsJson" JSONB,
    "videoProvider" TEXT,
    "videoRef" TEXT,
    "videoDurationMin" INTEGER,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ContentActivityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSubmissionConfig" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "requiresGithubUrl" BOOLEAN NOT NULL DEFAULT false,
    "requiresLinkedinUrl" BOOLEAN NOT NULL DEFAULT false,
    "requiresLiveUrl" BOOLEAN NOT NULL DEFAULT false,
    "enforceGlobalUrlUniqueness" BOOLEAN NOT NULL DEFAULT true,
    "linkedinTemplate" TEXT,
    "solutionApproach" TEXT,

    CONSTRAINT "ExternalSubmissionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySkill" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ActivitySkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramSkill" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "ProgramSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "status" "EnrollmentStatusV2" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "githubRepoUrl" TEXT,
    "unlockFloorDay" INTEGER,
    "skipTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentProgress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "completedActivities" INTEGER NOT NULL DEFAULT 0,
    "totalActivities" INTEGER NOT NULL DEFAULT 0,
    "percentCompleteBp" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsPossible" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "currentActivityId" TEXT,
    "nextActivityId" TEXT,
    "unlockedThroughPosition" INTEGER NOT NULL DEFAULT 0,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityAttempt" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "lateness" "AttemptLateness" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "payload" JSONB,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvaluation" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "evaluatorType" "EvaluatorType" NOT NULL,
    "evaluatorUserId" TEXT,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "maxScore" INTEGER,
    "detailJson" JSONB,
    "feedback" TEXT,
    "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentDayActivity" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "activityDate" DATE NOT NULL,
    "source" "DayActivitySource" NOT NULL DEFAULT 'SUBMISSION',
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EnrollmentDayActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "sourceType" "CredentialSourceType" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ISSUED',
    "title" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "metadata" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reconciledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" "PointsSourceType" NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "AchievementSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "outcomeLabel" TEXT,
    "outcomeValue" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "industry" TEXT,
    "sizeBucket" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgMemberRole" NOT NULL DEFAULT 'RECRUITER',
    "status" "OrgMemberStatus" NOT NULL DEFAULT 'INVITED',
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerRecruiterId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSharedWithOrg" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentListItem" (
    "id" TEXT NOT NULL,
    "talentListId" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "candidateLabel" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'SHORTLISTED',
    "addedByUserId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentReport" (
    "id" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AssessmentReportStatus" NOT NULL DEFAULT 'DRAFT',
    "recommendation" "RecommendationLevelV2",
    "summary" TEXT,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areasForGrowth" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessorName" TEXT,
    "assessedByUserId" TEXT,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentScore" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "skillId" TEXT,
    "score" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentReportShare" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRoleAssignment_userId_revokedAt_idx" ON "UserRoleAssignment"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_role_scopeType_scopeId_idx" ON "UserRoleAssignment"("role", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_grantedByUserId_idx" ON "UserRoleAssignment"("grantedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_referralCode_key" ON "CandidateProfile"("referralCode");

-- CreateIndex
CREATE INDEX "CandidateProfile_locationCity_countryCode_idx" ON "CandidateProfile"("locationCity", "countryCode");

-- CreateIndex
CREATE INDEX "CandidateProfile_isReadyForInterview_idx" ON "CandidateProfile"("isReadyForInterview");

-- CreateIndex
CREATE INDEX "CandidateProfile_updatedAt_idx" ON "CandidateProfile"("updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateVisibility_userId_key" ON "CandidateVisibility"("userId");

-- CreateIndex
CREATE INDEX "CandidateVisibility_searchableByRecruiters_updatedAt_idx" ON "CandidateVisibility"("searchableByRecruiters", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "CandidateEducation_userId_sortOrder_idx" ON "CandidateEducation"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "CandidateEducation_graduationYear_idx" ON "CandidateEducation"("graduationYear");

-- CreateIndex
CREATE INDEX "CandidateEducation_collegeId_idx" ON "CandidateEducation"("collegeId");

-- CreateIndex
CREATE INDEX "CandidateExperience_userId_startedOn_idx" ON "CandidateExperience"("userId", "startedOn" DESC);

-- CreateIndex
CREATE INDEX "CandidateExperience_isCurrent_totalMonths_idx" ON "CandidateExperience"("isCurrent", "totalMonths" DESC);

-- CreateIndex
CREATE INDEX "CandidateExperience_organizationId_idx" ON "CandidateExperience"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateProjectEntry_userId_sortOrder_idx" ON "CandidateProjectEntry"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "CandidateCertification_userId_idx" ON "CandidateCertification"("userId");

-- CreateIndex
CREATE INDEX "CandidateCertification_issuer_idx" ON "CandidateCertification"("issuer");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePreference_userId_key" ON "CandidatePreference"("userId");

-- CreateIndex
CREATE INDEX "CandidatePreference_openToWork_availableFrom_idx" ON "CandidatePreference"("openToWork", "availableFrom");

-- CreateIndex
CREATE UNIQUE INDEX "SkillCategory_slug_key" ON "SkillCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- CreateIndex
CREATE INDEX "Skill_categoryId_name_idx" ON "Skill"("categoryId", "name");

-- CreateIndex
CREATE INDEX "Skill_isActive_idx" ON "Skill"("isActive");

-- CreateIndex
CREATE INDEX "CandidateSkill_skillId_evidenceScore_idx" ON "CandidateSkill"("skillId", "evidenceScore" DESC);

-- CreateIndex
CREATE INDEX "CandidateSkill_skillId_verified_idx" ON "CandidateSkill"("skillId", "verified");

-- CreateIndex
CREATE INDEX "CandidateSkill_userId_evidenceScore_idx" ON "CandidateSkill"("userId", "evidenceScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSkill_userId_skillId_key" ON "CandidateSkill"("userId", "skillId");

-- CreateIndex
CREATE INDEX "SkillEvidence_candidateSkillId_occurredAt_idx" ON "SkillEvidence"("candidateSkillId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "SkillEvidence_sourceType_sourceId_idx" ON "SkillEvidence"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillEvidence_candidateSkillId_sourceType_sourceId_key" ON "SkillEvidence"("candidateSkillId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramCategory_slug_key" ON "ProgramCategory"("slug");

-- CreateIndex
CREATE INDEX "ProgramCategory_isActive_sortOrder_idx" ON "ProgramCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgram_slug_key" ON "LearningProgram"("slug");

-- CreateIndex
CREATE INDEX "LearningProgram_categoryId_isPublished_idx" ON "LearningProgram"("categoryId", "isPublished");

-- CreateIndex
CREATE INDEX "LearningProgram_isPublished_sortOrder_idx" ON "LearningProgram"("isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "ProgramVersion_programId_status_idx" ON "ProgramVersion"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramVersion_programId_versionNumber_key" ON "ProgramVersion"("programId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_slug_key" ON "Cohort"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_joinCode_key" ON "Cohort"("joinCode");

-- CreateIndex
CREATE INDEX "Cohort_programVersionId_status_idx" ON "Cohort"("programVersionId", "status");

-- CreateIndex
CREATE INDEX "Cohort_status_startsAt_idx" ON "Cohort"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Cohort_resultsPublishedAt_idx" ON "Cohort"("resultsPublishedAt" DESC);

-- CreateIndex
CREATE INDEX "Module_programVersionId_idx" ON "Module"("programVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Module_programVersionId_position_key" ON "Module"("programVersionId", "position");

-- CreateIndex
CREATE INDEX "Activity_moduleId_dayNumber_idx" ON "Activity"("moduleId", "dayNumber");

-- CreateIndex
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_moduleId_position_key" ON "Activity"("moduleId", "position");

-- CreateIndex
CREATE INDEX "ActivityPrerequisite_requiresActivityId_idx" ON "ActivityPrerequisite"("requiresActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityPrerequisite_activityId_requiresActivityId_key" ON "ActivityPrerequisite"("activityId", "requiresActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "CodingActivityConfig_activityId_key" ON "CodingActivityConfig"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_configId_sortOrder_key" ON "TestCase"("configId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuizActivityConfig_activityId_key" ON "QuizActivityConfig"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_configId_position_key" ON "Question"("configId", "position");

-- CreateIndex
CREATE INDEX "QuestionOption_questionId_isCorrect_idx" ON "QuestionOption"("questionId", "isCorrect");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_position_key" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectActivityConfig_activityId_key" ON "ProjectActivityConfig"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentActivityConfig_activityId_key" ON "ContentActivityConfig"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSubmissionConfig_activityId_key" ON "ExternalSubmissionConfig"("activityId");

-- CreateIndex
CREATE INDEX "ActivitySkill_skillId_idx" ON "ActivitySkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySkill_activityId_skillId_key" ON "ActivitySkill"("activityId", "skillId");

-- CreateIndex
CREATE INDEX "ProgramSkill_skillId_idx" ON "ProgramSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramSkill_programId_skillId_key" ON "ProgramSkill"("programId", "skillId");

-- CreateIndex
CREATE INDEX "ProgramEnrollment_userId_status_idx" ON "ProgramEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "ProgramEnrollment_cohortId_status_idx" ON "ProgramEnrollment"("cohortId", "status");

-- CreateIndex
CREATE INDEX "ProgramEnrollment_cohortId_enrolledAt_idx" ON "ProgramEnrollment"("cohortId", "enrolledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramEnrollment_userId_cohortId_key" ON "ProgramEnrollment"("userId", "cohortId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentProgress_enrollmentId_key" ON "EnrollmentProgress"("enrollmentId");

-- CreateIndex
CREATE INDEX "EnrollmentProgress_cohortId_pointsEarned_idx" ON "EnrollmentProgress"("cohortId", "pointsEarned" DESC);

-- CreateIndex
CREATE INDEX "EnrollmentProgress_cohortId_percentCompleteBp_idx" ON "EnrollmentProgress"("cohortId", "percentCompleteBp" DESC);

-- CreateIndex
CREATE INDEX "EnrollmentProgress_lastActivityAt_idx" ON "EnrollmentProgress"("lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityAttempt_enrollmentId_submittedAt_idx" ON "ActivityAttempt"("enrollmentId", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityAttempt_activityId_passed_idx" ON "ActivityAttempt"("activityId", "passed");

-- CreateIndex
CREATE INDEX "ActivityAttempt_enrollmentId_activityId_passed_idx" ON "ActivityAttempt"("enrollmentId", "activityId", "passed");

-- CreateIndex
CREATE INDEX "ActivityAttempt_submittedAt_idx" ON "ActivityAttempt"("submittedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityAttempt_enrollmentId_activityId_attemptNumber_key" ON "ActivityAttempt"("enrollmentId", "activityId", "attemptNumber");

-- CreateIndex
CREATE INDEX "ActivityEvaluation_attemptId_createdAt_idx" ON "ActivityEvaluation"("attemptId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvaluation_evaluatorType_createdAt_idx" ON "ActivityEvaluation"("evaluatorType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvaluation_evaluatorUserId_idx" ON "ActivityEvaluation"("evaluatorUserId");

-- CreateIndex
CREATE INDEX "EnrollmentDayActivity_enrollmentId_activityDate_idx" ON "EnrollmentDayActivity"("enrollmentId", "activityDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentDayActivity_enrollmentId_activityDate_source_key" ON "EnrollmentDayActivity"("enrollmentId", "activityDate", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_credentialId_key" ON "Credential"("credentialId");

-- CreateIndex
CREATE INDEX "Credential_userId_status_idx" ON "Credential"("userId", "status");

-- CreateIndex
CREATE INDEX "Credential_sourceType_sourceKey_idx" ON "Credential"("sourceType", "sourceKey");

-- CreateIndex
CREATE INDEX "Credential_issuedAt_idx" ON "Credential"("issuedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_type_sourceType_sourceKey_key" ON "Credential"("type", "sourceType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "PointsAccount_userId_key" ON "PointsAccount"("userId");

-- CreateIndex
CREATE INDEX "PointsAccount_balance_idx" ON "PointsAccount"("balance" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_idempotencyKey_key" ON "PointsTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointsTransaction_userId_createdAt_idx" ON "PointsTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PointsTransaction_sourceType_sourceId_idx" ON "PointsTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PointsTransaction_createdAt_idx" ON "PointsTransaction"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "CandidateAchievement_userId_occurredAt_idx" ON "CandidateAchievement"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "CandidateAchievement_userId_isPublic_idx" ON "CandidateAchievement"("userId", "isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAchievement_sourceType_sourceId_key" ON "CandidateAchievement"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_isVerified_idx" ON "Organization"("isVerified");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_status_idx" ON "OrganizationMember"("userId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_role_idx" ON "OrganizationMember"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "TalentList_ownerRecruiterId_idx" ON "TalentList"("ownerRecruiterId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentList_organizationId_name_key" ON "TalentList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TalentListItem_talentListId_stage_addedAt_idx" ON "TalentListItem"("talentListId", "stage", "addedAt" DESC);

-- CreateIndex
CREATE INDEX "TalentListItem_candidateUserId_idx" ON "TalentListItem"("candidateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentListItem_talentListId_candidateUserId_key" ON "TalentListItem"("talentListId", "candidateUserId");

-- CreateIndex
CREATE INDEX "CandidateNote_organizationId_candidateUserId_createdAt_idx" ON "CandidateNote"("organizationId", "candidateUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CandidateNote_authorUserId_idx" ON "CandidateNote"("authorUserId");

-- CreateIndex
CREATE INDEX "JobSkill_skillId_idx" ON "JobSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSkill_jobId_skillId_key" ON "JobSkill"("jobId", "skillId");

-- CreateIndex
CREATE INDEX "AssessmentReport_candidateUserId_assessedAt_idx" ON "AssessmentReport"("candidateUserId", "assessedAt" DESC);

-- CreateIndex
CREATE INDEX "AssessmentReport_status_assessedAt_idx" ON "AssessmentReport"("status", "assessedAt" DESC);

-- CreateIndex
CREATE INDEX "AssessmentScore_dimension_score_idx" ON "AssessmentScore"("dimension", "score" DESC);

-- CreateIndex
CREATE INDEX "AssessmentScore_skillId_score_idx" ON "AssessmentScore"("skillId", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentScore_reportId_dimension_key" ON "AssessmentScore"("reportId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentReportShare_token_key" ON "AssessmentReportShare"("token");

-- CreateIndex
CREATE INDEX "AssessmentReportShare_reportId_revokedAt_idx" ON "AssessmentReportShare"("reportId", "revokedAt");

-- CreateIndex
CREATE INDEX "User_deletedAt_createdAt_idx" ON "User"("deletedAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynergyEvent" ADD CONSTRAINT "SynergyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterProfile" ADD CONSTRAINT "RecruiterProfile_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterShortlistItem" ADD CONSTRAINT "RecruiterShortlistItem_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProgramMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HackathonRemoval" ADD CONSTRAINT "HackathonRemoval_removedByUserId_fkey" FOREIGN KEY ("removedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateVisibility" ADD CONSTRAINT "CandidateVisibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateExperience" ADD CONSTRAINT "CandidateExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateExperience" ADD CONSTRAINT "CandidateExperience_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProjectEntry" ADD CONSTRAINT "CandidateProjectEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePreference" ADD CONSTRAINT "CandidatePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SkillCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CandidateProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillEvidence" ADD CONSTRAINT "SkillEvidence_candidateSkillId_fkey" FOREIGN KEY ("candidateSkillId") REFERENCES "CandidateSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgram" ADD CONSTRAINT "LearningProgram_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProgramCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVersion" ADD CONSTRAINT "ProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityPrerequisite" ADD CONSTRAINT "ActivityPrerequisite_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityPrerequisite" ADD CONSTRAINT "ActivityPrerequisite_requiresActivityId_fkey" FOREIGN KEY ("requiresActivityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingActivityConfig" ADD CONSTRAINT "CodingActivityConfig_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_configId_fkey" FOREIGN KEY ("configId") REFERENCES "CodingActivityConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizActivityConfig" ADD CONSTRAINT "QuizActivityConfig_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_configId_fkey" FOREIGN KEY ("configId") REFERENCES "QuizActivityConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivityConfig" ADD CONSTRAINT "ProjectActivityConfig_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentActivityConfig" ADD CONSTRAINT "ContentActivityConfig_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmissionConfig" ADD CONSTRAINT "ExternalSubmissionConfig_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySkill" ADD CONSTRAINT "ActivitySkill_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySkill" ADD CONSTRAINT "ActivitySkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSkill" ADD CONSTRAINT "ProgramSkill_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSkill" ADD CONSTRAINT "ProgramSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEnrollment" ADD CONSTRAINT "ProgramEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEnrollment" ADD CONSTRAINT "ProgramEnrollment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentProgress" ADD CONSTRAINT "EnrollmentProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ProgramEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityAttempt" ADD CONSTRAINT "ActivityAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ProgramEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityAttempt" ADD CONSTRAINT "ActivityAttempt_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvaluation" ADD CONSTRAINT "ActivityEvaluation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ActivityAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvaluation" ADD CONSTRAINT "ActivityEvaluation_evaluatorUserId_fkey" FOREIGN KEY ("evaluatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentDayActivity" ADD CONSTRAINT "EnrollmentDayActivity_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ProgramEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAchievement" ADD CONSTRAINT "CandidateAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentList" ADD CONSTRAINT "TalentList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentList" ADD CONSTRAINT "TalentList_ownerRecruiterId_fkey" FOREIGN KEY ("ownerRecruiterId") REFERENCES "RecruiterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentListItem" ADD CONSTRAINT "TalentListItem_talentListId_fkey" FOREIGN KEY ("talentListId") REFERENCES "TalentList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentListItem" ADD CONSTRAINT "TalentListItem_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReport" ADD CONSTRAINT "AssessmentReport_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AssessmentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReportShare" ADD CONSTRAINT "AssessmentReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AssessmentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- I10: progress cache must never exceed its denominator.
ALTER TABLE "EnrollmentProgress"
  ADD CONSTRAINT "EnrollmentProgress_completed_lte_total_check"
  CHECK ("completedActivities" <= "totalActivities");

ALTER TABLE "EnrollmentProgress"
  ADD CONSTRAINT "EnrollmentProgress_percent_bp_check"
  CHECK ("percentCompleteBp" >= 0 AND "percentCompleteBp" <= 10000);

-- Prisma cannot express GIN / pg_trgm / partial unique indexes (plan 078 §10.3).
-- CONCURRENTLY is omitted: Prisma migrations run inside a transaction.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX candidate_profile_fullname_trgm
  ON "CandidateProfile" USING gin ("fullName" gin_trgm_ops);

CREATE INDEX candidate_profile_headline_trgm
  ON "CandidateProfile" USING gin ("headline" gin_trgm_ops);

CREATE INDEX candidate_education_institution_trgm
  ON "CandidateEducation" USING gin ("institutionName" gin_trgm_ops);

CREATE INDEX organization_name_trgm
  ON "Organization" USING gin (name gin_trgm_ops);

CREATE INDEX skill_aliases_gin
  ON "Skill" USING gin (aliases);

CREATE INDEX college_searchtext_trgm
  ON "College" USING gin ("searchText" gin_trgm_ops);

CREATE UNIQUE INDEX activity_eval_one_authoritative
  ON "ActivityEvaluation"("attemptId") WHERE "isAuthoritative";

CREATE UNIQUE INDEX attempt_github_url_unique
  ON "ActivityAttempt"((payload->>'githubUrl'))
  WHERE payload->>'githubUrl' IS NOT NULL;

CREATE UNIQUE INDEX role_assignment_active_unique
  ON "UserRoleAssignment"("userId", role, "scopeType", COALESCE("scopeId", ''))
  WHERE "revokedAt" IS NULL;

CREATE INDEX candidate_visibility_searchable
  ON "CandidateVisibility"("updatedAt" DESC) WHERE "searchableByRecruiters";
