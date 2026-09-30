import type { Metadata } from "next";
import { requireRecruiter } from "@/lib/program-auth";
import { CandidateEvidenceReport } from "@/components/hire/candidate-evidence-report";

export const metadata: Metadata = {
  title: "Candidate report | ABTalks Hire",
  description:
    "The full ABTalks report for a Scout match: verified evidence, experience and skills.",
};

export default async function HireEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  // The gate stays on the server. Everything the report renders below is
  // either already in this recruiter's own browser cache or comes back from a
  // server action that re-resolves the candidate handle for itself.
  await requireRecruiter();
  const raw = (await searchParams).ref;
  const lookup = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  return <CandidateEvidenceReport lookup={lookup} />;
}
