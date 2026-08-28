import { prisma } from "@/lib/db";
import {
  findChallengeEnrollment,
  getQuizDefinition,
} from "@/repositories/learning";
import { getQuizAttemptForUser } from "@/repositories/progress";

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
    answersDetailAvailable: boolean;
  } | null;
};

export function mapQuizAttemptAnswers(input: {
  currentQuestionIds: Set<string>;
  answers: Record<string, string>;
  legacyByOrder: Array<{ id: string; questionOrder: number }>;
  currentIdByOrder: Map<number, string>;
}): { answers: Record<string, string>; answersDetailAvailable: boolean } {
  const keys = Object.keys(input.answers);
  if (keys.length === 0) {
    return { answers: {}, answersDetailAvailable: false };
  }
  if (keys.every((key) => input.currentQuestionIds.has(key))) {
    return { answers: input.answers, answersDetailAvailable: true };
  }

  const remapped: Record<string, string> = {};
  for (const row of input.legacyByOrder) {
    const nextId = input.currentIdByOrder.get(row.questionOrder);
    const value = input.answers[row.id];
    if (nextId && value) remapped[nextId] = value;
  }
  const remappedKeys = Object.keys(remapped);
  const fullyMapped =
    remappedKeys.length === keys.length &&
    remappedKeys.every((key) => input.currentQuestionIds.has(key));
  if (fullyMapped) {
    return { answers: remapped, answersDetailAvailable: true };
  }
  return { answers: {}, answersDetailAvailable: false };
}

async function remapAttemptAnswers(
  quizId: string,
  questions: QuizQuestionPublic[],
  answers: Record<string, string>,
): Promise<{ answers: Record<string, string>; answersDetailAvailable: boolean }> {
  const currentQuestionIds = new Set(questions.map((q) => q.id));
  const currentIdByOrder = new Map(questions.map((q) => [q.questionOrder, q.id]));
  const already = mapQuizAttemptAnswers({
    currentQuestionIds,
    answers,
    legacyByOrder: [],
    currentIdByOrder,
  });
  if (already.answersDetailAvailable) return already;

  const legacy = await prisma.quizQuestion.findMany({
    where: { quizId },
    select: { id: true, questionOrder: true },
  });
  return mapQuizAttemptAnswers({
    currentQuestionIds,
    answers,
    legacyByOrder: legacy,
    currentIdByOrder,
  });
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

  const existingAttempt = await getQuizAttemptForUser(userId, quizId);

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

  const mapped = existingAttempt
    ? await remapAttemptAnswers(quizId, questions, existingAttempt.answers)
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
          answers: mapped?.answers ?? {},
          attemptedAt: existingAttempt.attemptedAt,
          answersDetailAvailable: mapped?.answersDetailAvailable ?? false,
        }
      : null,
  };
}
