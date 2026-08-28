import {
  CalendarDays,
  GraduationCap,
  Repeat,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { WorkshopAnalyticsChart } from "@/components/admin/workshop-analytics-chart";
import type { WorkshopAnalytics } from "@/features/workshop/get-workshop-analytics";
import { formatDateIST } from "@/lib/date-utils";

interface Props {
  analytics: WorkshopAnalytics;
  /** eventId → display title. */
  eventLabels: Record<string, string>;
}

export function WorkshopAnalyticsPanel({ analytics, eventLabels }: Props) {
  const {
    totalRegistrations,
    uniqueAttendees,
    repeatPeople,
    memberRegistrations,
    newToABTalks,
    existingMembers,
    convertedToChallenge,
    workshopCount,
    perEvent,
  } = analytics;

  if (totalRegistrations === 0) return null;

  const pct = (n: number) =>
    uniqueAttendees > 0 ? Math.round((n / uniqueAttendees) * 100) : 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Master data</h2>
        <p className="text-sm text-muted-foreground">
          Across all {workshopCount} workshop{workshopCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total registrations"
          value={totalRegistrations}
          accent="blue"
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Unique attendees"
          value={uniqueAttendees}
          accent="orange"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Repeat attendees"
          value={repeatPeople}
          delta={pct(repeatPeople)}
          deltaSuffix="% of attendees"
          accent="green"
          icon={<Repeat className="h-4 w-4" />}
        />
        <StatCard
          label="From ABTalks members"
          value={memberRegistrations}
          accent="orange"
          icon={<UserCheck className="h-4 w-4" />}
        />
      </div>

      <div className="space-y-3 border-t pt-6">
        <div>
          <h2 className="font-display text-lg font-semibold">
            ABTalks membership
          </h2>
          <p className="text-sm text-muted-foreground">
            Counted per person, matched by email — not per registration.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="New to ABTalks"
            value={newToABTalks}
            delta={pct(newToABTalks)}
            deltaSuffix="% of attendees"
            accent="green"
            icon={<UserPlus className="h-4 w-4" />}
          />
          <StatCard
            label="Already ABTalks members"
            value={existingMembers}
            delta={pct(existingMembers)}
            deltaSuffix="% of attendees"
            accent="blue"
            icon={<UserCheck className="h-4 w-4" />}
          />
          <StatCard
            label="Converted to a challenge"
            value={convertedToChallenge}
            delta={pct(convertedToChallenge)}
            deltaSuffix="% of attendees"
            accent="orange"
            icon={<GraduationCap className="h-4 w-4" />}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          &ldquo;New to ABTalks&rdquo; means they had no account before their
          first workshop — the workshop brought them in.
          &ldquo;Converted&rdquo; means they went on to enroll in a challenge.
        </p>
      </div>

      <WorkshopAnalyticsChart
        data={[...perEvent]
          .reverse()
          .map((e) => ({
            name: eventLabels[e.eventId] ?? e.eventId,
            New: e.newRegistrants,
            Returning: e.returning,
          }))}
      />

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Workshop</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">New</th>
              <th className="px-4 py-3 text-right font-medium">Returning</th>
              <th className="px-4 py-3 text-right font-medium">Linked</th>
              <th className="px-4 py-3 font-medium">Signup window</th>
            </tr>
          </thead>
          <tbody>
            {perEvent.map((e) => {
              const newPct =
                e.total > 0 ? Math.round((e.newRegistrants / e.total) * 100) : 0;
              return (
                <tr key={e.eventId} className="border-b last:border-0">
                  <td className="max-w-[260px] px-4 py-3">
                    <span className="block truncate font-medium">
                      {eventLabels[e.eventId] ?? e.eventId}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {e.eventId}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {e.total}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-medium text-emerald-500">
                      {e.newRegistrants}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {newPct}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#E05226]">
                    {e.returning}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {e.linked}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {e.firstSignupAt ? formatDateIST(e.firstSignupAt) : "—"} →{" "}
                    {e.lastSignupAt ? formatDateIST(e.lastSignupAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        &ldquo;New&rdquo; means this was the person&rsquo;s first ever ABTalks
        workshop, matched by email. Everyone else counts as returning against the
        workshop they first signed up for.
      </p>

    </section>
  );
}
