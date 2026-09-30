/**
 * Gemini hiring brief: schema, grounding, flags, merge, and the HTTP client
 * against a fake fetch. No network. Run with:
 *   npm run test:hire-brief
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  briefFlags,
  geminiBriefSchema,
  mergeBriefPatch,
  toBriefPatch,
} from "@/features/hire/hire-brief";
import {
  extractHireBrief,
  isHireBriefConfigured,
} from "@/features/hire/gemini-brief";
import type { JobSpec } from "@/lib/validations/hire";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}\n      ${(error as Error).message}`);
  }
}

function patchOf(model: unknown, text: string): JobSpec {
  const parsed = geminiBriefSchema.safeParse(model);
  assert(parsed.success, "model output should parse");
  return toBriefPatch(parsed.success ? parsed.data : {}, text);
}

const RICH = "AI Engineer in Kochi with 2 yoe, B.E., Kafka and microservices";
const RICH_MODEL = {
  isHiringBrief: true,
  title: "AI engineer",
  locationCity: "Kochi",
  workMode: null,
  minExperience: 2,
  maxExperience: null,
  seniority: null,
  education: "B.E.",
  requiresDegree: true,
  mustHaveStack: ["kafka", "microservices"],
  employmentType: null,
  noticePeriodDays: null,
  salaryText: null,
};

/** A fetch that answers like Gemini, and records what it was sent. */
function fakeGemini(reply: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body =
      status === 200
        ? { candidates: [{ content: { parts: [{ text: reply }] } }] }
        : { error: { message: "nope" } };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

async function main() {
  console.log("\nschema + grounding");

  await test("rich brief → every strip field", () => {
    const patch = patchOf(RICH_MODEL, RICH);
    assert(patch.title === "AI engineer", `title ${patch.title}`);
    assert(patch.locationCity === "Kochi", `city ${patch.locationCity}`);
    assert(patch.minExperience === 2, "min experience");
    assert(patch.requiresDegree === true, "degree");
    assert(
      patch.mustHaveStack?.join(",") === "kafka,microservices",
      `stack ${patch.mustHaveStack?.join(",")}`,
    );
    const f = briefFlags(patch, RICH);
    assert(
      f.role && f.location && f.experience && f.education && f.skills,
      `flags ${JSON.stringify(f)}`,
    );
    assert(!f.compensation, "no compensation stated");
  });

  await test("trivia is not a brief: no role, no skills", () => {
    const text = "who is prime minister of india";
    const patch = patchOf(
      { isHiringBrief: false, title: "Prime minister", mustHaveStack: ["politics"] },
      text,
    );
    assert(Object.keys(patch).length === 0, `patch ${JSON.stringify(patch)}`);
    const f = briefFlags(patch, text);
    assert(!f.role && !f.skills, "role and skills stay off");
  });

  await test("invented city and skills are dropped", () => {
    const text = "backend engineer with python";
    const patch = patchOf(
      {
        isHiringBrief: true,
        title: "Backend engineer",
        locationCity: "Pune",
        mustHaveStack: ["python", "django", "aws"],
      },
      text,
    );
    assert(patch.locationCity === undefined, "Pune was never said");
    assert(patch.mustHaveStack?.join(",") === "python", `stack ${patch.mustHaveStack}`);
  });

  await test("renamed city and skill aliases count as said", () => {
    const text = "React JS dev in Bangalore, Node.js and k8s";
    const patch = patchOf(
      {
        isHiringBrief: true,
        title: "React developer",
        locationCity: "Bengaluru",
        mustHaveStack: ["JS", "Node.js", "kubernetes", "react"],
      },
      text,
    );
    assert(patch.locationCity === "Bengaluru", `city ${patch.locationCity}`);
    assert(
      patch.mustHaveStack?.join(",") === "javascript,node,kubernetes,react",
      `stack ${patch.mustHaveStack?.join(",")}`,
    );
  });

  await test("go is not grounded by 'ongoing' or 'golang'", () => {
    const patch = patchOf(
      { isHiringBrief: true, mustHaveStack: ["go"] },
      "ongoing golang hiring",
    );
    assert(!patch.mustHaveStack, `stack ${patch.mustHaveStack}`);
  });

  await test("remote is a work mode, never a city; countries are not cities", () => {
    const text = "SDE-2 remote with Kafka, anywhere in India";
    const patch = patchOf(
      {
        isHiringBrief: true,
        title: "SDE-2",
        locationCity: "Remote",
        workMode: "remote",
        mustHaveStack: ["kafka"],
      },
      text,
    );
    assert(patch.locationCity === undefined, "no Remote city filter");
    assert(patch.workMode === "REMOTE", `workMode ${patch.workMode}`);
    const f = briefFlags(patch, text);
    assert(f.location && f.role && f.skills && f.availability, JSON.stringify(f));
    const india = patchOf({ isHiringBrief: true, locationCity: "India" }, "devs in India");
    assert(india.locationCity === undefined, "India is not a city filter");
  });

  await test("a bad enum drops only that field", () => {
    const patch = patchOf(
      { isHiringBrief: true, title: "Data analyst", seniority: "GODLIKE", workMode: "on-site" },
      "data analyst on-site",
    );
    assert(patch.title === "Data analyst", "title kept");
    assert(patch.seniority === undefined, "bad seniority dropped");
    assert(patch.workMode === "ONSITE", `workMode ${patch.workMode}`);
  });

  await test("experience range is ordered and rounded", () => {
    const patch = patchOf(
      { isHiringBrief: true, minExperience: 4.4, maxExperience: "2" },
      "2-4 years",
    );
    assert(patch.minExperience === 2 && patch.maxExperience === 4, JSON.stringify(patch));
  });

  await test("salary: quoted phrase parsed by parseMoney; unquoted ignored", () => {
    const text = "backend, 12-18 LPA";
    const patch = patchOf({ isHiringBrief: true, salaryText: "12-18 LPA" }, text);
    assert(patch.salaryMin === 1_200_000 && patch.salaryMax === 1_800_000, JSON.stringify(patch));
    assert(briefFlags(patch, text).compensation, "compensation tick");
    const invented = patchOf({ isHiringBrief: true, salaryText: "30 LPA" }, text);
    assert(invented.salaryMin === undefined, "30 LPA was never said");
  });

  await test("education phrase must be in the text", () => {
    const patch = patchOf(
      { isHiringBrief: true, education: "PhD", requiresDegree: true },
      "ml engineer",
    );
    assert(patch.requiresDegree === undefined, "PhD was never said");
    const said = patchOf({ isHiringBrief: true, education: "B.E." }, "need a BE grad");
    assert(said.requiresDegree === true, "BE grounded");
  });

  await test("garbage top level is rejected", () => {
    assert(!geminiBriefSchema.safeParse("not json").success, "string");
    assert(!geminiBriefSchema.safeParse(null).success, "null");
    assert(!geminiBriefSchema.safeParse([1, 2]).success, "array");
  });

  console.log("\nmerge");

  await test("stated values win, absent keep base, stacks union", () => {
    const base: JobSpec = {
      title: "Backend engineer",
      locationCity: "Chennai",
      mustHaveStack: ["go", "Kafka"],
      extra: { poolSources: ["CLAUDE"] },
    };
    const merged = mergeBriefPatch(base, {
      locationCity: "Kochi",
      mustHaveStack: ["kafka", "microservices"],
      minExperience: 2,
    });
    assert(merged.title === "Backend engineer", "title kept");
    assert(merged.locationCity === "Kochi", "later city wins");
    assert(merged.minExperience === 2, "experience added");
    assert(
      merged.mustHaveStack?.join(",") === "go,Kafka,microservices",
      `stack ${merged.mustHaveStack?.join(",")}`,
    );
    assert(
      JSON.stringify(merged.extra) === JSON.stringify(base.extra),
      "extra (pool filters) untouched",
    );
  });

  await test("empty patch is a no-op", () => {
    const base: JobSpec = { title: "SDE", mustHaveStack: ["java"] };
    assert(
      JSON.stringify(mergeBriefPatch(base, {})) === JSON.stringify(base),
      "unchanged",
    );
  });

  console.log("\ngemini client (fake fetch)");

  await test("happy path: key in header, not URL; flags returned", async () => {
    const { impl, calls } = fakeGemini(JSON.stringify(RICH_MODEL));
    const r = await extractHireBrief(RICH, {
      apiKey: "test-key",
      fetchImpl: impl,
      useCache: false,
    });
    assert(r.ok, "ok");
    if (r.ok) {
      assert(r.patch.locationCity === "Kochi", "patch");
      assert(r.flags.skills && r.flags.education, "flags");
    }
    assert(calls.length === 1, "one call");
    assert(!calls[0]!.url.includes("test-key"), "key never in the URL");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert(headers["x-goog-api-key"] === "test-key", "key in header");
    assert(String(calls[0]!.init.body).includes("Kochi"), "text sent");
  });

  await test("fenced JSON still parses", async () => {
    const { impl } = fakeGemini("```json\n" + JSON.stringify(RICH_MODEL) + "\n```");
    const r = await extractHireBrief(RICH, { apiKey: "k", fetchImpl: impl, useCache: false });
    assert(r.ok, "ok");
  });

  await test("empty text: no call", async () => {
    const { impl, calls } = fakeGemini("{}");
    const r = await extractHireBrief("   ", { apiKey: "k", fetchImpl: impl });
    assert(!r.ok && r.reason === "empty", "empty");
    assert(calls.length === 0, "no call");
  });

  await test("no key: unconfigured, no call", async () => {
    const { impl, calls } = fakeGemini("{}");
    const r = await extractHireBrief(RICH, { apiKey: null, fetchImpl: impl });
    assert(!r.ok && r.reason === "unconfigured", "unconfigured");
    assert(calls.length === 0, "no call");
  });

  await test("env: GEMINI_API_KEY configures hire brief parsing", async () => {
    const saved = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      assert(!isHireBriefConfigured(), "no key → unconfigured");
      const { impl, calls } = fakeGemini(JSON.stringify(RICH_MODEL));
      const r = await extractHireBrief(RICH, { fetchImpl: impl, useCache: false });
      assert(!r.ok && r.reason === "unconfigured", JSON.stringify(r));
      assert(calls.length === 0, "no call without key");

      process.env.GEMINI_API_KEY = "shared-key";
      assert(isHireBriefConfigured(), "GEMINI_API_KEY configures it");
      const ok = await extractHireBrief(RICH, { fetchImpl: impl, useCache: false });
      assert(ok.ok, "ok with GEMINI_API_KEY");
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert(headers["x-goog-api-key"] === "shared-key", "sends GEMINI_API_KEY");
    } finally {
      if (saved === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = saved;
    }
  });

  await test("invalid JSON → invalid", async () => {
    const { impl } = fakeGemini("sure! here is the brief: title=AI");
    const r = await extractHireBrief(RICH, { apiKey: "k", fetchImpl: impl, useCache: false });
    assert(!r.ok && r.reason === "invalid", JSON.stringify(r));
  });

  await test("HTTP 500 → http; 429 → rate_limited", async () => {
    const r500 = await extractHireBrief(RICH, {
      apiKey: "k",
      fetchImpl: fakeGemini("", 500).impl,
      useCache: false,
    });
    assert(!r500.ok && r500.reason === "http", JSON.stringify(r500));
    const r429 = await extractHireBrief(RICH, {
      apiKey: "k",
      fetchImpl: fakeGemini("", 429).impl,
      useCache: false,
    });
    assert(!r429.ok && r429.reason === "rate_limited", JSON.stringify(r429));
  });

  await test("timeout → timeout (request aborted)", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await extractHireBrief(RICH, {
      apiKey: "k",
      fetchImpl: hang,
      timeoutMs: 50,
      useCache: false,
    });
    assert(!r.ok && r.reason === "timeout", JSON.stringify(r));
    assert(Date.now() - t0 < 2000, "returned promptly");
  });

  await test("a thrown fetch never escapes", async () => {
    const boom = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await extractHireBrief(RICH, { apiKey: "k", fetchImpl: boom, useCache: false });
    assert(!r.ok, "failed softly");
  });

  await test("cache: the same brief is parsed once, concurrent calls share it", async () => {
    const { impl, calls } = fakeGemini(JSON.stringify(RICH_MODEL));
    const text = `${RICH} (cache probe)`;
    const [a, b] = await Promise.all([
      extractHireBrief(text, { apiKey: "k", fetchImpl: impl }),
      extractHireBrief(text, { apiKey: "k", fetchImpl: impl }),
    ]);
    const c = await extractHireBrief(`  ${text.toUpperCase()} `, { apiKey: "k", fetchImpl: impl });
    assert(a.ok && b.ok && c.ok, "all ok");
    assert(calls.length === 1, `expected 1 call, got ${calls.length}`);
  });

  console.log("\nboundaries");

  await test("the key never reaches client code", () => {
    const root = process.cwd();
    const chat = readFileSync(join(root, "src/components/hire/scout-chat.tsx"), "utf8");
    assert(!chat.includes("gemini-brief"), "scout-chat must not import the server client");
    assert(!/GEMINI_/.test(chat), "scout-chat must not name a Gemini env var");
    const shared = readFileSync(join(root, "src/features/hire/hire-brief.ts"), "utf8");
    assert(!shared.includes("process.env"), "hire-brief.ts is client-safe");
    const server = readFileSync(join(root, "src/features/hire/gemini-brief.ts"), "utf8");
    assert(server.startsWith('import "server-only"'), "gemini-brief.ts is server-only");
    const spoken = readFileSync(join(root, "src/features/hire/spoken-brief.ts"), "utf8");
    assert(!/gemini|fetch\(/i.test(spoken.replace(/\/\*[\s\S]*?\*\//g, "")), "regex fallback stays sync");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
