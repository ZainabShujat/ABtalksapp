/**
 * T-253 emit-site structure tests — run with:
 *   npm run test:analytics-instrumentation
 * or:
 *   npx tsx src/lib/analytics/instrumentation.test.ts
 *
 * events.test.ts proves the payloads are safe. This file proves the wiring
 * around them: that there is exactly one transport, that T-252's loader is
 * still the only thing that initialises GA4, that each event is emitted from
 * exactly one place (so one action cannot produce two events), and that the
 * four excluded behaviours have no instrumentation at all.
 *
 * It reads the source rather than running it, because the properties worth
 * guarding here are properties of the codebase — "nobody added a second
 * gtag" is not something a unit test of a function can observe.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log("  ✓", name);
}

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative, forward-slashed, so assertions read the same on Windows. */
function rel(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/");
}

/**
 * The file with its comment lines removed.
 *
 * Every check below asks "does this file *do* X", and half of these files
 * explain in prose why they do or don't. Line-based, which is enough: no
 * gtag call in this codebase hides behind a comment opener on its own line.
 */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const ALL = walk(SRC).map((f) => {
  const text = readFileSync(f, "utf8");
  return { path: rel(f), text, code: codeOnly(text) };
});
const APP = ALL.filter((f) => !f.path.endsWith(".test.ts") && !f.path.endsWith(".test.tsx"));

console.log("T-253 instrumentation structure: transport, emit sites, exclusions");

// ── One transport, one initialisation (T-252 preserved) ──────────────────────

{
  // GA4 events and the enrolment-success Ads conversion go through use-track.ts.
  // The landing page also carries Munna's page-load conversion snippet, pasted
  // in the same inline script as the Google tag.
  const senders = APP.filter((f) => /gtag\(\s*["']event["']/.test(f.code));
  const senderPaths = senders.map((f) => f.path).sort();
  assert(
    senderPaths.length === 2 &&
      senderPaths[0] === "src/app/page.tsx" &&
      senderPaths[1] === "src/lib/analytics/use-track.ts",
    `expected gtag('event') on the landing page and in use-track.ts, found: ${senderPaths.join(", ") || "none"}`,
  );
  ok("transport: gtag('event') is the landing conversion snippet and use-track.ts");
}

{
  // T-252 owns loading and configuring GA4. T-253 must not have added a second
  // loader, a second measurement id, or a second consent default.
  const loaders = APP.filter((f) => /googletagmanager\.com/.test(f.code));
  const loaderPaths = loaders.map((f) => f.path).sort();
  assert(
    loaderPaths.length === 2 &&
      loaderPaths[0] === "src/app/page.tsx" &&
      loaderPaths[1] === "src/components/analytics/ga4-loader.tsx",
    `expected the landing Ads tag and the T-252 loader to reference googletagmanager, found: ${loaderPaths.join(", ")}`,
  );

  const configurers = APP.filter((f) => /gtag\(\s*["']config["']/.test(f.code));
  const configurerPaths = configurers.map((f) => f.path).sort();
  assert(
    configurerPaths.length === 2 &&
      configurerPaths[0] === "src/app/page.tsx" &&
      configurerPaths[1] === "src/components/analytics/ga4-loader.tsx",
    `expected gtag('config') on the landing page and in the T-252 loader, found: ${configurerPaths.join(", ")}`,
  );

  const idReaders = APP.filter((f) =>
    /NEXT_PUBLIC_GA_MEASUREMENT_ID/.test(f.code),
  );
  assert(
    idReaders.length === 1 &&
      idReaders[0].path === "src/components/analytics/ga4-loader.tsx",
    `the measurement id must be read only by the T-252 loader, found: ${idReaders.map((f) => f.path).join(", ")}`,
  );
  ok("T-252 preserved: GA4 loader plus landing Ads tag, one measurement id reader");
}

{
  // The emit gate must come from T-252's consent mapping, not a fresh copy of
  // the "limited or all" rule that could drift away from the loader's.
  const track = ALL.find((f) => f.path === "src/lib/analytics/use-track.ts");
  assert(track !== undefined, "use-track.ts is missing");
  assert(
    /useCookieConsent/.test(track!.text),
    "use-track.ts must read consent from the T-252 provider",
  );
  assert(
    /hasAnalyticsConsent/.test(track!.text),
    "use-track.ts must gate on hasAnalyticsConsent",
  );

  const events = ALL.find((f) => f.path === "src/lib/analytics/events.ts");
  assert(
    /toGaConsent/.test(events!.text),
    "hasAnalyticsConsent must derive from T-252's toGaConsent mapping",
  );
  ok("consent: the emit gate is derived from T-252's provider and mapping");
}

// ── Every emit site, exactly once ────────────────────────────────────────────

// One event may have more than one canonical emit site when there is more
// than one canonical entry point for the action it describes. Recruiter
// registration is the current case: /talent/register (the legacy dedicated
// page) and /recruiter-onboarding/signup (the onboarding flow) are both
// live entry points that call the same server action. Any single user
// completes one path or the other, so the event still fires once per
// registration outcome — the "one action, one event" invariant holds even
// though two files reference the constant.
const EMIT_SITES: Record<keyof typeof ANALYTICS_EVENTS, readonly string[]> = {
  recruiterRegSubmitted: [
    "src/components/talent/recruiter-register-form.tsx",
    "src/components/recruiter-onboarding/recruiter-onboarding-wizard.tsx",
  ],
  recruiterCandidateViewed: ["src/components/talent/track-candidate-view.tsx"],
  recruiterContactUnlocked: ["src/components/admin/engagement-decision.tsx"],
  siteProfileUpdated: ["src/components/profile/use-section-save.ts"],
  siteSkillAdded: ["src/components/profile/skills-section.tsx"],
  siteJobApplied: ["src/components/jobs/apply-job-button.tsx"],
  siteTestCompleted: ["src/app/quiz/[quizId]/quiz-form.tsx"],
  // T-253: notification-driven analytics. Both events fire from the same
  // browser-side tracker that reads the candidate's notification feed.
  siteJobAlertSent: [
    "src/components/shared/notification-analytics-tracker.tsx",
  ],
  siteProfileViewNotified: [
    "src/components/shared/notification-analytics-tracker.tsx",
  ],
};

{
  for (const [key, expectedPaths] of Object.entries(EMIT_SITES)) {
    const marker = `ANALYTICS_EVENTS.${key}`;
    const users = APP.filter(
      (f) => f.path !== "src/lib/analytics/events.ts" && f.code.includes(marker),
    );
    const foundPaths = users.map((f) => f.path).sort();
    const expected = [...expectedPaths].sort();
    assert(
      users.length === expectedPaths.length,
      `${marker} should be emitted from ${expectedPaths.length} file(s), found ${users.length}: ${foundPaths.join(", ")}`,
    );
    assert(
      foundPaths.join("|") === expected.join("|"),
      `${marker} should be emitted from ${expected.join(", ")}, found ${foundPaths.join(", ")}`,
    );
    // Twice in one file is the other way to double-count a single action.
    for (const user of users) {
      const occurrences = user.code.split(marker).length - 1;
      assert(
        occurrences === 1,
        `${marker} appears ${occurrences} times in ${user.path} — each emit site must reference it exactly once`,
      );
    }
  }
  ok("emit sites: every event's declared canonical path(s) each reference it exactly once");
}

{
  // A name typed as a string bypasses both the vocabulary and the per-event
  // allowlist that keys off it, so every call must go through the constants.
  const badCalls: string[] = [];
  for (const file of APP) {
    if (file.path === "src/lib/analytics/use-track.ts") continue;
    for (const line of file.text.split("\n")) {
      const trimmed = line.trim();
      // Prose about track() is not a call to it.
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }
      const call = /\btrack\(\s*(.+)/.exec(line);
      if (!call) continue;
      if (!call[1].startsWith("ANALYTICS_EVENTS.")) {
        badCalls.push(`${file.path}: ${line.trim()}`);
      }
    }
  }
  assert(
    badCalls.length === 0,
    `track() must be called with an ANALYTICS_EVENTS constant:\n${badCalls.join("\n")}`,
  );
  ok("emit sites: every track() call names its event through ANALYTICS_EVENTS");
}

{
  // Firing straight off a click is the failure mode T-253 names explicitly:
  // the event would record an intention, not an outcome.
  const onClickEmits: string[] = [];
  for (const file of APP) {
    for (const line of file.text.split("\n")) {
      if (/on(Click|Change|Submit|Focus)\s*=\s*\{?\s*\(?\)?\s*=>\s*track\(/.test(line)) {
        onClickEmits.push(`${file.path}: ${line.trim()}`);
      }
    }
  }
  assert(
    onClickEmits.length === 0,
    `events must fire on a confirmed outcome, not a handler:\n${onClickEmits.join("\n")}`,
  );
  ok("emit sites: no event is wired directly to a click or change handler");
}

{
  // The one emit site that is not inside an `if (ok)` branch is the profile-view
  // beacon, which fires on render — so it carries its own once-guard instead.
  const beacon = ALL.find((f) => f.path === EMIT_SITES.recruiterCandidateViewed[0]);
  assert(beacon !== undefined, "the candidate-view beacon is missing");
  assert(
    /useRef/.test(beacon!.text) && /emittedFor/.test(beacon!.text),
    "the render-time beacon must keep a ref so a re-render cannot re-emit",
  );
  assert(
    /if\s*\(\s*!ready\s*\)\s*return/.test(beacon!.text),
    "the beacon must wait for consent to be read before spending its one shot",
  );
  ok("emit sites: the render-time beacon is deduped by ref and waits for consent");
}

// ── The four excluded behaviours ─────────────────────────────────────────────

{
  const EXCLUDED: { label: string; paths: string[] }[] = [
    {
      // The candidate visibility toggles these files held were removed in plan
      // 133; the files stay excluded so tracking is not added in their place.
      label: "former candidate visibility surfaces",
      paths: [
        "src/app/actions/talent-actions.ts",
        "src/components/profile/evidence-section.tsx",
      ],
    },
    {
      label: "recruiter Google login",
      paths: ["src/app/talent/login/page.tsx"],
    },
    {
      label: "company admin",
      paths: [
        "src/components/admin/recruiter-seats-panel.tsx",
        "src/app/actions/recruiter-seat-actions.ts",
      ],
    },
    {
      label: "team invitation",
      paths: [
        "src/components/hackathon/dashboard/invite-panel.tsx",
        "src/app/actions/hackathon-team-actions.ts",
      ],
    },
  ];

  for (const { label, paths } of EXCLUDED) {
    for (const path of paths) {
      const file = ALL.find((f) => f.path === path);
      assert(file !== undefined, `excluded surface not found: ${path}`);
      assert(
        !/lib\/analytics|useTrack|ANALYTICS_EVENTS|gtag/.test(file!.code),
        `${label} is instrumented in ${path} — it must not be`,
      );
    }
  }
  ok("exclusions: visibility, recruiter login, company admin and invites are untracked");
}

{
  // And nothing outside the analytics module and its emit sites touches gtag.
  const allowed = new Set<string>([
    "src/lib/analytics/use-track.ts",
    "src/components/analytics/ga4-loader.tsx",
    "src/app/page.tsx",
  ]);
  const touchers = APP.filter(
    (f) => /\bgtag\b/.test(f.code) && !allowed.has(f.path),
  );
  assert(
    touchers.length === 0,
    `gtag is reachable outside the analytics module: ${touchers.map((f) => f.path).join(", ")}`,
  );
  ok("transport: no surface outside the analytics module touches gtag directly");
}

console.log(`\n${passed} assertions passed`);
