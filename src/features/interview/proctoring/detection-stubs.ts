import type { EventCollector } from "@/features/interview/proctoring/collector";

/**
 * Interfaces for the detectors that do NOT exist yet.
 *
 * ============================ READ THIS FIRST ============================
 * NOTHING IN THIS FILE DETECTS ANYTHING. Every implementation below is inert:
 * it reports that it is running and it emits no events, ever. There is no face
 * detection, no gaze estimation, no head pose, no lighting analysis and no
 * speaker diarization in v0.1, and no code here should be described as if there
 * were — not in a UI string, not in a report, not in a comment.
 *
 * WHY THEY EXIST ANYWAY. The event vocabulary, the wire schema, the storage
 * column, the summary and the report card all have to agree on the shape of a
 * vision or audio observation. Fixing that shape now, against a stub, is what
 * makes the first real detector a single new class rather than a change that
 * ripples through six files. The stubs are also what the development simulator
 * exercises, so the whole warning-to-report pipeline is proven end to end
 * before a model is ever loaded.
 *
 * WHAT A REAL IMPLEMENTATION MUST DO. Implement `ProctorDetector`, push its own
 * events with an honest `confidence` below 1, and be swapped in at the call
 * site. It must not change the event kinds, and it must not introduce a score.
 * ========================================================================
 */

/**
 * The one shape every detector has.
 *
 * `start` takes the stream so that a future implementation can attach to the
 * same camera track the preview is already rendering, rather than opening a
 * second one.
 */
export type ProctorDetector = {
  /** Stable identifier, used in logs and in the development panel. */
  readonly id: string;
  /** True while this implementation actually emits observations. Stubs: false. */
  readonly isReal: boolean;
  start: (stream: MediaStream | null) => void;
  stop: () => void;
  isRunning: () => boolean;
};

/** What a real face detector will eventually report per frame. */
export type FaceObservation = {
  faceCount: number;
  /** 0-1. A stub has no basis for an opinion and reports 0. */
  confidence: number;
};

export type FaceDetector = ProctorDetector & {
  /** Latest reading, or null when nothing has been observed. */
  read: () => FaceObservation | null;
};

export type LightingObservation = {
  /** 0-1 relative luminance of the frame. */
  level: number;
  confidence: number;
};

export type LightingDetector = ProctorDetector & {
  read: () => LightingObservation | null;
};

export type SpeakerObservation = {
  speakerCount: number;
  confidence: number;
};

export type MultiSpeakerDetector = ProctorDetector & {
  read: () => SpeakerObservation | null;
};

/** Shared no-op lifecycle, so each stub below is only its own read shape. */
function stubLifecycle(id: string): {
  base: Omit<ProctorDetector, "id" | "isReal">;
  running: () => boolean;
} {
  let running = false;
  void id;
  return {
    base: {
      start: () => {
        running = true;
      },
      stop: () => {
        running = false;
      },
      isRunning: () => running,
    },
    running: () => running,
  };
}

/**
 * NOT A FACE DETECTOR. Reports one face with zero confidence and emits nothing.
 *
 * The constant `faceCount: 1` is a placeholder, not an observation. Anything
 * that reads it as "one person was present" is reading a bug.
 */
export function createStubFaceDetector(): FaceDetector {
  const { base } = stubLifecycle("stub-face");
  return {
    id: "stub-face",
    isReal: false,
    ...base,
    read: () => ({ faceCount: 1, confidence: 0 }),
  };
}

/** NOT A LIGHTING DETECTOR. Emits nothing. */
export function createStubLightingDetector(): LightingDetector {
  const { base } = stubLifecycle("stub-lighting");
  return {
    id: "stub-lighting",
    isReal: false,
    ...base,
    read: () => ({ level: 1, confidence: 0 }),
  };
}

/** NOT A SPEAKER DETECTOR. Emits nothing. */
export function createStubMultiSpeakerDetector(): MultiSpeakerDetector {
  const { base } = stubLifecycle("stub-speakers");
  return {
    id: "stub-speakers",
    isReal: false,
    ...base,
    read: () => ({ speakerCount: 1, confidence: 0 }),
  };
}

/**
 * The detector set an interview runs.
 *
 * Returns stubs today. When a real detector arrives it is constructed here and
 * given the collector, and no caller changes — which is the entire point of the
 * indirection.
 */
export function createDetectors(collector: EventCollector): {
  face: FaceDetector;
  lighting: LightingDetector;
  speakers: MultiSpeakerDetector;
  startAll: (stream: MediaStream | null) => void;
  stopAll: () => void;
  anyReal: () => boolean;
} {
  // Held so the signature is already the one a real detector needs. Unused
  // today precisely because the stubs observe nothing.
  void collector;

  const face = createStubFaceDetector();
  const lighting = createStubLightingDetector();
  const speakers = createStubMultiSpeakerDetector();
  const all: ProctorDetector[] = [face, lighting, speakers];

  return {
    face,
    lighting,
    speakers,
    startAll: (stream) => {
      for (const d of all) d.start(stream);
    },
    stopAll: () => {
      for (const d of all) d.stop();
    },
    anyReal: () => all.some((d) => d.isReal),
  };
}
