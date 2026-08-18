-- Synergy is an account-level wallet. SynergyEvent remains the source of truth.
ALTER TABLE "User"
ADD COLUMN "synergyPoints" INTEGER NOT NULL DEFAULT 0;

-- Preserve every challenge user's visible pre-migration balance while making
-- the ledger authoritative. Existing drift came from historical reset/delete
-- paths that removed submission events without reversing the profile balance.
WITH ledger AS (
  SELECT
    "userId",
    COALESCE(SUM("points"), 0)::BIGINT AS "totalPoints"
  FROM "SynergyEvent"
  GROUP BY "userId"
)
INSERT INTO "SynergyEvent" (
  "id",
  "userId",
  "points",
  "type",
  "reason"
)
SELECT
  'synergy-wallet-backfill-' || profile."userId",
  profile."userId",
  (profile."synergyPoints"::BIGINT - COALESCE(ledger."totalPoints", 0))::INTEGER,
  'BALANCE_RECONCILIATION',
  'Preserved the pre-migration challenge balance when Synergy moved to the User account.'
FROM "StudentProfile" AS profile
LEFT JOIN ledger ON ledger."userId" = profile."userId"
WHERE profile."synergyPoints"::BIGINT <> COALESCE(ledger."totalPoints", 0)
ON CONFLICT ("id") DO NOTHING;

UPDATE "User" AS account
SET "synergyPoints" = ledger."totalPoints"
FROM (
  SELECT
    "userId",
    COALESCE(SUM("points"), 0)::INTEGER AS "totalPoints"
  FROM "SynergyEvent"
  GROUP BY "userId"
) AS ledger
WHERE account."id" = ledger."userId";

CREATE INDEX "User_synergyPoints_idx"
ON "User"("synergyPoints" DESC);
