/** Candidate refs this recruiter has already asked about, on this device. */

export const DESK_REQUESTED_EVENT = "abtalks-hire-requested";
const KEY = "abtalks-hire-requested";

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function readRequested(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export function isRequested(candidateRef: string): boolean {
  return readRequested().includes(candidateRef);
}

export function markRequested(candidateRefs: string[]): void {
  if (!canUseStorage() || candidateRefs.length === 0) return;
  const next = new Set(readRequested());
  for (const ref of candidateRefs) {
    if (ref) next.add(ref);
  }
  window.localStorage.setItem(KEY, JSON.stringify([...next]));
  window.dispatchEvent(new Event(DESK_REQUESTED_EVENT));
}
