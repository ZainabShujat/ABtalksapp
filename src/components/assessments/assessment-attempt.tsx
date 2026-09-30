"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import {
  endAssessmentAttemptAction,
  saveAssessmentAnswerAction,
  startAssessmentAttemptAction,
  submitAssessmentAttemptAction,
} from "@/app/actions/assessment-attempt-actions";
import { CandidateAssessmentScreen } from "@/components/hire/assessment/candidate-assessment-screen";
import type {
  CandidateAnswer,
  CandidateAssessmentView,
} from "@/components/hire/assessment/assessment-types";
import {
  acquireCamera,
  detectStrictSupport,
  exitPageFullscreen,
  requestPageFullscreen,
  startBlockedReasonFor,
  StrictModeChecklist,
  StrictModeGuard,
  StrictModeUnavailable,
  type CameraError,
  type StrictSupport,
  type StrikeKind,
} from "@/components/assessments/assessment-integrity";
import {
  MAX_PARAGRAPH_WORDS,
  STRIKE_LIMIT,
  countWords,
  incompleteMessage,
  isAnswerComplete,
  isHttpUrl,
  type AssessmentEndReason,
} from "@/lib/validations/assessment";

/**
 * T-218 (plan 129) — a candidate taking an assessment.
 *
 * Owns persistence; `CandidateAssessmentScreen` owns what the candidate sees.
 * Every change goes to the server (board regression guard: answers must never
 * live only in React state or localStorage). Nothing here touches
 * localStorage or sessionStorage.
 */

type AttemptStatus = "ASSIGNED" | "STARTED" | "SUBMITTED";
type Stage = "instructions" | "taking" | "submitted";
type SaveState = "idle" | "saving" | "saved" | "retrying";

type AssessmentAttemptProps = {
  assignmentId: string;
  status: AttemptStatus;
  submittedAtLabel: string | null;
  /** ISO. When a STARTED timed attempt closes; null when untimed / not started. */
  deadlineAt: string | null;
  /** ISO server clock at render, to correct the countdown for device drift. */
  serverNow: string;
  /** How a SUBMITTED attempt closed; null while open. */
  endReason: AssessmentEndReason | null;
  /** Strict mode: strikes already recorded for this attempt (survive a reload). */
  strikes: { tabSwitches: number; fullscreenExits: number };
  view: CandidateAssessmentView;
  initialAnswers: Record<string, CandidateAnswer>;
  rules: { strictMode: boolean; cameraRequired: boolean };
};

/** Typing pause before a paragraph or link is sent. Choices go immediately. */
const DEBOUNCE_MS = 800;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
/** At 0:00, how long queued saves get before the time-up submit goes anyway. */
const TIME_UP_SAVE_WAIT_MS = 5000;
const TIME_UP_RETRY_MS = 3000;

/** "29:59", or "1:04:05" past an hour. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function stageFor(status: AttemptStatus): Stage {
  if (status === "ASSIGNED") return "instructions";
  if (status === "STARTED") return "taking";
  return "submitted";
}

/** What the candidate reads once an attempt has closed. No score (D-1). */
function endedNote(reason: AssessmentEndReason | null): string | null {
  switch (reason) {
    case "ENDED_EARLY":
      return "You ended this assessment early. It can't be continued or retaken.";
    case "TIME_UP":
      return "Time ran out, so the answers you had saved were submitted.";
    case "TAB_SWITCH_LIMIT":
      return `This assessment ended automatically because you switched tabs ${STRIKE_LIMIT} times. It can't be retaken.`;
    case "FULLSCREEN_LIMIT":
      return `This assessment ended automatically because you left fullscreen ${STRIKE_LIMIT} times. It can't be retaken.`;
    case "LEFT_PAGE":
      return "This assessment ended when you left the page.";
    case "DEADLINE":
      return "The deadline passed, so the answers you had saved were submitted.";
    default:
      return null;
  }
}

function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function withoutKey(
  record: Record<string, string>,
  key: string,
): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function AssessmentAttempt({
  assignmentId,
  status,
  submittedAtLabel,
  deadlineAt,
  serverNow,
  endReason,
  strikes,
  view,
  initialAnswers,
  rules,
}: AssessmentAttemptProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(() => stageFor(status));
  const [seenStatus, setSeenStatus] = useState(status);
  const [answers, setAnswers] =
    useState<Record<string, CandidateAnswer>>(initialAnswers);
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  // Reopening an attempt shows what the server already holds, so it is saved.
  const [saveState, setSaveState] = useState<SaveState>(() =>
    Object.keys(initialAnswers).length > 0 ? "saved" : "idle",
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [endedReason, setEndedReason] = useState<AssessmentEndReason | null>(endReason);
  const [tabSwitches, setTabSwitches] = useState(strikes.tabSwitches);
  const [fullscreenExits, setFullscreenExits] = useState(strikes.fullscreenExits);
  const [leaveNavBlocked, setLeaveNavBlocked] = useState(false);
  const [busy, startTransition] = useTransition();
  const [support, setSupport] = useState<StrictSupport | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const endingRef = useRef<"submitted" | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  /** The timer hit 0:00 and the time-up submit is running. */
  const expiringRef = useRef(false);

  // A refresh that finds the attempt moved on (started, or submitted here or on
  // another device) moves the screen with it. On SUBMITTED it also shows the
  // answers the server holds, which are the ones that were submitted.
  if (status !== seenStatus) {
    setSeenStatus(status);
    setStage(stageFor(status));
    if (status === "SUBMITTED") {
      setAnswers(initialAnswers);
      setEndedReason(endReason);
    }
  }

  const stopCameraTracks = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    for (const t of stream.getTracks()) t.stop();
  }, []);

  const applyCamera = useCallback(
    (stream: MediaStream | null) => {
      setCamera((prev) => {
        if (prev && prev !== stream) stopCameraTracks(prev);
        return stream;
      });
    },
    [stopCameraTracks],
  );

  const requestCamera = useCallback(async (): Promise<boolean> => {
    const res = await acquireCamera();
    if (!res.ok) {
      setCameraError(res.reason);
      return false;
    }
    setCameraError(null);
    applyCamera(res.stream);
    return true;
  }, [applyCamera]);

  useEffect(() => {
    if (!rules.strictMode) return;
    // Window/UA aren't available during SSR; the plan requires a mount detect.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- detectStrictSupport needs window
    setSupport(detectStrictSupport());
  }, [rules.strictMode]);

  useEffect(() => {
    if (status === "SUBMITTED") endingRef.current = "submitted";
  }, [status]);

  useEffect(() => {
    if (stage !== "submitted") return;
    void exitPageFullscreen();
    stopCameraTracks(cameraRef.current);
  }, [stage, stopCameraTracks]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    return () => {
      stopCameraTracks(cameraRef.current);
    };
  }, [stopCameraTracks]);

  // The autosave queue. Refs: they change without re-rendering, and one save
  // in flight per tab keeps this tab's writes in the order they were made.
  /** Ready to send, latest value per question. */
  const pendingRef = useRef(new Map<string, CandidateAnswer>());
  /** Waiting for typing to pause. */
  const debouncedRef = useRef(new Map<string, CandidateAnswer>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  /** Questions whose last save was refused as invalid. */
  const erroredRef = useRef(new Set<string>());
  const waitersRef = useRef<((drained: boolean) => void)[]>([]);

  const settle = useCallback((drained: boolean) => {
    const waiters = waitersRef.current.splice(0);
    for (const resolve of waiters) resolve(drained);
  }, []);

  /** The attempt is closed (submitted, or gone): nothing more is sent. */
  const stopAutosave = useCallback(() => {
    stoppedRef.current = true;
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    debouncedRef.current.clear();
    pendingRef.current.clear();
    settle(false);
  }, [settle]);

  const flush = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current.size > 0 && !stoppedRef.current) {
        const next = pendingRef.current.entries().next();
        if (next.done) break;
        const [questionId, answer] = next.value;
        pendingRef.current.delete(questionId);
        setSaveState("saving");

        let res: Awaited<ReturnType<typeof saveAssessmentAnswerAction>>;
        try {
          res = await saveAssessmentAnswerAction({ assignmentId, questionId, answer });
        } catch {
          // Offline or the server is down. Keep the value unless a newer one
          // is already queued for the question, and try again shortly.
          if (!pendingRef.current.has(questionId)) {
            pendingRef.current.set(questionId, answer);
          }
          setSaveState("retrying");
          setRetryNonce((n) => n + 1);
          settle(false);
          return;
        }

        if (res.ok) {
          retryCountRef.current = 0;
          if (erroredRef.current.delete(questionId)) {
            setQuestionErrors((prev) => withoutKey(prev, questionId));
          }
          continue;
        }
        if (res.status === 409) {
          // Submitted from another tab or device.
          stopAutosave();
          endingRef.current = "submitted";
          setStage("submitted");
          toast("This assessment was already submitted.");
          router.refresh();
          return;
        }
        if (res.status === 404 || res.status === 401) {
          stopAutosave();
          toast.error(res.message);
          router.refresh();
          return;
        }
        // Refused as invalid: say so under the question and don't retry it.
        const message = res.message;
        erroredRef.current.add(questionId);
        setQuestionErrors((prev) => ({ ...prev, [questionId]: message }));
      }
      if (!stoppedRef.current) {
        setSaveState("saved");
        setSavedAt(clockTime());
        settle(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [assignmentId, router, settle, stopAutosave]);

  // Retry after a failed save, backing off 2s → 5s → every 10s.
  useEffect(() => {
    if (retryNonce === 0) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(retryCountRef.current, RETRY_DELAYS_MS.length - 1)];
    retryCountRef.current += 1;
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [retryNonce, flush]);

  // Closing the tab: always warn while a strict attempt is in progress; also
  // warn when non-strict saves are still pending.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const pending =
        pendingRef.current.size > 0 ||
        debouncedRef.current.size > 0 ||
        inFlightRef.current;
      if (rules.strictMode && stage === "taking") {
        e.preventDefault();
        return;
      }
      if (pending) e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [rules.strictMode, stage]);

  // Plan 141 — block in-app leave while a strict attempt is in progress. The
  // candidate must Submit (complete answers). Hard leave force-finalizes via
  // the integrity guard's leave beacon.
  useEffect(() => {
    if (!rules.strictMode || stage !== "taking") return;

    const marker = { assessmentLeaveGuard: true as const };
    window.history.pushState(marker, "", window.location.href);

    const onPopState = () => {
      window.history.pushState(marker, "", window.location.href);
      setLeaveNavBlocked(true);
    };

    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el =
        e.target instanceof Element
          ? e.target
          : e.target instanceof Node
            ? e.target.parentElement
            : null;
      const anchor = el?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const stay =
        url.pathname === window.location.pathname &&
        url.search === window.location.search;
      if (stay) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveNavBlocked(true);
    };

    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [rules.strictMode, stage]);

  // Leaving by an in-app link mid-typing: send what is still queued rather
  // than drop the last few words. The Maps are created once, so these are the
  // same instances the queue writes to.
  useEffect(() => {
    const timers = timersRef.current;
    const debounced = debouncedRef.current;
    const pending = pendingRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      const leftovers = [...pending, ...debounced];
      pending.clear();
      debounced.clear();
      if (leftovers.length === 0) return;
      void (async () => {
        for (const [questionId, answer] of leftovers) {
          try {
            await saveAssessmentAnswerAction({ assignmentId, questionId, answer });
          } catch {
            // Nothing left to show an error on; beforeunload covers hard closes.
          }
        }
      })();
    };
  }, [assignmentId]);

  function handleAnswerChange(questionId: string, answer: CandidateAnswer) {
    if (stage !== "taking" || expiringRef.current) return;
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    if (erroredRef.current.delete(questionId)) {
      setQuestionErrors((prev) => withoutKey(prev, questionId));
    }
    if (stoppedRef.current) return;

    const existing = timersRef.current.get(questionId);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(questionId);
    }
    debouncedRef.current.delete(questionId);

    if (answer.kind === "choice") {
      pendingRef.current.set(questionId, answer);
      void flush();
      return;
    }

    let toSend: CandidateAnswer = answer;
    if (answer.kind === "file") {
      const trimmed = answer.fileUrl.trim();
      // Only a real link (or clearing it) is stored; the screen shows the hint.
      if (trimmed !== "" && !isHttpUrl(trimmed)) return;
      toSend = { kind: "file", fileUrl: trimmed };
    }

    setSaveState("saving");
    debouncedRef.current.set(questionId, toSend);
    timersRef.current.set(
      questionId,
      setTimeout(() => {
        timersRef.current.delete(questionId);
        const latest = debouncedRef.current.get(questionId);
        if (!latest) return;
        debouncedRef.current.delete(questionId);
        pendingRef.current.set(questionId, latest);
        void flush();
      }, DEBOUNCE_MS),
    );
  }

  /** Send everything now and resolve once it is stored (true) or not (false). */
  function waitForIdle(): Promise<boolean> {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    for (const [questionId, answer] of debouncedRef.current) {
      pendingRef.current.set(questionId, answer);
    }
    debouncedRef.current.clear();
    if (stoppedRef.current) return Promise.resolve(false);
    if (!inFlightRef.current && pendingRef.current.size === 0) {
      return Promise.resolve(true);
    }
    const done = new Promise<boolean>((resolve) => {
      waitersRef.current.push(resolve);
    });
    void flush();
    return done;
  }

  // Mirrors the server's submit check, in the same words (incompleteMessage).
  const blockedReason = useMemo(() => {
    let missing = 0;
    let over = 0;
    let badLink = false;
    view.questions.forEach((q, qi) => {
      const a = answers[q.id ?? String(qi)];
      if (q.isRequired && !isAnswerComplete(q.type, a)) missing++;
      if (
        q.type === "PARAGRAPH" &&
        a?.kind === "text" &&
        countWords(a.text) > (q.maxWords ?? MAX_PARAGRAPH_WORDS)
      ) {
        over++;
      }
      if (
        q.type === "FILE_UPLOAD" &&
        a?.kind === "file" &&
        a.fileUrl.trim() !== "" &&
        !isHttpUrl(a.fileUrl.trim())
      ) {
        badLink = true;
      }
    });
    if (missing > 0 || over > 0) return incompleteMessage(missing, over);
    if (badLink) return "Paste a full link starting with https:// before submitting.";
    if (Object.keys(questionErrors).length > 0) {
      return "Fix the highlighted answers before submitting.";
    }
    return null;
  }, [answers, questionErrors, view.questions]);

  function start() {
    if (rules.strictMode) {
      const entering = requestPageFullscreen(); // synchronous call inside the click handler
      startTransition(async () => {
        if (!(await entering)) {
          toast.error("Fullscreen couldn't be opened. Try again.");
          return;
        }
        const res = await startAssessmentAttemptAction({ assignmentId });
        if (!res.ok) {
          await exitPageFullscreen();
          toast.error(res.message);
          if (res.status === 409 || res.status === 404) router.refresh();
          return;
        }
        setStage("taking");
        router.refresh();
      });
      return;
    }
    startTransition(async () => {
      const res = await startAssessmentAttemptAction({ assignmentId });
      if (!res.ok) {
        toast.error(res.message);
        if (res.status === 409 || res.status === 404) router.refresh();
        return;
      }
      setStage("taking");
      router.refresh();
    });
  }

  function confirmSubmit() {
    if (blockedReason) {
      setConfirming(false);
      toast.error(blockedReason);
      return;
    }
    startTransition(async () => {
      const drained = await waitForIdle();
      if (!drained || erroredRef.current.size > 0) {
        setConfirming(false);
        toast.error(
          erroredRef.current.size > 0
            ? "Fix the highlighted answers before submitting."
            : "Some answers aren't saved yet — check your connection and try again.",
        );
        return;
      }
      const res = await submitAssessmentAttemptAction({ assignmentId });
      setConfirming(false);
      if (!res.ok) {
        if (res.status === 409) {
          stopAutosave();
          endingRef.current = "submitted";
          setStage("submitted");
          toast("This assessment was already submitted.");
          router.refresh();
          return;
        }
        toast.error(res.message);
        return;
      }
      stopAutosave();
      endingRef.current = "submitted";
      setStage("submitted");
      toast.success("Assessment submitted.");
      router.refresh();
    });
  }

  // ---- Time limit ----------------------------------------------------------
  // The attempt submits on the candidate's Submit, or here when the clock hits
  // 0:00 — never on its own otherwise. The server enforces the same deadline
  // (startedAt + duration), so closing the tab doesn't stop the clock.
  const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : null;
  const serverNowMs = Date.parse(serverNow);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const expireRef = useRef<() => void>(() => {});

  function expire() {
    if (expiringRef.current || stoppedRef.current) return;
    expiringRef.current = true;
    setTimeUp(true);
    setConfirming(false);
    setLeaveNavBlocked(false);
    void (async () => {
      // Push what is still queued, but never wait long on a dead connection.
      await Promise.race([
        waitForIdle(),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), TIME_UP_SAVE_WAIT_MS),
        ),
      ]);
      let res: Awaited<ReturnType<typeof submitAssessmentAttemptAction>> | null;
      try {
        res = await submitAssessmentAttemptAction({ assignmentId });
      } catch {
        res = null;
      }
      if (res && (res.ok || res.status === 409)) {
        stopAutosave();
        endingRef.current = "submitted";
        setStage("submitted");
        toast("Time's up — your answers were submitted.");
        router.refresh();
        return;
      }
      if (res && (res.status === 404 || res.status === 401)) {
        stopAutosave();
        toast.error(res.message);
        router.refresh();
        return;
      }
      // Offline, or the server clock isn't at 0:00 yet: the tick retries.
      setTimeout(() => {
        expiringRef.current = false;
      }, TIME_UP_RETRY_MS);
    })();
  }

  useEffect(() => {
    expireRef.current = expire;
  });

  // ---- Ending without Submit: "End assessment", or strict mode's strikes ----
  const endingRequestedRef = useRef(false);
  const [ending, setEnding] = useState(false);

  function endNow(reason: "ENDED_EARLY" | "TAB_SWITCH_LIMIT" | "FULLSCREEN_LIMIT") {
    if (endingRequestedRef.current || stoppedRef.current) return;
    endingRequestedRef.current = true;
    // Nothing more may change once it's decided.
    expiringRef.current = true;
    setEnding(true);
    setConfirming(false);
    setConfirmingEnd(false);
    setLeaveNavBlocked(false);
    startTransition(async () => {
      await Promise.race([
        waitForIdle(),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), TIME_UP_SAVE_WAIT_MS),
        ),
      ]);
      let res: Awaited<ReturnType<typeof endAssessmentAttemptAction>> | null;
      try {
        res = await endAssessmentAttemptAction({ assignmentId, reason });
      } catch {
        res = null;
      }
      if (res && (res.ok || res.status === 409)) {
        stopAutosave();
        endingRef.current = "submitted";
        setEndedReason(res.ok ? res.data.reason : reason);
        setStage("submitted");
        if (reason === "ENDED_EARLY") toast("Assessment ended.");
        router.refresh();
        return;
      }
      if (reason === "ENDED_EARLY") {
        // The candidate can try again; nothing was closed.
        endingRequestedRef.current = false;
        expiringRef.current = false;
        setEnding(false);
        toast.error(res?.message ?? "Couldn't end the assessment. Try again.");
        return;
      }
      // A strike limit is final: keep the screen locked and retry until the
      // server has it (the server also closes it from the recorded activity).
      setTimeout(() => {
        endingRequestedRef.current = false;
        expiringRef.current = false;
        endNow(reason);
      }, TIME_UP_RETRY_MS);
    });
  }

  function handleStrike(kind: StrikeKind) {
    if (
      stage !== "taking" ||
      endingRequestedRef.current ||
      expiringRef.current ||
      stoppedRef.current
    ) {
      return;
    }
    const isTab = kind === "TAB_SWITCH";
    const next = (isTab ? tabSwitches : fullscreenExits) + 1;
    if (isTab) setTabSwitches(next);
    else setFullscreenExits(next);
    if (next >= STRIKE_LIMIT) {
      endNow(isTab ? "TAB_SWITCH_LIMIT" : "FULLSCREEN_LIMIT");
      return;
    }
    const left = STRIKE_LIMIT - next;
    toast.warning(
      isTab
        ? `You switched tabs (${next} of ${STRIKE_LIMIT}). ${left} more and the assessment ends automatically.`
        : `You left fullscreen (${next} of ${STRIKE_LIMIT}). ${left} more and the assessment ends automatically.`,
    );
  }

  useEffect(() => {
    if (stage !== "taking" || deadlineMs === null) return;
    // Server time ≈ device time + offset, so a wrong device clock can't add time.
    const offset = serverNowMs - Date.now();
    const tick = () => {
      const left = deadlineMs - (Date.now() + offset);
      setRemainingMs(left);
      if (left <= 0) expireRef.current();
    };
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [stage, deadlineMs, serverNowMs]);

  const showTimer = stage === "taking" && deadlineMs !== null && remainingMs !== null;
  const timerTone =
    remainingMs === null
      ? undefined
      : timeUp || remainingMs <= 0
        ? "over"
        : remainingMs <= 60_000
          ? "danger"
          : remainingMs <= 5 * 60_000
            ? "warn"
            : undefined;
  // Announced once per threshold, not every second.
  const timerAnnouncement =
    remainingMs === null || !showTimer
      ? ""
      : timeUp || remainingMs <= 0
        ? "Time is up. Submitting your answers."
        : remainingMs <= 60_000
          ? "Less than 1 minute left."
          : remainingMs <= 5 * 60_000
            ? "Less than 5 minutes left."
            : "";

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "retrying"
        ? "Couldn't save — retrying…"
        : saveState === "saved"
          ? `All answers saved${savedAt ? ` · ${savedAt}` : ""}`
          : "Your answers save automatically";

  const statusSlot = (
    <div className="hire-cand-assess__bar">
      {showTimer ? (
        <div className="hire-cand-assess__timer" data-tone={timerTone}>
          <Clock aria-hidden="true" />
          <span className="hire-cand-assess__timer-label">
            {timeUp ? "Time's up — submitting…" : "Time left"}
          </span>
          <span className="hire-cand-assess__timer-value" role="timer">
            {formatRemaining(remainingMs ?? 0)}
          </span>
          <span className="sr-only" aria-live="polite">
            {timerAnnouncement}
          </span>
        </div>
      ) : null}
      {rules.strictMode && stage === "taking" ? (
        <p
          className="hire-cand-assess__strikes"
          data-tone={
            Math.max(tabSwitches, fullscreenExits) >= STRIKE_LIMIT - 1 ? "danger" : undefined
          }
        >
          PENALTY COUNT: {tabSwitches + fullscreenExits}
        </p>
      ) : null}
      <p
        className="hire-cand-assess__status"
        data-state={saveState}
        role="status"
        aria-live="polite"
      >
        <span className="hire-cand-assess__status-dot" aria-hidden="true" />
        {saveLabel}
      </p>
    </div>
  );

  const timedCopy =
    view.durationMinutes == null
      ? null
      : `You have ${view.durationMinutes} minute${view.durationMinutes === 1 ? "" : "s"} once you start. The timer keeps running if you leave this page, and your answers are submitted automatically when time runs out.`;

  const screen = (
    <CandidateAssessmentScreen
      draft={view}
      readOnly={stage !== "taking" || busy || timeUp || ending}
      stage={stage}
      answers={answers}
      onAnswerChange={handleAnswerChange}
      questionErrors={questionErrors}
      statusSlot={statusSlot}
      onStart={start}
      onSubmit={() => setConfirming(true)}
      confirmingSubmit={confirming}
      onConfirmSubmit={confirmSubmit}
      onCancelSubmit={() => setConfirming(false)}
      onEnd={() => {
        setConfirming(false);
        setConfirmingEnd(true);
      }}
      confirmingEnd={confirmingEnd}
      onConfirmEnd={() => endNow("ENDED_EARLY")}
      onCancelEnd={() => setConfirmingEnd(false)}
      submittedNote={endedNote(endedReason)}
      submitBlockedReason={blockedReason}
      busy={busy || timeUp || ending}
      submittedAtLabel={submittedAtLabel}
      startPanel={
        rules.strictMode ? (
          <StrictModeChecklist
            support={support}
            cameraRequired={rules.cameraRequired}
            camera={camera}
            cameraError={cameraError}
            onAllowCamera={() => {
              void requestCamera();
            }}
            busy={busy}
          />
        ) : undefined
      }
      startBlockedReason={
        rules.strictMode
          ? startBlockedReasonFor(support, rules.cameraRequired, camera)
          : null
      }
      resumeHint={
        timedCopy
          ? `${timedCopy} Your answers save as you go.`
          : "Your answers save automatically as you go. You can leave this page and come back to continue — nothing is submitted until you press Submit."
      }
    />
  );

  const leaveBlockModal =
    leaveNavBlocked && stage === "taking" ? (
      <div className="hire-cand-assess-block" role="dialog" aria-modal="true">
        <div className="hire-cand-assess-block__card">
          <h2>Stay on this page</h2>
          <p>
            {deadlineMs !== null
              ? "Your answers are saved, but the timer keeps running while you're away. Submit to finish now, or stay and keep working."
              : "Your answers are saved. Submit to finish now, or stay and keep working."}
          </p>
          <div className="hire-cand-assess-leave-actions">
            <button
              type="button"
              className="hire-cand-assess__secondary"
              onClick={() => setLeaveNavBlocked(false)}
            >
              Stay
            </button>
            <button
              type="button"
              className="hire-cand-assess__primary"
              disabled={busy}
              onClick={() => {
                setLeaveNavBlocked(false);
                setConfirming(true);
              }}
            >
              Submit assessment
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (!rules.strictMode) return screen;

  if (stage === "taking") {
    if (
      support &&
      (support.phone ||
        !support.fullscreenSupported ||
        (rules.cameraRequired && !support.cameraSupported))
    ) {
      return <StrictModeUnavailable />;
    }
    return (
      <StrictModeGuard
        assignmentId={assignmentId}
        cameraRequired={rules.cameraRequired}
        onStrike={handleStrike}
        fullscreenExits={fullscreenExits}
        strikeLimit={STRIKE_LIMIT}
        camera={camera}
        onRequestCamera={requestCamera}
        endingRef={endingRef}
        onStopped={(status) => {
          if (status === 409) {
            stopAutosave();
            endingRef.current = "submitted";
            setStage("submitted");
            router.refresh();
          }
        }}
      >
        {screen}
        {leaveBlockModal}
      </StrictModeGuard>
    );
  }

  return (
    <>
      {screen}
      {leaveBlockModal}
    </>
  );
}
