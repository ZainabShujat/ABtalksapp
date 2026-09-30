import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { AssessmentBuilder } from "@/components/hire/assessment/assessment-builder";
import { PlatformBuilderFrame } from "@/components/admin/platform-builder-frame";
import { prismaPlatformStore } from "@/features/platform-assessments/prisma-store";

export const metadata = { title: "Create assessment | Admin" };

export default async function AdminNewAssessmentPage() {
  await requireAdmin();
  const audienceOptions = await prismaPlatformStore().audienceOptions();

  return (
    // `relative`: admin <main> scrolls internally, so the builder's absolutely
    // positioned sr-only nodes must resolve inside it — otherwise they anchor to
    // the document and stretch the page (empty scroll above the site footer).
    <div className="relative space-y-4">
      <Link
        href="/admin/assessments"
        className="text-sm font-medium text-[#03535F] hover:underline"
      >
        ← All assessments
      </Link>
      <PlatformBuilderFrame>
        <AssessmentBuilder
          candidates={[]}
          existingDraft={null}
          platform={{ audienceOptions }}
        />
      </PlatformBuilderFrame>
    </div>
  );
}
