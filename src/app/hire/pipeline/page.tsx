import type { Metadata } from "next";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { listPipeline } from "@/repositories/talent-pipeline";
import {
  PipelineBoard,
  type PipelineBoardRow,
} from "@/components/hire/pipeline/pipeline-board";

export const metadata: Metadata = {
  title: "Pipeline | Hire with ABTalks",
  description:
    "Move candidates through the nine stages of your hiring pipeline. Every change persists across refresh, sign-out and device.",
};

/**
 * T-240 recruiter hiring pipeline route.
 *
 * Server Component. Resolves the recruiter workspace through the shared
 * boundary, loads the pipeline from the repository, ISO-formats the two
 * date fields, and hands a plain-object array to the client board .
 */
export default async function PipelinePage() {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return (
      <div className="hire-pipeline-empty px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{workspace.message}</p>
      </div>
    );
  }

  const snapshot = await listPipeline({
    userId: workspace.data.userId,
    recruiterProfileId: workspace.data.recruiterProfileId,
    organizationId: workspace.data.organizationId,
  });

  const rows: PipelineBoardRow[] = [];
  for (const stage of Object.keys(snapshot.stages) as Array<keyof typeof snapshot.stages>) {
    for (const row of snapshot.stages[stage]) {
      rows.push({
        itemId: row.itemId,
        candidateUserId: row.candidateUserId,
        candidateLabel: row.candidateLabel,
        stage: row.stage,
        addedAtIso: row.addedAt.toISOString(),
        stageChangedAtIso: row.stageChangedAt.toISOString(),
      });
    }
  }

  return (
    /* `hire-shell-wide` opts out of the shell's 880px prose measure — a nine
       stage board is not prose. Padding and the page gutter come from
       `.hire-shell__content`, the same as every other plain /hire page, so this
       no longer sets its own and no longer sits on a different rhythm to
       Analytics. */
    <div className="hire-pipeline hire-shell-wide">
      <PipelineBoard rows={rows} companyName={workspace.data.company} />
    </div>
  );
}
