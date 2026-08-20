import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReferralsFilters } from "@/components/admin/referrals-filters";
import {
  formatDateIST,
  formatDateTimeIST,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  getReferredByUser,
  getReferrersInRange,
} from "@/features/admin/get-referrals-report";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(value: string | undefined): string | undefined {
  if (!value || !DATE_KEY_RE.test(value)) return undefined;
  return value;
}

function domainBadgeClass(domain: string | null): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "CLAUDE")
    return "border-orange-500/40 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200";
  if (domain === "SE") return "border-domains-se/50 bg-domains-se-bg text-domains-se";
  return "border-border bg-muted text-muted-foreground";
}

function rangeDescription(startKey?: string, endKey?: string): string {
  if (startKey && endKey) {
    return `from ${formatDateIST(parseCalendarKeyToUtcDate(startKey))} to ${formatDateIST(parseCalendarKeyToUtcDate(endKey))} (IST)`;
  }
  if (startKey) {
    return `from ${formatDateIST(parseCalendarKeyToUtcDate(startKey))} onward (IST)`;
  }
  if (endKey) {
    return `through ${formatDateIST(parseCalendarKeyToUtcDate(endKey))} (IST)`;
  }
  return "all time";
}

function buildReferralsHref(
  params: { startKey?: string; endKey?: string; referrer?: string },
): string {
  const search = new URLSearchParams();
  if (params.startKey) search.set("start", params.startKey);
  if (params.endKey) search.set("end", params.endKey);
  if (params.referrer) search.set("referrer", params.referrer);
  const qs = search.toString();
  return qs ? `/admin/referrals?${qs}` : "/admin/referrals";
}

export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{
    start?: string;
    end?: string;
    referrer?: string;
  }>;
}) {
  const sp = await searchParams;
  const startKey = parseDateKey(sp.start);
  const endKey = parseDateKey(sp.end);
  const referrerId = sp.referrer?.trim() || undefined;
  const range = { startKey, endKey };

  const isDrillDown = Boolean(referrerId);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Referrals</h1>
        <p className="text-sm text-muted-foreground">
          Sign-ups via referral code — {rangeDescription(startKey, endKey)}
        </p>
      </div>

      <ReferralsFilters start={startKey} end={endKey} />

      {isDrillDown && referrerId ? (
        <DrillDownView
          referrerId={referrerId}
          range={range}
          startKey={startKey}
          endKey={endKey}
        />
      ) : (
        <ListView range={range} startKey={startKey} endKey={endKey} />
      )}
    </div>
  );
}

async function ListView({
  range,
  startKey,
  endKey,
}: {
  range: { startKey?: string; endKey?: string };
  startKey?: string;
  endKey?: string;
}) {
  const rows = await getReferrersInRange(range);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No referrals in this range.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <article key={row.userId} className="rounded-xl border bg-card p-3 text-sm">
            <Link
              href={buildReferralsHref({
                referrer: row.userId,
                startKey,
                endKey,
              })}
              className="font-medium underline"
            >
              {row.fullName}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">{row.email}</p>
            <p className="mt-2 text-xs">
              <span className="font-medium">{row.referralCount}</span> referral
              {row.referralCount === 1 ? "" : "s"}
            </p>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Referral count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.userId}>
                <TableCell>
                  <Link
                    href={buildReferralsHref({
                      referrer: row.userId,
                      startKey,
                      endKey,
                    })}
                    className="font-medium underline"
                  >
                    {row.fullName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
                <TableCell>{row.referralCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

async function DrillDownView({
  referrerId,
  range,
  startKey,
  endKey,
}: {
  referrerId: string;
  range: { startKey?: string; endKey?: string };
  startKey?: string;
  endKey?: string;
}) {
  const { referrer, rows } = await getReferredByUser(referrerId, range);
  const referrerName = referrer?.fullName ?? "Unknown";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={buildReferralsHref({ startKey, endKey })}
          className="text-sm text-primary underline"
        >
          ← Back to referrers
        </Link>
        <p className="text-sm font-medium">
          {referrerName} — referred {rows.length}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No referrals from this student in this range.
        </p>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <article key={row.userId} className="rounded-xl border bg-card p-3 text-sm">
                <Link
                  href={`/admin/students/${row.userId}`}
                  className="font-medium underline"
                >
                  {row.fullName}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{row.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {row.domain ? (
                    <Badge variant="outline" className={domainBadgeClass(row.domain)}>
                      {row.domain}
                    </Badge>
                  ) : (
                    <Badge variant="outline">—</Badge>
                  )}
                  <Badge
                    className={cn(
                      "border-0",
                      row.rewardGiven
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    Day 7: {row.rewardGiven ? "Yes" : "No"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Signed up {formatDateTimeIST(row.signedUpAt)}
                </p>
                <p className="mt-1 text-xs">Days completed: {row.daysCompleted}</p>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Signed up</TableHead>
                  <TableHead>Reached Day 7?</TableHead>
                  <TableHead>Days completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <Link
                        href={`/admin/students/${row.userId}`}
                        className="font-medium underline"
                      >
                        {row.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.email}
                    </TableCell>
                    <TableCell>
                      {row.domain ? (
                        <Badge variant="outline" className={domainBadgeClass(row.domain)}>
                          {row.domain}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{formatDateTimeIST(row.signedUpAt)}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "border-0",
                          row.rewardGiven
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row.rewardGiven ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.daysCompleted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
