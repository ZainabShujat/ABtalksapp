import Link from "next/link";
import { WorkshopAnalyticsPanel } from "@/components/admin/workshop-analytics";
import { WorkshopEventPicker } from "@/components/admin/workshop-event-picker";
import { WorkshopRegistrationsView } from "@/components/admin/workshop-registrations-view";
import { EVENTS } from "@/components/workshop/events-data";
import {
  getWorkshopEventCounts,
  getWorkshopRegistrations,
} from "@/features/workshop/get-admin-data";
import { getWorkshopAnalytics } from "@/features/workshop/get-workshop-analytics";
import { requireAdmin } from "@/lib/admin-auth";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "registrations", label: "Registrations" },
  { value: "analytics", label: "Analytics" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default async function AdminWorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; events?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const tab: TabValue = TABS.some((t) => t.value === sp.tab)
    ? (sp.tab as TabValue)
    : "registrations";

  const counts = await getWorkshopEventCounts();

  const titleById = new Map(EVENTS.map((e) => [e.id, e.title]));
  const pickerEvents = counts.map((c) => ({
    eventId: c.eventId,
    label: titleById.get(c.eventId) ?? c.eventId,
    count: c.count,
  }));
  const eventLabels = Object.fromEntries(
    pickerEvents.map((e) => [e.eventId, e.label]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Workshop</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registrations, analytics and share links across every workshop.
        </p>
      </div>

      <div className="inline-flex rounded-lg border bg-card p-1">
        {TABS.map((t) => {
          const active = t.value === tab;
          // Tab lives in the URL so a view is shareable; the events selection is
          // preserved so switching tabs and back keeps your filter.
          const href =
            t.value === "registrations" && sp.events
              ? `/admin/workshop?tab=registrations&events=${encodeURIComponent(sp.events)}`
              : `/admin/workshop?tab=${t.value}`;
          return (
            <Link
              key={t.value}
              href={href}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[#E05226] text-primary-foreground shadow-[var(--shadow-card)]"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {tab === "registrations" && (
        <RegistrationsTab
          eventsParam={sp.events}
          counts={counts}
          pickerEvents={pickerEvents}
          eventLabels={eventLabels}
        />
      )}

      {tab === "analytics" && <AnalyticsTab eventLabels={eventLabels} />}
    </div>
  );
}

async function RegistrationsTab({
  eventsParam,
  counts,
  pickerEvents,
  eventLabels,
}: {
  eventsParam?: string;
  counts: { eventId: string; count: number }[];
  pickerEvents: { eventId: string; label: string; count: number }[];
  eventLabels: Record<string, string>;
}) {
  const known = new Set(counts.map((c) => c.eventId));
  const requested = (eventsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && known.has(s));

  // Default to the most recent workshop only. With a weekly cadence, defaulting
  // to every event would mean rendering thousands of rows on first load.
  const selected =
    requested.length > 0 ? requested : counts[0] ? [counts[0].eventId] : [];

  const rows = await getWorkshopRegistrations(selected);

  const subtitle =
    selected.length === 0
      ? "No workshop registrations yet."
      : selected.length === 1
        ? `${rows.length} registration${rows.length === 1 ? "" : "s"} · ${
            eventLabels[selected[0]!] ?? selected[0]
          }`
        : `${rows.length} registrations across ${selected.length} workshops`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{subtitle}</p>

      {pickerEvents.length > 0 && (
        <WorkshopEventPicker events={pickerEvents} selected={selected} />
      )}

      <WorkshopRegistrationsView
        rows={rows}
        eventLabels={eventLabels}
        showEventColumn={selected.length > 1}
        exportName={
          selected.length === 1 ? selected[0]! : `${selected.length}-workshops`
        }
      />
    </div>
  );
}

async function AnalyticsTab({
  eventLabels,
}: {
  eventLabels: Record<string, string>;
}) {
  const analytics = await getWorkshopAnalytics();

  return (
    <WorkshopAnalyticsPanel analytics={analytics} eventLabels={eventLabels} />
  );
}
