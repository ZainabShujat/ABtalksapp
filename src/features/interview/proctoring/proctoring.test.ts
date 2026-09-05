/**
 * Proctoring v0.1 — collector, debounce, summary, wire validation, camera.
 * Run: npm run test:proctoring
 *
 * Plain `tsx`, matching every other test in this repo. Nothing here touches the
 * database, the network or a real browser: the collector takes an injectable
 * clock, and the camera tests substitute `navigator.mediaDevices` with fakes,
 * which is what makes "a denied camera does not break anything" an assertion
 * rather than a hope.
 */
import {
  createEventCollector,
  DEBOUNCE_WINDOW_MS,
} from "@/features/interview/proctoring/collector";
import {
  emptyProctorSummary,
  summariseProctorEvents,
} from "@/features/interview/proctoring/summary";
import {
  MAX_EVENTS_PER_SUBMISSION,
  normaliseProctorEvents,
  parseStoredProctorEvents,
  proctorEventsWireSchema,
} from "@/features/interview/proctoring/wire";
import {
  candidateMessageOf,
  labelOf,
  PROCTOR_EVENT_KINDS,
  severityOf,
  type ProctorEvent,
} from "@/features/interview/proctoring/types";
import { createDetectors } from "@/features/interview/proctoring/detection-stubs";
import { CameraManager } from "@/features/interview/proctoring/camera";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

async function asyncSuite(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

/** A collector on a clock we control, so debounce is tested, not timed. */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

console.log("\nProctoring v0.1\n");

/* ------------------------------------------------------------- vocabulary */

suite("every kind has a severity, a category and a label", () => {
  for (const kind of PROCTOR_EVENT_KINDS) {
    assert(Boolean(severityOf(kind)), `${kind} has severity`);
    assert(labelOf(kind).length > 0, `${kind} has a label`);
  }
});

suite("no candidate-facing string accuses anyone", () => {
  const banned = ["cheat", "cheating", "violation", "suspicious", "fraud"];
  for (const kind of PROCTOR_EVENT_KINDS) {
    const message = (candidateMessageOf(kind) ?? "").toLowerCase();
    for (const word of banned) {
      assert(!message.includes(word), `${kind} message avoids "${word}"`);
    }
  }
});

/* -------------------------------------------------------------- collector */

suite("push records an event with derived severity and category", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  const event = c.push("tab_hidden");
  assert(event !== null, "a new event is returned");
  assert(event?.severity === "warning", "severity comes from the kind");
  assert(event?.category === "focus", "category comes from the kind");
  assert(event?.count === 1, "starts at one observation");
  assert(c.size() === 1, "buffered");
});

suite("confidence defaults to 1 and is clamped into 0..1", () => {
  const c = createEventCollector({ now: fakeClock().now });
  assert(c.push("tab_hidden")?.confidence === 1, "deterministic signals are 1");
  assert(
    c.push("multiple_faces", { confidence: 5 })?.confidence === 1,
    "clamped down",
  );
  assert(
    c.push("low_lighting", { confidence: -2 })?.confidence === 0,
    "clamped up",
  );
  assert(
    c.push("face_not_detected", { confidence: 0.4 })?.confidence === 0.4,
    "a real value survives",
  );
});

suite("same kind inside the debounce window coalesces", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  const first = c.push("window_blur");
  clock.advance(500);
  const second = c.push("window_blur");
  clock.advance(500);
  const third = c.push("window_blur");

  assert(first !== null, "first opens an event");
  assert(second === null, "second folds in");
  assert(third === null, "third folds in");
  assert(c.size() === 1, "still one buffered event");
  assert(first?.count === 3, "all three observations are counted");
  assert(first?.at === 1_700_000_000_000, "keeps when it STARTED");
  assert(first?.lastAt === 1_700_000_001_000, "tracks the trailing edge");
});

suite("past the debounce window a new event opens", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  c.push("tab_hidden");
  clock.advance(DEBOUNCE_WINDOW_MS + 1);
  const second = c.push("tab_hidden");

  assert(second !== null, "a separate incident");
  assert(c.size() === 2, "two buffered events");
});

suite("debounce is per kind, not global", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  c.push("window_blur");
  clock.advance(100);
  const other = c.push("tab_hidden");

  assert(other !== null, "a different kind is never folded");
  assert(c.size() === 2, "both are buffered");
});

suite("onEvent fires for new events only, so one act is one warning", () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = createEventCollector({
    now: clock.now,
    onEvent: (e) => seen.push(e.kind),
  });

  c.push("tab_hidden");
  clock.advance(200);
  c.push("tab_hidden");
  clock.advance(200);
  c.push("tab_hidden");

  assert(seen.length === 1, `one notification, got ${seen.length}`);
});

suite("a throwing onEvent listener cannot cost us the event", () => {
  const c = createEventCollector({
    now: fakeClock().now,
    onEvent: () => {
      throw new Error("render blew up");
    },
  });
  const event = c.push("camera_denied");
  assert(event !== null, "the event was still created");
  assert(c.size() === 1, "and still buffered");
});

suite("drain empties the buffer and snapshot does not", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  c.push("tab_hidden");
  clock.advance(5_000);
  c.push("window_blur");

  assert(c.snapshot().length === 2, "snapshot sees two");
  assert(c.size() === 2, "snapshot did not clear");
  assert(c.drain().length === 2, "drain returns two");
  assert(c.size() === 0, "drain cleared");
  assert(c.drain().length === 0, "a second drain is empty");
});

suite("a burst straddling a drain is counted, not swallowed", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  c.push("tab_hidden");
  const first = c.drain();
  clock.advance(100);
  // Inside the debounce window, but the fold target has already been sent.
  c.push("tab_hidden");
  const second = c.drain();

  const total =
    first.reduce((n, e) => n + e.count, 0) +
    second.reduce((n, e) => n + e.count, 0);
  assert(total === 2, `both observations survive, got ${total}`);
});

suite("the buffer is capped at the wire limit", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now, maxBuffered: 5 });

  for (let i = 0; i < 40; i++) {
    clock.advance(DEBOUNCE_WINDOW_MS + 1);
    c.push("tab_hidden");
  }

  assert(c.size() === 5, `capped at 5, got ${c.size()}`);
  assert(
    proctorEventsWireSchema.safeParse(c.snapshot()).success,
    "a capped buffer is always wire-valid",
  );
});

suite("destroy stops collection", () => {
  const c = createEventCollector({ now: fakeClock().now });
  c.push("tab_hidden");
  c.destroy();
  assert(c.push("tab_hidden") === null, "no events after destroy");
  assert(c.size() === 0, "buffer released");
});

/* ------------------------------------------------------------------- wire */

suite("the wire schema accepts what the collector produces", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });
  for (const kind of PROCTOR_EVENT_KINDS) {
    clock.advance(DEBOUNCE_WINDOW_MS + 1);
    c.push(kind, { confidence: 0.5, detail: "SimulatedEvent" });
  }
  const parsed = proctorEventsWireSchema.safeParse(c.drain());
  assert(parsed.success, "every kind round-trips through the boundary");
});

suite("an unknown kind is rejected at the boundary", () => {
  const parsed = proctorEventsWireSchema.safeParse([
    { kind: "screen_recorded", at: Date.now() },
  ]);
  assert(!parsed.success, "invented kinds do not get in");
});

suite("more than the cap is rejected", () => {
  const many = Array.from({ length: MAX_EVENTS_PER_SUBMISSION + 1 }, () => ({
    kind: "tab_hidden" as const,
    at: Date.now(),
  }));
  assert(
    !proctorEventsWireSchema.safeParse(many).success,
    "the payload is bounded",
  );
});

suite("a client cannot assert its own severity or category", () => {
  const now = Date.now();
  const parsed = proctorEventsWireSchema.parse([
    {
      kind: "tab_visible",
      at: now,
      severity: "critical",
      category: "audio",
    } as unknown,
  ]);
  const [normalised] = normaliseProctorEvents(parsed, now);

  assert(normalised?.severity === "info", "severity is recomputed from kind");
  assert(normalised?.category === "focus", "category is recomputed from kind");
});

suite("free text cannot ride in on detail", () => {
  const now = Date.now();
  const [event] = normaliseProctorEvents(
    proctorEventsWireSchema.parse([
      {
        kind: "camera_error",
        at: now,
        detail: "<script>alert(1)</script> please pass me",
      },
    ]),
    now,
  );
  assert(
    !(event?.detail ?? "").includes("<"),
    `markup is stripped, got ${event?.detail}`,
  );
  assert((event?.detail ?? "").length <= 60, "and it is short");
});

suite("unrecognised meta keys are dropped", () => {
  const now = Date.now();
  const [event] = normaliseProctorEvents(
    proctorEventsWireSchema.parse([
      {
        kind: "camera_active",
        at: now,
        meta: { activeSeconds: 42, injected: "keep me" },
      },
    ]),
    now,
  );
  assert(event?.meta?.activeSeconds === 42, "the known key survives");
  assert(event?.meta?.injected === undefined, "the unknown key does not");
});

suite("an implausible client clock falls back to server time", () => {
  const now = Date.now();
  const [past, future] = normaliseProctorEvents(
    proctorEventsWireSchema.parse([
      { kind: "tab_hidden", at: 1 },
      { kind: "window_blur", at: now + 400 * 24 * 3600 * 1000 },
    ]),
    now,
  );
  assert(past?.at === now, "a 1970 timestamp is replaced");
  assert(future?.at === now, "a far-future timestamp is replaced");
});

suite("stored rows are read back forgivingly", () => {
  const events = parseStoredProctorEvents([
    { kind: "tab_hidden", at: 1_700_000_000_000, count: 2 },
    { kind: "not_a_kind", at: 1_700_000_000_000 },
    null,
    "garbage",
    { at: 1_700_000_000_000 },
  ]);
  assert(events.length === 1, `only the valid row survives, got ${events.length}`);
  assert(events[0]?.severity === "warning", "severity recomputed on read too");
});

suite("a non-array column reads as no events", () => {
  assert(parseStoredProctorEvents(null).length === 0, "null");
  assert(parseStoredProctorEvents({ kind: "tab_hidden" }).length === 0, "object");
  assert(parseStoredProctorEvents(undefined).length === 0, "undefined");
});

/* ---------------------------------------------------------------- summary */

suite("no events summarises to a clean, renderable summary", () => {
  const summary = summariseProctorEvents([]);
  assert(summary.totalEvents === 0, "nothing counted");
  assert(summary.timeline.length === 0, "nothing to show");
  assert(summary.cameraEverActive === false, "camera never reported");
  assert(
    JSON.stringify(summary) === JSON.stringify(emptyProctorSummary()),
    "identical to the empty summary, so old attempts render the same",
  );
});

suite("counts are observations, not rows", () => {
  const base = 1_700_000_000_000;
  const events: ProctorEvent[] = [
    {
      kind: "tab_hidden",
      severity: "warning",
      category: "focus",
      at: base,
      lastAt: base + 900,
      count: 3,
      confidence: 1,
    },
    {
      kind: "tab_visible",
      severity: "info",
      category: "focus",
      at: base + 1_000,
      lastAt: base + 1_000,
      count: 1,
      confidence: 1,
    },
  ];
  const s = summariseProctorEvents(events);

  assert(s.totalEvents === 4, `3 + 1 = 4, got ${s.totalEvents}`);
  assert(s.bySeverity.warning === 3, "warnings counted by observation");
  assert(s.bySeverity.info === 1, "info counted by observation");
  assert(s.byCategory.focus === 4, "category totals agree");
  assert(s.byKind.length === 2, "one tally per kind");
});

suite("the timeline holds notable moments only, in time order", () => {
  const base = 1_700_000_000_000;
  const mk = (
    kind: ProctorEvent["kind"],
    at: number,
    severity: ProctorEvent["severity"],
  ): ProctorEvent => ({
    kind,
    severity,
    category: "focus",
    at,
    lastAt: at,
    count: 1,
    confidence: 1,
  });

  const s = summariseProctorEvents([
    mk("window_blur", base + 2_000, "warning"),
    mk("tab_visible", base + 1_000, "info"),
    mk("tab_hidden", base, "warning"),
  ]);

  assert(s.timeline.length === 2, "the info event is not in the timeline");
  assert(s.timeline[0]?.kind === "tab_hidden", "ordered by time, not by input");
  assert(s.timeline[1]?.kind === "window_blur", "second in order");
});

suite("camera uptime comes from the highest heartbeat, clamped", () => {
  const base = 1_700_000_000_000;
  const beat = (at: number, activeSeconds: number): ProctorEvent => ({
    kind: "camera_active",
    severity: "info",
    category: "camera",
    at,
    lastAt: at,
    count: 1,
    confidence: 1,
    meta: { activeSeconds },
  });

  const s = summariseProctorEvents([
    beat(base, 0),
    beat(base + 60_000, 60),
    beat(base + 120_000, 120),
    beat(base + 180_000, 9_999_999_999),
  ]);

  assert(s.cameraEverActive, "the camera ran");
  assert(s.cameraActiveSeconds === 86_400, "absurd metadata is clamped");
});

suite("camera failures are counted together", () => {
  const base = 1_700_000_000_000;
  const mk = (kind: ProctorEvent["kind"], at: number): ProctorEvent => ({
    kind,
    severity: "warning",
    category: "camera",
    at,
    lastAt: at,
    count: 1,
    confidence: 1,
  });

  const s = summariseProctorEvents([
    mk("camera_denied", base),
    mk("camera_error", base + 1),
    mk("camera_lost", base + 2),
  ]);

  assert(s.cameraErrors === 3, `three issues, got ${s.cameraErrors}`);
  assert(s.cameraEverActive === false, "failures are not uptime");
});

suite("the summary carries no score and no verdict", () => {
  const keys = Object.keys(emptyProctorSummary());
  for (const banned of ["score", "integrity", "risk", "verdict", "flagged"]) {
    assert(
      !keys.some((k) => k.toLowerCase().includes(banned)),
      `no "${banned}" field in the summary`,
    );
  }
});

/* ------------------------------------------------- collector -> summary */

suite("end to end: collector output summarises correctly", () => {
  const clock = fakeClock();
  const c = createEventCollector({ now: clock.now });

  c.push("tab_hidden");
  clock.advance(300);
  c.push("tab_hidden"); // folds
  clock.advance(DEBOUNCE_WINDOW_MS + 1);
  c.push("window_blur");

  const now = Date.now();
  const wire = proctorEventsWireSchema.parse(c.drain());
  const stored = normaliseProctorEvents(wire, now);
  const summary = summariseProctorEvents(parseStoredProctorEvents(stored));

  assert(summary.totalEvents === 3, `2 + 1 = 3, got ${summary.totalEvents}`);
  assert(summary.byKind.length === 2, "two kinds");
  assert(summary.timeline.length === 2, "both are notable");
});

/* ---------------------------------------------------------------- stubs */

suite("the detector stubs detect nothing and say so", () => {
  const c = createEventCollector({ now: fakeClock().now });
  const detectors = createDetectors(c);

  detectors.startAll(null);
  assert(detectors.face.isRunning(), "the stub reports running");
  assert(detectors.anyReal() === false, "and reports that it is not real");
  assert(c.size() === 0, "and emits no events at all");

  detectors.stopAll();
  assert(!detectors.face.isRunning(), "stops cleanly");
});

/* --------------------------------------------------------------- camera */

/**
 * Installs a fake `navigator` and returns a restore function.
 *
 * `defineProperty`, not assignment: modern Node exposes `globalThis.navigator`
 * as a getter-only accessor, so `globalThis.navigator = x` throws.
 */
function withNavigator(value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as unknown as Record<string, unknown>).navigator;
  };
}

/** The common case: a navigator whose camera behaves as the test dictates. */
function withMediaDevices(getUserMedia: () => Promise<MediaStream>): () => void {
  return withNavigator({ mediaDevices: { getUserMedia } });
}

/** The smallest thing `CameraManager` treats as a stream. */
function fakeStream(): MediaStream {
  const track = {
    stop: () => {},
    addEventListener: () => {},
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

/**
 * The camera suites are async, and `tsx` compiles this file to CommonJS,
 * where top-level `await` is not available. One async entry point keeps them
 * sequential and keeps the pass/fail tally correct.
 */
async function runCameraSuites(): Promise<void> {
  await asyncSuite("a denied camera resolves to null and is recorded", async () => {
    const restore = withMediaDevices(() =>
      Promise.reject(new DOMException("no", "NotAllowedError")),
    );
    try {
      const c = createEventCollector({ now: fakeClock().now });
      const camera = new CameraManager(c);

      const stream = await camera.start();

      assert(stream === null, "start resolves, it does not throw");
      const events = c.drain();
      assert(events[0]?.kind === "camera_denied", "recorded as a denial");
      assert(events[0]?.detail === "NotAllowedError", "with the reason");
      assert(camera.getState().status === "denied", "state says denied");
      assert(
        (camera.getState().message ?? "").includes("continues without video"),
        "and the candidate is told the interview goes on",
      );
    } finally {
      restore();
    }
  });

  await asyncSuite("a hardware failure is an error, not a denial", async () => {
    const restore = withMediaDevices(() =>
      Promise.reject(new DOMException("gone", "NotReadableError")),
    );
    try {
      const c = createEventCollector({ now: fakeClock().now });
      const camera = new CameraManager(c);
      assert((await camera.start()) === null, "resolves to null");
      assert(c.drain()[0]?.kind === "camera_error", "recorded as an error");
      assert(camera.getState().status === "error", "state says error");
    } finally {
      restore();
    }
  });

  await asyncSuite("a browser without getUserMedia does not throw", async () => {
    const restore = withNavigator({});
    try {
      const c = createEventCollector({ now: fakeClock().now });
      const camera = new CameraManager(c);
      assert((await camera.start()) === null, "resolves to null");
      assert(c.drain()[0]?.detail === "UnsupportedBrowser", "recorded as such");
    } finally {
      restore();
    }
  });

  await asyncSuite("a working camera goes active and heartbeats once", async () => {
    const restore = withMediaDevices(() => Promise.resolve(fakeStream()));
    try {
      const c = createEventCollector({ now: fakeClock().now });
      const camera = new CameraManager(c);

      const stream = await camera.start();
      assert(stream !== null, "a stream comes back");
      assert(camera.getState().status === "active", "state says active");

      const events = c.drain();
      assert(events.length === 1, "one heartbeat at start");
      assert(events[0]?.kind === "camera_active", "of the right kind");
      assert(events[0]?.meta?.activeSeconds === 0, "starting at zero");

      camera.stop();
      assert(camera.getState().stream === null, "the device is released");
    } finally {
      restore();
    }
  });

  await asyncSuite("dispose before the prompt is answered releases the device", async () => {
    // Held in a box: TypeScript narrows a plain `let` assigned inside a callback
    // to `never` at the call site, and the point of this test is the call.
    const box: { resolve: ((s: MediaStream) => void) | null } = { resolve: null };
    const restore = withMediaDevices(
      () =>
        new Promise<MediaStream>((resolve) => {
          box.resolve = resolve;
        }),
    );
    try {
      const c = createEventCollector({ now: fakeClock().now });
      const camera = new CameraManager(c);

      const pending = camera.start();
      camera.dispose();

      let stopped = false;
      const track = { stop: () => (stopped = true), addEventListener: () => {} };
      box.resolve?.({
        getTracks: () => [track],
        getVideoTracks: () => [track],
      } as unknown as MediaStream);

      assert((await pending) === null, "no stream is handed to a dead component");
      assert(stopped, "and the camera light is turned off");
    } finally {
      restore();
    }
  });

}

void runCameraSuites().then(() => {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
