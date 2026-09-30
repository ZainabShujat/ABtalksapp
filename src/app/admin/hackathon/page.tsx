import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { HackathonView } from "@/components/admin/hackathon-view";
import { buttonVariants } from "@/components/ui/button";
import { VIDEOTHON } from "@/features/hackathon-video/config";
import { getAdminData } from "@/features/hackathon/get-admin-data";
import { cn } from "@/lib/utils";

export default async function AdminHackathonPage() {
  await requireAdmin();
  const data = await getAdminData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hackathon</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registrations, roster export, and problem statement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/hackathon/videothon"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            {VIDEOTHON.name} participants
          </Link>
        </div>
      </div>
      <HackathonView data={data} />
    </div>
  );
}
