import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { HackathonMasterFilters } from "@/components/admin/hackathon-master-filters";
import { VideothonExportButton } from "@/components/admin/videothon-export-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VIDEOTHON } from "@/features/hackathon-video/config";
import {
  getAdminVideoRegistrations,
  parseVideoRegistrationQuery,
  parseVideoRegistrationUserType,
} from "@/features/hackathon-video/get-admin-registrations";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AdminVideothonParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cohort?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = parseVideoRegistrationQuery(sp.q);
  const userType = parseVideoRegistrationUserType(sp.cohort);
  const data = await getAdminVideoRegistrations({ q, userType });

  const stats = [
    { label: "Registered", value: data.total },
    { label: "New to ABTalks", value: data.newUserCount },
    { label: "Existing users", value: data.existingUserCount },
    { label: "Learners", value: data.learnerCount },
    { label: "Working", value: data.workingCount },
    { label: "Submitted", value: data.submittedCount },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {VIDEOTHON.name} participants
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Event <code>{VIDEOTHON.eventId}</code> · Sorted by recently registered
          </p>
        </div>
        <div className="flex gap-2">
          <VideothonExportButton rows={data.rows} />
          <Link
            href="/admin/hackathon"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Back to Hackathon
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Suspense fallback={null}>
          <HackathonMasterFilters />
        </Suspense>
        <p className="text-xs text-muted-foreground">
          NEW = ABTalks account created within 24 hours before registering for{" "}
          {VIDEOTHON.name} (joined for it). OLD = account already existed.
        </p>
      </div>

      <form className="flex max-w-md gap-2" action="/admin/hackathon/videothon">
        {userType !== "all" ? (
          <input type="hidden" name="cohort" value={userType} />
        ) : null}
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name, email, city or phone"
        />
        <button type="submit" className={cn(buttonVariants({ size: "sm" }), "h-9")}>
          Search
        </button>
        {q ? (
          <Link
            href={
              userType === "all"
                ? "/admin/hackathon/videothon"
                : `/admin/hackathon/videothon?cohort=${userType}`
            }
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}
          >
            Clear
          </Link>
        ) : null}
      </form>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q
            ? `No participants match “${q}”.`
            : userType !== "all"
              ? `No ${userType.toUpperCase()} participants.`
              : "No registrations yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CTC</TableHead>
                <TableHead>Portfolio</TableHead>
                <TableHead>Submission</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/students/${r.userId}`} className="hover:underline">
                      {r.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={r.isNewUser ? "default" : "outline"}
                      title={`Account created ${dateFmt.format(new Date(r.accountCreatedAtIso))}`}
                    >
                      {r.isNewUser ? "NEW" : "OLD"}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.phone}</TableCell>
                  <TableCell>{r.city}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {r.employment === "WORKING" ? "Working" : "Learner"}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.currentCtc || "—"}</TableCell>
                  <TableCell>
                    <a
                      href={r.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Open
                    </a>
                  </TableCell>
                  <TableCell>
                    {r.submissionUrl ? (
                      <a
                        href={r.submissionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        title={r.submissionNotes ?? undefined}
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{r.sourceSlug ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dateFmt.format(new Date(r.createdAtIso))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
