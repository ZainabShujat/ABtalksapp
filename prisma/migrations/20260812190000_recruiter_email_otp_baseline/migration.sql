-- Baseline for RecruiterEmailOtp.
--
-- The table already exists in the shared database: migration
-- 20260810100124_recruiter_email_otp created it, but that migration's folder
-- and its application code are in no branch of either repo. This file brings
-- the schema under version control without touching the live table, so it is a
-- no-op where the table exists and correct on a fresh database.
--
-- Written by hand rather than generated: `prisma migrate dev` would emit a bare
-- CREATE TABLE and fail against the database this is meant to describe.

CREATE TABLE IF NOT EXISTS "RecruiterEmailOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruiterEmailOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecruiterEmailOtp_email_idx" ON "RecruiterEmailOtp"("email");
CREATE INDEX IF NOT EXISTS "RecruiterEmailOtp_expiresAt_idx" ON "RecruiterEmailOtp"("expiresAt");
