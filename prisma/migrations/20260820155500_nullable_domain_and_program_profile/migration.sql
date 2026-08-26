-- AlterTable
ALTER TABLE "StudentProfile" ALTER COLUMN "domain" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "jobRole" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "company" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "yearsExperience" DROP NOT NULL;
