import type { Metadata } from "next";
import { EvidenceResume } from "@/components/hire/evidence-resume";

export const metadata: Metadata = {
  title: "Evidence resume | ABTalks Hire",
  description:
    "Platform-verified evidence for a Scout match — not a self-written resume.",
};

export default async function HireEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const raw = (await searchParams).ref;
  const lookup = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  return <EvidenceResume lookup={lookup} />;
}
