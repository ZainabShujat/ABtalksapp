"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AdminVideoRegistration } from "@/features/hackathon-video/get-admin-registrations";
import { downloadCSV, toCSV } from "@/lib/csv";

export function VideothonExportButton({ rows }: { rows: AdminVideoRegistration[] }) {
  function handleExport() {
    if (rows.length === 0) {
      toast.error("No participants to export");
      return;
    }
    const csv = toCSV(
      rows.map((r) => ({
        fullName: r.fullName,
        userType: r.isNewUser ? "NEW" : "OLD",
        accountCreatedAt: r.accountCreatedAtIso,
        email: r.email,
        phone: r.phone,
        city: r.city,
        employment: r.employment,
        currentCtc: r.currentCtc ?? "",
        portfolioUrl: r.portfolioUrl,
        sourceSlug: r.sourceSlug ?? "",
        submissionUrl: r.submissionUrl ?? "",
        submissionNotes: r.submissionNotes ?? "",
        submissionUpdatedAt: r.submissionUpdatedAtIso ?? "",
        registeredAt: r.createdAtIso,
      })),
    );
    const date = new Date().toISOString().split("T")[0];
    downloadCSV(`abtalks-videothon-${date}.csv`, csv);
    toast.success(`Exported ${rows.length} participants`);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="size-4" />
      Export CSV
    </Button>
  );
}
