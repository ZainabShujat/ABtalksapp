import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  findChallengeEnrollment,
  getQuizDefinition,
} from "@/repositories/learning";

export type QuizSubmitResultRow = {
  questionId: string;
  userAnswer: "A" | "B" | "C" | "D";
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
};

export type SubmitQuizOk = {
  ok: true;
  score: number;
  results: QuizSubmitResultRow[];
};

export type SubmitQuizErr = {
  ok: false;
  message: string;
};

export type SubmitQuizResult = SubmitQuizOk | SubmitQuizErr;

export async function submitQuiz(input: {
  userId: string;
  quizId: string;
  answers: Record<string, "A" | "B" | "C" | "D">;
}): Promise<SubmitQuizResult> {
  const { userId, quizId, answers } = input;

  const existing = await prisma.quizAttempt.findUnique({
    where: {
      userId_quizId: { userId, quizId },
    },
    select: { id: true },
  });

  if (existing) {
    return { ok: false, message: "Quiz already submitted" };
  }

  const quiz = await getQuizDefinition(quizId);
  if (!quiz) {
    return { ok: false, message: "Quiz not found" };
  }

  const enrollment = await findChallengeEnrollment(userId, {
    domain: quiz.domain,
    excludeAbandoned: true,
  });
  if (!enrollment) {
    return { ok: false, message: "No enrollment for this quiz" };
  }

  const questions = quiz.questions;
  if (questions.length === 0) {
    return { ok: false, message: "Quiz has no questions" };
  }

  for (const q of questions) {
    const a = answers[q.id];
    if (!a || !["A", "B", "C", "D"].includes(a)) {
      return { ok: false, message: "Missing or invalid answer for a question" };
    }
  }

  let score = 0;
  const results: QuizSubmitResultRow[] = questions.map((q) => {
    const userAnswer = answers[q.id]!;
    const isCorrect = userAnswer === q.correctAnswer;
    if (isCorrect) score += 1;
    return {
      questionId: q.id,
      userAnswer,
      correctAnswer: q.correctAnswer,
      isCorrect,
      explanation: q.explanation,
    };
  });

  await prisma.quizAttempt.create({
    data: {
      userId,
      quizId,
      score,
      answers: answers as Prisma.InputJsonValue,
    },
  });

  return { ok: true, score, results };
}
