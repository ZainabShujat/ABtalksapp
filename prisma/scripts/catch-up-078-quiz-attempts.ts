/**
 * Targeted catch-up: QuizAttempt rows with no aa_qa_* / ev_qa_* dual-write.
 * Does not rewrite answer blobs. Does not touch EnrollmentProgress.
 *
 * PHASE2_ALLOW_PRODUCTION=1 + direct URL required for production.
 */
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";
import { dualWriteQuizAttempt } from "../../src/repositories/dual-write";

config({ path: ".env.local" });
config();

process.env.ENABLE_DUAL_WRITE = "true";

const prisma = new PrismaClient();

async function main() {
  assertChildBranch();

  const missing = await prisma.$queryRaw<
    Array<{
      id: string;
      userId: string;
      quizId: string;
      score: number;
      answers: Prisma.JsonValue;
      attemptedAt: Date;
      challengeId: string;
    }>
  >`
    SELECT qa.id, qa."userId", qa."quizId", qa.score, qa.answers, qa."attemptedAt",
           q."challengeId"
    FROM "QuizAttempt" qa
    JOIN "Quiz" q ON q.id = qa."quizId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "ActivityAttempt" a WHERE a.id = 'aa_qa_' || qa.id
    )
    ORDER BY qa."attemptedAt" ASC
  `;

  console.log(`missing quiz attempts: ${missing.length}`);
  if (missing.length === 0) return;

  let written = 0;
  let skipped = 0;
  for (const row of missing) {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        userId: row.userId,
        challengeId: row.challengeId,
        status: { not: "ABANDONED" },
      },
      select: { id: true },
      orderBy: { startedAt: "desc" },
    });
    if (!enrollment) {
      skipped += 1;
      console.warn(`skip ${row.id}: no enrollment for challenge`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await dualWriteQuizAttempt(tx, {
        id: row.id,
        enrollmentId: enrollment.id,
        quizId: row.quizId,
        score: row.score,
        answers: row.answers as Prisma.InputJsonValue,
        attemptedAt: row.attemptedAt,
      });
    });
    written += 1;
  }

  console.log(`written=${written} skipped=${skipped}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
