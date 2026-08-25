import type { MatchCardData } from "@/components/hire/match-card";
import { readPoolExtra } from "@/features/hire/pool-brief";
import type { JobSpec } from "@/lib/validations/hire";

export const GUEST_MATCHES_KEY = "abtalks-hire-guest-matches";
export const GUEST_SEARCHES_EVENT = "abtalks-hire-searches";

/** Enough to compare two searches; oldest drop off after this. */
export const MAX_GUEST_SEARCH_TABS = 8;

export type GuestSearchTab = {
  id: string;
  label: string;
  title: string;
  overallGap: string;
  matches: MatchCardData[];
};

export type GuestMatchCollection = {
  activeId: string;
  tabs: GuestSearchTab[];
};

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function isMatchCard(raw: unknown): raw is MatchCardData {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as MatchCardData).candidateRef === "string"
  );
}

function isTab(raw: unknown): raw is GuestSearchTab {
  if (!raw || typeof raw !== "object") return false;
  const t = raw as GuestSearchTab;
  return (
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.label === "string" &&
    typeof t.title === "string" &&
    typeof t.overallGap === "string" &&
    Array.isArray(t.matches) &&
    t.matches.every(isMatchCard)
  );
}

/** One-line tab label: track/role, stack, how many came back. */
export function labelGuestSearch(spec: JobSpec, count: number): string {
  const extra = readPoolExtra(spec);
  const bits: string[] = [];
  if (spec.title?.trim()) bits.push(spec.title.trim());
  else if (extra.sources.includes("CLAUDE")) bits.push("Claude");
  else if (extra.sources.includes("CHALLENGE_60")) bits.push("60-day");
  else if (extra.sources.includes("HACKATHON")) bits.push("Hackathon");
  else if (extra.sources.includes("PROGRAM")) bits.push("US cohort");
  else if (extra.geo === "IN") bits.push("India");
  else bits.push("Search");
  if (spec.mustHaveStack?.length) {
    bits.push(spec.mustHaveStack.slice(0, 2).join("/"));
  }
  bits.push(String(count));
  return bits.join(" · ");
}

/**
 * Accept the tabbed collection and the older single-search blob so a
 * session that started before tabs landed is one tab, not a blank page.
 */
export function parseGuestMatchCollection(raw: unknown): GuestMatchCollection {
  const empty: GuestMatchCollection = { activeId: "", tabs: [] };
  if (!raw || typeof raw !== "object") return empty;
  const parsed = raw as Record<string, unknown>;

  if (Array.isArray(parsed.tabs)) {
    const tabs = parsed.tabs.filter(isTab).slice(-MAX_GUEST_SEARCH_TABS);
    if (tabs.length === 0) return empty;
    const want = typeof parsed.activeId === "string" ? parsed.activeId : "";
    const activeId = tabs.some((t) => t.id === want)
      ? want
      : tabs[tabs.length - 1]!.id;
    return { activeId, tabs };
  }

  if (Array.isArray(parsed.matches) && parsed.matches.every(isMatchCard)) {
    const id = "legacy";
    return {
      activeId: id,
      tabs: [
        {
          id,
          label: typeof parsed.title === "string" && parsed.title
            ? `${parsed.title} · ${parsed.matches.length}`
            : `Search · ${parsed.matches.length}`,
          title: typeof parsed.title === "string" ? parsed.title : "",
          overallGap:
            typeof parsed.overallGap === "string" ? parsed.overallGap : "",
          matches: parsed.matches,
        },
      ],
    };
  }

  return empty;
}

export function readGuestMatchCollection(): GuestMatchCollection {
  if (!canUseStorage()) return { activeId: "", tabs: [] };
  try {
    const raw =
      window.localStorage.getItem(GUEST_MATCHES_KEY) ??
      window.sessionStorage.getItem(GUEST_MATCHES_KEY);
    if (!raw) return { activeId: "", tabs: [] };
    return parseGuestMatchCollection(JSON.parse(raw));
  } catch {
    return { activeId: "", tabs: [] };
  }
}

export function writeGuestMatchCollection(store: GuestMatchCollection): void {
  if (!canUseStorage()) return;
  const raw = JSON.stringify(store);
  window.localStorage.setItem(GUEST_MATCHES_KEY, raw);
  window.sessionStorage.setItem(GUEST_MATCHES_KEY, raw);
  window.dispatchEvent(new Event(GUEST_SEARCHES_EVENT));
}

export function appendGuestSearch(tab: Omit<GuestSearchTab, "id">): GuestSearchTab {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}`;
  const next: GuestSearchTab = { ...tab, id };
  const current = readGuestMatchCollection();
  const tabs = [...current.tabs, next].slice(-MAX_GUEST_SEARCH_TABS);
  writeGuestMatchCollection({ activeId: id, tabs });
  return next;
}

export function setActiveGuestSearch(id: string): void {
  const current = readGuestMatchCollection();
  if (!current.tabs.some((t) => t.id === id)) return;
  writeGuestMatchCollection({ ...current, activeId: id });
}

export function clearGuestMatches(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(GUEST_MATCHES_KEY);
  window.sessionStorage.removeItem(GUEST_MATCHES_KEY);
  window.dispatchEvent(new Event(GUEST_SEARCHES_EVENT));
}

/** Active tab only — what the results list should render. */
export function readGuestMatches(): GuestSearchTab | null {
  const store = readGuestMatchCollection();
  return store.tabs.find((t) => t.id === store.activeId) ?? store.tabs.at(-1) ?? null;
}
