/**
 * Plan 129 (T-218) — candidate assessment taking. Covers TC-C-012 and TC-C-013.
 *   npm run test:assessment-attempts
 *
 * In-memory store (decision D-2): start / saveAnswer / submit check and write
 * with no `await` in between, so they are atomic the way the Postgres guards
 * are. findAttempt returns a snapshot, as a database read would.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeAttemptsPastDeadline,
  finishAttempt,
  endAttempt,
  finishAttemptForced,
  finalizeStrictAttemptOnLeave,
  listCandidateAttempts,
  loadAttempt,
  recordAttemptEvents,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type AnswerRow,
  type AttemptListRow,
  type AttemptQuestionRow,
  type AttemptRow,
  type AttemptStatus,
  type AttemptStore,
  type EventWrite,
  type FinishInput,
  type GradeQuestion,
  type SubmitOutcome,
} from "./service";
import {
  ACTIVITY_DISCLAIMER,
  BANNED_CLAIM_PATTERN,
  CAMERA_DISCLAIMER,
  SESSION_GRACE_MS,
  SUMMARY_COPY,
  describeEvent,
  summarizeAttemptActivity,
  type ActivityEvent,
  type ActivitySession,
} from "./activity";
import { createIntegrityRecorder } from "@/components/assessments/integrity-recorder";
import {
  ATTEMPT_EVENT_TYPES,
  ASSESSMENT_END_REASONS,
  type AssessmentEndReason,
  type AttemptEventType,
} from "@/lib/validations/assessment";
import { $Enums } from "@prisma/client";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function suite(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** The body of one method, from its signature to `endMarker`. */
function sliceBody(src: string, startMarker: string, endMarker: RegExp): string {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const rest = src.slice(start + startMarker.length);
  const end = rest.search(endMarker);
  return end < 0 ? rest : rest.slice(0, end);
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

type StoredAssessment = {
  id: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  title: string;
  passMarkPercent: number;
  durationMinutes: number | null;
  questions: AttemptQuestionRow[];
  /** The answer key, kept apart — findAttempt never reads it. */
  correct: Map<string, string[]>;
  strictMode: boolean;
  cameraRequired: boolean;
  /** Plan 166. */
  source: "RECRUITER" | "PLATFORM";
  closesAt: Date | null;
};

type StoredSession = {
  assignmentId: string;
  clientSessionId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type StoredEvent = EventWrite & { assignmentId: string; sessionId: string };

type StoredAssignment = {
  id: string;
  assessmentId: string;
  candidateUserId: string;
  status: AttemptStatus;
  assignedAt: Date;
  startedAt: Date | null;
  submittedAt: Date | null;
  scorePercent: number | null;
  passed: boolean | null;
  endReason: AssessmentEndReason | null;
};

function inMemoryStore() {
  const assessments = new Map<string, StoredAssessment>();
  const assignments = new Map<string, StoredAssignment>();
  const answers = new Map<string, AnswerRow>();
  const sessions = new Map<string, StoredSession>();
  const events = new Map<string, StoredEvent>();
  let seq = 0;

  const sessionKey = (assignmentId: string, clientSessionId: string) =>
    `${assignmentId}:${clientSessionId}`;
  const eventKey = (assignmentId: string, sessionId: string, n: number) =>
    `${assignmentId}:${sessionId}:${n}`;

  const key = (assignmentId: string, questionId: string) =>
    `${assignmentId}:${questionId}`;
  const owned = (assignmentId: string, userId: string) => {
    const a = assignments.get(assignmentId);
    return a && a.candidateUserId === userId ? a : undefined;
  };
  const answersFor = (assignmentId: string) =>
    [...answers.entries()]
      .filter(([k]) => k.startsWith(`${assignmentId}:`))
      .map(([, v]) => v);

  const store: AttemptStore = {
    async findAttempt(assignmentId, candidateUserId): Promise<AttemptRow | null> {
      const a = owned(assignmentId, candidateUserId);
      if (!a) return null;
      const s = assessments.get(a.assessmentId)!;
      return structuredClone({
        assignmentId: a.id,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        endReason: a.endReason,
        assessment: {
          status: s.status,
          source: s.source,
          closesAt: s.closesAt,
          title: s.title,
          subheading: null,
          instructions: "Read carefully.",
          durationMinutes: s.durationMinutes,
          passMarkPercent: s.passMarkPercent,
          strictMode: s.strictMode,
          cameraRequired: s.cameraRequired,
        },
        questions: s.questions,
        answers: answersFor(a.id),
      });
    },
    async listAttempts(candidateUserId): Promise<AttemptListRow[]> {
      return [...assignments.values()]
        .filter(
          (a) =>
            a.candidateUserId === candidateUserId &&
            assessments.get(a.assessmentId)?.status === "PUBLISHED",
        )
        .sort((x, y) => y.assignedAt.getTime() - x.assignedAt.getTime())
        .map((a) => {
          const s = assessments.get(a.assessmentId)!;
          return {
            assignmentId: a.id,
            title: s.title,
            subheading: null,
            source: s.source,
            status: a.status,
            assignedAt: a.assignedAt,
            startedAt: a.startedAt,
            submittedAt: a.submittedAt,
            closesAt: s.closesAt,
            durationMinutes: s.durationMinutes,
            questionCount: s.questions.length,
            strictMode: s.strictMode,
            cameraRequired: s.cameraRequired,
          };
        });
    },
    async listStartedPastClose(assessmentId, now) {
      const s = assessments.get(assessmentId);
      if (!s || s.source !== "PLATFORM" || !s.closesAt || s.closesAt > now) return [];
      const closesAt = s.closesAt;
      return [...assignments.values()]
        .filter((a) => a.assessmentId === assessmentId && a.status === "STARTED")
        .map((a) => ({ assignmentId: a.id, candidateUserId: a.candidateUserId, closesAt }));
    },
    async start(assignmentId, candidateUserId, at) {
      const a = owned(assignmentId, candidateUserId);
      if (!a || a.status !== "ASSIGNED") return false;
      a.status = "STARTED";
      a.startedAt = at;
      return true;
    },
    async saveAnswer(assignmentId, candidateUserId, questionId, value) {
      const a = owned(assignmentId, candidateUserId);
      if (!a || a.status !== "STARTED") return "NOT_OPEN";
      answers.set(key(assignmentId, questionId), { questionId, ...value });
      return "SAVED";
    },
    async submit(assignmentId, candidateUserId, at, finish): Promise<SubmitOutcome> {
      const a = owned(assignmentId, candidateUserId);
      if (!a || (a.status !== "ASSIGNED" && a.status !== "STARTED")) {
        return { outcome: "NOT_OPEN" };
      }
      const before = { status: a.status, submittedAt: a.submittedAt };
      a.status = "SUBMITTED";
      a.submittedAt = at;
      const s = assessments.get(a.assessmentId)!;
      const result = finish({
        passMarkPercent: s.passMarkPercent,
        answers: answersFor(a.id),
        questions: s.questions.map((q) => ({
          id: q.id,
          type: q.type,
          points: q.points,
          isRequired: q.isRequired,
          maxWords: q.maxWords,
          correctOptionIds: s.correct.get(q.id) ?? [],
        })),
      });
      if (!result.ok) {
        // Emulates the transaction rolling the flip back.
        a.status = before.status;
        a.submittedAt = before.submittedAt;
        return {
          outcome: "INCOMPLETE",
          missingRequired: result.missingRequired,
          overLimit: result.overLimit,
        };
      }
      a.scorePercent = result.scorePercent;
      a.passed = result.passed;
      a.endReason = "SUBMITTED";
      return { outcome: "SUBMITTED" };
    },
    async submitForced(assignmentId, candidateUserId, at, finish, reason) {
      const a = owned(assignmentId, candidateUserId);
      if (!a) return { outcome: "NOT_OPEN" };
      if (a.status === "SUBMITTED") return { outcome: "ALREADY" };
      if (a.status !== "STARTED") return { outcome: "NOT_OPEN" };
      const before = { status: a.status, submittedAt: a.submittedAt };
      a.status = "SUBMITTED";
      a.submittedAt = at;
      const s = assessments.get(a.assessmentId)!;
      const result = finish({
        passMarkPercent: s.passMarkPercent,
        answers: answersFor(a.id),
        questions: s.questions.map((q) => ({
          id: q.id,
          type: q.type,
          points: q.points,
          isRequired: q.isRequired,
          maxWords: q.maxWords,
          correctOptionIds: s.correct.get(q.id) ?? [],
        })),
      });
      if (!result.ok) {
        a.status = before.status;
        a.submittedAt = before.submittedAt;
        return {
          outcome: "INCOMPLETE",
          missingRequired: result.missingRequired,
          overLimit: result.overLimit,
        };
      }
      a.scorePercent = result.scorePercent;
      a.passed = result.passed;
      a.endReason = reason;
      return { outcome: "SUBMITTED" };
    },
    async countStrikes(assignmentId, candidateUserId) {
      if (!owned(assignmentId, candidateUserId)) return { tabSwitches: 0, fullscreenExits: 0 };
      const mine = [...events.values()].filter((e) => e.assignmentId === assignmentId);
      return {
        tabSwitches: mine.filter((e) => e.type === "VISIBILITY_VISIBLE").length,
        fullscreenExits: mine.filter((e) => e.type === "FULLSCREEN_EXITED").length,
      };
    },
    async findEventContext(assignmentId, candidateUserId, clientSessionId) {
      const a = owned(assignmentId, candidateUserId);
      if (!a) return null;
      const s = assessments.get(a.assessmentId)!;
      const eventCount = [...events.values()].filter((e) => e.assignmentId === assignmentId).length;
      const sessionCount = [...sessions.values()].filter((x) => x.assignmentId === assignmentId).length;
      return {
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        assessment: {
          status: s.status,
          strictMode: s.strictMode,
          cameraRequired: s.cameraRequired,
          questions: s.questions.map((q) => ({ id: q.id, type: q.type })),
        },
        eventCount,
        sessionExists: sessions.has(sessionKey(assignmentId, clientSessionId)),
        sessionCount,
      };
    },
    async writeEventBatch(assignmentId, clientSessionId, receivedAt, batch) {
      const sk = sessionKey(assignmentId, clientSessionId);
      const existing = sessions.get(sk);
      if (existing) {
        existing.lastSeenAt = receivedAt;
      } else {
        sessions.set(sk, {
          assignmentId,
          clientSessionId,
          firstSeenAt: receivedAt,
          lastSeenAt: receivedAt,
        });
      }
      for (const e of batch) {
        const ek = eventKey(assignmentId, clientSessionId, e.seq);
        if (events.has(ek)) continue;
        events.set(ek, { ...e, assignmentId, sessionId: clientSessionId });
      }
    },
  };

  function addAssessment(
    status: StoredAssessment["status"] = "PUBLISHED",
    title = "Backend screen",
  ): StoredAssessment {
    const id = `as_${++seq}`;
    const s: StoredAssessment = {
      id,
      status,
      title,
      passMarkPercent: 60,
      durationMinutes: 30,
      strictMode: false,
      cameraRequired: false,
      source: "RECRUITER",
      closesAt: null,
      correct: new Map([
        [`${id}_q1`, [`${id}_o1a`]],
        [`${id}_q2`, [`${id}_o2a`, `${id}_o2b`]],
      ]),
      questions: [
        {
          id: `${id}_q1`,
          position: 0,
          type: "MULTIPLE_CHOICE",
          title: "Which structure is FIFO?",
          helpText: null,
          isRequired: true,
          points: 2,
          allowMultipleCorrect: false,
          maxWords: null,
          uploadDestinationUrl: null,
          options: [
            { id: `${id}_o1a`, position: 0, body: "Queue" },
            { id: `${id}_o1b`, position: 1, body: "Stack" },
          ],
        },
        {
          id: `${id}_q2`,
          position: 1,
          type: "MULTIPLE_CHOICE",
          title: "Which are HTTP methods?",
          helpText: null,
          isRequired: true,
          points: 3,
          allowMultipleCorrect: true,
          maxWords: null,
          uploadDestinationUrl: null,
          options: [
            { id: `${id}_o2a`, position: 0, body: "GET" },
            { id: `${id}_o2b`, position: 1, body: "POST" },
            { id: `${id}_o2c`, position: 2, body: "FETCH" },
          ],
        },
        {
          id: `${id}_q3`,
          position: 2,
          type: "PARAGRAPH",
          title: "Explain CAP briefly.",
          helpText: null,
          isRequired: true,
          points: 5,
          allowMultipleCorrect: false,
          maxWords: 20,
          uploadDestinationUrl: null,
          options: [],
        },
        {
          id: `${id}_q4`,
          position: 3,
          type: "FILE_UPLOAD",
          title: "Upload your design doc.",
          helpText: null,
          isRequired: true,
          points: 5,
          allowMultipleCorrect: false,
          maxWords: null,
          uploadDestinationUrl: "https://drive.example.com/upload",
          options: [],
        },
      ],
    };
    assessments.set(id, s);
    return s;
  }

  function addAssignment(assessmentId: string, candidateUserId: string, assignedAt = new Date()) {
    const id = `asg_${++seq}`;
    assignments.set(id, {
      id,
      assessmentId,
      candidateUserId,
      status: "ASSIGNED",
      assignedAt,
      startedAt: null,
      submittedAt: null,
      scorePercent: null,
      passed: null,
      endReason: null,
    });
    return id;
  }

  return { store, assessments, assignments, answers, sessions, events, addAssessment, addAssignment, key };
}

const C = "cand_c";
const D = "cand_d";

function fixture() {
  const mem = inMemoryStore();
  const s = mem.addAssessment();
  const aC = mem.addAssignment(s.id, C);
  const aD = mem.addAssignment(s.id, D);
  const q = (n: number) => `${s.id}_q${n}`;
  const o = (label: string) => `${s.id}_o${label}`;
  return { ...mem, s, aC, aD, q, o };
}

type Fixture = ReturnType<typeof fixture>;

async function save(f: Fixture, questionId: string, answer: unknown, user = C, assignmentId = f.aC) {
  return saveAnswer(f.store, user, { assignmentId, questionId, answer });
}

/** Every required question answered correctly, within limits. */
async function answerAll(f: Fixture) {
  await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
  await save(f, f.q(2), { kind: "choice", selectedOptionIds: [f.o("2a"), f.o("2b")] });
  await save(f, f.q(3), { kind: "text", text: "Consistency, availability, partition tolerance." });
  await save(f, f.q(4), { kind: "file", fileUrl: "https://drive.example.com/f/1" });
}

async function started(): Promise<Fixture> {
  const f = fixture();
  const res = await startAttempt(f.store, C, { assignmentId: f.aC });
  if (!res.ok) throw new Error("setup start failed");
  return f;
}

async function strictFixture(cameraRequired = false): Promise<Fixture> {
  const f = fixture();
  f.assessments.get(f.s.id)!.strictMode = true;
  f.assessments.get(f.s.id)!.cameraRequired = cameraRequired;
  const res = await startAttempt(f.store, C, { assignmentId: f.aC });
  if (!res.ok) throw new Error("strict start failed");
  // Pin start before the I-suite's fixed receivedAt timestamps so wall-clock
  // time of day cannot drop events as "before start".
  f.assignments.get(f.aC)!.startedAt = new Date("2026-09-14T09:00:00Z");
  return f;
}

const SID = "11111111-1111-4111-8111-111111111111";
const SID2 = "22222222-2222-4222-8222-222222222222";

function ev(
  seq: number,
  type: AttemptEventType,
  occurredAt: number,
  extra: { questionId?: string; count?: number } = {},
) {
  return { seq, type, occurredAt, ...extra };
}

async function ingest(
  f: Fixture,
  body: unknown,
  receivedAt: Date,
  assignmentId = f.aC,
  user = C,
) {
  return recordAttemptEvents(f.store, user, assignmentId, body, receivedAt);
}

function gradeInput(overrides: Partial<FinishInput> = {}): FinishInput {
  const questions: GradeQuestion[] = [
    { id: "m1", type: "MULTIPLE_CHOICE", points: 2, isRequired: false, maxWords: null, correctOptionIds: ["a"] },
    { id: "m2", type: "MULTIPLE_CHOICE", points: 3, isRequired: false, maxWords: null, correctOptionIds: ["x", "y"] },
    { id: "p1", type: "PARAGRAPH", points: 10, isRequired: false, maxWords: 50, correctOptionIds: [] },
    { id: "f1", type: "FILE_UPLOAD", points: 10, isRequired: false, maxWords: null, correctOptionIds: [] },
  ];
  return { questions, answers: [], passMarkPercent: 60, ...overrides };
}

const pick = (questionId: string, ids: string[]): AnswerRow => ({
  questionId,
  selectedOptionIds: ids,
  text: null,
  fileUrl: null,
});

// ---------------------------------------------------------------------------

async function run() {
  console.log("\nPlan 129 (T-218) assessment taking\n");

  // ---- start --------------------------------------------------------------

  await suite("1. start: ASSIGNED → STARTED, startedAt set", async () => {
    const f = fixture();
    const res = await startAttempt(f.store, C, { assignmentId: f.aC });
    assert(res.ok && res.data.alreadyStarted === false, "start ok");
    const a = f.assignments.get(f.aC)!;
    assert(a.status === "STARTED", `status STARTED, got ${a.status}`);
    assert(a.startedAt instanceof Date, "startedAt set");
  });

  await suite("2. start twice → alreadyStarted, startedAt unchanged", async () => {
    const f = await started();
    const first = f.assignments.get(f.aC)!.startedAt!.getTime();
    const again = await startAttempt(f.store, C, { assignmentId: f.aC });
    assert(again.ok && again.data.alreadyStarted === true, "second start is a no-op");
    assert(f.assignments.get(f.aC)!.startedAt!.getTime() === first, "startedAt unchanged");
  });

  await suite("3. start after submit → CONFLICT", async () => {
    const f = await started();
    await answerAll(f);
    const sub = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(sub.ok, "setup submit");
    const res = await startAttempt(f.store, C, { assignmentId: f.aC });
    assert(!res.ok && res.code === "CONFLICT", "CONFLICT");
  });

  // ---- isolation ------------------------------------------------------------

  await suite(
    "4. another candidate's assignment → NOT_FOUND on load, start, save and submit",
    async () => {
      const f = fixture();
      const load = await loadAttempt(f.store, D, f.aC);
      const start = await startAttempt(f.store, D, { assignmentId: f.aC });
      const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] }, D, f.aC);
      const sub = await submitAttempt(f.store, D, { assignmentId: f.aC });
      for (const [name, r] of [["load", load], ["start", start], ["save", put], ["submit", sub]] as const) {
        assert(!r.ok && r.code === "NOT_FOUND", `${name} must be NOT_FOUND`);
      }
      assert(f.assignments.get(f.aC)!.status === "ASSIGNED", "C's attempt untouched");
      assert(f.answers.size === 0, "nothing written");
    },
  );

  await suite("5. DRAFT or ARCHIVED assessment → NOT_FOUND on load and start", async () => {
    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      const mem = inMemoryStore();
      const s = mem.addAssessment(status);
      const id = mem.addAssignment(s.id, C);
      const load = await loadAttempt(mem.store, C, id);
      const start = await startAttempt(mem.store, C, { assignmentId: id });
      assert(!load.ok && load.code === "NOT_FOUND", `${status} load NOT_FOUND`);
      assert(!start.ok && start.code === "NOT_FOUND", `${status} start NOT_FOUND`);
      assert(mem.assignments.get(id)!.status === "ASSIGNED", `${status} not started`);
    }
  });

  await suite("6. unknown question, or one from another assessment → NOT_FOUND", async () => {
    const f = await started();
    const other = f.addAssessment("PUBLISHED", "Other");
    const unknown = await save(f, "nope", { kind: "text", text: "x" });
    const foreign = await save(f, `${other.id}_q3`, { kind: "text", text: "x" });
    assert(!unknown.ok && unknown.code === "NOT_FOUND", "unknown NOT_FOUND");
    assert(!foreign.ok && foreign.code === "NOT_FOUND", "foreign NOT_FOUND");
    assert(f.answers.size === 0, "nothing written");
  });

  // ---- save -----------------------------------------------------------------

  await suite("7. save before start → CONFLICT, nothing written", async () => {
    const f = fixture();
    const res = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(!res.ok && res.code === "CONFLICT", "CONFLICT");
    assert(f.answers.size === 0, "nothing written");
  });

  await suite("8. invalid choices and a mismatched kind → INVALID", async () => {
    const f = await started();
    const two = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a"), f.o("1b")] });
    const alien = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("2a")] });
    const kind = await save(f, f.q(1), { kind: "text", text: "Queue" });
    assert(!two.ok && two.code === "INVALID", "single-select with two options");
    assert(!alien.ok && alien.code === "INVALID", "option from another question");
    assert(!kind.ok && kind.code === "INVALID", "text for an MCQ");
    assert(f.answers.size === 0, "nothing written");
  });

  await suite("9. an over-limit paragraph is saved, then submit refuses it", async () => {
    const f = await started();
    await answerAll(f);
    const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const put = await save(f, f.q(3), { kind: "text", text: long });
    assert(put.ok, "over-limit draft is saved, not lost");
    assert(f.answers.get(f.key(f.aC, f.q(3)))?.text === long, "stored in full");
    const sub = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!sub.ok && sub.code === "INVALID", "submit refused");
    if (!sub.ok) assert(sub.message.includes("Shorten 1 answer"), `message: ${sub.message}`);
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still STARTED");
  });

  await suite("10. file links: javascript: and data: refused, empty clears, https trimmed", async () => {
    const f = await started();
    const js = await save(f, f.q(4), { kind: "file", fileUrl: "javascript:alert(1)" });
    const data = await save(f, f.q(4), { kind: "file", fileUrl: "data:text/html,x" });
    assert(!js.ok && js.code === "INVALID", "javascript: refused");
    assert(!data.ok && data.code === "INVALID", "data: refused");
    const ok = await save(f, f.q(4), { kind: "file", fileUrl: "  https://drive.example.com/f  " });
    assert(ok.ok, "https saved");
    assert(
      f.answers.get(f.key(f.aC, f.q(4)))?.fileUrl === "https://drive.example.com/f",
      "stored trimmed",
    );
    const clear = await save(f, f.q(4), { kind: "file", fileUrl: "" });
    assert(clear.ok, "clearing saved");
    assert(f.answers.get(f.key(f.aC, f.q(4)))?.fileUrl === null, "cleared to null");
  });

  await suite("11. saving a question twice keeps one row with the second value", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1b")] });
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    const rows = [...f.answers.keys()].filter((k) => k.endsWith(f.q(1)));
    assert(rows.length === 1, "one row");
    assert(
      f.answers.get(f.key(f.aC, f.q(1)))?.selectedOptionIds.join() === f.o("1a"),
      "second value",
    );
  });

  // ---- TC-C-012 -------------------------------------------------------------

  await suite("12. TC-C-012: every answer survives a device change", async () => {
    const f = await started();
    const paragraph = "  line one\n\tline two — ünïcode, kept exactly  ";
    const link = "https://drive.example.com/f/42";
    // Device A: answer all four types.
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    await save(f, f.q(2), { kind: "choice", selectedOptionIds: [f.o("2b"), f.o("2a")] });
    await save(f, f.q(3), { kind: "text", text: paragraph });
    await save(f, f.q(4), { kind: "file", fileUrl: link });

    // Device B: nothing from device A is reused — only the user and the id.
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok, "load ok");
    if (!loaded.ok) return;
    const a = loaded.data.answers;
    const q1 = a[f.q(1)];
    const q2 = a[f.q(2)];
    const q3 = a[f.q(3)];
    const q4 = a[f.q(4)];
    assert(q1?.kind === "choice" && q1.selectedOptionIds.join() === f.o("1a"), "single-select restored");
    assert(
      q2?.kind === "choice" &&
        new Set(q2.selectedOptionIds).size === 2 &&
        q2.selectedOptionIds.includes(f.o("2a")) &&
        q2.selectedOptionIds.includes(f.o("2b")),
      "multi-select restored as the same set",
    );
    assert(q3?.kind === "text" && q3.text === paragraph, "paragraph byte-identical, not trimmed");
    assert(q4?.kind === "file" && q4.fileUrl === link, "file link restored");
    assert(loaded.data.status === "STARTED", "resumes in progress");
  });

  await suite("13. the candidate view never carries the answer key, score or result", async () => {
    const f = await started();
    await answerAll(f);
    await submitAttempt(f.store, C, { assignmentId: f.aC });
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok, "load ok");
    const json = JSON.stringify(loaded.ok ? loaded.data : null);
    for (const word of ["isCorrect", "scorePercent", "passed", "correctOptionIds"]) {
      assert(!json.includes(word), `view must not contain ${word}`);
    }
  });

  // ---- submit — TC-C-013 ----------------------------------------------------

  await suite("14. TC-C-013: a duplicate submission is refused server-side", async () => {
    const f = await started();
    await answerAll(f);
    const first = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(first.ok, "first submit ok");
    const row = f.assignments.get(f.aC)!;
    const snapshot = { ...row };
    const second = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!second.ok && second.code === "CONFLICT", "second submit refused");
    if (!second.ok) {
      assert(
        second.message === "This assessment has already been submitted.",
        `message: ${second.message}`,
      );
    }
    assert(row.submittedAt === snapshot.submittedAt, "one submittedAt");
    assert(row.scorePercent === snapshot.scorePercent && row.passed === snapshot.passed, "one result");
    assert(row.scorePercent === 100 && row.passed === true, "scored from the saved answers");
  });

  await suite("15. two concurrent submits → exactly one succeeds", async () => {
    const f = await started();
    await answerAll(f);
    const results = await Promise.all([
      submitAttempt(f.store, C, { assignmentId: f.aC }),
      submitAttempt(f.store, C, { assignmentId: f.aC }),
    ]);
    const oks = results.filter((r) => r.ok).length;
    const conflicts = results.filter((r) => !r.ok && r.code === "CONFLICT").length;
    assert(oks === 1 && conflicts === 1, `expected 1 ok + 1 conflict, got ${oks} + ${conflicts}`);
  });

  await suite("16. save after submit → CONFLICT; the stored answer is unchanged", async () => {
    const f = await started();
    await answerAll(f);
    await submitAttempt(f.store, C, { assignmentId: f.aC });
    const before = f.answers.get(f.key(f.aC, f.q(1)))?.selectedOptionIds.join();
    const late = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1b")] });
    assert(!late.ok && late.code === "CONFLICT", "late save refused");
    assert(
      f.answers.get(f.key(f.aC, f.q(1)))?.selectedOptionIds.join() === before,
      "answer unchanged",
    );
  });

  await suite("17. a required question left blank refuses submit and rolls back", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    await save(f, f.q(2), { kind: "choice", selectedOptionIds: [f.o("2a")] });
    await save(f, f.q(3), { kind: "text", text: "An answer." });
    const refused = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!refused.ok && refused.code === "INVALID", "INVALID");
    if (!refused.ok) {
      assert(
        refused.message === "Answer the 1 required question left before submitting.",
        `message: ${refused.message}`,
      );
    }
    const a = f.assignments.get(f.aC)!;
    assert(a.status === "STARTED" && a.submittedAt === null, "flip rolled back");
    await save(f, f.q(4), { kind: "file", fileUrl: "https://drive.example.com/f" });
    const ok = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(ok.ok, "submits once complete");
  });

  await suite("18. a whitespace-only paragraph counts as unanswered", async () => {
    const f = await started();
    await answerAll(f);
    await save(f, f.q(3), { kind: "text", text: "   \n\t  " });
    const res = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!res.ok && res.code === "INVALID", "refused");
  });

  await suite("19. the submit response carries no score (D-1)", async () => {
    const f = await started();
    await answerAll(f);
    const res = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(res.ok, "ok");
    if (res.ok) {
      // Plan 166: `source` (RECRUITER | PLATFORM) is not a result; the action
      // reads it server-side and still returns submittedAt only.
      assert(
        JSON.stringify(Object.keys(res.data)) === JSON.stringify(["submittedAt", "source"]),
        `keys: ${Object.keys(res.data).join()}`,
      );
    }
  });

  // ---- scoring (finishAttempt) ---------------------------------------------

  await suite("20. single-select: right earns its points, wrong earns 0", () => {
    const right = finishAttempt(gradeInput({ answers: [pick("m1", ["a"])] }));
    const wrong = finishAttempt(gradeInput({ answers: [pick("m1", ["b"])] }));
    assert(right.ok && right.scorePercent === 40, "2 of 5 → 40");
    assert(wrong.ok && wrong.scorePercent === 0, "wrong → 0");
  });

  await suite("21. multi-select: only the exact set earns — subset and superset get 0", () => {
    const exact = finishAttempt(gradeInput({ answers: [pick("m2", ["y", "x"])] }));
    const subset = finishAttempt(gradeInput({ answers: [pick("m2", ["x"])] }));
    const superset = finishAttempt(gradeInput({ answers: [pick("m2", ["x", "y", "z"])] }));
    assert(exact.ok && exact.scorePercent === 60, "3 of 5 → 60");
    assert(subset.ok && subset.scorePercent === 0, "subset → 0");
    assert(superset.ok && superset.scorePercent === 0, "superset → 0");
  });

  await suite("22. PARAGRAPH and FILE_UPLOAD never change the score", () => {
    const res = finishAttempt(
      gradeInput({
        answers: [
          pick("m1", ["a"]),
          pick("m2", ["x", "y"]),
          { questionId: "p1", selectedOptionIds: [], text: "anything at all", fileUrl: null },
          { questionId: "f1", selectedOptionIds: [], text: null, fileUrl: "https://x.example" },
        ],
      }),
    );
    assert(res.ok && res.scorePercent === 100, "all MCQ right → 100 regardless");
  });

  await suite("23. weighting and rounding", () => {
    const three = (earnedPoints: number) => {
      const questions: GradeQuestion[] = [
        { id: "a", type: "MULTIPLE_CHOICE", points: 1, isRequired: false, maxWords: null, correctOptionIds: ["1"] },
        { id: "b", type: "MULTIPLE_CHOICE", points: 1, isRequired: false, maxWords: null, correctOptionIds: ["1"] },
        { id: "c", type: "MULTIPLE_CHOICE", points: 1, isRequired: false, maxWords: null, correctOptionIds: ["1"] },
      ];
      const answers = questions.slice(0, earnedPoints).map((q) => pick(q.id, ["1"]));
      return finishAttempt({ questions, answers, passMarkPercent: 60 });
    };
    const twoOfThree = three(2);
    const oneOfThree = three(1);
    assert(twoOfThree.ok && twoOfThree.scorePercent === 67, "2 of 3 → 67");
    assert(oneOfThree.ok && oneOfThree.scorePercent === 33, "1 of 3 → 33");
  });

  await suite("24. pass mark boundary: equal passes, one below does not", () => {
    const at = finishAttempt(gradeInput({ answers: [pick("m1", ["a"])], passMarkPercent: 40 }));
    const below = finishAttempt(gradeInput({ answers: [pick("m1", ["a"])], passMarkPercent: 41 }));
    assert(at.ok && at.passed === true, "40 ≥ 40 passes");
    assert(below.ok && below.passed === false, "40 < 41 fails");
  });

  await suite("25. an unanswered multiple-choice question earns 0", () => {
    const res = finishAttempt(gradeInput());
    assert(res.ok && res.scorePercent === 0 && res.passed === false, "nothing answered → 0, not passed");
  });

  // ---- list -----------------------------------------------------------------

  await suite("26. the list is this candidate's published assignments, newest first, no score", async () => {
    const mem = inMemoryStore();
    const older = mem.addAssessment("PUBLISHED", "Older");
    const newer = mem.addAssessment("PUBLISHED", "Newer");
    const draft = mem.addAssessment("DRAFT", "Draft");
    mem.addAssignment(older.id, C, new Date("2026-09-01T10:00:00Z"));
    mem.addAssignment(newer.id, C, new Date("2026-09-10T10:00:00Z"));
    mem.addAssignment(draft.id, C);
    mem.addAssignment(newer.id, D);
    const listed = await listCandidateAttempts(mem.store, C);
    assert(listed.ok, "ok");
    if (!listed.ok) return;
    assert(
      listed.data.map((r) => r.title).join() === "Newer,Older",
      `got ${listed.data.map((r) => r.title).join()}`,
    );
    const json = JSON.stringify(listed.data);
    assert(!json.includes("scorePercent") && !json.includes("passed"), "no score fields");
  });

  // ---- source scans ---------------------------------------------------------

  await suite("27. the candidate queries never select the answer key or the result", () => {
    const src = read("src/features/assessment-attempts/prisma-store.ts");
    const find = sliceBody(src, "async findAttempt(", /\n {4}async /);
    const list = sliceBody(src, "async listAttempts(", /\n {4}async /);
    for (const [name, body] of [["findAttempt", find], ["listAttempts", list]] as const) {
      for (const word of ["isCorrect", "scorePercent", "passed:"]) {
        assert(!body.includes(word), `${name} must not mention ${word}`);
      }
    }
    assert(find.includes("candidateUserId"), "findAttempt scopes by candidate");
    assert(
      list.includes("candidateUserId") && list.includes('status: "PUBLISHED"'),
      "listAttempts scopes by candidate and to PUBLISHED",
    );
    const submitAt = src.indexOf("async submit(");
    const firstKey = src.indexOf("isCorrect");
    assert(submitAt > 0 && firstKey > submitAt, "the answer key is read only inside submit");
  });

  await suite("28. guarded writes use plan 128 §10's guards and no relation filter", () => {
    const src = read("src/features/assessment-attempts/prisma-store.ts");
    const wheres = [...src.matchAll(/updateMany\(\{([\s\S]*?)data:/g)].map((m) => m[1] ?? "");
    assert(wheres.length === 4, `expected 4 guarded updateMany, found ${wheres.length}`);
    assert(
      wheres.every((w) => w.includes("candidateUserId") && !w.includes("assessment:")),
      "every guard scopes by candidate and carries no relation filter",
    );
    assert(wheres.some((w) => w.includes('status: "ASSIGNED"')), "start guards on ASSIGNED");
    assert(
      wheres.filter((w) => w.includes('status: "STARTED"')).length >= 2,
      "save and leave-finalize guard on STARTED",
    );
    assert(
      wheres.some((w) => /status:\s*\{\s*in:\s*\["ASSIGNED",\s*"STARTED"\]\s*\}/.test(w)),
      "submit guards on ASSIGNED | STARTED",
    );
  });

  await suite("29. actions take the candidate from the session, never from input", () => {
    const src = read("src/app/actions/assessment-attempt-actions.ts");
    const exported = (src.match(/export async function /g) ?? []).length;
    const gated = (src.match(/await sessionUserId\(\)/g) ?? []).length;
    assert(exported === 4 && gated === 4, `every action calls sessionUserId() (${gated}/${exported})`);
    assert(!src.includes("candidateUserId"), "no user id is read from input");
    assert(!src.includes("console."), "no console");
    assert(!src.includes("scorePercent") && !/\bpassed\b/.test(src), "no score in responses");
  });

  // ---- T-219 device refusal -------------------------------------------------

  await suite("G1. strict + mobile → CONFLICT on start, save and submit; nothing written", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    const phone = { mobile: true };
    const start = await startAttempt(f.store, C, { assignmentId: f.aC }, phone);
    assert(!start.ok && start.code === "CONFLICT", "start CONFLICT");
    assert(f.assignments.get(f.aC)!.status === "ASSIGNED", "not started");
    f.assignments.get(f.aC)!.status = "STARTED";
    f.assignments.get(f.aC)!.startedAt = new Date();
    const put = await saveAnswer(
      f.store,
      C,
      { assignmentId: f.aC, questionId: f.q(1), answer: { kind: "choice", selectedOptionIds: [f.o("1a")] } },
      phone,
    );
    assert(!put.ok && put.code === "CONFLICT", "save CONFLICT");
    assert(f.answers.size === 0, "nothing written");
    const sub = await submitAttempt(f.store, C, { assignmentId: f.aC }, phone);
    assert(!sub.ok && sub.code === "CONFLICT", "submit CONFLICT");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "not submitted");
  });

  await suite("G2. non-strict + mobile → start/save/submit behave as today", async () => {
    const f = fixture();
    const phone = { mobile: true };
    const start = await startAttempt(f.store, C, { assignmentId: f.aC }, phone);
    assert(start.ok, "start ok");
    const put = await saveAnswer(
      f.store,
      C,
      { assignmentId: f.aC, questionId: f.q(1), answer: { kind: "choice", selectedOptionIds: [f.o("1a")] } },
      phone,
    );
    assert(put.ok, "save ok");
    await answerAll(f);
    const sub = await submitAttempt(f.store, C, { assignmentId: f.aC }, phone);
    assert(sub.ok, "submit ok");
  });

  await suite("G3. loadAttempt returns rules matching the assessment", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    f.assessments.get(f.s.id)!.cameraRequired = true;
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.rules.strictMode && loaded.data.rules.cameraRequired, "rules");
    const plain = fixture();
    const loaded2 = await loadAttempt(plain.store, C, plain.aC);
    assert(
      loaded2.ok && !loaded2.data.rules.strictMode && !loaded2.data.rules.cameraRequired,
      "defaults false",
    );
  });

  // ---- T-219 ingestion ------------------------------------------------------

  await suite("I1. a batch for a started strict attempt is stored", async () => {
    const f = await strictFixture();
    const receivedAt = new Date("2026-09-14T10:00:00Z");
    const res = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: receivedAt.getTime(),
        events: [ev(0, "SESSION_STARTED", receivedAt.getTime() - 10)],
      },
      receivedAt,
    );
    assert(res.ok && res.data.accepted === 1 && res.data.dropped === 0, "accepted 1");
    const sess = f.sessions.get(`${f.aC}:${SID}`)!;
    assert(sess.firstSeenAt.getTime() === receivedAt.getTime(), "firstSeenAt");
    assert(sess.lastSeenAt.getTime() === receivedAt.getTime(), "lastSeenAt");
    assert(f.events.size === 1, "one event");
  });

  await suite("I2. device clock 2h behind is corrected; clientOccurredAt keeps raw", async () => {
    const f = await strictFixture();
    const receivedAt = new Date("2026-09-14T12:00:00Z");
    const sentAt = receivedAt.getTime() - 2 * 3600_000;
    const occurredAt = sentAt - 5_000;
    const res = await ingest(
      f,
      { sessionId: SID, sentAt, events: [ev(0, "SESSION_STARTED", occurredAt)] },
      receivedAt,
    );
    assert(res.ok && res.data.accepted === 1, "accepted");
    const stored = [...f.events.values()][0];
    const expected = occurredAt + (receivedAt.getTime() - sentAt);
    assert(Math.abs(stored.occurredAt.getTime() - expected) < 50, "corrected");
    assert(stored.clientOccurredAt.getTime() === occurredAt, "raw kept");
  });

  await suite("I3. the same batch twice: no new events, lastSeenAt advances", async () => {
    const f = await strictFixture();
    const t1 = new Date("2026-09-14T10:00:00Z");
    const body = {
      sessionId: SID,
      sentAt: t1.getTime(),
      events: [ev(0, "SESSION_STARTED", t1.getTime() - 10)],
    };
    await ingest(f, body, t1);
    const t2 = new Date("2026-09-14T10:00:05Z");
    const again = await ingest(f, { ...body, sentAt: t2.getTime() }, t2);
    assert(again.ok && again.data.accepted === 1, "accepted again (idempotent write)");
    assert(f.events.size === 1, "one event");
    assert(f.sessions.get(`${f.aC}:${SID}`)!.lastSeenAt.getTime() === t2.getTime(), "lastSeenAt");
  });

  await suite("I4. another candidate's assignment → NOT_FOUND, nothing written", async () => {
    const f = await strictFixture();
    const t = new Date();
    const res = await ingest(
      f,
      { sessionId: SID, sentAt: t.getTime(), events: [ev(0, "SESSION_STARTED", t.getTime())] },
      t,
      f.aC,
      D,
    );
    assert(!res.ok && res.code === "NOT_FOUND", "NOT_FOUND");
    assert(f.sessions.size === 0 && f.events.size === 0, "nothing written");
  });

  await suite("I5. non-strict → CONFLICT; ASSIGNED → CONFLICT", async () => {
    const f = await started();
    const t = new Date();
    const nonStrict = await ingest(
      f,
      { sessionId: SID, sentAt: t.getTime(), events: [ev(0, "SESSION_STARTED", t.getTime())] },
      t,
    );
    assert(!nonStrict.ok && nonStrict.code === "CONFLICT", "non-strict");
    const assigned = fixture();
    assigned.assessments.get(assigned.s.id)!.strictMode = true;
    const before = await ingest(
      assigned,
      { sessionId: SID, sentAt: t.getTime(), events: [ev(0, "SESSION_STARTED", t.getTime())] },
      t,
      assigned.aC,
    );
    assert(!before.ok && before.code === "CONFLICT", "ASSIGNED");
  });

  await suite("I6. SUBMITTED grace: within 60s stored; late occurredAt dropped; after 60s CONFLICT", async () => {
    const f = await strictFixture();
    await answerAll(f);
    const submittedAt = new Date("2026-09-14T10:00:00Z");
    f.assignments.get(f.aC)!.status = "SUBMITTED";
    f.assignments.get(f.aC)!.submittedAt = submittedAt;
    const okAt = new Date(submittedAt.getTime() + 10_000);
    const ok = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: okAt.getTime(),
        events: [ev(0, "PAGE_LEFT", submittedAt.getTime() - 1)],
      },
      okAt,
    );
    assert(ok.ok && ok.data.accepted === 1, "within grace stored");
    const droppedAt = new Date(submittedAt.getTime() + 20_000);
    const drop = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: droppedAt.getTime(),
        events: [ev(1, "PAGE_LEFT", submittedAt.getTime() + 6_000)],
      },
      droppedAt,
    );
    assert(drop.ok && drop.data.accepted === 0 && drop.data.dropped === 1, "late occurredAt dropped");
    const late = new Date(submittedAt.getTime() + 61_000);
    const conflict = await ingest(
      f,
      { sessionId: SID, sentAt: late.getTime(), events: [] },
      late,
    );
    assert(!conflict.ok && conflict.code === "CONFLICT", "after 60s");
  });

  await suite("I7. camera events on a non-camera assessment → dropped", async () => {
    const f = await strictFixture(false);
    const t = new Date();
    const res = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: t.getTime(),
        events: [ev(0, "CAMERA_ON", t.getTime() - 5), ev(1, "CAMERA_OFF", t.getTime() - 1)],
      },
      t,
    );
    assert(res.ok && res.data.accepted === 0 && res.data.dropped === 2, "dropped");
  });

  await suite("I8. file-link events need a FILE_UPLOAD question; foreign clipboard id nulled", async () => {
    const f = await strictFixture();
    const t = new Date();
    const other = f.addAssessment();
    const res = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: t.getTime(),
        events: [
          ev(0, "LINK_PASTED", t.getTime() - 4, { questionId: f.q(3) }),
          ev(1, "UPLOAD_LINK_OPENED", t.getTime() - 3, { questionId: `${other.id}_q4` }),
          ev(2, "PASTE_BLOCKED", t.getTime() - 2, { questionId: `${other.id}_q1` }),
          ev(3, "LINK_PASTED", t.getTime() - 1, { questionId: f.q(4) }),
        ],
      },
      t,
    );
    assert(res.ok && res.data.accepted === 2 && res.data.dropped === 2, "2 kept 2 dropped");
    const paste = [...f.events.values()].find((e) => e.type === "PASTE_BLOCKED")!;
    assert(paste.questionId === null, "foreign clipboard nulled");
    const link = [...f.events.values()].find((e) => e.type === "LINK_PASTED")!;
    assert(link.questionId === f.q(4), "file-link kept");
  });

  await suite("I9. event after sentAt + 1s, or older than 24h → dropped", async () => {
    const f = await strictFixture();
    const t = new Date("2026-09-14T12:00:00Z");
    const res = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: t.getTime(),
        events: [
          ev(0, "SESSION_STARTED", t.getTime() + 2_000),
          ev(1, "PAGE_LEFT", t.getTime() - 86_400_001),
        ],
      },
      t,
    );
    assert(res.ok && res.data.accepted === 0 && res.data.dropped === 2, "both dropped");
  });

  await suite("I10. 51 events or a non-UUID sessionId → INVALID, nothing written", async () => {
    const f = await strictFixture();
    const t = new Date();
    const tooMany = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: t.getTime(),
        events: Array.from({ length: 51 }, (_, i) => ev(i, "COPY_BLOCKED", t.getTime() - i)),
      },
      t,
    );
    assert(!tooMany.ok && tooMany.code === "INVALID", "51 INVALID");
    const badId = await ingest(
      f,
      { sessionId: "not-a-uuid", sentAt: t.getTime(), events: [] },
      t,
    );
    assert(!badId.ok && badId.code === "INVALID", "uuid INVALID");
    assert(f.sessions.size === 0 && f.events.size === 0, "nothing written");
  });

  await suite("I11. 990 stored + 20 sent → 10 accepted, limitReached; next batch 0 but lastSeenAt", async () => {
    const f = await strictFixture();
    const t0 = new Date("2026-09-14T10:00:00Z");
    await ingest(f, { sessionId: SID, sentAt: t0.getTime(), events: [] }, t0);
    for (let i = 0; i < 990; i++) {
      f.events.set(`${f.aC}:${SID}:${i}`, {
        assignmentId: f.aC,
        sessionId: SID,
        seq: i,
        type: "COPY_BLOCKED",
        occurredAt: t0,
        clientOccurredAt: t0,
        receivedAt: t0,
        questionId: null,
        count: 1,
      });
    }
    const t1 = new Date("2026-09-14T10:01:00Z");
    const res = await ingest(
      f,
      {
        sessionId: SID,
        sentAt: t1.getTime(),
        events: Array.from({ length: 20 }, (_, i) => ev(1000 + i, "COPY_BLOCKED", t1.getTime() - i)),
      },
      t1,
    );
    assert(res.ok && res.data.accepted === 10 && res.data.limitReached, "10 accepted");
    const t2 = new Date("2026-09-14T10:01:05Z");
    const next = await ingest(f, { sessionId: SID, sentAt: t2.getTime(), events: [ev(2000, "COPY_BLOCKED", t2.getTime())] }, t2);
    assert(next.ok && next.data.accepted === 0 && next.data.limitReached, "0 accepted");
    assert(f.sessions.get(`${f.aC}:${SID}`)!.lastSeenAt.getTime() === t2.getTime(), "lastSeenAt");
  });

  await suite("I12. 50 sessions → 51st CONFLICT; existing session still accepted", async () => {
    const f = await strictFixture();
    const t = new Date();
    for (let i = 0; i < 50; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      f.sessions.set(`${f.aC}:${id}`, {
        assignmentId: f.aC,
        clientSessionId: id,
        firstSeenAt: t,
        lastSeenAt: t,
      });
    }
    const neu = await ingest(f, { sessionId: SID, sentAt: t.getTime(), events: [] }, t);
    assert(!neu.ok && neu.code === "CONFLICT", "51st CONFLICT");
    const existingId = [...f.sessions.values()][0].clientSessionId;
    const existing = await ingest(f, { sessionId: existingId, sentAt: t.getTime(), events: [] }, t);
    assert(existing.ok, "existing accepted");
  });

  await suite("I13. empty batch creates or updates the session and stores no events", async () => {
    const f = await strictFixture();
    const t = new Date();
    const res = await ingest(f, { sessionId: SID, sentAt: t.getTime(), events: [] }, t);
    assert(res.ok && res.data.accepted === 0, "accepted 0");
    assert(f.sessions.has(`${f.aC}:${SID}`) && f.events.size === 0, "session only");
  });

  await suite("I14. ATTEMPT_EVENT_TYPES equals the Prisma enum", () => {
    const prismaSet = new Set(Object.values($Enums.AssessmentAttemptEventType));
    const ours = new Set(ATTEMPT_EVENT_TYPES);
    assert(prismaSet.size === ours.size, "same size");
    for (const t of ours) assert(prismaSet.has(t), t);
  });

  // ---- T-219 summary --------------------------------------------------------

  function act(
    sessionId: string,
    seq: number,
    type: AttemptEventType,
    at: Date,
    extra: Partial<ActivityEvent> = {},
  ): ActivityEvent {
    return { sessionId, seq, type, occurredAt: at, questionId: extra.questionId ?? null, count: extra.count ?? 1 };
  }

  const t0 = new Date("2026-09-14T10:00:00Z");
  const ms = (n: number) => new Date(t0.getTime() + n);

  await suite("S1. exit → return: FULLSCREEN times 1 and Returned to fullscreen after 2m 14s", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(10 * 60_000),
      now: ms(10 * 60_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(10 * 60_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", ms(1_000)),
        act(SID, 2, "FULLSCREEN_EXITED", ms(60_000)),
        act(SID, 3, "FULLSCREEN_ENTERED", ms(60_000 + 134_000)),
      ],
      questionNumbers: {},
      eventCount: 4,
    });
    assert(summary.totals.FULLSCREEN.times === 1, "times");
    assert(summary.totals.FULLSCREEN.ms === 134_000, `ms ${summary.totals.FULLSCREEN.ms}`);
    const line = summary.timeline.flatMap((e) => e.lines).find((l) => l.startsWith("Returned"));
    assert(line === "Returned to fullscreen after 2m 14s", `line: ${line}`);
  });

  await suite("S2. tab switch counts once in awayMs and once in each per-kind total", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(60_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
        act(SID, 2, "FULLSCREEN_EXITED", ms(10_000)),
        act(SID, 3, "VISIBILITY_HIDDEN", ms(10_000)),
        act(SID, 4, "WINDOW_BLURRED", ms(10_000)),
        act(SID, 5, "VISIBILITY_VISIBLE", ms(20_000)),
        act(SID, 6, "WINDOW_FOCUSED", ms(20_000)),
        act(SID, 7, "FULLSCREEN_ENTERED", ms(20_000)),
      ],
      questionNumbers: {},
      eventCount: 8,
    });
    assert(summary.totals.FULLSCREEN.times === 1, "fullscreen");
    assert(summary.totals.HIDDEN.times === 1, "hidden");
    assert(summary.totals.UNFOCUSED.times === 1, "unfocused");
    assert(summary.awayMs === 10_000, `away ${summary.awayMs}`);
  });

  await suite("S3. two concurrent sessions: A hidden while B in view → not away", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: false,
      sessions: [
        { clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(60_000) },
        { clientSessionId: SID2, firstSeenAt: t0, lastSeenAt: ms(60_000) },
      ],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
        act(SID, 2, "VISIBILITY_HIDDEN", ms(10_000)),
        act(SID2, 0, "SESSION_STARTED", t0),
        act(SID2, 1, "FULLSCREEN_ENTERED", t0),
      ],
      questionNumbers: {},
      eventCount: 5,
    });
    assert(summary.awayMs === 0, `away ${summary.awayMs}`);
  });

  await suite("S4. leave → next session: PAGE_CLOSED interval; awayMs includes it", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: false,
      sessions: [
        { clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(10_000) },
        { clientSessionId: SID2, firstSeenAt: ms(40_000), lastSeenAt: ms(60_000) },
      ],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
        act(SID, 2, "PAGE_LEFT", ms(10_000)),
        act(SID2, 0, "SESSION_STARTED", ms(40_000)),
        act(SID2, 1, "FULLSCREEN_ENTERED", ms(40_000)),
      ],
      questionNumbers: {},
      eventCount: 5,
    });
    assert(summary.totals.PAGE_CLOSED.times === 1, "closed once");
    assert(summary.totals.PAGE_CLOSED.ms === 30_000, `closed ms ${summary.totals.PAGE_CLOSED.ms}`);
    assert(summary.awayMs === 30_000, `away ${summary.awayMs}`);
    assert(
      summary.timeline.flatMap((e) => e.lines).includes("Left the assessment page"),
      "left line",
    );
  });

  await suite("S5. crashed session: in view until lastSeenAt + 45s, away after", () => {
    const lastSeen = ms(10_000);
    const submittedAt = ms(10_000 + SESSION_GRACE_MS + 20_000);
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt,
      now: submittedAt,
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: lastSeen }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
      ],
      questionNumbers: {},
      eventCount: 2,
    });
    assert(summary.awayMs === 20_000, `away ${summary.awayMs}`);
  });

  await suite("S6. away starting ≤5s after upload link is attributed; >5s is not", () => {
    const attributed = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(60_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
        act(SID, 2, "UPLOAD_LINK_OPENED", ms(10_000), { questionId: "q4" }),
        act(SID, 3, "FULLSCREEN_EXITED", ms(12_000)),
        act(SID, 4, "FULLSCREEN_ENTERED", ms(22_000)),
      ],
      questionNumbers: { q4: 4 },
      eventCount: 5,
    });
    assert(attributed.awayAfterUploadLinkMs === 10_000, `attr ${attributed.awayAfterUploadLinkMs}`);
    const not = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(60_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", t0),
        act(SID, 2, "UPLOAD_LINK_OPENED", ms(10_000), { questionId: "q4" }),
        act(SID, 3, "FULLSCREEN_EXITED", ms(16_000)),
        act(SID, 4, "FULLSCREEN_ENTERED", ms(26_000)),
      ],
      questionNumbers: { q4: 4 },
      eventCount: 5,
    });
    assert(not.awayAfterUploadLinkMs === 0, `not ${not.awayAfterUploadLinkMs}`);
  });

  await suite("S7. camera off → on duration; reopen before first CAMERA_ON is not Camera off", () => {
    const withOff = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: true,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(60_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "CAMERA_ON", t0),
        act(SID, 2, "CAMERA_OFF", ms(10_000)),
        act(SID, 3, "CAMERA_ON", ms(25_000)),
      ],
      questionNumbers: {},
      eventCount: 4,
    });
    assert(withOff.totals.CAMERA_OFF.times === 1 && withOff.totals.CAMERA_OFF.ms === 15_000, "duration");
    const reopen = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(60_000),
      now: ms(60_000),
      cameraRequired: true,
      sessions: [{ clientSessionId: SID2, firstSeenAt: t0, lastSeenAt: ms(60_000) }],
      events: [
        act(SID2, 0, "SESSION_STARTED", t0),
        act(SID2, 1, "CAMERA_ON", ms(8_000)),
      ],
      questionNumbers: {},
      eventCount: 2,
    });
    assert(reopen.totals.CAMERA_OFF.times === 0, "not counted before first on");
  });

  await suite("S8. in progress uses now; submitted uses submittedAt", () => {
    const events = [
      act(SID, 0, "SESSION_STARTED", t0),
      act(SID, 1, "FULLSCREEN_ENTERED", t0),
    ];
    const sessions: ActivitySession[] = [
      { clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(30_000) },
    ];
    const inProg = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: null,
      now: ms(20_000),
      cameraRequired: false,
      sessions,
      events,
      questionNumbers: {},
      eventCount: 2,
    });
    assert(inProg.window.inProgress && inProg.window.end.getTime() === ms(20_000).getTime(), "now");
    const done = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(15_000),
      now: ms(40_000),
      cameraRequired: false,
      sessions,
      events: [...events, act(SID, 2, "FULLSCREEN_EXITED", ms(40_000))],
      questionNumbers: {},
      eventCount: 3,
    });
    assert(!done.window.inProgress && done.window.end.getTime() === ms(15_000).getTime(), "submittedAt");
  });

  await suite("S9. clipboard counts sum count; Paste blocked in Q3 (3 attempts)", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(10_000),
      now: ms(10_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(10_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "PASTE_BLOCKED", ms(1_000), { questionId: "q3", count: 3 }),
        act(SID, 2, "COPY_BLOCKED", ms(2_000), { count: 2 }),
      ],
      questionNumbers: { q3: 3 },
      eventCount: 3,
    });
    assert(summary.clipboardBlocked === 5, `sum ${summary.clipboardBlocked}`);
    const line = describeEvent(act(SID, 1, "PASTE_BLOCKED", ms(1_000), { questionId: "q3", count: 3 }), {
      questionNumber: 3,
      sessionNumber: 1,
      multipleSessions: false,
    });
    assert(line === "Paste blocked in Q3 (3 attempts)", line);
  });

  await suite("S10. events within 1s form one timeline entry; Started and Submitted present", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(10_000),
      now: ms(10_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(10_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_EXITED", ms(5_000)),
        act(SID, 2, "VISIBILITY_HIDDEN", ms(5_400)),
        act(SID, 3, "WINDOW_BLURRED", ms(5_800)),
      ],
      questionNumbers: {},
      eventCount: 4,
    });
    const grouped = summary.timeline.find((e) => e.lines.includes("Fullscreen exited"));
    assert(grouped && grouped.lines.length === 3, `grouped ${grouped?.lines.length}`);
    assert(summary.timeline[0].lines[0] === "Started the assessment", "started");
    assert(
      summary.timeline[summary.timeline.length - 1].lines[0] === "Submitted the assessment",
      "submitted",
    );
  });

  await suite("S11. Entered fullscreen (no prior exit) creates no FULLSCREEN interval", () => {
    const summary = summarizeAttemptActivity({
      startedAt: t0,
      submittedAt: ms(10_000),
      now: ms(10_000),
      cameraRequired: false,
      sessions: [{ clientSessionId: SID, firstSeenAt: t0, lastSeenAt: ms(10_000) }],
      events: [
        act(SID, 0, "SESSION_STARTED", t0),
        act(SID, 1, "FULLSCREEN_ENTERED", ms(1_000)),
      ],
      questionNumbers: {},
      eventCount: 2,
    });
    assert(summary.totals.FULLSCREEN.times === 0 && summary.totals.FULLSCREEN.ms === 0, "no interval");
    assert(
      summary.timeline.flatMap((e) => e.lines).includes("Entered fullscreen"),
      "entered line",
    );
  });

  // ---- T-219 recorder -------------------------------------------------------

  function fakeRecorder() {
    let now = 1_000_000;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let tid = 0;
    const sends: string[] = [];
    const beacons: string[] = [];
    let sendImpl: (body: string) => Promise<{ status: number }> = async (body) => {
      sends.push(body);
      return { status: 200 };
    };
    let stoppedStatus: number | null = null;
    const rec = createIntegrityRecorder({
      assignmentId: "a1",
      send: (body) => sendImpl(body),
      beacon: (body) => {
        beacons.push(body);
        return true;
      },
      now: () => now,
      uuid: () => SID,
      setTimer: (fn, ms) => {
        const id = ++tid;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
      onStopped: (status) => {
        stoppedStatus = status;
      },
    });
    async function advance(ms: number) {
      const target = now + ms;
      now = target;
      let guard = 0;
      while (guard++ < 50) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now);
        if (due.length === 0) break;
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
        await Promise.resolve();
        await Promise.resolve();
      }
    }
    return { rec, sends, beacons, advance, setSend: (fn: typeof sendImpl) => { sendImpl = fn; }, get stoppedStatus() { return stoppedStatus; }, get now() { return now; } };
  }

  await suite("R1. startSession → seq 0 is SESSION_STARTED; seq increments", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    await f.advance(5_000);
    const body = JSON.parse(f.sends[0] ?? "{}") as { events: { seq: number; type: string }[] };
    assert(body.events[0]?.seq === 0 && body.events[0]?.type === "SESSION_STARTED", "seq 0");
    f.rec.record("FULLSCREEN_ENTERED");
    await f.advance(5_000);
    const body2 = JSON.parse(f.sends[1] ?? "{}") as { events: { seq: number; type: string }[] };
    assert(body2.events[0]?.seq === 1, `seq ${body2.events[0]?.seq}`);
  });

  await suite("R2. repeated PASTE_BLOCKED within 1s coalesce; after 1s a new seq", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    f.rec.record("PASTE_BLOCKED", "q1");
    f.rec.record("PASTE_BLOCKED", "q1");
    await f.advance(5_000);
    const body = JSON.parse(f.sends[0] ?? "{}") as { events: { type: string; count?: number; seq: number }[] };
    const paste = body.events.find((e) => e.type === "PASTE_BLOCKED");
    assert(paste?.count === 2, `count ${paste?.count}`);
    await f.advance(1);
    // new event after >1s from first paste — the coalesced one was sent, so a new seq
    f.rec.record("PASTE_BLOCKED", "q1");
    await f.advance(5_000);
    const body2 = JSON.parse(f.sends[1] ?? "{}") as { events: { seq: number }[] };
    assert(body2.events[0]?.seq === 2, `new seq ${body2.events[0]?.seq}`);
  });

  await suite("R3. flush sends ≤50 events, sentAt = send time; retry re-stamps sentAt", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    for (let i = 0; i < 55; i++) f.rec.record("COPY_BLOCKED", `q${i}`);
    await f.advance(5_000);
    const first = JSON.parse(f.sends[0] ?? "{}") as { sentAt: number; events: unknown[] };
    assert(first.events.length === 50, `len ${first.events.length}`);
    assert(first.sentAt === f.now, "sentAt now");

    const g = fakeRecorder();
    let attempts = 0;
    const sentAts: number[] = [];
    g.setSend(async (body) => {
      attempts += 1;
      sentAts.push(JSON.parse(body).sentAt as number);
      g.sends.push(body);
      if (attempts === 1) throw new Error("net");
      return { status: 200 };
    });
    g.rec.startSession();
    await g.advance(5_000);
    await g.advance(2_000);
    assert(attempts === 2 && sentAts[1] > sentAts[0], "re-stamped");
  });

  await suite("R4. network error retried; 200 removes; 409 stops later record", async () => {
    const f = fakeRecorder();
    let n = 0;
    f.setSend(async (body) => {
      n += 1;
      f.sends.push(body);
      if (n === 1) throw new Error("offline");
      if (n === 2) return { status: 200 };
      return { status: 409 };
    });
    f.rec.startSession();
    await f.advance(5_000);
    await f.advance(2_000);
    assert(n >= 2, "retried then 200");
    f.rec.record("WINDOW_BLURRED");
    await f.advance(5_000);
    assert(f.stoppedStatus === 409 && f.rec.isStopped(), "stopped");
    const before = f.sends.length;
    f.rec.record("WINDOW_FOCUSED");
    await f.advance(5_000);
    assert(f.sends.length === before, "later record ignored");
  });

  await suite("R5. beaconed events stay queued and go out on the next fetch flush", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    f.rec.record("PAGE_LEFT");
    f.rec.flushWithBeacon();
    assert(f.beacons.length === 1, "beaconed");
    await f.advance(5_000);
    const body = JSON.parse(f.sends[0] ?? "{}") as { events: { type: string }[] };
    assert(body.events.some((e) => e.type === "PAGE_LEFT"), "resent on fetch");
  });

  await suite("R6. 20s with nothing sent → empty heartbeat batch", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    await f.advance(5_000);
    assert(f.sends.length === 1, "session start flushed");
    await f.advance(20_000);
    const last = JSON.parse(f.sends[f.sends.length - 1] ?? "{}") as { events: unknown[] };
    assert(last.events.length === 0, "heartbeat empty");
  });

  await suite("R7. leave() records PAGE_LEFT once and beacons; finish() records nothing", async () => {
    const f = fakeRecorder();
    f.rec.startSession();
    f.rec.leave();
    f.rec.leave();
    const beacon = JSON.parse(f.beacons[0] ?? "{}") as { events: { type: string }[] };
    assert(beacon.events.filter((e) => e.type === "PAGE_LEFT").length === 1, "once");
    const g = fakeRecorder();
    g.rec.startSession();
    g.rec.finish();
    g.rec.record("COPY_BLOCKED");
    await g.advance(5_000);
    assert(g.sends.length === 0, "finish records nothing more");
  });

  // ---- Plan 141 leave-close -------------------------------------------------

  await suite("L1. finishAttemptForced scores incomplete; never refuses missing required", () => {
    const requiredBlank = gradeInput({
      questions: [
        {
          id: "m1",
          type: "MULTIPLE_CHOICE",
          points: 2,
          isRequired: true,
          maxWords: null,
          correctOptionIds: ["a"],
        },
      ],
      answers: [],
    });
    const forced = finishAttemptForced(requiredBlank);
    assert(forced.ok, "forced ok");
    if (forced.ok) {
      assert(forced.scorePercent === 0, "unanswered MCQ = 0");
    }
    const refused = finishAttempt(requiredBlank);
    assert(!refused.ok, "normal finish still refuses");
  });

  await suite("L2. leave-finalize incomplete strict STARTED → SUBMITTED", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    const left = await finalizeStrictAttemptOnLeave(f.store, C, f.aC);
    assert(left.ok && !left.data.alreadySubmitted, "closed");
    assert(f.assignments.get(f.aC)!.status === "SUBMITTED", "submitted");
    assert(f.assignments.get(f.aC)!.scorePercent === 0, "scored");
  });

  await suite("L3. second leave is idempotent ALREADY", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    await finalizeStrictAttemptOnLeave(f.store, C, f.aC);
    const again = await finalizeStrictAttemptOnLeave(f.store, C, f.aC);
    assert(again.ok && again.data.alreadySubmitted, "already");
  });

  await suite("L4. non-strict leave → CONFLICT; ASSIGNED leave → CONFLICT", async () => {
    const f = fixture();
    const non = await finalizeStrictAttemptOnLeave(f.store, C, f.aC);
    assert(!non.ok && non.code === "CONFLICT", "non-strict");
    f.assessments.get(f.s.id)!.strictMode = true;
    const assigned = await finalizeStrictAttemptOnLeave(f.store, C, f.aC);
    assert(!assigned.ok && assigned.code === "CONFLICT", "assigned");
  });

  await suite("L5. leave on mobile strict → CONFLICT", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    const left = await finalizeStrictAttemptOnLeave(f.store, C, f.aC, { mobile: true });
    assert(!left.ok && left.code === "CONFLICT", "mobile refused");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still open");
  });

  await suite("L6. PAGE_LEFT is activity only — reopening keeps a strict attempt open", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.strictMode = true;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    const t = new Date();
    await f.store.writeEventBatch(f.aC, "11111111-1111-4111-8111-111111111111", t, [
      {
        seq: 0,
        type: "PAGE_LEFT",
        occurredAt: t,
        clientOccurredAt: t,
        receivedAt: t,
        questionId: null,
        count: 1,
      },
    ]);
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "STARTED", "still open on load");
    const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(put.ok, "answers still save");
  });

  // ---- Time limit: submit only on Submit or when the timer runs out --------

  const MIN = 60_000;

  await suite("TL1. loadAttempt: deadlineAt = startedAt + duration while STARTED; null untimed", async () => {
    const f = await started();
    const startedAt = f.assignments.get(f.aC)!.startedAt!;
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok, "loaded");
    if (!loaded.ok) return;
    assert(
      loaded.data.deadlineAt?.getTime() === startedAt.getTime() + 30 * MIN,
      "30-minute deadline from start",
    );
    assert(loaded.data.serverNow instanceof Date, "server clock returned");

    const g = fixture();
    g.assessments.get(g.s.id)!.durationMinutes = null;
    await startAttempt(g.store, C, { assignmentId: g.aC });
    const untimed = await loadAttempt(g.store, C, g.aC);
    assert(untimed.ok && untimed.data.deadlineAt === null, "untimed has no deadline");

    const notStarted = await loadAttempt(g.store, D, g.aD);
    assert(notStarted.ok && notStarted.data.deadlineAt === null, "ASSIGNED has no deadline");
  });

  await suite("TL2. answering and reopening before the deadline never submits", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "STARTED", "still STARTED after one answer");
    assert(f.assignments.get(f.aC)!.submittedAt === null, "no submittedAt");
  });

  await suite("TL3. reopened after time ran out → SUBMITTED at the deadline, incomplete allowed", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    const startedAt = new Date(Date.now() - 31 * MIN);
    f.assignments.get(f.aC)!.startedAt = startedAt;
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "SUBMITTED", "closed on load");
    const a = f.assignments.get(f.aC)!;
    assert(a.submittedAt?.getTime() === startedAt.getTime() + 30 * MIN, "submittedAt = deadline");
    assert(a.scorePercent !== null, "scored");
  });

  await suite("TL4. a save after the deadline (+grace) is refused and closes the attempt", async () => {
    const f = await started();
    f.assignments.get(f.aC)!.startedAt = new Date(Date.now() - 31 * MIN);
    const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(!put.ok && put.code === "CONFLICT", "CONFLICT");
    assert(f.answers.size === 0, "nothing written");
    assert(f.assignments.get(f.aC)!.status === "SUBMITTED", "closed");
  });

  await suite("TL5. a save just inside the grace window is still accepted", async () => {
    const f = await started();
    f.assignments.get(f.aC)!.startedAt = new Date(Date.now() - 30 * MIN - 5_000);
    const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(put.ok, "saved within grace");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still open");
  });

  await suite("TL6. submit at 0:00 with unanswered required questions → SUBMITTED", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    f.assignments.get(f.aC)!.startedAt = new Date(Date.now() - 30 * MIN);
    const res = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(res.ok, "time-up submit accepted");
    assert(f.assignments.get(f.aC)!.status === "SUBMITTED", "submitted");
    const again = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!again.ok && again.code === "CONFLICT", "second submit refused");
  });

  await suite("TL7. submit before time is up still refuses incomplete answers", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    f.assignments.get(f.aC)!.startedAt = new Date(Date.now() - 20 * MIN);
    const res = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(!res.ok && res.code === "INVALID", "INVALID");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still open");
  });

  await suite("TL8. untimed attempts never close on their own", async () => {
    const f = fixture();
    f.assessments.get(f.s.id)!.durationMinutes = null;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    f.assignments.get(f.aC)!.startedAt = new Date(Date.now() - 24 * 60 * MIN);
    const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(put.ok, "saves days later");
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "STARTED", "still open");
  });

  // ---- End early + strict strike limit --------------------------------------

  const visibleEvent = (seq: number, at: number) => ev(seq, "VISIBILITY_VISIBLE", at);
  const exitEvent = (seq: number, at: number) => ev(seq, "FULLSCREEN_EXITED", at);
  async function sendEvents(f: Fixture, events: ReturnType<typeof ev>[], sid = SID) {
    const t = Math.max(...events.map((e) => e.occurredAt)) + 10;
    return recordAttemptEvents(f.store, C, f.aC, { sessionId: sid, sentAt: t, events }, new Date(t));
  }

  await suite("E0. the end-reason list mirrors the Prisma enum", () => {
    const schema = read("prisma/schema.prisma");
    const body = sliceBody(schema, "enum AssessmentEndReason {", /\n\}/);
    const inSchema = body.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l));
    assert(
      JSON.stringify(inSchema) === JSON.stringify([...ASSESSMENT_END_REASONS]),
      `enum mismatch: ${inSchema.join(",")}`,
    );
  });

  await suite("E1. End assessment with required questions unanswered → SUBMITTED, ENDED_EARLY", async () => {
    const f = await started();
    await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    const res = await endAttempt(f.store, C, { assignmentId: f.aC, reason: "ENDED_EARLY" });
    assert(res.ok && res.data.reason === "ENDED_EARLY", "ended");
    const a = f.assignments.get(f.aC)!;
    assert(a.status === "SUBMITTED" && a.endReason === "ENDED_EARLY", "stored reason");
    assert(a.scorePercent !== null, "scored with what was saved");
  });

  await suite("E2. after ending: no saves, no second end, no restart", async () => {
    const f = await started();
    await endAttempt(f.store, C, { assignmentId: f.aC, reason: "ENDED_EARLY" });
    const put = await save(f, f.q(1), { kind: "choice", selectedOptionIds: [f.o("1a")] });
    assert(!put.ok && put.code === "CONFLICT", "save refused");
    const again = await endAttempt(f.store, C, { assignmentId: f.aC, reason: "ENDED_EARLY" });
    assert(!again.ok && again.code === "CONFLICT", "second end refused");
    const restart = await startAttempt(f.store, C, { assignmentId: f.aC });
    assert(!restart.ok && restart.code === "CONFLICT", "cannot retake");
  });

  await suite("E3. end: ASSIGNED → CONFLICT; foreign → NOT_FOUND; limit reason on non-strict → CONFLICT", async () => {
    const f = fixture();
    const early = await endAttempt(f.store, C, { assignmentId: f.aC, reason: "ENDED_EARLY" });
    assert(!early.ok && early.code === "CONFLICT", "not started");
    await startAttempt(f.store, C, { assignmentId: f.aC });
    const foreign = await endAttempt(f.store, D, { assignmentId: f.aC, reason: "ENDED_EARLY" });
    assert(!foreign.ok && foreign.code === "NOT_FOUND", "foreign");
    const limit = await endAttempt(f.store, C, { assignmentId: f.aC, reason: "TAB_SWITCH_LIMIT" });
    assert(!limit.ok && limit.code === "CONFLICT", "limit needs strict");
    const bad = await endAttempt(f.store, C, { assignmentId: f.aC, reason: "SUBMITTED" });
    assert(!bad.ok && bad.code === "INVALID", "client can't claim SUBMITTED");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still open");
  });

  await suite("E4. normal Submit stores SUBMITTED; time-up close stores TIME_UP", async () => {
    const f = await started();
    await answerAll(f);
    await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(f.assignments.get(f.aC)!.endReason === "SUBMITTED", "SUBMITTED");
    const g = await started();
    g.assignments.get(g.aC)!.startedAt = new Date(Date.now() - 31 * MIN);
    await loadAttempt(g.store, C, g.aC);
    assert(g.assignments.get(g.aC)!.endReason === "TIME_UP", "TIME_UP");
  });

  await suite("E5. strict: the 3rd tab switch recorded closes the attempt with TAB_SWITCH_LIMIT", async () => {
    const f = await strictFixture();
    f.assessments.get(f.s.id)!.durationMinutes = null;
    const base = Date.parse("2026-09-14T09:05:00Z");
    const two = await sendEvents(f, [visibleEvent(0, base), visibleEvent(1, base + 1000)]);
    assert(two.ok && two.data.ended === null, "two strikes: still open");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "open after 2");
    const three = await sendEvents(f, [visibleEvent(2, base + 2000)]);
    assert(three.ok && three.data.ended === "TAB_SWITCH_LIMIT", "third ends it");
    const a = f.assignments.get(f.aC)!;
    assert(a.status === "SUBMITTED" && a.endReason === "TAB_SWITCH_LIMIT", "stored penalty");
  });

  await suite("E6. strict: 3 fullscreen exits across page sessions → FULLSCREEN_LIMIT", async () => {
    const f = await strictFixture();
    f.assessments.get(f.s.id)!.durationMinutes = null;
    const base = Date.parse("2026-09-14T09:05:00Z");
    await sendEvents(f, [exitEvent(0, base), exitEvent(1, base + 1000)], SID);
    // A reload is a new page session; the count carries over.
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.strikes.fullscreenExits === 2, "strikes survive a reload");
    await sendEvents(f, [exitEvent(0, base + 5000)], SID2);
    assert(f.assignments.get(f.aC)!.endReason === "FULLSCREEN_LIMIT", "FULLSCREEN_LIMIT");
  });

  await suite("E7. strict: hidden without a return (reload / closed tab) is not a strike", async () => {
    const f = await strictFixture();
    f.assessments.get(f.s.id)!.durationMinutes = null;
    const base = Date.parse("2026-09-14T09:05:00Z");
    await sendEvents(f, [
      ev(0, "VISIBILITY_HIDDEN", base),
      ev(1, "PAGE_LEFT", base + 10),
      ev(2, "VISIBILITY_HIDDEN", base + 2000),
      ev(3, "VISIBILITY_HIDDEN", base + 3000),
      ev(4, "WINDOW_BLURRED", base + 4000),
    ]);
    assert(f.assignments.get(f.aC)!.status === "STARTED", "still open");
  });

  await suite("E8. non-strict: strike events are refused, nothing closes", async () => {
    const f = await started();
    const base = Date.now();
    const res = await sendEvents(f, [visibleEvent(0, base), visibleEvent(1, base), visibleEvent(2, base)]);
    assert(!res.ok && res.code === "CONFLICT", "non-strict records no activity");
    assert(f.assignments.get(f.aC)!.status === "STARTED", "open");
  });

  await suite("E9. loadAttempt closes a strict attempt already at the limit", async () => {
    const f = await strictFixture();
    f.assessments.get(f.s.id)!.durationMinutes = null;
    const t = new Date("2026-09-14T09:05:00Z");
    // Written straight to the store: as if the close after the batch failed.
    await f.store.writeEventBatch(f.aC, SID, t, [0, 1, 2].map((seq) => ({
      seq,
      type: "VISIBILITY_VISIBLE" as const,
      occurredAt: t,
      clientOccurredAt: t,
      receivedAt: t,
      questionId: null,
      count: 1,
    })));
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "SUBMITTED", "closed on load");
    assert(loaded.ok && loaded.data.endReason === "TAB_SWITCH_LIMIT", "penalty reason");
  });

  await suite("TL9. the candidate screen never calls the leave-finalize route", () => {
    const guard = read("src/components/assessments/assessment-integrity.tsx");
    assert(!guard.includes("/leave"), "integrity guard does not beacon /leave");
    assert(!guard.includes("sendBeacon(leave"), "no leave beacon");
    const attempt = read("src/components/assessments/assessment-attempt.tsx");
    assert(!attempt.includes("/leave"), "attempt does not call /leave");
    const service = read("src/features/assessment-attempts/service.ts");
    const load = sliceBody(service, "export async function loadAttempt(", /\nexport /);
    assert(!load.includes("PAGE_LEFT") && !load.includes("finalizeStrictAttemptOnLeave"), "load has no leave close");
  });

  await suite("L7. integrity UI has no clipboard toast string", () => {
    const src = read("src/components/assessments/assessment-integrity.tsx");
    assert(
      !src.includes("Copy, cut and paste are turned off"),
      "toast copy removed",
    );
    assert(!src.includes('from "sonner"'), "no sonner toast in integrity");
  });

  // ---- T-219 copy guard -----------------------------------------------------

  await suite("C1. describeEvent and SUMMARY_COPY never match BANNED_CLAIM_PATTERN", () => {
    const types = [...ATTEMPT_EVENT_TYPES];
    for (const type of types) {
      const e: ActivityEvent = {
        sessionId: SID,
        seq: 0,
        type,
        occurredAt: t0,
        questionId: "q1",
        count: 3,
      };
      for (const paired of [undefined, 2000]) {
        const line = describeEvent(e, {
          returnAfterMs: paired,
          questionNumber: 3,
          sessionNumber: 2,
          multipleSessions: true,
        });
        assert(!BANNED_CLAIM_PATTERN.test(line), `describe ${type}: ${line}`);
      }
    }
    const strings: string[] = [
      SUMMARY_COPY.away.label,
      SUMMARY_COPY.away.help,
      SUMMARY_COPY.awayAfterUploadLink.help("2s"),
      SUMMARY_COPY.FULLSCREEN.label,
      SUMMARY_COPY.FULLSCREEN.help(1, "2s"),
      SUMMARY_COPY.HIDDEN.label,
      SUMMARY_COPY.HIDDEN.help,
      SUMMARY_COPY.UNFOCUSED.label,
      SUMMARY_COPY.UNFOCUSED.help,
      SUMMARY_COPY.PAGE_CLOSED.label,
      SUMMARY_COPY.PAGE_CLOSED.help,
      SUMMARY_COPY.CAMERA_OFF.label,
      SUMMARY_COPY.CAMERA_OFF.help,
      SUMMARY_COPY.clipboard.label,
      SUMMARY_COPY.clipboard.help,
      SUMMARY_COPY.links.label,
      SUMMARY_COPY.links.help,
      SUMMARY_COPY.sessions.label,
      SUMMARY_COPY.sessions.help,
      SUMMARY_COPY.withoutReturn.help(1),
      SUMMARY_COPY.limit.help,
    ];
    for (const s of strings) {
      assert(!BANNED_CLAIM_PATTERN.test(s), `summary: ${s}`);
    }
  });

  await suite("C2. activity page, integrity UI and builder note do not match BANNED_CLAIM_PATTERN", () => {
    for (const rel of [
      "src/app/hire/assessments/[assessmentId]/attempts/[assignmentId]/page.tsx",
      "src/components/assessments/assessment-integrity.tsx",
      "src/components/hire/assessment/assessment-builder.tsx",
      // T-265: the admin reads the same attempt and is held to the same rule.
      "src/app/admin/students/[id]/assessments/[assignmentId]/page.tsx",
      "src/components/admin/candidate-attempt-detail.tsx",
      "src/features/admin/attempt-outcome.ts",
    ]) {
      const src = read(rel);
      assert(!BANNED_CLAIM_PATTERN.test(src), rel);
    }
  });

  await suite("C3. disclaimers contain the required phrases", () => {
    assert(ACTIVITY_DISCLAIMER.includes("does not detect"), "does not detect");
    assert(ACTIVITY_DISCLAIMER.includes("not proof"), "not proof");
    assert(CAMERA_DISCLAIMER.includes("doesn't record or see the video"), "camera");
  });

  // ---- Plan 166: platform assessment deadline -----------------------------

  function platformFixture(closesInMs: number): Fixture {
    const f = fixture();
    const s = f.assessments.get(f.s.id)!;
    s.source = "PLATFORM";
    s.durationMinutes = null;
    s.closesAt = new Date(Date.now() + closesInMs);
    return f;
  }

  await suite("P1. attemptDeadline is the earlier of the timer and the closing time", async () => {
    const f = platformFixture(10 * 60_000);
    f.assessments.get(f.s.id)!.durationMinutes = 30;
    await startAttempt(f.store, C, { assignmentId: f.aC });
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok, "load ok");
    const closes = f.assessments.get(f.s.id)!.closesAt!;
    assert(loaded.data.deadlineAt?.getTime() === closes.getTime(), "closing time wins");
  });

  await suite("P2. start after the deadline → CONFLICT and load reports missed", async () => {
    const f = platformFixture(-60_000);
    const res = await startAttempt(f.store, C, { assignmentId: f.aC });
    assert(!res.ok && res.code === "CONFLICT", "start refused");
    assert(f.assignments.get(f.aC)!.status === "ASSIGNED", "still ASSIGNED");
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.missed, "missed");
  });

  await suite("P3. a STARTED attempt reopened after the deadline auto-submits as DEADLINE", async () => {
    const f = platformFixture(60 * 60_000);
    await startAttempt(f.store, C, { assignmentId: f.aC });
    await answerAll(f);
    f.assessments.get(f.s.id)!.closesAt = new Date(Date.now() - 60_000);
    const loaded = await loadAttempt(f.store, C, f.aC);
    assert(loaded.ok && loaded.data.status === "SUBMITTED", "submitted on load");
    const a = f.assignments.get(f.aC)!;
    assert(a.endReason === "DEADLINE", `endReason DEADLINE, got ${a.endReason}`);
    assert(a.scorePercent === 100, `saved answers graded, got ${a.scorePercent}`);
    assert(!loaded.data.missed, "a submitted attempt is not missed");
  });

  await suite("P4. listing and the admin sweep close expired attempts; recruiter ones untouched", async () => {
    const f = platformFixture(60 * 60_000);
    await startAttempt(f.store, C, { assignmentId: f.aC });
    await startAttempt(f.store, D, { assignmentId: f.aD });
    f.assessments.get(f.s.id)!.closesAt = new Date(Date.now() - 1_000);

    const listed = await listCandidateAttempts(f.store, C);
    assert(listed.ok && listed.data[0]?.status === "SUBMITTED", "C closed by the list");
    assert(f.assignments.get(f.aD)!.status === "STARTED", "D not touched by C's list");

    const closed = await closeAttemptsPastDeadline(f.store, f.s.id);
    assert(closed === 1, `sweep closed D only, got ${closed}`);
    assert(f.assignments.get(f.aD)!.endReason === "DEADLINE", "D ended by DEADLINE");

    const r = fixture();
    await startAttempt(r.store, C, { assignmentId: r.aC });
    assert((await closeAttemptsPastDeadline(r.store, r.s.id)) === 0, "recruiter untouched");
  });

  await suite("P5. submit carries the source so the recruiter notification can be skipped", async () => {
    const f = platformFixture(60 * 60_000);
    await startAttempt(f.store, C, { assignmentId: f.aC });
    await answerAll(f);
    const res = await submitAttempt(f.store, C, { assignmentId: f.aC });
    assert(res.ok && res.data.source === "PLATFORM", "source PLATFORM");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
