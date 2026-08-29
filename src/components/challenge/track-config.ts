import type { Domain } from "@prisma/client";

export type SectionNavItem = {
  href: string;
  label: string;
};

export type TrackConfig = {
  domain: Domain;
  /** Page heading + breadcrumb label. */
  label: string;
  /** Track landing route. */
  path: string;
  /** Day route prefix — a day lives at `${dayPathPrefix}/${dayNumber}`. */
  dayPathPrefix: string;
  /** Hero paragraph under the heading. */
  description: string;
  /** The FAQ copy is Claude-specific, so only that track shows the panel. */
  showFaq: boolean;
  /**
   * Claude locks a day once it has been submitted; AI/DS/SE let a student edit
   * an existing submission. Submission policy, not layout — preserved per track.
   */
  allowEditAfterSubmit: boolean;
};

export const TRACK_CONFIG: Record<Domain, TrackConfig> = {
  CLAUDE: {
    domain: "CLAUDE",
    label: "Claude Challenge",
    path: "/claude",
    dayPathPrefix: "/claude/day",
    description:
      "Master Claude with a 60-day learning journey. Complete your daily tasks, submit your proof of work, and take weekly quizzes.",
    showFaq: true,
    allowEditAfterSubmit: false,
  },
  AI: {
    domain: "AI",
    label: "AI Challenge",
    path: "/ai",
    dayPathPrefix: "/challenge",
    description:
      "Build real AI skills over a 60-day learning journey. Complete your daily tasks, submit your proof of work, and take weekly quizzes.",
    showFaq: false,
    allowEditAfterSubmit: true,
  },
  DS: {
    domain: "DS",
    label: "Data Science Challenge",
    path: "/ds",
    dayPathPrefix: "/challenge",
    description:
      "Build real data science skills over a 60-day learning journey. Complete your daily tasks, submit your proof of work, and take weekly quizzes.",
    showFaq: false,
    allowEditAfterSubmit: true,
  },
  SE: {
    domain: "SE",
    label: "Software Engineering Challenge",
    path: "/se",
    dayPathPrefix: "/challenge",
    description:
      "Build real software engineering skills over a 60-day learning journey. Complete your daily tasks, submit your proof of work, and take weekly quizzes.",
    showFaq: false,
    allowEditAfterSubmit: true,
  },
};

/** Track landing page, scoped to the enrollment the student is viewing. */
export function trackHref(track: TrackConfig, enrollmentId: string): string {
  return `${track.path}?challenge=${encodeURIComponent(enrollmentId)}`;
}

/** A single day of the track, scoped to the enrollment. */
export function dayHref(
  track: TrackConfig,
  dayNumber: number,
  enrollmentId: string,
): string {
  return `${track.dayPathPrefix}/${dayNumber}?challenge=${encodeURIComponent(enrollmentId)}`;
}

const SECTION_ANCHORS: { id: string; label: string; faqOnly?: boolean }[] = [
  { id: "challenge-days", label: "Days" },
  { id: "challenge-faqs", label: "FAQs", faqOnly: true },
  { id: "challenge-recent-runs", label: "Recent Runs" },
  { id: "challenge-quiz-history", label: "Quiz History" },
];

/** Header anchors while on the track landing page. */
export function sectionNavHash(track: TrackConfig): SectionNavItem[] {
  return SECTION_ANCHORS.filter((a) => !a.faqOnly || track.showFaq).map(
    (a) => ({ href: `#${a.id}`, label: a.label }),
  );
}

/** Same anchors, from a day page — they have to navigate back to the track. */
export function sectionNavFromDay(track: TrackConfig): SectionNavItem[] {
  return sectionNavHash(track).map((item) => ({
    href: `${track.path}${item.href}`,
    label: item.label,
  }));
}
