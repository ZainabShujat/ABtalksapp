import { prisma } from "@/lib/db";
import {
  findChallengeEnrollment,
  getQuizDefinition,
} from "@/repositories/learning";

export type QuizQuestionPublic = {
  id: string;
  questionOrder: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer?: string;
  explanation?: string;
};

export type QuizWithQuestionsPayload = {
  quiz: {
    id: string;
    weekNumber: number;
    title: string;
    domain: string;
  };
  questions: QuizQuestionPublic[];
  existingAttempt: {
    id: string;
    score: number;
    answers: Record<string, string>;
    attemptedAt: Date;
  } | null;
};

async function remapAttemptAnswers(
  quizId: string,
  questions: QuizQuestionPublic[],
  answers: Record<string, string>,
): Promise<Record<string, string>> {
  const ids = new Set(questions.map((q) => q.id));
  const alreadyAligned = Object.keys(answers).every((key) => ids.has(key));
  if (alreadyAligned) return answers;

  const legacy = await prisma.quizQuestion.findMany({
    where: { quizId },
    select: { id: true, questionOrder: true },
  });
  const byOrder = new Map(questions.map((q) => [q.questionOrder, q.id]));
  const remapped: Record<string, string> = {};
  for (const row of legacy) {
    const nextId = byOrder.get(row.questionOrder);
    const value = answers[row.id];
    if (nextId && value) remapped[nextId] = value;
  }
  return Object.keys(remapped).length > 0 ? remapped : answers;
}

export async function getQuizWithQuestions(
  quizId: string,
  userId: string,
): Promise<QuizWithQuestionsPayload | null> {
  const quiz = await getQuizDefinition(quizId);
  if (!quiz) return null;

  const enrollment = await findChallengeEnrollment(userId, {
    domain: quiz.domain,
    excludeAbandoned: true,
  });
  if (!enrollment) return null;

  const existingAttempt = await prisma.quizAttempt.findUnique({
    where: {
      userId_quizId: { userId, quizId },
    },
    select: {
      id: true,
      score: true,
      answers: true,
      attemptedAt: true,
    },
  });

  const revealSolutions = existingAttempt !== null;
  const questions: QuizQuestionPublic[] = quiz.questions.map((q) => ({
    id: q.id,
    questionOrder: q.questionOrder,
    questionText: q.questionText,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    ...(revealSolutions
      ? { correctAnswer: q.correctAnswer, explanation: q.explanation }
      : {}),
  }));

  const remappedAnswers = existingAttempt
    ? await remapAttemptAnswers(
        quizId,
        questions,
        existingAttempt.answers as Record<string, string>,
      )
    : null;

  return {
    quiz: {
      id: quiz.id,
      weekNumber: quiz.weekNumber,
      title: quiz.title,
      domain: quiz.domain,
    },
    questions,
    existingAttempt: existingAttempt
      ? {
          id: existingAttempt.id,
          score: existingAttempt.score,
          answers: remappedAnswers ?? {},
          attemptedAt: existingAttempt.attemptedAt,
        }
      : null,
  };
}
