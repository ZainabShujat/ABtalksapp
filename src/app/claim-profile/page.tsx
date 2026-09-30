import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  needsClaimProfileAcknowledgement,
  getCandidateClaimSummary,
} from "@/features/resume/import/claim";
import { ClaimProfileClient } from "./claim-profile-client";

export const metadata = {
  title: "Welcome to ABTalks — Claim Your Profile",
  description: "Review and activate your candidate profile pre-filled from your résumé.",
};

type PageProps = {
  searchParams?: Promise<{ preview?: string }>;
};

export default async function ClaimProfilePage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params?.preview === "true") {
    const previewSummary = {
      fullName: "Pranav Gupta",
      headline: "Full Stack Software Engineer",
      phone: "+91 98765 43210",
      phoneVerified: false,
      education: {
        degree: "B.Tech in Computer Science",
        institutionName: "Indian Institute of Information Technology",
        graduationYear: 2024,
      },
      skills: ["React", "TypeScript", "Next.js", "Node.js", "PostgreSQL", "Python"],
      resumeFileName: "Pranav_Gupta_Resume.pdf",
    };

    return (
      <ClaimProfileClient
        summary={previewSummary}
        userEmail="ompranav2003@gmail.com"
        isPreview={true}
      />
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const needsAck = await needsClaimProfileAcknowledgement(session.user.id);
  if (!needsAck) {
    redirect("/dashboard");
  }

  const summary = await getCandidateClaimSummary(session.user.id);

  return (
    <ClaimProfileClient
      summary={summary}
      userEmail={session.user.email ?? ""}
    />
  );
}
