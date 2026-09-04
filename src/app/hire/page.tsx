import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { isHireProPreviewEnabled, isVirtualCandidatesEnabled } from "@/lib/feature-flags";
import { ScoutChat } from "@/components/hire/scout-chat";

export const metadata: Metadata = {
  title: "Scout | Hire with ABTalks",
  description:
    "Describe the role. Scout matches candidates by verified platform evidence, not resumes.",
};

export default async function HirePage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const recruiter = userId
    ? await getRecruiterState(userId)
    : { status: "none" as const };
  const persist = recruiter.status === "approved";

  let recent: { id: string; title: string; status: string; updatedAt: Date }[] =
    [];
  if (userId) {
    try {
      recent = await prisma.talentRequest.findMany({
        where: { recruiterUserId: userId },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { id: true, title: true, status: true, updatedAt: true },
      });
    } catch {
      recent = [];
    }
  }

  return (
    <ScoutChat
      persist={persist}
      proPreview={isHireProPreviewEnabled()}
      virtualCandidates={isVirtualCandidatesEnabled()}
      initialRequestId={null}
      initialMessages={[]}
      initialSpec={{}}
      initialSummary="Not started"
      recent={recent.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        date: r.updatedAt.toISOString().slice(0, 10),
      }))}
    />
  );
}
