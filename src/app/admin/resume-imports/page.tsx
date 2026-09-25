import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CONSENT_ATTESTATION, loadImportStatus } from "@/features/resume/import/status";
import { ImportTable } from "./import-table";

/**
 * Admin résumé import (plan 154). Server Component: guards, loads the first
 * page, hands plain JSON to the client table.
 *
 * `maxDuration` is 300 because the server actions invoked from this page start
 * the background drain with `after()`, which runs inside that same invocation.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export default async function ResumeImportsPage() {
  await requireAdmin();
  const initial = await loadImportStatus({});

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Résumé Import"
        description="Upload student résumés, parse them on the server, and register them as candidates. A student takes over their account by signing in with Google using the email on their résumé."
      />
      <ImportTable initial={initial} attestation={CONSENT_ATTESTATION} />
    </div>
  );
}
