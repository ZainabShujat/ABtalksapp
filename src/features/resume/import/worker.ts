import "server-only";
import { logger } from "@/lib/logger";
import { looksLikeResume } from "@/features/resume/normalize";
import { analyseResumeStrength } from "@/features/resume/strength";
import { parseResumeDocumentDetailed, type DetailedParseResult } from "@/features/resume/parse";
import { resumeMaxOutputTokens } from "@/features/resume/providers/openai";
import { readResumeBytes } from "@/features/resume/storage";
import { MAX_RESUME_BYTES } from "@/features/resume/types";
import { resolveImportEmail } from "@/features/resume/import/email";
import {
  createRateBudget,
  estimateReservation,
  importConfigFromEnv,
  nextRetryDelayMs,
} from "@/features/resume/import/rate-budget";
import { registerImportedStudent } from "@/features/resume/import/register";
import {
  acquireWorkerLease,
  addImportUsage,
  hasPendingImportWork,
  leaseParseJobs,
  leaseRegisterJobs,
  markImportFailed,
  markImportNeedsReview,
  markImportParsed,
  markImportRetry,
  releaseWorkerLease,
  renewWorkerLease,
  requeueStaleImports,
  type LeasedParseJob,
} from "@/repositories/resume-import";

/**
 * The résumé-import worker (plan 154).
 *
 * One drain = one serverless invocation: take the worker lease, lease jobs,
 * parse them with bounded concurrency under the rate budget, register what was
 * asked to be registered, and stop before the function's time runs out. The
 * drain route re-invokes itself while work remains, so nothing depends on a
 * browser staying open; expired leases are requeued, so nothing depends on a
 * drain finishing.
 *
 * All I/O is injected (`WorkerDeps`) — the same loop runs against the database
 * and against the 1,000-job simulation in the tests.
 */

const WORKER_LEASE_MS = 5 * 60_000;
const RENEW_EVERY_MS = 60_000;
/** A parse can take up to the 45 s request timeout; never start one later than this before the deadline. */
const START_CUTOFF_MS = 55_000;
const IDLE_POLL_MS = 2_000;
const MAX_BUDGET_WAIT_SLICE_MS = 5_000;

export type WorkerConfig = {
  concurrency: number;
  tpm: number;
  rpm: number;
  maxAttempts: number;
  minRemainingRatio: number;
  maxOutputTokens: number;
};

export type WorkerDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  config: WorkerConfig;
  acquireLease: (ms: number) => Promise<string | null>;
  renewLease: (token: string, ms: number) => Promise<string | null>;
  releaseLease: (token: string) => Promise<void>;
  requeueStale: () => Promise<number>;
  leaseParseJobs: (n: number) => Promise<LeasedParseJob[]>;
  leaseRegisterJobs: (n: number) => Promise<{ id: string }[]>;
  hasPendingWork: () => Promise<boolean>;
  readBytes: (pathname: string) => Promise<Uint8Array | null>;
  parse: (job: LeasedParseJob, bytes: Uint8Array) => Promise<DetailedParseResult>;
  register: (importId: string) => Promise<void>;
  addUsage: typeof addImportUsage;
  markParsed: typeof markImportParsed;
  markNeedsReview: typeof markImportNeedsReview;
  markRetry: typeof markImportRetry;
  markFailed: typeof markImportFailed;
};

export function defaultWorkerDeps(): WorkerDeps {
  const env = importConfigFromEnv();
  return {
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    config: { ...env, maxOutputTokens: resumeMaxOutputTokens() },
    acquireLease: acquireWorkerLease,
    renewLease: renewWorkerLease,
    releaseLease: releaseWorkerLease,
    requeueStale: requeueStaleImports,
    leaseParseJobs,
    leaseRegisterJobs,
    hasPendingWork: hasPendingImportWork,
    readBytes: (pathname) => readResumeBytes(pathname, MAX_RESUME_BYTES),
    parse: (job, bytes) =>
      parseResumeDocumentDetailed(
        { bytes, mimeType: "application/pdf", fileName: job.originalFilename },
        { ctx: { source: "IMPORT", resumeImportId: job.id }, retry429: false },
      ),
    register: async (importId) => {
      await registerImportedStudent(importId);
    },
    addUsage: addImportUsage,
    markParsed: markImportParsed,
    markNeedsReview: markImportNeedsReview,
    markRetry: markImportRetry,
    markFailed: markImportFailed,
  };
}

export type DrainResult = {
  skipped: boolean;
  parsed: number;
  needsReview: number;
  failed: number;
  retried: number;
  registered: number;
  remaining: boolean;
};

/** Admin-facing wording for `ResumeImport.lastError`. No vendor bodies. */
const RETRY_LABEL: Record<string, string> = {
  rate_limited: "Rate limited by OpenAI — retrying automatically.",
  unavailable: "OpenAI unavailable — retrying automatically.",
  truncated: "Reply was cut off — retrying automatically.",
  bad_output: "Unreadable reply — retrying automatically.",
};

/**
 * Everything after a successful model call. Shared with a future Batch API
 * collector, which would hand the same `DetailedParseResult` in.
 */
export async function completeImport(
  job: Pick<LeasedParseJob, "id">,
  result: Extract<DetailedParseResult, { ok: true }>,
  deps: Pick<WorkerDeps, "markParsed" | "markNeedsReview" | "markFailed">,
): Promise<"PARSED" | "NEEDS_REVIEW" | "FAILED"> {
  const data = result.data;
  if (!looksLikeResume(data)) {
    await deps.markFailed(job.id, "This PDF does not look like a résumé.");
    return "FAILED";
  }
  const analysis = analyseResumeStrength(data);
  const email = resolveImportEmail(data.email, result.emails);

  if (email.kind === "single") {
    return deps.markParsed(job.id, {
      parsed: data,
      analysis,
      sourceEmail: email.source,
      normalizedEmail: email.email,
      emailCandidates: [email.email],
    });
  }
  await deps.markNeedsReview(job.id, {
    reason:
      email.kind === "none"
        ? "No email address found in the résumé — enter it to continue."
        : "Several email addresses found — choose the student's.",
    parsed: data,
    analysis,
    sourceEmail: data.email,
    emailCandidates: email.kind === "conflict" ? email.candidates : [],
  });
  return "NEEDS_REVIEW";
}

export async function drainResumeImports(
  opts: { budgetMs?: number } = {},
  deps: WorkerDeps = defaultWorkerDeps(),
): Promise<DrainResult> {
  const result: DrainResult = {
    skipped: false,
    parsed: 0,
    needsReview: 0,
    failed: 0,
    retried: 0,
    registered: 0,
    remaining: false,
  };

  let token = await deps.acquireLease(WORKER_LEASE_MS);
  if (!token) return { ...result, skipped: true, remaining: true };

  const started = deps.now();
  const deadline = started + (opts.budgetMs ?? 240_000);
  const stopStartingAt = deadline - START_CUTOFF_MS;
  let lastRenew = started;
  const { config } = deps;
  const estimate = estimateReservation(config.maxOutputTokens);
  const budget = createRateBudget({
    tpm: config.tpm,
    rpm: config.rpm,
    minRemainingRatio: config.minRemainingRatio,
    now: deps.now,
  });
  const inFlight = new Set<Promise<void>>();

  async function runParseJob(job: LeasedParseJob): Promise<void> {
    // 1. Wait for budget — but never past the point where a call could still finish.
    let reservationId: number | null = null;
    while (reservationId === null) {
      const r = budget.tryReserve(estimate);
      if ("id" in r) {
        reservationId = r.id;
        break;
      }
      if (deps.now() + r.waitMs > stopStartingAt) {
        // Hand the job back unchanged-in-spirit: due now, for the next drain.
        await deps.markRetry(job.id, new Date(deps.now()), "Waiting for rate budget.");
        result.retried++;
        return;
      }
      await deps.sleep(Math.min(r.waitMs, MAX_BUDGET_WAIT_SLICE_MS));
    }

    // 2. The file.
    const bytes = job.blobPathname ? await deps.readBytes(job.blobPathname) : null;
    if (!bytes) {
      budget.settle(reservationId, 0);
      await deps.markFailed(job.id, "The uploaded file is missing — upload it again.");
      result.failed++;
      return;
    }

    // 3. The model.
    const res = await deps.parse(job, bytes);
    budget.settle(reservationId, res.usage.prompt + res.usage.completion);
    budget.observe(res.rate);
    await deps.addUsage(job.id, {
      promptTokens: res.usage.prompt,
      completionTokens: res.usage.completion,
      costMicroUsd: res.costMicroUsd,
      model: res.model,
    });

    if (res.ok) {
      const outcome = await completeImport(job, res, deps);
      if (outcome === "PARSED") result.parsed++;
      else if (outcome === "NEEDS_REVIEW") result.needsReview++;
      else result.failed++;
      return;
    }

    // 4. Failures: stop, or schedule a retry without holding a slot.
    if (res.kind === "rate_limited") {
      budget.pauseUntil(deps.now() + (res.retryAfterMs ?? 2_000));
    }
    if (res.kind === "quota") {
      await deps.markFailed(job.id, "OpenAI quota exhausted — top up the account, then Retry failed.");
      result.failed++;
      return;
    }
    if (res.kind === "not_configured") {
      await deps.markFailed(job.id, "Résumé parsing is not configured (OPENAI_API_KEY).");
      result.failed++;
      return;
    }
    if (res.kind === "empty") {
      await deps.markFailed(job.id, "No readable text — this may be a scan or a photo.");
      result.failed++;
      return;
    }
    if (job.attempts < config.maxAttempts) {
      const delay = nextRetryDelayMs(job.attempts, res.retryAfterMs, deps.random);
      await deps.markRetry(job.id, new Date(deps.now() + delay), RETRY_LABEL[res.kind] ?? "Retrying.");
      result.retried++;
      return;
    }
    await deps.markFailed(job.id, `Gave up after ${job.attempts} attempts (${res.kind}).`);
    result.failed++;
  }

  function track(job: LeasedParseJob) {
    const p = runParseJob(job)
      .catch(async (error: unknown) => {
        logger.error("[resume-import] job crashed", { importId: job.id, error: String(error) });
        // Leave it for the lease to expire if even this fails.
        await deps
          .markRetry(job.id, new Date(deps.now() + 30_000), "Unexpected error — retrying.")
          .catch(() => undefined);
      })
      .finally(() => {
        inFlight.delete(p);
      });
    inFlight.add(p);
  }

  try {
    await deps.requeueStale();

    for (;;) {
      const now = deps.now();
      if (now >= stopStartingAt) break;

      if (now - lastRenew >= RENEW_EVERY_MS) {
        const renewed = await deps.renewLease(token, WORKER_LEASE_MS);
        if (!renewed) {
          logger.warn("[resume-import] worker lease lost — stopping");
          break;
        }
        token = renewed;
        lastRenew = now;
      }

      // Registrations are database-only: no model budget, one at a time.
      const regs = await deps.leaseRegisterJobs(2);
      for (const r of regs) {
        try {
          await deps.register(r.id);
          result.registered++;
        } catch (error) {
          logger.error("[resume-import] registration crashed", { importId: r.id, error: String(error) });
        }
      }

      const free = config.concurrency - inFlight.size;
      const jobs = free > 0 ? await deps.leaseParseJobs(free) : [];
      for (const job of jobs) track(job);

      if (jobs.length === 0 && regs.length === 0) {
        if (inFlight.size > 0) {
          await Promise.race(inFlight);
          continue;
        }
        if (!(await deps.hasPendingWork())) break;
        // Only future-dated retries left: wait a little and look again.
        await deps.sleep(IDLE_POLL_MS);
        continue;
      }
      if (inFlight.size >= config.concurrency) await Promise.race(inFlight);
    }

    await Promise.all(inFlight);
  } finally {
    await deps.releaseLease(token).catch(() => undefined);
  }

  result.remaining = await deps.hasPendingWork();
  logger.info("[resume-import] drain finished", {
    ...result,
    ms: deps.now() - started,
  });
  return result;
}

/* ─── Keeping the drain going without a browser ─────────────────────────── */

/**
 * The URL of THIS deployment. Never `NEXT_PUBLIC_APP_URL`: in local dev that
 * can point at production, and a local drain would then kick the live site.
 * `VERCEL_URL` is the deployment's own host.
 */
function selfBaseUrl(): string | null {
  const override = process.env.RESUME_IMPORT_SELF_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV !== "production") return `http://localhost:${process.env.PORT ?? 3000}`;
  return null;
}

/**
 * Start a fresh drain in a NEW function invocation, fire-and-forget. The
 * request is abandoned after 3 s; the invoked function keeps running.
 */
export async function kickDrain(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const base = selfBaseUrl();
  if (!secret || !base) {
    logger.warn("[resume-import] cannot self-kick (CRON_SECRET or deployment URL missing)");
    return;
  }
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  await fetch(`${base}/api/internal/resume-imports/drain`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(3_000),
  }).catch(() => undefined); // the abort is expected
}

/** One drain here, then hand over to a new invocation while work remains. */
export async function drainAndContinue(budgetMs = 230_000): Promise<DrainResult> {
  const result = await drainResumeImports({ budgetMs });
  if (!result.skipped && result.remaining) await kickDrain();
  return result;
}
