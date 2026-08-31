import { redirect } from "next/navigation";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";

/** Entry assessment quiz removed — send anyone here back to apply. */
export default function ProgramAssessmentPage() {
  redirect(`${PROGRAM_AI_COHORT_BASE}/apply`);
}
