/**
 * Plan 154 — résumé parsing on OpenAI, admin bulk import, registration, claim.
 *
 * Offline: no database, no network, no API key. The database URL is pointed at
 * a closed port before anything imports Prisma, and `fetch` is stubbed. The
 * DB-backed journey (Admin → Parse → Register → Recruiter → Google claim) is
 * `import-e2e.test.ts`.
 *
 * T1  provider switch + user-facing messages          T11 identity mapping
 * T2  model config + request shape                    T12 visibility kinds
 * T3  admin guards (source)                           T13 unlock refused before charging
 * T4  dedup (source + schema)                         T14 Google claim: verified match
 * T5  email normalisation / resolution                T15 claim atomicity + lost race
 * T6  NEEDS_REVIEW / not-a-résumé paths               T16 existing data never overwritten
 * T7  429 retry, backoff, quota                       T17 no duplicate candidate after claim
 * T8  rate budget                                     T18 non-import accounts unchanged
 * T9  1,000-job simulated load                        T19 usage + cost recorded per attempt
 * T10 interruption + lease recovery
 *
 * Run: npm run test:resume-import
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Before ANY import that could construct a Prisma client.
process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
process.env.DIRECT_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
process.env.OPENAI_API_KEY = "sk-test-offline";
delete process.env.RESUME_OPENAI_API_KEY;
delete process.env.RESUME_PARSER_PROVIDER;
delete process.env.RESUME_OPENAI_MODEL;

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function suite(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  }
}

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Deterministic PRNG so the load simulation is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { normalizeEmail, resolveImportEmail } = await import("@/features/resume/import/email");
  const { identityFromParsedResume } = await import("@/features/resume/import/identity-mapping");
  const budgetMod = await import("@/features/resume/import/rate-budget");
  const openai = await import("@/features/resume/providers/openai");
  const parseMod = await import("@/features/resume/parse");
  const { normalizeParsedResume } = await import("@/features/resume/normalize");
  const worker = await import("@/features/resume/import/worker");
  const claim = await import("@/features/resume/import/claim");
  const visibility = await import("@/repositories/visibility");

  const raw = JSON.parse(
    src("src/features/resume/fixtures/sample-resume.raw.json"),
  ) as Record<string, unknown>;
  const fixture = normalizeParsedResume(raw);

  /* ─── T1 / T19 ─────────────────────────────────────────────────────────── */
  console.log("\nT1 / T19 — provider, messages, usage");

  const realFetch = globalThis.fetch;
  function stubFetch(responses: Array<() => Response>) {
    let i = 0;
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      const make = responses[Math.min(i++, responses.length - 1)]!;
      return make();
    }) as typeof fetch;
    return calls;
  }
  const okResponse = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ...raw, all_emails: ["asha.menon@example.com"] }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1376, completion_tokens: 947 },
      }),
      { status: 200, headers: { "x-ratelimit-limit-tokens": "200000", "x-ratelimit-remaining-tokens": "190000" } },
    );
  const rateLimited = () =>
    new Response(JSON.stringify({ error: { message: "slow down", code: "rate_limit_exceeded" } }), {
      status: 429,
      headers: { "retry-after-ms": "5" },
    });

  await suite("OpenAI is the default provider; Gemini only when configured", () => {
    assert(parseMod.resumeParserProvider() === "openai", "default");
    process.env.RESUME_PARSER_PROVIDER = "gemini";
    assert(parseMod.resumeParserProvider() === "gemini", "gemini");
    delete process.env.RESUME_PARSER_PROVIDER;
  });

  await suite("a successful OpenAI parse yields the normalised ParsedResume and the email list", async () => {
    const calls = stubFetch([okResponse]);
    const res = await parseMod.parseResumeDocumentDetailed(
      { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "a.pdf" },
      { ctx: { source: "IMPORT" }, retry429: false },
    );
    assert(res.ok, "should parse");
    assert(res.data.candidateName === fixture.candidateName, "same normaliser output");
    assert(res.emails.includes("asha.menon@example.com"), "all_emails read");
    assert(calls[0]!.url.includes("api.openai.com"), "OpenAI endpoint");
  });

  await suite("T19: a 429 then success is two attempts, both counted in usage and cost", async () => {
    stubFetch([rateLimited, okResponse]);
    const res = await parseMod.parseResumeDocumentDetailed(
      { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: null },
      { ctx: { source: "REGISTER", userId: "u1" }, retry429: true },
    );
    assert(res.ok, "retried to success");
    assert(res.usage.prompt === 1376, `usage summed over attempts: ${res.usage.prompt}`);
    const expected = openai.costMicroUsd("gpt-4.1-mini", 1376, 947);
    assert(res.costMicroUsd === expected, `cost ${res.costMicroUsd} vs ${expected}`);
  });

  await suite("user-facing messages are the existing wording, never vendor detail", async () => {
    stubFetch([rateLimited]);
    const busy = await parseMod.parseResumeDocument(
      { bytes: new Uint8Array([1]), mimeType: "application/pdf", fileName: null },
      { source: "PROFILE" },
    );
    assert(!busy.ok && busy.message.includes("busy right now"), `busy: ${JSON.stringify(busy)}`);
    stubFetch([() => new Response("{}", { status: 500 })]);
    const down = await parseMod.parseResumeDocument(
      { bytes: new Uint8Array([1]), mimeType: "application/pdf", fileName: null },
    );
    assert(!down.ok && !/openai|500|HTTP/i.test(down.message), `no vendor detail: ${JSON.stringify(down)}`);
  });

  await suite("insufficient_quota is 'quota', not a retryable rate limit", async () => {
    stubFetch([() => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 })]);
    const r = await openai.callOpenAiResumeParser({ bytes: new Uint8Array([1]), fileName: null, system: "s", user: "u" });
    assert(!r.ok && r.kind === "quota", `kind ${r.ok ? "ok" : r.kind}`);
  });

  await suite("cost math: price per 1M tokens = micro-USD per token", () => {
    assert(openai.costMicroUsd("gpt-4.1-mini", 1_000_000, 0) === 400_000, "input $0.40/M");
    assert(openai.costMicroUsd("gpt-4.1-mini", 0, 1_000_000) === 1_600_000, "output $1.60/M");
  });
  globalThis.fetch = realFetch;

  /* ─── T2 ───────────────────────────────────────────────────────────────── */
  console.log("\nT2 — model configuration");

  await suite("one model literal, in providers/openai.ts only", () => {
    const files = [
      "src/features/resume/parse.ts",
      "src/features/resume/import/worker.ts",
      "src/features/resume/import/register.ts",
      "src/features/resume/usage.ts",
      "src/app/actions/admin-resume-import-actions.ts",
    ];
    for (const f of files) {
      assert(!/["']gpt-[0-9]/.test(src(f)), `${f} names a model`);
    }
    assert(src("src/features/resume/providers/openai.ts").includes('RESUME_OPENAI_DEFAULT_MODEL = "gpt-4.1-mini"'), "default");
  });

  await suite("RESUME_OPENAI_MODEL overrides; the key falls back to OPENAI_API_KEY", () => {
    assert(openai.resumeOpenAiModel() === "gpt-4.1-mini", "default model");
    process.env.RESUME_OPENAI_MODEL = "gpt-5-mini";
    assert(openai.resumeOpenAiModel() === "gpt-5-mini", "override");
    delete process.env.RESUME_OPENAI_MODEL;
    assert(openai.resumeOpenAiKey() === "sk-test-offline", "fallback key");
    process.env.RESUME_OPENAI_API_KEY = "sk-dedicated";
    assert(openai.resumeOpenAiKey() === "sk-dedicated", "dedicated key wins");
    delete process.env.RESUME_OPENAI_API_KEY;
  });

  await suite("request shape: strict schema, PDF file part; gpt-5 uses reasoning params", () => {
    const base = { bytes: new Uint8Array([1, 2]), fileName: "x.pdf", system: "s", user: "u", maxOutputTokens: 4096 };
    const mini = openai.buildResumeRequestBody({ ...base, model: "gpt-4.1-mini" });
    assert(mini.temperature === 0 && mini.max_tokens === 4096, "4.1-mini sampling");
    const rf = mini.response_format as { type: string; json_schema: { strict: boolean } };
    assert(rf.type === "json_schema" && rf.json_schema.strict === true, "strict schema");
    const content = (mini.messages as { content: unknown }[])[1]!.content as { type: string }[];
    assert(content[0]!.type === "file", "PDF as file part");
    const five = openai.buildResumeRequestBody({ ...base, model: "gpt-5-mini" });
    assert(five.temperature === undefined && five.max_completion_tokens === 4096, "gpt-5 params");
    assert(five.reasoning_effort === "minimal", "minimal reasoning");
  });

  await suite("never the interview judge's model by default", () => {
    const model: string = openai.RESUME_OPENAI_DEFAULT_MODEL;
    assert(model !== "gpt-4o", "must not share gpt-4o's budget");
  });

  /* ─── T3 / T4 ──────────────────────────────────────────────────────────── */
  console.log("\nT3 / T4 — admin guards and dedup (source)");

  await suite("every admin action checks getAdminContext() first", () => {
    const s = src("src/app/actions/admin-resume-import-actions.ts");
    assert(s.startsWith('"use server"'), "is a server action file");
    const fns = s.split(/\nexport async function /).slice(1);
    assert(fns.length === 6, `expected 6 actions, found ${fns.length}`);
    for (const fn of fns) {
      const body = fn.slice(fn.indexOf("{\n") + 2).trim();
      assert(
        body.startsWith("const admin = await getAdminContext();\n  if (!admin) return NOT_AUTHORISED;"),
        `${fn.slice(0, 40)} does not guard first`,
      );
    }
  });

  await suite("the actions file exports nothing unguarded (no consts, no helpers)", () => {
    const s = src("src/app/actions/admin-resume-import-actions.ts");
    const exported = [...s.matchAll(/^export (const|function|async function|let|class) (\w+)/gm)];
    for (const m of exported) {
      assert(m[1] === "async function", `unguarded export: ${m[1]} ${m[2]}`);
    }
    assert(!src("src/features/resume/import/status.ts").trimStart().startsWith('"use server"'), "status.ts is not an action file");
  });

  await suite("the upload-token route admits admins only, PDFs only, staging only", () => {
    const s = src("src/app/api/admin/resume-imports/upload/route.ts");
    assert(s.includes("const admin = await getAdminContext();") && s.includes('throw new Error("NOT_AUTHORISED")'), "admin gate");
    assert(s.includes('allowedContentTypes: ["application/pdf"]'), "PDF only");
    assert(s.includes("STAGING_PATH.test(pathname)"), "staging prefix");
    assert(!/onUploadCompleted\s*[:(]/.test(s), "no unauthenticated webhook");
  });

  await suite("registration (manual or automatic) always requires the consent attestation server-side", () => {
    const s = src("src/app/actions/admin-resume-import-actions.ts");
    assert(s.includes("consentAttested: z.literal(true)"), "manual register");
    assert(s.includes("!v.autoRegister || v.consentAttested === true"), "auto-register on parse");
  });

  await suite("the page requires admin; staged paths are restricted to the staging prefix", () => {
    assert(src("src/app/admin/resume-imports/page.tsx").includes("await requireAdmin();"), "page guard");
    const s = src("src/app/actions/admin-resume-import-actions.ts");
    assert(s.includes("p.startsWith(IMPORT_STAGING_PREFIX)") && s.includes('!p.includes("..")'), "path guard");
  });

  await suite("T4: same bytes are one import (unique hash, checked before storing)", () => {
    assert(/contentHash\s+String\s+@unique/.test(src("prisma/schema.prisma")), "unique contentHash");
    const s = src("src/app/actions/admin-resume-import-actions.ts");
    const check = s.indexOf("await findImportByHash(contentHash)");
    const store = s.indexOf("await promoteImportFile(");
    assert(check > 0 && check < store, "dedup before storing");
  });

  await suite("drain routes are CRON_SECRET-only and never use NEXT_PUBLIC_APP_URL to self-call", () => {
    for (const f of ["src/app/api/internal/resume-imports/drain/route.ts", "src/app/api/cron/resume-imports/route.ts"]) {
      assert(src(f).includes("`Bearer ${secret}`"), `${f} secret`);
    }
    assert(!src("src/features/resume/import/worker.ts").includes("NEXT_PUBLIC_APP_URL ??"), "no prod URL fallback");
  });

  /* ─── T5 ───────────────────────────────────────────────────────────────── */
  console.log("\nT5 — email");

  await suite("normalizeEmail trims, lowercases, strips mailto/<>, validates", () => {
    assert(normalizeEmail("  Asha.Menon@Example.COM ") === "asha.menon@example.com", "trim+lower");
    assert(normalizeEmail("mailto:a@b.co") === "a@b.co", "mailto");
    assert(normalizeEmail("<a@b.co>") === "a@b.co", "angle brackets");
    assert(normalizeEmail("not an email") === null, "invalid");
    assert(normalizeEmail("") === null && normalizeEmail(null) === null, "empty");
  });

  await suite("resolveImportEmail: one, none, and several — never silently picks", () => {
    const one = resolveImportEmail("A@b.co", ["a@B.co"]);
    assert(one.kind === "single" && one.email === "a@b.co", "dedup by normalised form");
    assert(resolveImportEmail(null, []).kind === "none", "none");
    const two = resolveImportEmail("a@b.co", ["c@d.co"]);
    assert(two.kind === "conflict" && two.candidates.length === 2, "conflict");
  });

  /* ─── T6 ───────────────────────────────────────────────────────────────── */
  console.log("\nT6 — outcomes of a parse");

  function outcomeDeps() {
    const log: string[] = [];
    return {
      log,
      deps: {
        markParsed: async (_id: string, i: { normalizedEmail: string }) => {
          log.push(`parsed:${i.normalizedEmail}`);
          return "PARSED" as const;
        },
        markNeedsReview: async (_id: string, i: { reason: string; emailCandidates?: string[] }) => {
          log.push(`review:${i.emailCandidates?.length ?? 0}`);
        },
        markFailed: async (_id: string, m: string) => {
          log.push(`failed:${m}`);
        },
      },
    };
  }
  const okResult = (data = fixture, emails: string[] = []) => ({
    ok: true as const,
    data,
    emails,
    model: "gpt-4.1-mini",
    usage: { prompt: 1, completion: 1 },
    costMicroUsd: 1,
    rate: null,
  });

  await suite("single email → PARSED", async () => {
    const { log, deps } = outcomeDeps();
    await worker.completeImport({ id: "i" }, okResult(fixture, [fixture.email ?? ""]), deps as never);
    assert(log[0] === `parsed:${fixture.email}`, log.join());
  });

  await suite("no email → NEEDS_REVIEW; two emails → NEEDS_REVIEW with both candidates", async () => {
    const a = outcomeDeps();
    await worker.completeImport({ id: "i" }, okResult({ ...fixture, email: null }, []), a.deps as never);
    assert(a.log[0] === "review:0", a.log.join());
    const b = outcomeDeps();
    await worker.completeImport({ id: "i" }, okResult(fixture, ["other@example.com"]), b.deps as never);
    assert(b.log[0] === "review:2", b.log.join());
  });

  await suite("a document that is not a résumé → FAILED", async () => {
    const { log, deps } = outcomeDeps();
    const empty = normalizeParsedResume({});
    await worker.completeImport({ id: "i" }, okResult(empty, ["x@y.co"]), deps as never);
    assert(log[0]?.startsWith("failed:"), log.join());
  });

  /* ─── Fake queue for T7–T10 ────────────────────────────────────────────── */

  type Row = {
    id: string;
    status: string;
    attempts: number;
    nextAttemptAt: number | null;
    leaseUntil: number | null;
    lastError: string | null;
  };

  function makeWorld(n: number, opts: {
    seed: number;
    p429?: number;
    pBad?: number;
    pQuota?: number;
    concurrency?: number;
    tpm?: number;
    maxAttempts?: number;
  }) {
    const rnd = mulberry32(opts.seed);
    let now = 1_700_000_000_000;
    const rows = new Map<string, Row>();
    for (let i = 0; i < n; i++) {
      rows.set(`r${i}`, { id: `r${i}`, status: "QUEUED", attempts: 0, nextAttemptAt: null, leaseUntil: null, lastError: null });
    }
    let lease: { token: string; until: number } | null = null;
    let inCall = 0;
    let maxInCall = 0;
    const starts: { at: number; tokens: number }[] = [];
    const config = {
      concurrency: opts.concurrency ?? 4,
      tpm: opts.tpm ?? 100_000,
      rpm: 200,
      maxAttempts: opts.maxAttempts ?? 6,
      minRemainingRatio: 0.3,
      maxOutputTokens: 4096,
    };

    const deps = {
      now: () => now,
      sleep: async (ms: number) => {
        now += Math.max(1, ms);
      },
      random: rnd,
      config,
      acquireLease: async (ms: number) => {
        if (lease && lease.until > now) return null;
        lease = { token: `t${now}`, until: now + ms };
        return lease.token;
      },
      renewLease: async (token: string, ms: number) => {
        if (!lease || lease.token !== token) return null;
        lease = { token: `t${now}`, until: now + ms };
        return lease.token;
      },
      releaseLease: async (token: string) => {
        if (lease?.token === token) lease = null;
      },
      requeueStale: async () => {
        let c = 0;
        for (const r of rows.values()) {
          if (r.status === "PROCESSING" && (r.leaseUntil ?? 0) < now) {
            r.status = "QUEUED";
            r.leaseUntil = null;
            c++;
          }
        }
        return c;
      },
      leaseParseJobs: async (k: number) => {
        const due = [...rows.values()]
          .filter((r) => r.status === "QUEUED" && (r.nextAttemptAt === null || r.nextAttemptAt <= now))
          .slice(0, k);
        for (const r of due) {
          r.status = "PROCESSING";
          r.leaseUntil = now + 300_000;
          r.attempts++;
        }
        return due.map((r) => ({ id: r.id, blobPathname: `p/${r.id}`, originalFilename: `${r.id}.pdf`, attempts: r.attempts, registerRequested: false }));
      },
      leaseRegisterJobs: async () => [],
      hasPendingWork: async () => [...rows.values()].some((r) => r.status === "QUEUED" || r.status === "PROCESSING"),
      readBytes: async () => new Uint8Array([37, 80, 68, 70]),
      parse: async () => {
        inCall++;
        maxInCall = Math.max(maxInCall, inCall);
        const tokens = 2000 + Math.floor(rnd() * 3000);
        starts.push({ at: now, tokens });
        now += 3_000 + Math.floor(rnd() * 17_000); // 3–20 s latency
        inCall--;
        const roll = rnd();
        const usage = { prompt: Math.floor(tokens * 0.6), completion: tokens - Math.floor(tokens * 0.6) };
        if (roll < (opts.pQuota ?? 0)) {
          return { ok: false as const, kind: "quota" as const, message: "m", retryAfterMs: null, model: "m", usage, costMicroUsd: 1, rate: null };
        }
        if (roll < (opts.pQuota ?? 0) + (opts.p429 ?? 0)) {
          return { ok: false as const, kind: "rate_limited" as const, message: "m", retryAfterMs: 1_000, model: "m", usage: { prompt: 0, completion: 0 }, costMicroUsd: 0, rate: null };
        }
        if (roll < (opts.pQuota ?? 0) + (opts.p429 ?? 0) + (opts.pBad ?? 0)) {
          return { ok: false as const, kind: "bad_output" as const, message: "m", retryAfterMs: null, model: "m", usage, costMicroUsd: 1, rate: null };
        }
        return { ...okResult(fixture, [fixture.email ?? ""]), usage };
      },
      register: async () => undefined,
      addUsage: async () => undefined,
      markParsed: async (id: string) => {
        const r = rows.get(id)!;
        r.status = "PARSED";
        r.leaseUntil = null;
        return "PARSED" as const;
      },
      markNeedsReview: async (id: string) => {
        rows.get(id)!.status = "NEEDS_REVIEW";
      },
      markRetry: async (id: string, at: Date, err: string) => {
        const r = rows.get(id)!;
        r.status = "QUEUED";
        r.nextAttemptAt = at.getTime();
        r.leaseUntil = null;
        r.lastError = err;
      },
      markFailed: async (id: string, err: string) => {
        const r = rows.get(id)!;
        r.status = "FAILED";
        r.leaseUntil = null;
        r.lastError = err;
      },
    };
    return {
      rows,
      deps,
      config,
      starts,
      maxInCall: () => maxInCall,
      setNow: (t: number) => {
        now = t;
      },
      getNow: () => now,
      holdLease: () => {
        lease = { token: "other", until: now + 300_000 };
      },
    };
  }

  /** Keep draining the way the self-chain would, until nothing is pending. */
  async function drainAll(world: ReturnType<typeof makeWorld>, maxDrains = 2_000) {
    let drains = 0;
    while (drains < maxDrains && (await world.deps.hasPendingWork())) {
      await worker.drainResumeImports({ budgetMs: 240_000 }, world.deps as never);
      drains++;
    }
    return drains;
  }

  /* ─── T7 ───────────────────────────────────────────────────────────────── */
  console.log("\nT7 — retries");

  await suite("backoff: full jitter within [0, min(cap, base·2^(n-1))], never below retry-after", () => {
    for (let n = 1; n <= 10; n++) {
      const hi = Math.min(60_000, 2_000 * 2 ** (n - 1));
      assert(budgetMod.fullJitterBackoff(n, { random: () => 0.999999 }) < hi, `attempt ${n} ceiling`);
      assert(budgetMod.fullJitterBackoff(n, { random: () => 0 }) === 0, `attempt ${n} floor`);
    }
    assert(budgetMod.nextRetryDelayMs(1, 30_000, () => 0) === 30_000, "honours retry-after");
  });

  await suite("a 429 schedules a retry no sooner than retry-after; MAX attempts → FAILED", async () => {
    const w = makeWorld(1, { seed: 1, p429: 1, maxAttempts: 3 });
    const t0 = w.getNow();
    await worker.drainResumeImports({ budgetMs: 240_000 }, w.deps as never);
    const r = w.rows.get("r0")!;
    // Either still waiting with a future due time, or failed after 3 tries within the drain.
    if (r.status === "QUEUED") assert((r.nextAttemptAt ?? 0) >= t0 + 1_000, "retry-after honoured");
    await drainAll(w);
    assert(r.status === "FAILED" && r.attempts === 3, `status ${r.status} after ${r.attempts}`);
    assert(r.lastError?.includes("Gave up") === true, r.lastError ?? "");
  });

  await suite("quota is not retried automatically", async () => {
    const w = makeWorld(1, { seed: 2, pQuota: 1 });
    await drainAll(w);
    const r = w.rows.get("r0")!;
    assert(r.status === "FAILED" && r.attempts === 1, `${r.status} ${r.attempts}`);
    assert(r.lastError?.includes("quota") === true, r.lastError ?? "");
  });

  /* ─── T8 ───────────────────────────────────────────────────────────────── */
  console.log("\nT8 — rate budget");

  await suite("reservations never exceed TPM or RPM in a 60 s window", () => {
    let t = 0;
    const b = budgetMod.createRateBudget({ tpm: 20_000, rpm: 3, minRemainingRatio: 0.3, now: () => t });
    const g1 = b.tryReserve(8_000);
    const g2 = b.tryReserve(8_000);
    const g3 = b.tryReserve(8_000);
    assert("id" in g1 && "id" in g2, "two fit");
    assert("waitMs" in g3 && g3.waitMs > 0, "third waits (TPM)");
    if ("id" in g1) b.settle(g1.id, 1_000);
    const g4 = b.tryReserve(8_000);
    assert("id" in g4, "settling to actual frees budget");
    const g5 = b.tryReserve(10);
    assert("waitMs" in g5, "RPM 3 reached");
    t += 60_000;
    assert("id" in b.tryReserve(8_000), "window slides");
  });

  await suite("low remaining quota in the headers pauses new work until reset", () => {
    let t = 0;
    const b = budgetMod.createRateBudget({ tpm: 1_000_000, rpm: 1_000, minRemainingRatio: 0.3, now: () => t });
    b.observe({ limitTokens: 200_000, remainingTokens: 10_000, resetTokensMs: 4_000, limitRequests: null, remainingRequests: null, resetRequestsMs: null });
    const r = b.tryReserve(1);
    assert("waitMs" in r && r.waitMs === 4_000, JSON.stringify(r));
    t += 4_000;
    assert("id" in b.tryReserve(1), "resumes after reset");
  });

  await suite("reset durations parse (6ms, 8.64s, 1m2s)", () => {
    assert(openai.parseResetDuration("6ms") === 6, "ms");
    assert(openai.parseResetDuration("8.64s") === 8_640, "s");
    assert(openai.parseResetDuration("1m2s") === 62_000, "m+s");
    assert(openai.parseResetDuration(null) === null, "null");
  });

  /* ─── T9 ───────────────────────────────────────────────────────────────── */
  console.log("\nT9 — 1,000 résumés, server-side, no browser");

  await suite("1,000 jobs with 5% 429s and 1% bad replies all reach a final state within budget", async () => {
    const w = makeWorld(1_000, { seed: 42, p429: 0.05, pBad: 0.01, concurrency: 4, tpm: 100_000 });
    const drains = await drainAll(w);
    const statuses = [...w.rows.values()].map((r) => r.status);
    const pending = statuses.filter((s) => s === "QUEUED" || s === "PROCESSING").length;
    assert(pending === 0, `${pending} still pending after ${drains} drains`);
    const parsed = statuses.filter((s) => s === "PARSED").length;
    assert(parsed >= 990, `parsed ${parsed}/1000`);
    assert(w.maxInCall() <= w.config.concurrency, `concurrency ${w.maxInCall()}`);

    // No 60 s window ever started more actual tokens than the TPM budget.
    const s = w.starts;
    let lo = 0;
    let sum = 0;
    let worst = 0;
    for (let hi = 0; hi < s.length; hi++) {
      sum += s[hi]!.tokens;
      while (s[hi]!.at - s[lo]!.at >= 60_000) sum -= s[lo++]!.tokens;
      worst = Math.max(worst, sum);
    }
    assert(worst <= w.config.tpm, `window peaked at ${worst} tokens > ${w.config.tpm}`);
  });

  /* ─── T10 ──────────────────────────────────────────────────────────────── */
  console.log("\nT10 — interruption and recovery");

  await suite("rows stranded in PROCESSING by a dead worker are requeued and finished", async () => {
    const w = makeWorld(20, { seed: 7 });
    for (const id of ["r0", "r1", "r2"]) {
      const r = w.rows.get(id)!;
      r.status = "PROCESSING";
      r.leaseUntil = w.getNow() - 1; // the worker that held it died
      r.attempts = 1;
    }
    await drainAll(w);
    assert([...w.rows.values()].every((r) => r.status === "PARSED"), "all parsed");
  });

  await suite("a second drain while one holds the lease does nothing", async () => {
    const w = makeWorld(5, { seed: 8 });
    w.holdLease();
    const res = await worker.drainResumeImports({ budgetMs: 240_000 }, w.deps as never);
    assert(res.skipped && res.parsed === 0, JSON.stringify(res));
    assert([...w.rows.values()].every((r) => r.status === "QUEUED"), "untouched");
  });

  await suite("a drain stops starting work before its deadline and hands over", async () => {
    const w = makeWorld(200, { seed: 9 });
    const t0 = w.getNow();
    const res = await worker.drainResumeImports({ budgetMs: 120_000 }, w.deps as never);
    assert(res.remaining, "work remains for the next drain");
    assert(w.starts.every((s) => s.at < t0 + 120_000 - 55_000 + 1), "no call started in the last 55 s");
  });

  /* ─── T11 ──────────────────────────────────────────────────────────────── */
  console.log("\nT11 — what a registered profile is created with");

  await suite("identity mapping invents nothing and trims the name", () => {
    const m = identityFromParsedResume({ ...fixture, candidateName: "  ASHA   MENON " });
    assert(m.ok && m.identity.fullName === "ASHA MENON", "trimmed; capitalisation is the DB trigger's job");
    assert(!identityFromParsedResume({ ...fixture, candidateName: null }).ok, "no name");
    const student = identityFromParsedResume({ ...fixture, estimatedExperienceYears: 0 });
    assert(student.ok && student.identity.userType === "STUDENT", "student");
    const s = src("src/features/resume/import/register.ts");
    for (const k of ["phone: null", "college: null", "organization: null", "locationCity: null", "countryCode: null"]) {
      assert(s.includes(k), `register must pass ${k}`);
    }
  });

  /* ─── T12 ──────────────────────────────────────────────────────────────── */
  console.log("\nT12 — recruiter visibility");

  function fakeVisTx(existing: { consentSource: string | null; withdrawnAt: Date | null } | null) {
    const writes: { op: string; data: Record<string, unknown> }[] = [];
    const tx = {
      candidateVisibility: {
        findUnique: async () =>
          existing && { ...existing, searchableByRecruiters: true, consentedAt: new Date(0) },
        create: async (a: { data: Record<string, unknown> }) => {
          writes.push({ op: "create", data: a.data });
          return {};
        },
        update: async (a: { data: Record<string, unknown> }) => {
          writes.push({ op: "update", data: a.data });
          return {};
        },
      },
    };
    return { tx, writes };
  }

  await suite("admin_import creates a searchable row with its own consent source", async () => {
    const { tx, writes } = fakeVisTx(null);
    await visibility.applyVisibilityChange(tx as never, { userId: "u", kind: "admin_import" });
    assert(writes[0]?.op === "create", "created");
    assert(writes[0]?.data.consentSource === visibility.ADMIN_IMPORT_CONSENT_SOURCE, "source");
    assert(writes[0]?.data.searchableByRecruiters === true, "searchable");
  });

  await suite("admin_import never overwrites an existing decision", async () => {
    const { tx, writes } = fakeVisTx({ consentSource: "platform_default_profile", withdrawnAt: null });
    await visibility.applyVisibilityChange(tx as never, { userId: "u", kind: "admin_import" });
    assert(writes.length === 0, "no write");
  });

  await suite("claim_consent re-stamps only an import-sourced row, never a withdrawn one", async () => {
    const a = fakeVisTx({ consentSource: visibility.ADMIN_IMPORT_CONSENT_SOURCE, withdrawnAt: null });
    await visibility.applyVisibilityChange(a.tx as never, { userId: "u", kind: "claim_consent" });
    assert(a.writes[0]?.data.consentSource === visibility.OAUTH_CLAIM_CONSENT_SOURCE, "re-stamped");
    const b = fakeVisTx({ consentSource: "platform_default", withdrawnAt: null });
    await visibility.applyVisibilityChange(b.tx as never, { userId: "u", kind: "claim_consent" });
    assert(b.writes.length === 0, "other sources untouched");
    const c = fakeVisTx({ consentSource: visibility.ADMIN_IMPORT_CONSENT_SOURCE, withdrawnAt: new Date() });
    await visibility.applyVisibilityChange(c.tx as never, { userId: "u", kind: "claim_consent" });
    assert(c.writes.length === 0, "withdrawn stays withdrawn");
  });

  /* ─── T13 ──────────────────────────────────────────────────────────────── */
  console.log("\nT13 — contact stays locked until claim");

  await suite("unlock refuses an unclaimed import BEFORE any price lookup or charge", () => {
    const s = src("src/features/hire/unlock-transaction.ts");
    const gate = s.indexOf("await hasUnclaimedImportForUser(candidateUserId)");
    const price = s.indexOf("await getIntConfig(CONTACT_UNLOCK_COST_KEY)");
    const charge = s.indexOf("applyCreditChange(tx");
    assert(gate > 0 && gate < price && gate < charge, "order");
    assert(s.includes('reason: "CANDIDATE_NOT_CLAIMED"'), "refusal reason");
  });

  /* ─── T14–T18 ──────────────────────────────────────────────────────────── */
  console.log("\nT14–T18 — Google claim");

  function fakeReadDb(state: {
    linkedAccount?: boolean;
    user?: { id: string; accounts: number; deletedAt?: Date | null; disabledAt?: Date | null } | null;
    unclaimedImports?: number;
  }) {
    return {
      account: { findUnique: async () => (state.linkedAccount ? { id: "acc" } : null) },
      user: {
        findFirst: async () =>
          state.user
            ? {
                id: state.user.id,
                deletedAt: state.user.deletedAt ?? null,
                disabledAt: state.user.disabledAt ?? null,
                _count: { accounts: state.user.accounts },
              }
            : null,
      },
      resumeImport: { count: async () => state.unclaimedImports ?? 0 },
    };
  }
  const link = (db: ReturnType<typeof fakeReadDb>, email = "asha@example.com", verified = true) =>
    claim.evaluateGoogleLink({ providerAccountId: "g-1", email, emailVerified: verified }, db as never);

  await suite("T14: verified Google email matching an unclaimed import → allow link", async () => {
    assert((await link(fakeReadDb({ user: { id: "u1", accounts: 0 }, unclaimedImports: 1 }))) === "allow", "allow");
  });

  await suite("T14: unverified Google email → deny", async () => {
    const d = await link(fakeReadDb({ user: { id: "u1", accounts: 0 }, unclaimedImports: 1 }), "asha@example.com", false);
    assert(d === "deny", d);
  });

  await suite("T15/T16: an account that already has a login cannot be taken over → deny", async () => {
    const d = await link(fakeReadDb({ user: { id: "u1", accounts: 1 }, unclaimedImports: 1 }));
    assert(d === "deny", d);
  });

  await suite("T18: same-email account that is NOT an import (recruiter/dev) → deny, as before", async () => {
    const d = await link(fakeReadDb({ user: { id: "u1", accounts: 0 }, unclaimedImports: 0 }));
    assert(d === "deny", d);
  });

  await suite("T18: returning Google users and brand-new signups are unaffected → allow", async () => {
    assert((await link(fakeReadDb({ linkedAccount: true }))) === "allow", "returning");
    assert((await link(fakeReadDb({ user: null }))) === "allow", "new signup");
  });

  await suite("closed accounts cannot be claimed", async () => {
    const d = await link(fakeReadDb({ user: { id: "u1", accounts: 0, disabledAt: new Date() }, unclaimedImports: 1 }));
    assert(d === "deny", d);
  });

  function fakeWriteDb(moved: number) {
    const writes: string[] = [];
    const tx = {
      resumeImport: {
        updateMany: async (a: { where: { registeredUserId: string; status: string } }) => {
          writes.push(`import:${a.where.registeredUserId}:${a.where.status}`);
          return { count: moved };
        },
      },
      user: {
        update: async (a: { where: { id: string } }) => {
          writes.push(`user:${a.where.id}`);
          return {};
        },
      },
      candidateVisibility: {
        findUnique: async () => ({
          consentSource: visibility.ADMIN_IMPORT_CONSENT_SOURCE,
          withdrawnAt: null,
          searchableByRecruiters: true,
          consentedAt: new Date(0),
        }),
        update: async () => {
          writes.push("visibility");
          return {};
        },
      },
    };
    return { writes, db: { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } };
  }

  await suite("T15/T17: the claim moves exactly that user's import and keeps the same user id", async () => {
    const { writes, db } = fakeWriteDb(1);
    const claimed = await claim.onGoogleAccountLinked("u1", db as never);
    assert(claimed, "claimed");
    assert(writes[0] === "import:u1:REGISTERED", writes.join());
    assert(writes.includes("user:u1") && writes.includes("visibility"), writes.join());
  });

  await suite("T15: a lost race or an ordinary signup changes nothing", async () => {
    const { writes, db } = fakeWriteDb(0);
    const claimed = await claim.onGoogleAccountLinked("u2", db as never);
    assert(!claimed && writes.length === 1, writes.join());
  });

  await suite("T15/T17: one Google login per user is enforced by the database", () => {
    const m = src("prisma/migrations/20260925130000_resume_import/migration.sql");
    assert(/CREATE UNIQUE INDEX "Account_one_google_per_user" ON "Account"\("userId"\)\s+WHERE "provider" = 'google'/.test(m), "index");
    assert(m.includes(`WHERE "status" IN ('PARSED', 'REGISTERED')`), "one open import per email");
  });

  await suite("T16: registering against an existing account creates nothing and only merges additively", () => {
    const s = src("src/features/resume/import/register.ts");
    const attach = s.slice(s.indexOf("async function attachToExisting"), s.indexOf("export async function registerImportedStudent"));
    assert(!attach.includes("user.create") && !attach.includes("createCandidateIdentity"), "no creation");
    assert(attach.includes("const attachResume = user.resume === null"), "résumé attached only if none");
    assert(attach.includes("await mergeQuietly(user.id"), "additive merge path");
    const merge = s.slice(s.indexOf("async function mergeQuietly"), s.indexOf("async function attachToExisting"));
    assert(merge.includes("applyParsedResumeToProfile(userId, parsed)"), "merge is the shared additive merge");
  });

  await suite("T16: a lost registration race rolls back (throws, never returns, inside the transaction)", () => {
    const s = src("src/features/resume/import/register.ts");
    assert((s.match(/throw new Error\(LOST_RACE\)/g) ?? []).length === 2, "both transactions throw");
  });

  await suite("T18: normal registration still merges the stored résumé", () => {
    const s = src("src/app/actions/registration-actions.ts");
    assert(s.includes("applyStoredResumeToProfile("), "deferred merge kept");
    const a = src("src/auth.ts");
    assert(a.includes('if (decision === "deny") return "/login?error=OAuthAccountNotLinked";'), "old outcome kept");
    assert(a.includes('account?.provider === "google"'), "Google only");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

void main();
