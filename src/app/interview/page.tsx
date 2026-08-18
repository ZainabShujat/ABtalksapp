import { redirect } from "next/navigation";

/**
 * The general (60-day challenge) interview entry point.
 *
 * Not part of V1. Its backend — a candidate context assembled from Enrollment /
 * Submission / DailyTask rows plus a submission-consumption retake rule — was
 * replaced by the AI Cohort milestone model, and the columns it depended on no
 * longer exist. Rather than leave a route that would open a broken attempt, it
 * redirects.
 *
 * The domain modules it needs (`candidate-context`, `challenge-context`,
 * `resume-context`, `question-rules`, `question-generation`, `eligibility`, and
 * the in-memory mock provider) are all intact on disk. Reinstating this route is
 * a matter of giving them a repository again — see docs/plans/066.
 */
export default function InterviewPage() {
  redirect("/program/dashboard");
}
