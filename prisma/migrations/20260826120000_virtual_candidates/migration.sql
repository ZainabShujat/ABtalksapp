-- Virtual candidates: a recruiter requirement the pool could not answer,
-- kept as a profile so an empty search reads as "we will source this" rather
-- than "we cannot do this".
--
-- Additive only. No existing table is altered, no row is rewritten, and every
-- foreign key onto an existing table is nullable with ON DELETE SET NULL, so
-- this migration cannot cascade a delete into anything that already exists.

CREATE TYPE "VirtualCandidateStatus" AS ENUM (
  'AVAILABLE_ON_REQUEST', 'REQUESTED', 'SOURCING', 'CANDIDATE_FOUND',
  'FULFILLED', 'EXPIRED', 'CANCELLED'
);

CREATE TYPE "VirtualCandidateRequestStatus" AS ENUM (
  'REQUESTED', 'SOURCING', 'CANDIDATE_FOUND', 'CANDIDATE_SHARED',
  'FULFILLED', 'CANCELLED', 'EXPIRED'
);

CREATE TABLE "VirtualCandidate" (
  "id" TEXT NOT NULL,
  "fingerprintKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "roleFamily" TEXT NOT NULL,
  "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "preferredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "experienceMin" INTEGER,
  "experienceMax" INTEGER,
  "locationLabel" TEXT,
  "employmentType" "TalentEmploymentType",
  "availabilityRequirement" TEXT,
  "educationRequirement" TEXT,
  "status" "VirtualCandidateStatus" NOT NULL DEFAULT 'AVAILABLE_ON_REQUEST',
  "originRequestId" TEXT,
  "convertedCandidateUserId" TEXT,
  "adminNotes" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  CONSTRAINT "VirtualCandidate_pkey" PRIMARY KEY ("id")
);

-- One profile per distinct requirement. This is what makes demand countable
-- and what stops two recruiters becoming two sourcing jobs.
CREATE UNIQUE INDEX "VirtualCandidate_fingerprintKey_key"
  ON "VirtualCandidate"("fingerprintKey");
CREATE INDEX "VirtualCandidate_status_createdAt_idx"
  ON "VirtualCandidate"("status", "createdAt" DESC);
CREATE INDEX "VirtualCandidate_roleFamily_idx"
  ON "VirtualCandidate"("roleFamily");

CREATE TABLE "VirtualCandidateRequest" (
  "id" TEXT NOT NULL,
  "virtualCandidateId" TEXT NOT NULL,
  "recruiterUserId" TEXT NOT NULL,
  "talentRequestId" TEXT,
  "status" "VirtualCandidateRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "timelineDays" INTEGER,
  "recruiterNote" TEXT,
  "adminNotes" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "assignedAdminId" TEXT,
  "expectedBy" TIMESTAMP(3),
  "linkedCandidateUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "VirtualCandidateRequest_pkey" PRIMARY KEY ("id")
);

-- A second click by the same recruiter on the same requirement is the same
-- ask, not a second sourcing job. Enforced here so no action has to remember.
CREATE UNIQUE INDEX "VirtualCandidateRequest_virtualCandidateId_recruiterUserId_key"
  ON "VirtualCandidateRequest"("virtualCandidateId", "recruiterUserId");
CREATE INDEX "VirtualCandidateRequest_status_createdAt_idx"
  ON "VirtualCandidateRequest"("status", "createdAt" DESC);
CREATE INDEX "VirtualCandidateRequest_recruiterUserId_createdAt_idx"
  ON "VirtualCandidateRequest"("recruiterUserId", "createdAt" DESC);
CREATE INDEX "VirtualCandidateRequest_assignedAdminId_status_idx"
  ON "VirtualCandidateRequest"("assignedAdminId", "status");

CREATE TABLE "VirtualCandidateEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fromStatus" "VirtualCandidateRequestStatus",
  "toStatus" "VirtualCandidateRequestStatus",
  "note" TEXT,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VirtualCandidateEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VirtualCandidateEvent_requestId_createdAt_idx"
  ON "VirtualCandidateEvent"("requestId", "createdAt");

ALTER TABLE "VirtualCandidate"
  ADD CONSTRAINT "VirtualCandidate_originRequestId_fkey"
  FOREIGN KEY ("originRequestId") REFERENCES "TalentRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidate"
  ADD CONSTRAINT "VirtualCandidate_convertedCandidateUserId_fkey"
  FOREIGN KEY ("convertedCandidateUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateRequest"
  ADD CONSTRAINT "VirtualCandidateRequest_virtualCandidateId_fkey"
  FOREIGN KEY ("virtualCandidateId") REFERENCES "VirtualCandidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateRequest"
  ADD CONSTRAINT "VirtualCandidateRequest_recruiterUserId_fkey"
  FOREIGN KEY ("recruiterUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateRequest"
  ADD CONSTRAINT "VirtualCandidateRequest_talentRequestId_fkey"
  FOREIGN KEY ("talentRequestId") REFERENCES "TalentRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateRequest"
  ADD CONSTRAINT "VirtualCandidateRequest_assignedAdminId_fkey"
  FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateRequest"
  ADD CONSTRAINT "VirtualCandidateRequest_linkedCandidateUserId_fkey"
  FOREIGN KEY ("linkedCandidateUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateEvent"
  ADD CONSTRAINT "VirtualCandidateEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "VirtualCandidateRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VirtualCandidateEvent"
  ADD CONSTRAINT "VirtualCandidateEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
