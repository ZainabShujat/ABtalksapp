import { jobSpecSchema, type JobSpec } from "@/lib/validations/hire";

export const PENDING_DEMAND_KEY = "abtalks-hire-pending-demand";

/**
 * A requirement the recruiter asked us to capture before they had an account.
 *
 * Same storage discipline as `pending-checkout.ts`: one key, bounded payload,
 * never throw, never write an empty value. localStorage rather than session
 * because a sign-in can bounce through Google and come back on a new tab.
 */
export type PendingDemand = {
  spec: JobSpec;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function savePendingDemand(intent: PendingDemand): void {
  if (!canUseStorage()) return;
  const parsed = jobSpecSchema.safeParse(intent.spec);
  if (!parsed.success) return;
  const spec = parsed.data;
  if (!spec.title?.trim() && (spec.mustHaveStack?.length ?? 0) === 0) return;
  window.localStorage.setItem(PENDING_DEMAND_KEY, JSON.stringify({ spec }));
}

export function readPendingDemand(): PendingDemand | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PENDING_DEMAND_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const spec = jobSpecSchema.safeParse((parsed as PendingDemand).spec);
    if (!spec.success) return null;
    return { spec: spec.data };
  } catch {
    return null;
  }
}

export function clearPendingDemand(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(PENDING_DEMAND_KEY);
}
