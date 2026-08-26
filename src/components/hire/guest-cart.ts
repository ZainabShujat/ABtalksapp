import {
  decodeCandidateRef,
  encodeCandidateRef,
  type CandidateSource,
} from "@/features/hire/candidate-ref";
import type { MatchCardData } from "@/components/hire/match-card";

export const GUEST_CART_KEY = "abtalks-hire-cart";

export type GuestCartItem = {
  candidateRef: string;
  jobRole: string;
  totalScore: number;
  displayName?: string | null;
  skills?: string[];
  source?: CandidateSource;
  locationLabel?: string | null;
  yearsExperience?: number;
  missionsPassed?: number;
  totalTrackDays?: number | null;
  certificateIssued?: boolean;
  rationale?: string | null;
  workMode?: string | null;
  educationLevel?: string | null;
  availabilityUnknown?: boolean;
  compensationBand?: string | null;
};

export function cartItemFromMatch(match: MatchCardData): GuestCartItem {
  const e = match.evidence ?? {};
  return {
    candidateRef: match.candidateRef,
    jobRole: match.jobRole,
    totalScore: match.score,
    displayName: match.displayName ?? null,
    skills: e.skills,
    source: match.source,
    locationLabel: match.locationLabel ?? null,
    yearsExperience: e.yearsExperience,
    missionsPassed: e.missionsPassed,
    totalTrackDays: e.totalTrackDays,
    certificateIssued: e.certificateIssued,
    rationale: match.rationale,
    workMode: e.workMode ?? null,
    educationLevel: e.educationLevel ?? null,
    availabilityUnknown: match.availabilityUnknown,
    compensationBand: match.compensationBand ?? null,
  };
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

/**
 * Accept the current shape and the pre-challenge `{ memberId }` rows so a
 * cart that was sitting in localStorage before this change is not dropped.
 * A bare memberId is always a ProgramMember id — never a Claude user id.
 */
export function normalizeGuestCartItem(raw: unknown): GuestCartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    candidateRef?: unknown;
    memberId?: unknown;
    jobRole?: unknown;
    totalScore?: unknown;
    displayName?: unknown;
    skills?: unknown;
    source?: unknown;
    locationLabel?: unknown;
    yearsExperience?: unknown;
    missionsPassed?: unknown;
    totalTrackDays?: unknown;
    certificateIssued?: unknown;
    rationale?: unknown;
    workMode?: unknown;
    educationLevel?: unknown;
    availabilityUnknown?: unknown;
    compensationBand?: unknown;
  };
  const jobRole = typeof row.jobRole === "string" ? row.jobRole : "Candidate";
  const totalScore = typeof row.totalScore === "number" ? row.totalScore : 0;
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim()
      ? row.displayName.trim()
      : null;
  const skills = Array.isArray(row.skills)
    ? row.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : undefined;
  const extra: Omit<GuestCartItem, "candidateRef" | "jobRole" | "totalScore"> = {
    displayName,
    skills,
    source:
      row.source === "PROGRAM" ||
      row.source === "CLAUDE" ||
      row.source === "CHALLENGE_60" ||
      row.source === "HACKATHON"
        ? row.source
        : undefined,
    locationLabel:
      typeof row.locationLabel === "string" ? row.locationLabel : null,
    yearsExperience:
      typeof row.yearsExperience === "number" ? row.yearsExperience : undefined,
    missionsPassed:
      typeof row.missionsPassed === "number" ? row.missionsPassed : undefined,
    totalTrackDays:
      typeof row.totalTrackDays === "number" ? row.totalTrackDays : undefined,
    certificateIssued:
      typeof row.certificateIssued === "boolean"
        ? row.certificateIssued
        : undefined,
    rationale: typeof row.rationale === "string" ? row.rationale : null,
    workMode: typeof row.workMode === "string" ? row.workMode : null,
    educationLevel:
      typeof row.educationLevel === "string" ? row.educationLevel : null,
    availabilityUnknown:
      typeof row.availabilityUnknown === "boolean"
        ? row.availabilityUnknown
        : undefined,
    compensationBand:
      typeof row.compensationBand === "string" ? row.compensationBand : null,
  };
  if (typeof row.candidateRef === "string") {
    if (!decodeCandidateRef(row.candidateRef)) return null;
    return { candidateRef: row.candidateRef, jobRole, totalScore, ...extra };
  }
  if (typeof row.memberId === "string" && row.memberId.trim()) {
    return {
      candidateRef: encodeCandidateRef("PROGRAM", row.memberId),
      jobRole,
      totalScore,
      ...extra,
    };
  }
  return null;
}

export function readGuestCart(): GuestCartItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeGuestCartItem)
      .filter((row): row is GuestCartItem => row !== null);
  } catch {
    return [];
  }
}

export function writeGuestCart(items: GuestCartItem[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("abtalks-hire-cart"));
}

export function guestCartHas(candidateRef: string): boolean {
  return readGuestCart().some((i) => i.candidateRef === candidateRef);
}

export function toggleGuestCart(item: GuestCartItem): boolean {
  const current = readGuestCart();
  const exists = current.some((i) => i.candidateRef === item.candidateRef);
  const next = exists
    ? current.filter((i) => i.candidateRef !== item.candidateRef)
    : [...current, item].slice(0, 25);
  writeGuestCart(next);
  return !exists;
}

export function clearGuestCart(): void {
  writeGuestCart([]);
}

export function guestCartProgramIds(items: GuestCartItem[] = readGuestCart()): string[] {
  return items
    .map((i) => decodeCandidateRef(i.candidateRef))
    .filter((ref): ref is NonNullable<typeof ref> => ref?.source === "PROGRAM")
    .map((ref) => ref.id);
}

export function guestCartNonProgram(items: GuestCartItem[] = readGuestCart()): GuestCartItem[] {
  return items.filter((i) => decodeCandidateRef(i.candidateRef)?.source !== "PROGRAM");
}

/**
 * The cart minus only the program members the server CONFIRMED it has.
 *
 * The guest cart is the sole copy of a shortlist built before the recruiter had
 * an account, so forgetting an item is destructive and must be earned. Sign-in
 * used to drop every program candidate whenever the merge action returned `ok`,
 * and that action returned `ok` even when it had merged none of them — which is
 * what happens while a recruiter is still waiting on approval. Anything the
 * server did not name stays here and is retried.
 */
export function guestCartWithoutMerged(
  items: GuestCartItem[],
  mergedMemberIds: string[],
): GuestCartItem[] {
  const landed = new Set(mergedMemberIds);
  return items.filter((i) => {
    const ref = decodeCandidateRef(i.candidateRef);
    if (ref?.source !== "PROGRAM") return true;
    return !landed.has(ref.id);
  });
}
