import { refPublicId } from "@/features/hire/candidate-ref";
import { readGuestMatchCollection } from "@/components/hire/guest-matches-store";
import type { MatchCardData } from "@/components/hire/match-card";

const KEY = "abtalks-hire-evidence";

export function evidenceResumeHref(candidateRef: string): string {
  return `/hire/evidence?ref=${encodeURIComponent(candidateRef)}`;
}

export function rememberEvidence(matches: MatchCardData[]): void {
  if (typeof window === "undefined" || matches.length === 0) return;
  const bag = readBag();
  for (const match of matches) {
    bag[match.candidateRef] = match;
    const pub = refPublicId(match.candidateRef);
    if (pub !== "AB-????") bag[pub] = match;
  }
  try {
    const raw = JSON.stringify(bag);
    window.sessionStorage.setItem(KEY, raw);
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Quota or private mode — resume still works from the guest match store.
  }
}

/** Prefer the last-search card (full evidence) over a sparse list snapshot. */
export function hydrateMatch(fallback: MatchCardData): MatchCardData {
  const cached = recallEvidence(fallback.candidateRef);
  if (!cached) return fallback;
  return {
    ...cached,
    shortlisted: fallback.shortlisted ?? cached.shortlisted,
    engagementStatus: fallback.engagementStatus ?? cached.engagementStatus,
  };
}

export function recallEvidence(key: string): MatchCardData | null {
  const want = key.trim();
  if (!want) return null;

  const bag = readBag();
  const direct = bag[want];
  if (direct) return direct;

  for (const match of Object.values(bag)) {
    if (match.candidateRef === want) return match;
    if (refPublicId(match.candidateRef) === want) return match;
  }

  for (const tab of readGuestMatchCollection().tabs) {
    for (const match of tab.matches) {
      if (match.candidateRef === want) return match;
      if (refPublicId(match.candidateRef) === want) return match;
    }
  }
  return null;
}

function readBag(): Record<string, MatchCardData> {
  if (typeof window === "undefined") return {};
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = store.getItem(KEY);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const bag: Record<string, MatchCardData> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isMatch(v)) bag[k] = v;
      }
      return bag;
    } catch {
      continue;
    }
  }
  return {};
}

function isMatch(raw: unknown): raw is MatchCardData {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as MatchCardData).candidateRef === "string" &&
    typeof (raw as MatchCardData).jobRole === "string"
  );
}
