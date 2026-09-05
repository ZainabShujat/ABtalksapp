import type { EventCollector } from "@/features/interview/proctoring/collector";

/**
 * Camera lifecycle for a mock interview.
 *
 * THE GOVERNING RULE, stated once: THE CAMERA IS NEVER A GATE. The mock
 * interview is a voice interview — `MicCheck` gates on the microphone and
 * always has, and nothing in this file changes that. Every failure path here
 * resolves rather than throws, is recorded as a proctoring event, is shown to
 * the candidate once, and then gets out of the way. A blocked camera costs the
 * attempt its video, not the attempt.
 *
 * That is also why `start()` returns `null` instead of rejecting: a caller that
 * forgets a `catch` still cannot deadlock the interview on a permission prompt.
 */

export type CameraStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "error"
  | "stopped";

export type CameraState = {
  status: CameraStatus;
  stream: MediaStream | null;
  /** Candidate-facing, already phrased for display. Null when nothing is wrong. */
  message: string | null;
};

/**
 * How often the camera reports that it is still running.
 *
 * Uptime cannot be derived from a start and a stop event, because the stop
 * happens at unmount — after the last answer, so after the last chance to
 * persist anything. A periodic heartbeat carrying cumulative seconds means the
 * report knows the camera was on for roughly as long as it was, using only
 * events that were actually saved.
 */
export const CAMERA_HEARTBEAT_MS = 60_000;

const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  // Video only. Audio belongs to the interview's own speech pipeline, and
  // opening a second microphone track here would compete with it.
  video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: "user" },
  audio: false,
};

function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
}

/** Permission refusals, as opposed to hardware or policy failures. */
function isDenial(name: string): boolean {
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

/**
 * Owns one camera stream and reports what happens to it.
 *
 * Not a React hook: the session needs to start this before the room mounts and
 * tear it down on unmount regardless of render outcome, and a class with an
 * explicit `stop()` makes that ordering visible.
 */
export class CameraManager {
  private readonly collector: EventCollector;
  private readonly onChange: (state: CameraState) => void;
  private stream: MediaStream | null = null;
  private status: CameraStatus = "idle";
  private message: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private activeSinceMs: number | null = null;
  private accumulatedMs = 0;
  private disposed = false;

  constructor(
    collector: EventCollector,
    onChange: (state: CameraState) => void = () => {},
  ) {
    this.collector = collector;
    this.onChange = onChange;
  }

  getState(): CameraState {
    return { status: this.status, stream: this.stream, message: this.message };
  }

  /** Total seconds the camera has been running, including the current run. */
  activeSeconds(): number {
    const live =
      this.activeSinceMs === null ? 0 : Date.now() - this.activeSinceMs;
    return Math.round((this.accumulatedMs + live) / 1000);
  }

  /**
   * Requests the camera. Resolves to the stream, or to `null` on any failure.
   * Never rejects, and never leaves the caller waiting on a decision that was
   * already made.
   */
  async start(): Promise<MediaStream | null> {
    if (this.disposed) return null;
    if (this.stream) return this.stream;

    const media =
      typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) {
      this.fail(
        "camera_error",
        "UnsupportedBrowser",
        "This browser cannot open a camera. Your interview continues without video.",
        "error",
      );
      return null;
    }

    this.set("requesting", null, null);

    let stream: MediaStream;
    try {
      stream = await media.getUserMedia(VIDEO_CONSTRAINTS);
    } catch (error) {
      const name = errorName(error);
      const denied = isDenial(name);
      this.fail(
        denied ? "camera_denied" : "camera_error",
        name,
        denied
          ? "Camera access is blocked. Your interview continues without video."
          : "Your camera could not start. Your interview continues without video.",
        denied ? "denied" : "error",
      );
      return null;
    }

    // The permission prompt can outlive the component that asked for it. If we
    // were torn down while it was open, release the hardware immediately rather
    // than leaving a camera light on behind a page nobody is looking at.
    if (this.disposed) {
      for (const track of stream.getTracks()) track.stop();
      return null;
    }

    this.stream = stream;
    this.activeSinceMs = Date.now();
    this.set("active", stream, null);

    // A track ends when the device is unplugged, taken by another application,
    // or revoked from the browser's site settings mid-interview.
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => this.handleTrackEnded());
    }

    this.collector.push("camera_active", { meta: { activeSeconds: 0 } });
    this.heartbeat = setInterval(() => {
      if (this.status !== "active") return;
      this.collector.push("camera_active", {
        meta: { activeSeconds: this.activeSeconds() },
      });
    }, CAMERA_HEARTBEAT_MS);

    return stream;
  }

  /** Releases the device. Idempotent, and safe to call from a cleanup path. */
  stop(): void {
    this.clearHeartbeat();
    if (this.activeSinceMs !== null) {
      this.accumulatedMs += Date.now() - this.activeSinceMs;
      this.activeSinceMs = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
      this.set("stopped", null, this.message);
    }
  }

  /** Stop, and refuse to start again. Called from the component's unmount. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private handleTrackEnded(): void {
    if (this.disposed || this.status !== "active") return;
    this.clearHeartbeat();
    if (this.activeSinceMs !== null) {
      this.accumulatedMs += Date.now() - this.activeSinceMs;
      this.activeSinceMs = null;
    }
    this.stream = null;
    this.collector.push("camera_lost", { detail: "TrackEnded" });
    this.set(
      "error",
      null,
      "Your camera stopped. Your interview continues without video.",
    );
  }

  private fail(
    kind: "camera_denied" | "camera_error",
    detail: string,
    message: string,
    status: CameraStatus,
  ): void {
    this.collector.push(kind, { detail });
    this.set(status, null, message);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private set(
    status: CameraStatus,
    stream: MediaStream | null,
    message: string | null,
  ): void {
    this.status = status;
    this.stream = stream;
    this.message = message;
    try {
      this.onChange(this.getState());
    } catch {
      // A subscriber that throws is a render problem, not a camera problem.
    }
  }
}
