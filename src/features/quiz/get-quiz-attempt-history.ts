import type { Domain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listQuizCatalog } from "@/repositories/learning";

export type QuizHistoryRow = {
  attemptId: string;
  quizId: string;
  weekNumber: number;
  score: number;
  title: string;
};

export async function getQuizAttemptHistory(
  userId: string,
  enrollment: { challengeId: string; domain: Domain },
): Promise<QuizHistoryRow[]> {
  const catalog = await listQuizCatalog(enrollment.domain);
  const quizIds = catalog.map((q) => q.id);
  if (quizIds.length === 0) return [];

  const byId = new Map(catalog.map((q) => [q.id, q]));
  const attempts = await prisma.quizAttempt.findMany({
    where: { userId, quizId: { in: quizIds } },
    select: { id: true, score: true, quizId: true, attemptedAt: true },
    orderBy: { attemptedAt: "desc" },
  });

  return attempts.flatMap((a) => {
    const quiz = byId.get(a.quizId);
    if (!quiz) return [];
    return [
      {
        attemptId: a.id,
        quizId: a.quizId,
        weekNumber: quiz.weekNumber,
        score: a.score,
        title: quiz.title,
      },
    ];
  });
}
