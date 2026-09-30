"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  Check,
  ChevronDown,
  Heart,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import {
  CLAY_CTA,
  JOB_TYPE_LABEL,
  SAVED_JOBS_KEY,
  WORK_MODE_LABEL,
  type ApplicationCardRow,
  type JobCardRow,
} from "./job-ui";
import { cn } from "@/lib/utils";

/*
 * Candidate Jobs browser. Everything here is view state — search text, the
 * filter rail, the tab, and the per-device saved list. The server owns what a
 * candidate may see (PUBLISHED only) and the apply write path; "Apply" links
 * to the job detail page, which is where the real application is submitted.
 */

type Tab = "jobs" | "applications" | "saved";
type FilterKey = "location" | "workMode" | "type" | "skill";
type Filters = Record<FilterKey, string>;

const EMPTY_FILTERS: Filters = {
  location: "",
  workMode: "",
  type: "",
  skill: "",
};

const FILTER_LABEL: Record<FilterKey, string> = {
  location: "Location",
  workMode: "Work mode",
  type: "Job type",
  skill: "Skills",
};

/** What the rail shows when a filter is unset. */
const FILTER_PLACEHOLDER: Record<FilterKey, string> = {
  location: "Anywhere",
  workMode: "Any mode",
  type: "Any type",
  skill: "Any skill",
};

const APPLICATION_STEPS = [
  "Applied",
  "Under review",
  "Interview",
  "Decision",
] as const;

/**
 * Where each application sits on the four-step tracker, plus its badge. The
 * recruiter workflow only moves rows between these four statuses, so a
 * decision (either way) lands on the last step.
 */
const APPLICATION_STATE: Record<
  ApplicationCardRow["status"],
  { step: number; label: string; badge: string }
> = {
  APPLIED: { step: 0, label: "Submitted", badge: "bg-[#E7F2F3] text-[#03535F]" },
  REVIEWING: { step: 1, label: "Under review", badge: "bg-[#FFF3D6] text-[#8A6100]" },
  ACCEPTED: { step: 3, label: "Accepted", badge: "bg-[#D6F7EC] text-[#197E23]" },
  REJECTED: { step: 3, label: "Not selected", badge: "bg-[#FFF2F0] text-[#D92D20]" },
};

const CARD_CLASS = "rounded-xl border border-[#E0E0E0] bg-white";
const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-[7px] bg-[#EEF6F6] px-2.5 py-1.5 text-xs text-[#03535F]";
/**
 * Experience gets its own fill rather than joining `meta`.
 *
 * The meta pills are all the same muted tint, and a candidate scanning a list
 * needs "3+ years" to register before location or work mode do. Same radius,
 * padding and size as PILL_CLASS so the row still lines up; brand teal at
 * semibold, which is the weight the "Applied" badge already uses — but teal,
 * because this describes the job rather than the candidate's status.
 */
const EXPERIENCE_PILL_CLASS =
  "inline-flex items-center rounded-[7px] bg-[#03535F] px-2.5 py-1.5 text-xs font-semibold text-white";

const SKILL_CLASS =
  "inline-flex rounded-[7px] border border-[#E0E0E0] px-2 py-1 text-xs text-[#4B4B4B]";

/*
 * Saved jobs are a per-device convenience — there is no SavedJob table, so the
 * ids never leave this browser. localStorage is an external store, so it is
 * read through `useSyncExternalStore` rather than copied into state by an
 * effect: no cascading render, and the hydration render still matches the
 * server (which knows nothing about saves).
 */
const EMPTY_SAVED: string[] = [];
const savedListeners = new Set<() => void>();
let savedCache: string[] = EMPTY_SAVED;
let savedLoaded = false;

function parseSavedFromStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_JOBS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return EMPTY_SAVED;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // Blocked or corrupt storage simply means nothing is saved yet.
    return EMPTY_SAVED;
  }
}

/** Must stay referentially stable between renders, hence the cache. */
function getSavedSnapshot(): string[] {
  if (!savedLoaded) {
    savedLoaded = true;
    savedCache = parseSavedFromStorage();
  }
  return savedCache;
}

function getSavedServerSnapshot(): string[] {
  return EMPTY_SAVED;
}

function subscribeSaved(onStoreChange: () => void): () => void {
  savedListeners.add(onStoreChange);
  // Saving a job in another tab updates this one.
  window.addEventListener("storage", onStoreChange);
  return () => {
    savedListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function writeSaved(next: string[]): void {
  savedLoaded = true;
  savedCache = next;
  try {
    window.localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify(next));
  } catch {
    // Saving is a convenience; a blocked store must not break the page. The
    // cache still holds, so the heart responds for this session.
  }
  for (const listener of savedListeners) listener();
}

type Props = {
  jobs: JobCardRow[];
  applications: ApplicationCardRow[];
  /** `?tab=` on the URL — lets the detail page link straight to the tracker. */
  initialTab?: Tab;
};

export function JobsBrowser({ jobs, applications, initialTab = "jobs" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [sort, setSort] = useState<"recent" | "relevant">("recent");
  const [showRail, setShowRail] = useState(false);
  const saved = useSyncExternalStore(
    subscribeSaved,
    getSavedSnapshot,
    getSavedServerSnapshot,
  );

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openFilter) return;
    function onPointerDown(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpenFilter(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenFilter(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilter]);

  function toggleSaved(id: string) {
    writeSaved(
      saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id],
    );
  }

  // Every option comes from the jobs actually on offer, so the rail can never
  // present a filter that matches nothing.
  const options = useMemo(() => {
    const location = new Set<string>();
    const workMode = new Set<string>();
    const type = new Set<string>();
    const skill = new Set<string>();
    for (const job of jobs) {
      if (job.location) location.add(job.location);
      if (job.workMode) workMode.add(WORK_MODE_LABEL[job.workMode]);
      type.add(JOB_TYPE_LABEL[job.type]);
      for (const s of job.skills) skill.add(s);
    }
    const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
    return {
      location: sorted(location),
      workMode: sorted(workMode),
      type: sorted(type),
      skill: sorted(skill),
    } satisfies Record<FilterKey, string[]>;
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const loc = locationQuery.trim().toLowerCase();

    const matched = jobs.filter((job) => {
      if (q) {
        const haystack = [job.title, job.company, job.location ?? "", ...job.skills]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (loc) {
        const jobLocation = (job.location ?? "").toLowerCase();
        const remoteMatch = loc.includes("remote") && job.workMode === "REMOTE";
        if (!jobLocation.includes(loc) && !remoteMatch) return false;
      }
      if (filters.location && job.location !== filters.location) return false;
      if (
        filters.workMode &&
        (job.workMode ? WORK_MODE_LABEL[job.workMode] : "") !== filters.workMode
      ) {
        return false;
      }
      if (filters.type && JOB_TYPE_LABEL[job.type] !== filters.type) return false;
      if (filters.skill && !job.skills.includes(filters.skill)) return false;
      return true;
    });

    // The server already returns newest first, so "recent" is the given order.
    if (sort === "relevant" && q) {
      return [...matched].sort((a, b) => score(b, q) - score(a, q));
    }
    return matched;
  }, [jobs, query, locationQuery, filters, sort]);

  const savedJobs = useMemo(
    () => jobs.filter((job) => saved.includes(job.id)),
    [jobs, saved],
  );

  const activeFilters = (Object.keys(filters) as FilterKey[]).filter(
    (key) => filters[key],
  );

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setQuery("");
    setLocationQuery("");
  }

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-6">
      <header>
        <p className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-[#03535F]">
          Candidate jobs
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-black sm:text-[40px] sm:leading-[48px]">
          Find your next opportunity
        </h1>
        <p className="mt-2 max-w-2xl text-[#4B4B4B]">
          Search published roles by title, skill, location and work mode, then
          track every application you send.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Jobs views"
        className="mt-7 flex gap-1 overflow-x-auto border-b border-[#E0E0E0]"
      >
        <TabButton
          id="jobs"
          active={tab}
          onSelect={setTab}
          label="All jobs"
          count={jobs.length}
        />
        <TabButton
          id="applications"
          active={tab}
          onSelect={setTab}
          label="Applications"
          count={applications.length}
          icon={<Check aria-hidden className="size-3.5" />}
        />
        <TabButton
          id="saved"
          active={tab}
          onSelect={setTab}
          label="Saved jobs"
          count={savedJobs.length}
          icon={<Heart aria-hidden className="size-3.5" />}
        />
      </div>

      {tab === "jobs" ? (
        <div role="tabpanel" aria-labelledby="jobs-tab">
          <div ref={panelRef} className={cn(CARD_CLASS, "relative mt-6 p-4 sm:p-5")}>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.6fr_0.9fr_auto]">
              <label className="flex h-[52px] items-center gap-2.5 rounded-[9px] border border-[#E0E0E0] px-4">
                <Search aria-hidden className="size-5 shrink-0 text-[#03535F]" />
                <span className="sr-only">Search jobs</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by job title, skill or company"
                  autoComplete="off"
                  className="w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[#8F8F8F]"
                />
              </label>
              <label className="flex h-[52px] items-center gap-2.5 rounded-[9px] border border-[#E0E0E0] px-4">
                <MapPin aria-hidden className="size-5 shrink-0 text-[#03535F]" />
                <span className="sr-only">Search by location</span>
                <input
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  placeholder="Location"
                  autoComplete="off"
                  className="w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[#8F8F8F]"
                />
              </label>
              <button
                type="button"
                onClick={() => setOpenFilter(null)}
                className={cn(
                  dsButtonVariants(),
                  CLAY_CTA,
                  "h-[52px] w-full sm:col-span-2 lg:col-span-1 lg:w-auto",
                )}
              >
                Search jobs
              </button>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E0E0E0] pt-3.5">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-expanded={openFilter === key}
                    onClick={() =>
                      setOpenFilter((prev) => (prev === key ? null : key))
                    }
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors",
                      filters[key]
                        ? "border-[#C7DFE1] bg-[#D4EBEC] text-[#03535F]"
                        : "border-[#E0E0E0] bg-white text-[#353535] hover:border-[#B9D5D7] hover:bg-[#EEF6F6]",
                    )}
                  >
                    {filters[key] || FILTER_LABEL[key]}
                    <ChevronDown aria-hidden className="size-3.5 text-[#8F8F8F]" />
                  </button>
                ))}
              </div>
              {activeFilters.length > 0 || query || locationQuery ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[13px] font-semibold text-[#03535F] hover:underline"
                >
                  Clear all
                </button>
              ) : null}
            </div>

            {openFilter ? (
              <div className="absolute left-4 right-4 top-[calc(100%-8px)] z-20 w-auto rounded-[10px] border border-[#E0E0E0] bg-white p-2.5 shadow-[0_12px_35px_rgba(0,0,0,0.12)] sm:right-auto sm:w-[260px]">
                <div className="flex items-center justify-between border-b border-[#E0E0E0] px-2 pb-2.5">
                  <b className="text-sm">{FILTER_LABEL[openFilter]}</b>
                  <button
                    type="button"
                    aria-label="Close filter"
                    onClick={() => setOpenFilter(null)}
                    className="text-[#8F8F8F] hover:text-[#353535]"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
                <div className="max-h-[280px] overflow-auto pt-1.5">
                  {options[openFilter].length === 0 ? (
                    <p className="px-2 py-3 text-[13px] text-[#8F8F8F]">
                      Nothing to filter by yet.
                    </p>
                  ) : (
                    options[openFilter].map((value) => {
                      const selected = filters[openFilter] === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setFilters((prev) => ({
                              ...prev,
                              // Tapping the chosen option again clears it.
                              [openFilter]: selected ? "" : value,
                            }));
                            setOpenFilter(null);
                          }}
                          className={cn(
                            "flex h-10 w-full items-center justify-between rounded-[7px] px-2.5 text-left text-[13px] transition-colors",
                            selected
                              ? "bg-[#EEF6F6] font-semibold text-[#03535F]"
                              : "text-[#353535] hover:bg-[#EEF6F6] hover:text-[#03535F]",
                          )}
                        >
                          {value}
                          {selected ? <Check aria-hidden className="size-4" /> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {activeFilters.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeFilters.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, [key]: "" }))
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#C7DFE1] bg-[#D4EBEC] px-3 py-1.5 text-xs text-[#03535F]"
                  >
                    {filters[key]}
                    <X aria-hidden className="size-3" />
                    <span className="sr-only">Remove {FILTER_LABEL[key]} filter</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-semibold text-black">
                Jobs for you
              </h2>
              <p className="mt-0.5 text-[13px] text-[#4B4B4B]">
                {visibleJobs.length}{" "}
                {visibleJobs.length === 1 ? "opportunity" : "opportunities"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[#4B4B4B]">
              Sort by
              <select
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value === "relevant" ? "relevant" : "recent")
                }
                className="h-9 rounded-lg border border-[#E0E0E0] bg-white px-2.5 text-[13px] text-[#353535] outline-none focus-visible:border-[#03535F]"
              >
                <option value="recent">Most recent</option>
                <option value="relevant">Most relevant</option>
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside
              className={cn(
                CARD_CLASS,
                "h-max p-2.5 lg:sticky lg:top-[75px] lg:block",
                showRail ? "block" : "hidden",
              )}
            >
              <div className="flex items-center justify-between px-2 pb-2.5">
                <b className="font-heading text-[17px] font-semibold">Filter jobs</b>
              </div>
              {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setOpenFilter((prev) => (prev === key ? null : key))
                  }
                  className="grid w-full gap-1 border-t border-[#E0E0E0] px-2 py-3 text-left"
                >
                  <span className="text-[11px] text-[#8F8F8F]">
                    {FILTER_LABEL[key]}
                  </span>
                  <b className="text-[13px] font-medium text-[#353535]">
                    {filters[key] || FILTER_PLACEHOLDER[key]}
                  </b>
                </button>
              ))}
            </aside>

            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowRail((v) => !v)}
                className="inline-flex h-9 w-max items-center gap-2 rounded-lg border border-[#E0E0E0] bg-white px-3 text-[13px] text-[#03535F] lg:hidden"
              >
                <SlidersHorizontal aria-hidden className="size-3.5" />
                {showRail ? "Hide filters" : "Filters"}
              </button>

              {visibleJobs.length === 0 ? (
                <EmptyState
                  icon={<Search aria-hidden className="size-6" />}
                  title="No jobs found"
                  body="Try changing your search or removing one of the filters."
                  action={
                    <button
                      type="button"
                      onClick={clearFilters}
                      className={cn(dsButtonVariants({ size: "sm" }), CLAY_CTA)}
                    >
                      Clear filters
                    </button>
                  }
                />
              ) : (
                visibleJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    saved={saved.includes(job.id)}
                    onToggleSave={() => toggleSaved(job.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "applications" ? (
        <div role="tabpanel" aria-labelledby="applications-tab" className="mt-6">
          {applications.length === 0 ? (
            <EmptyState
              icon={<Check aria-hidden className="size-6" />}
              title="No applications yet"
              body="Jobs you apply to appear here so you can follow their status."
              action={
                <button
                  type="button"
                  onClick={() => setTab("jobs")}
                  className={cn(dsButtonVariants({ size: "sm" }), CLAY_CTA)}
                >
                  Browse jobs
                </button>
              }
            />
          ) : (
            <div className={cn(CARD_CLASS, "px-5 sm:px-6")}>
              {applications.map((application) => {
                const state = APPLICATION_STATE[application.status];
                const facts = [
                  application.company,
                  application.location,
                  application.workMode
                    ? WORK_MODE_LABEL[application.workMode]
                    : null,
                  `Applied ${application.appliedLabel}`,
                ].filter(Boolean);
                return (
                  <article
                    key={application.id}
                    className="grid gap-4 border-t border-[#E0E0E0] py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <div className="min-w-0">
                      <h3 className="font-heading text-lg font-semibold text-black">
                        <Link
                          href={`/jobs/${application.jobId}`}
                          className="hover:text-[#03535F]"
                        >
                          {application.title}
                        </Link>
                      </h3>
                      <p className="mt-1 text-[13px] text-[#4B4B4B]">
                        {facts.join(" · ")}
                      </p>
                      <ol className="mt-5 flex">
                        {APPLICATION_STEPS.map((label, index) => {
                          const done = index <= state.step;
                          const rejected =
                            application.status === "REJECTED" && index === 3;
                          return (
                            <li
                              key={label}
                              className="relative flex-1 pt-7 text-xs text-[#4B4B4B]"
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "absolute left-0 top-1.5 size-3.5 rounded-full",
                                  rejected
                                    ? "bg-[#D92D20]"
                                    : done
                                      ? "bg-[#18D39B]"
                                      : "bg-[#D2D2D2]",
                                )}
                              />
                              {index < APPLICATION_STEPS.length - 1 ? (
                                <span
                                  aria-hidden
                                  className={cn(
                                    "absolute left-3.5 right-0 top-[13px] h-0.5",
                                    index < state.step
                                      ? "bg-[#B5E9DB]"
                                      : "bg-[#D2D2D2]",
                                  )}
                                />
                              ) : null}
                              <span className={done ? "text-[#03535F]" : undefined}>
                                {label}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    <span
                      className={cn(
                        "inline-flex w-max rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                        state.badge,
                      )}
                    >
                      {state.label}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === "saved" ? (
        <div role="tabpanel" aria-labelledby="saved-tab" className="mt-6">
          {savedJobs.length === 0 ? (
            <EmptyState
              icon={<Heart aria-hidden className="size-6" />}
              title="No saved jobs yet"
              body="Save a role from the list and it waits for you here on this device."
              action={
                <button
                  type="button"
                  onClick={() => setTab("jobs")}
                  className={cn(dsButtonVariants({ size: "sm" }), CLAY_CTA)}
                >
                  Browse jobs
                </button>
              }
            />
          ) : (
            <div className="grid gap-3">
              {savedJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  saved
                  onToggleSave={() => toggleSaved(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

/** Title hits outrank skill hits, which outrank company hits. */
function score(job: JobCardRow, q: string): number {
  let value = 0;
  if (job.title.toLowerCase().includes(q)) value += 4;
  if (job.skills.some((s) => s.toLowerCase().includes(q))) value += 2;
  if (job.company.toLowerCase().includes(q)) value += 1;
  return value;
}

function TabButton({
  id,
  active,
  onSelect,
  label,
  count,
  icon,
}: {
  id: Tab;
  active: Tab;
  onSelect: (tab: Tab) => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  const selected = active === id;
  return (
    <button
      type="button"
      role="tab"
      id={`${id}-tab`}
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={cn(
        "inline-flex h-[46px] shrink-0 items-center gap-1.5 border-b-2 px-4 text-sm font-semibold transition-colors",
        selected
          ? "border-[#03535F] text-[#03535F]"
          : "border-transparent text-[#4B4B4B] hover:bg-[#EEF6F6] hover:text-[#03535F]",
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          "ml-1 inline-grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-[11px]",
          selected ? "bg-[#D4EBEC] text-[#03535F]" : "bg-[#F4F4F4] text-[#4B4B4B]",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function JobCard({
  job,
  saved,
  onToggleSave,
}: {
  job: JobCardRow;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const meta = [
    job.location,
    job.workMode ? WORK_MODE_LABEL[job.workMode] : null,
    JOB_TYPE_LABEL[job.type],
  ].filter((v): v is string => Boolean(v));

  return (
    <article
      className={cn(
        CARD_CLASS,
        "relative grid gap-4 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-[box-shadow,border-color] duration-200 hover:border-[#C7DFE1] hover:shadow-[0_8px_24px_rgba(3,83,95,0.08)] sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#EEF6F6] font-heading text-[17px] font-bold text-[#03535F]"
          >
            {job.company.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#353535]">
              {job.company}
            </p>
            <p className="text-[11px] text-[#8F8F8F]">{job.postedLabel}</p>
          </div>
        </div>

        <h3 className="mt-3 font-heading text-xl font-semibold leading-tight text-black sm:text-2xl">
          {/* Stretched link: the whole card opens the job, while the save and
              apply controls below stay independently clickable. */}
          <Link
            href={`/jobs/${job.id}`}
            className="after:absolute after:inset-0 hover:text-[#03535F]"
          >
            {job.title}
          </Link>
        </h3>

        <div className="mt-3 flex flex-wrap gap-2">
          {job.experienceLabel ? (
            <span className={EXPERIENCE_PILL_CLASS}>{job.experienceLabel}</span>
          ) : null}
          {meta.map((value) => (
            <span key={value} className={PILL_CLASS}>
              {value}
            </span>
          ))}
        </div>

        {job.skills.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <span key={skill} className={SKILL_CLASS}>
                {skill}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative z-10 flex items-center gap-2 sm:flex-col sm:items-end">
        <button
          type="button"
          aria-pressed={saved}
          onClick={onToggleSave}
          title={saved ? "Remove from saved jobs" : "Save job"}
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[#EEF6F6]",
            saved ? "text-[#03535F]" : "text-[#8F8F8F]",
          )}
        >
          <Heart aria-hidden className="size-5" fill={saved ? "currentColor" : "none"} />
          <span className="sr-only">
            {saved ? "Remove from saved jobs" : "Save job"}
          </span>
        </button>

        {job.applied ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#D6F7EC] px-4 text-[13px] font-semibold text-[#197E23]">
            <Check aria-hidden className="size-3.5" />
            Applied
          </span>
        ) : (
          <Link
            href={`/jobs/${job.id}`}
            className={cn(dsButtonVariants({ size: "sm" }), CLAY_CTA, "gap-1.5")}
          >
            Apply
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        )}
      </div>
    </article>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        CARD_CLASS,
        "flex flex-col items-center gap-3 px-6 py-14 text-center",
      )}
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-[#EEF6F6] text-[#03535F]">
        {icon ?? <Briefcase aria-hidden className="size-6" />}
      </span>
      <h2 className="font-heading text-xl font-semibold text-black">{title}</h2>
      <p className="max-w-md text-sm leading-6 text-[#4B4B4B]">{body}</p>
      <div className="mt-2">{action}</div>
    </div>
  );
}
