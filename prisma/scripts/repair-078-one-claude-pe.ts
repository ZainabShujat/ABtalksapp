/**
 * Repair the one known Claude Enrollment.COMPLETED / ProgramEnrollment.ACTIVE
 * mismatch. Does not backfill. Requires --apply plus PHASE2_ALLOW_PRODUCTION=1
 * and the production direct URL.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function main() {
  assertChildBranch();
  const apply = process.argv.includes("--apply");

  const mismatches = await prisma.$queryRaw<
    {
      enrollmentId: string;
      peId: string;
      domain: string;
      enrollmentStatus: string;
      peStatus: string;
      completedAt: Date | null;
    }[]
  >`
    SELECT e.id AS "enrollmentId",
           pe.id AS "peId",
           e.domain::text AS domain,
           e.status::text AS "enrollmentStatus",
           pe.status::text AS "peStatus",
           e."completedAt" AS "completedAt"
    FROM "Enrollment" e
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    WHERE pe.status::text <> CASE e.status::text
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'ABANDONED' THEN 'DROPPED'
      ELSE 'ACTIVE'
    END
  `;

  console.log(JSON.stringify({ mismatchCount: mismatches.length, mismatches }, null, 2));

  if (mismatches.length !== 1) {
    throw new Error(
      `Expected exactly one status mismatch, found ${mismatches.length}. Refusing to repair.`,
    );
  }

  const row = mismatches[0]!;
  if (
    row.domain !== "CLAUDE" ||
    row.enrollmentStatus !== "COMPLETED" ||
    row.peStatus !== "ACTIVE"
  ) {
    throw new Error(
      `Mismatch is not the known Claude COMPLETED/ACTIVE case: ${JSON.stringify(row)}`,
    );
  }

  if (!apply) {
    console.log("Dry run. Pass --apply to update that one ProgramEnrollment row.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const legacy = await tx.enrollment.findUnique({
      where: { id: row.enrollmentId },
      select: { id: true, status: true, completedAt: true, domain: true },
    });
    if (
      !legacy ||
      legacy.domain !== "CLAUDE" ||
      legacy.status !== "COMPLETED"
    ) {
      throw new Error(
        `Preflight failed: legacy Enrollment ${row.enrollmentId} is no longer CLAUDE COMPLETED.`,
      );
    }

    const updated = await tx.programEnrollment.updateMany({
      where: {
        id: row.peId,
        status: "ACTIVE",
      },
      data: {
        status: "COMPLETED",
        completedAt: legacy.completedAt,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        `Expected to update 1 ProgramEnrollment, updated ${updated.count}`,
      );
    }
    return { peId: row.peId, completedAt: legacy.completedAt };
  });

  const remaining = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "Enrollment" e
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    WHERE pe.status::text <> CASE e.status::text
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'ABANDONED' THEN 'DROPPED'
      ELSE 'ACTIVE'
    END
  `;
  const remainingN = remaining[0]?.n ?? -1;
  if (remainingN !== 0) {
    throw new Error(`Post-repair challenge status drift is ${remainingN}, expected 0`);
  }

  console.log(JSON.stringify({ repaired: result, remainingDrift: remainingN }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
