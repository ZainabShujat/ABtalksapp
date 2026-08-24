-- Plan 078 Phase 2 audit tables. Additive only. Apply on child branch plan-078-phase1.

CREATE TABLE "MigrationRun" (
    "id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "counts" JSONB,
    "error" TEXT,

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MigrationConflict" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "chosenValue" TEXT NOT NULL,
    "rejectedValue" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationConflict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MigrationQuarantine" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationQuarantine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MigrationRun_step_startedAt_idx" ON "MigrationRun"("step", "startedAt" DESC);
CREATE INDEX "MigrationConflict_userId_field_idx" ON "MigrationConflict"("userId", "field");
CREATE INDEX "MigrationConflict_runId_idx" ON "MigrationConflict"("runId");
CREATE INDEX "MigrationQuarantine_sourceTable_sourceId_idx" ON "MigrationQuarantine"("sourceTable", "sourceId");
CREATE INDEX "MigrationQuarantine_runId_idx" ON "MigrationQuarantine"("runId");

ALTER TABLE "MigrationConflict" ADD CONSTRAINT "MigrationConflict_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MigrationQuarantine" ADD CONSTRAINT "MigrationQuarantine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
