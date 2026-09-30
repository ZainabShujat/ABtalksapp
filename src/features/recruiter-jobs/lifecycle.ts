import type { JobStatus, JobWorkMode, JobType } from "@prisma/client";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" };

export type LifecycleAction = "publish" | "close" | "reopen";

export function nextStatus(
  current: JobStatus,
  action: LifecycleAction,
): JobStatus | null {
  if (action === "publish") {
    if (current === "DRAFT" || current === "CLOSED") return "PUBLISHED";
    return null;
  }
  if (action === "close") {
    if (current === "PUBLISHED") return "CLOSED";
    return null;
  }
  if (action === "reopen") {
    if (current === "CLOSED") return "PUBLISHED";
    return null;
  }
  return null;
}

export type JobLifecycleFields = {
  status: JobStatus;
  isOpen: boolean;
  publishedAt: Date | null;
  closedAt: Date | null;
};

/** Compute the field patch to apply for a lifecycle transition. */
export function lifecyclePatch(
  current: JobLifecycleFields,
  action: LifecycleAction,
  now: Date = new Date(),
): Result<Partial<JobLifecycleFields>> {
  const target = nextStatus(current.status, action);
  if (!target) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Cannot ${action} a job in status ${current.status}.`,
    };
  }
  const patch: Partial<JobLifecycleFields> = {
    status: target,
    isOpen: target === "PUBLISHED",
  };
  if (target === "PUBLISHED" && !current.publishedAt) {
    patch.publishedAt = now;
  }
  if (target === "CLOSED") {
    patch.closedAt = now;
  }
  return { ok: true, data: patch };
}

export type JobDraftInput = {
  title: string;
  description: string;
  skills: string[];
  location: string;
  workMode: JobWorkMode;
  opportunityType: JobType;
  company: string;
  /** Years of experience asked for; null or absent when the posting is silent. */
  minExperience?: number | null;
};

export function normalizeSkills(input: readonly string[] | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, 25);
}
