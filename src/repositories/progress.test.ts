/**
 * Pure helpers for 078 progress reads (no DB).
 * Run: npm run test:078-progress
 */
import { computeTrackStreakFromOnTimeDays } from "@/features/submission/streak-utils";
import { mapQuizAttemptAnswers } from "@/features/quiz/get-quiz-with-questions";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

suite("track streak is consecutive ON_TIME dayNumbers with today grace", () => {
  const onTime = new Set([1, 2, 3, 5]);
  const { currentStreak, longestStreak } = computeTrackStreakFromOnTimeDays(
    onTime,
    5,
  );
  assert(currentStreak === 1, `current ${currentStreak}`);
  assert(longestStreak === 3, `longest ${longestStreak}`);
});

suite("track streak grace uses yesterday when today is missing", () => {
  const { currentStreak } = computeTrackStreakFromOnTimeDays(
    new Set([1, 2, 3]),
    4,
  );
  assert(currentStreak === 3, `current ${currentStreak}`);
});

suite("quiz answers already on current ids stay mapped", () => {
  const ids = new Set(["q1", "q2"]);
  const result = mapQuizAttemptAnswers({
    currentQuestionIds: ids,
    answers: { q1: "A", q2: "B" },
    legacyByOrder: [],
    currentIdByOrder: new Map([
      [1, "q1"],
      [2, "q2"],
    ]),
  });
  assert(result.answersDetailAvailable, "available");
  assert(result.answers.q1 === "A", "kept");
});

suite("quiz answers remap by catalog order when legacy ids still exist", () => {
  const result = mapQuizAttemptAnswers({
    currentQuestionIds: new Set(["n1", "n2"]),
    answers: { old1: "C", old2: "D" },
    legacyByOrder: [
      { id: "old1", questionOrder: 1 },
      { id: "old2", questionOrder: 2 },
    ],
    currentIdByOrder: new Map([
      [1, "n1"],
      [2, "n2"],
    ]),
  });
  assert(result.answersDetailAvailable, "available");
  assert(result.answers.n1 === "C" && result.answers.n2 === "D", "remapped");
});

suite("orphaned historical quiz keys do not invent per-question highlights", () => {
  const result = mapQuizAttemptAnswers({
    currentQuestionIds: new Set(["n1", "n2"]),
    answers: { deleted1: "A", deleted2: "B" },
    legacyByOrder: [{ id: "other", questionOrder: 1 }],
    currentIdByOrder: new Map([
      [1, "n1"],
      [2, "n2"],
    ]),
  });
  assert(!result.answersDetailAvailable, "unavailable");
  assert(Object.keys(result.answers).length === 0, "no highlights");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
