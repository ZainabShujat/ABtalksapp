"use client";

import type { QuizWithQuestionsPayload } from "@/features/quiz/get-quiz-with-questions";
import { QuizResultsDisplay } from "./quiz-results-display";

type QuestionWithSolution = QuizWithQuestionsPayload["questions"][number] & {
  correctAnswer: string;
  explanation: string;
};

type Props = {
  quiz: QuizWithQuestionsPayload["quiz"];
  questions: QuestionWithSolution[];
  existingAttempt: NonNullable<QuizWithQuestionsPayload["existingAttempt"]>;
};

export function ResultsView({ quiz, questions, existingAttempt }: Props) {
  return (
    <QuizResultsDisplay
      quiz={quiz}
      questions={questions}
      userAnswers={existingAttempt.answers}
      score={existingAttempt.score}
      answersDetailAvailable={existingAttempt.answersDetailAvailable}
    />
  );
}
