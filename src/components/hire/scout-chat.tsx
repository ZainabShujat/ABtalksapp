"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { suggestChips } from "@/features/hire/scout-chips";
import { detectSpokenBrief } from "@/features/hire/spoken-brief";
import { toast } from "sonner";
import {
  applyHireFiltersAction,
  runMatchAction,
  sendScoutMessageAction,
} from "@/app/actions/hire-actions";
import {
  markMatchViewedAction,
  markProjectOpenedAction,
  renameTalentProjectAction,
  setMatchDecisionAction,
} from "@/app/actions/talent-project-actions";
import {
  runGuestMatchAction,
  sendGuestScoutMessageAction,
} from "@/app/actions/hire-guest-actions";
import { recordCandidateViewAction } from "@/app/actions/hire-view-actions";
import { MatchResults } from "@/components/hire/match-results";
import {
  HireFilterDialog,
  filterSummary,
} from "@/components/hire/hire-filter-dialog";
import { CandidateInspector } from "@/components/hire/candidate-inspector";
import { GapReport } from "@/components/hire/gap-report";
import {
  useHireDesk,
  type DeskAssessment,
  type DeskSession,
} from "@/components/hire/hire-desk-context";
import { NewProjectDialog } from "@/components/hire/new-project-dialog";
import { readGuestCart } from "@/components/hire/guest-cart";
import { buildSampleCards } from "@/features/hire/sample-card";
import { hasSufficientRealMatches } from "@/features/hire/match-config";
import {
  generateVirtualCandidate,
  virtualCandidateToCard,
} from "@/features/hire/virtual-candidate";
import { buildLockedPreviewCards } from "@/features/hire/locked-preview";
import type {
  MatchCardData,
  MatchTriage,
} from "@/components/hire/match-card";
import { SearchTabs } from "@/components/hire/search-tabs";
import {
  RecruiterSearchSuggestions,
  RecruiterSearchTitle,
} from "@/components/hire/recruiter-search-landing";
import {
  HIRE_STAGE_MS,
  ghostFadeOut,
  measureStage,
  playStageFlip,
  prefersReducedMotion,
  type StageRect,
} from "@/components/hire/hire-stage-flip";
import {
  appendGuestSearch,
  clearGuestMatches,
  labelGuestSearch,
  readGuestMatchCollection,
  setActiveGuestSearch,
  writeGuestMatchCollection,
  type GuestSearchTab,
} from "@/components/hire/guest-matches-store";
import {
  clearGuestSession,
  readGuestSession,
  writeGuestSession,
} from "@/components/hire/guest-session";
import { cn } from "@/lib/utils";
import { type JobSpec } from "@/lib/validations/hire";

type Option = { label: string; value: string };
/** `options` is null for stored turns that offered no chips. */
type Msg = {
  role: "user" | "assistant";
  content: string;
  options?: Option[] | null;
};

type RecentRequest = {
  id: string;
  title: string;
  status: string;
  date: string;
};

type Props = {
  /** Persist turns as a TalentRequest. False for guests and pending recruiters. */
  persist?: boolean;
  initialRequestId: string | null;
  initialMessages: Msg[];
  initialSpec: JobSpec;
  initialSummary: string;
  /** Signed-in matches from the request page. Rendered inside the desk. */
  results?: (MatchCardData & Partial<MatchTriage>)[];
  resultsCartCount?: number;
  recent?: RecentRequest[];
  /** Recruiter label for this TalentRequest; falls back to the role title. */
  projectName?: string | null;
  alertWhenAvailable?: boolean;
  /** True when this TalentRequest has already been searched. */
  initialSearched?: boolean;
  /** Server flag: fill an empty desk with blurred example profiles. */
  proPreview?: boolean;
  virtualCandidates?: boolean;
  /** Plan 133: the search session on screen. Null = a new search not yet sent. */
  initialSessionId?: string | null;
  /** Plan 133: every search in this project, for the nav card. */
  projectSessions?: DeskSession[];
  /** Plan 133: this project's assessments, and the recruiter's unfiled ones. */
  projectAssessments?: DeskAssessment[];
  unassignedAssessments?: DeskAssessment[];
};

// Stable empties: a fresh `[]` default per render would re-fire the desk
// effect that publishes these, which sets context, which re-renders — forever.
const NO_SESSIONS: DeskSession[] = [];
const NO_ASSESSMENTS: DeskAssessment[] = [];

const OPENING: Msg = {
  role: "assistant",
  content: "What role are you hiring for?",
  options: [
    { label: "Backend engineer", value: "Backend engineer" },
    { label: "Full-stack engineer", value: "Full-stack engineer" },
    { label: "Data / ML engineer", value: "Data / ML engineer" },
    { label: "AI engineer", value: "AI engineer" },
    { label: "Frontend engineer", value: "Frontend engineer" },
  ],
};

/** How long screen 1's heading and suggestions take to fade out, pinned in
 *  place, while the workspace forms under them. Matches `rsearch-leave`. */
const LANDING_EXIT_MS = 520;

/** First beat of screen 2 -> 1. Matches `hire-results-out` in CSS. */
const RETURN_EXIT_MS = 380;

const SENIORITY_LABEL: Record<string, string> = {
  INTERN: "Intern",
  JUNIOR: "Junior",
  MID: "Mid",
  SENIOR: "Senior",
  LEAD: "Lead",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  PART_TIME: "Part-time",
  FREELANCE: "Freelance",
};

const WORK_MODE_LABEL: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

const EVIDENCE_LABEL: Record<string, string> = {
  missions: "Code correctness",
  clean_pass: "First-attempt quality",
  projects: "Project quality",
  consistency: "Consistency",
  interview: "Communication",
};

function looksLikeSalaryAsk(text: string): boolean {
  return /\b(salary|budget|compensation|lpa|ctc|stipend|pay range|package)\b/i.test(
    text,
  );
}

/** Display-only. Engine chip label can stay "Search verified talent". */
function chipLabel(o: Option): string {
  return o.value === "action:search" ? "Show me" : o.label;
}

function displaySalaryChips(): Option[] {
  return [
    { label: "₹5-10 LPA", value: "salary:500000-1000000" },
    { label: "₹10-20 LPA", value: "salary:1000000-2000000" },
    { label: "₹20-35 LPA", value: "salary:2000000-3500000" },
    { label: "Not decided", value: "skip:salary" },
  ];
}

/*
 * Juicebox-style: ticks go green as the recruiter types, not only after Scout
 * stores the spec. The detector lives in `features/hire/spoken-brief.ts` so it
 * shares role / stack vocabulary with Search and is unit-tested.
 */

function toLpa(rupees: number): string {
  const lakhs = rupees / 100_000;
  return Number.isInteger(lakhs) ? String(lakhs) : lakhs.toFixed(1);
}

/**
 * The requirement as a recruiter would read it back.
 *
 * Only answered fields produce a row, so the panel fills in as the conversation
 * goes — which is the honest version of a progress indicator: it shows what was
 * actually captured rather than a count. Several fields store a sentinel for
 * "asked, deliberately unspecified" (0–0 budget, 180-day notice, 0–50 years);
 * those read as the recruiter's intent, never as a literal number.
 */
function specRows(spec: JobSpec): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) rows.push({ label, value });
  };

  push("Role", spec.title?.trim());
  push("Seniority", spec.seniority ? SENIORITY_LABEL[spec.seniority] : null);
  push("Must have", spec.mustHaveStack?.join(" · "));
  push("Nice to have", spec.niceToHaveStack?.join(" · "));
  push(
    "Ranked on",
    spec.evidencePriority?.map((e) => EVIDENCE_LABEL[e] ?? e).join(" · "),
  );

  if (spec.salaryMin != null || spec.salaryMax != null) {
    const lo = spec.salaryMin ?? 0;
    const hi = spec.salaryMax ?? 0;
    // Stored annually so it stays comparable to candidate expectations, but
    // read back in the units the recruiter used — a stipend shown as "₹2.4 LPA"
    // is technically true and useless.
    const money =
      spec.salaryPeriod === "MONTHLY"
        ? `₹${Math.round(lo / 12).toLocaleString("en-IN")}–₹${Math.round(hi / 12).toLocaleString("en-IN")} / month`
        : `₹${toLpa(lo)}–${toLpa(hi)} LPA`;
    push("Budget", lo === 0 && hi === 0 ? "Not specified" : money);
  }

  push(
    "Engagement",
    spec.employmentType ? EMPLOYMENT_LABEL[spec.employmentType] : null,
  );
  push("Work mode", spec.workMode ? WORK_MODE_LABEL[spec.workMode] : null);
  if (spec.workMode !== "REMOTE") {
    push("City", spec.locationCity === "Any" ? "Any city" : spec.locationCity);
  }

  if (spec.noticePeriodDays != null) {
    const d = spec.noticePeriodDays;
    push(
      "Start",
      d === 0 ? "Immediate" : d >= 180 ? "Flexible" : `Within ${d} days`,
    );
  }

  if (spec.minExperience != null || spec.maxExperience != null) {
    const lo = spec.minExperience ?? 0;
    const hi = spec.maxExperience ?? 0;
    push(
      "Experience",
      lo === 0 && hi >= 50 ? "Evidence only" : `${lo}–${hi} years`,
    );
  }

  return rows;
}

export function ScoutChat({
  persist = false,
  initialRequestId,
  initialMessages,
  initialSpec,
  initialSummary,
  results,
  resultsCartCount = 0,
  recent = [],
  projectName = null,
  alertWhenAvailable = false,
  initialSearched = false,
  proPreview = false,
  virtualCandidates = false,
  initialSessionId = null,
  projectSessions = NO_SESSIONS,
  projectAssessments = NO_ASSESSMENTS,
  unassignedAssessments = NO_ASSESSMENTS,
}: Props) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string | null>(initialRequestId);
  // Plan 133: which search inside the project this chat is. Null until the
  // first message of a new search, when the server creates the session.
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(
    initialMessages.length ? initialMessages : [OPENING],
  );
  const [spec, setSpec] = useState<JobSpec>(initialSpec);
  const [summary, setSummary] = useState(initialSummary);
  const [readyToSearch, setReadyToSearch] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [searched, setSearched] = useState(
    initialSearched || (results?.length ?? 0) > 0,
  );
  const [matchCount, setMatchCount] = useState<number | null>(
    results != null ? results.length : null,
  );
  const [searchTabs, setSearchTabs] = useState<GuestSearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openMatch, setOpenMatch] = useState<MatchCardData | null>(null);
  const [unlockedRefs, setUnlockedRefs] = useState<Set<string>>(
    () => new Set(),
  );

  function markContactRevealed(candidateRef: string) {
    setUnlockedRefs((prev) => {
      if (prev.has(candidateRef)) return prev;
      const next = new Set(prev);
      next.add(candidateRef);
      return next;
    });
    setOpenMatch((m) =>
      m && m.candidateRef === candidateRef
        ? { ...m, engagementStatus: "CONTACT_SHARED" }
        : m,
    );
  }
  /**
   * Where the results were scrolled to before the panel opened.
   *
   * Captured on the FIRST open only. Opening narrows the left column, so a mark
   * taken while the panel is already open measures a different layout — which
   * is exactly what walking next/previous would do to it.
   */
  const savedScroll = useRef<number | null>(null);
  /** Open the inspector and fire-and-forget a detail-view record (plan 120). */
  function openMatchPanel(match: MatchCardData) {
    if (!openMatch) savedScroll.current = scrollRef.current?.scrollTop ?? null;
    setOpenMatch(match);
    void recordCandidateViewAction(match.candidateRef);
  }

  /** Close the panel and put the results back exactly where they were. */
  function closeMatchPanel() {
    const top = savedScroll.current;
    savedScroll.current = null;
    setOpenMatch(null);
    if (top == null) return;
    // The grid animates back to one column over 280ms. Restore on the next
    // frame so the recruiter sees the right place immediately, then again when
    // the track actually settles, or the browser keeps wherever the reflow left
    // us.
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (root) root.scrollTop = top;
    });
    const body = scrollRef.current?.closest(".scout__body");
    if (!body) return;
    // Arrow consts, not function declarations: a hoisted `function` loses the
    // `top == null` narrowing above and TS widens it back to `number | null`.
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      body.removeEventListener("transitionend", settle);
    };
    const settle = (e: Event) => {
      // `.scout__body` transitions more than one property; without this the
      // handler fires on whichever finishes first, mid-reflow.
      if ((e as TransitionEvent).propertyName !== "grid-template-columns") return;
      done();
      const root = scrollRef.current;
      if (root) root.scrollTop = top;
    };
    // The transition may never fire — reduced motion, or a track that did not
    // actually change. Without this the listener and its closure would outlive
    // every close for the rest of the session.
    timer = window.setTimeout(done, 600);
    body.addEventListener("transitionend", settle);
  }
  const {
    setDesk,
    view,
    inspect,
    clearInspect,
    newSearchNonce,
    newProjectNonce,
    landing: deskLanding,
  } = useHireDesk();
  const scrollRef = useRef<HTMLDivElement>(null);
  const visitStamped = useRef(false);
  const [projectLabel, setProjectLabel] = useState(
    projectName?.trim() || initialSummary || "",
  );
  const [hideRejected, setHideRejected] = useState(false);
  const [triageByRef, setTriageByRef] = useState<Record<string, MatchTriage>>(
    () => {
      const next: Record<string, MatchTriage> = {};
      for (const m of results ?? []) {
        if (!m.candidateUserId || !m.decision) continue;
        next[m.candidateRef] = {
          candidateUserId: m.candidateUserId,
          viewedAt: m.viewedAt ?? null,
          decision: m.decision,
          isNew: Boolean(m.isNew),
        };
      }
      return next;
    },
  );

  useEffect(() => {
    if (!persist || !initialRequestId || visitStamped.current) return;
    visitStamped.current = true;
    void markProjectOpenedAction({ requestId: initialRequestId });
  }, [persist, initialRequestId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    // Empty field: drop the inline height so CSS min-height owns the box.
    // Measuring scrollHeight on a blank placeholder after the stage flip
    // wrapped the placeholder and grew the bar.
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  // ...and again whenever the field's WIDTH changes. Sizing only on `text`
  // meant a measurement taken while the field was momentarily narrow (first
  // layout, or mid stage-change) was kept for good: the empty placeholder
  // wrapped into many lines, measured 132px, and the hero's single-line field
  // rendered as a tall box. Height changes are ignored here, or the resize
  // would feed itself. An empty field still skips the measurement.
  useEffect(() => {
    const el = promptRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      if (!el.value) {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const reqMenuRef = useRef<HTMLDivElement>(null);
  /**
   * The search bar — ONE element on both screens. It is never unmounted
   * between them; the stage change moves it and `playStageFlip` shows the
   * move.
   */
  const composerRef = useRef<HTMLFormElement>(null);
  /** Last hero geometry, recorded every hero render for the hand-off. */
  const heroGeometry = useRef<{
    bar: StageRect | null;
    title: StageRect | null;
    below: StageRect | null;
  } | null>(null);
  /** Screen 2's last bar position, for the move back to screen 1. */
  const resultsBar = useRef<StageRect | null>(null);
  /** First beat of the way back: the workspace fading before the reset. */
  const [returning, setReturning] = useState(false);
  /** Screen 1's pieces coming back in behind the returning bar. */
  const [arriving, setArriving] = useState(false);
  /**
   * A fresh chat inside the project: screen 2 with an empty thread. Without
   * it an empty thread means screen 1, and "New search" would have left the
   * dashboard — which is New project's job, not New search's.
   */
  const [freshChat, setFreshChat] = useState(false);
  /** Screen 1's own pieces, pinned where they were while they fade out. */
  const [heroGhost, setHeroGhost] = useState<{
    title: StageRect | null;
    below: StageRect | null;
  } | null>(null);
  const hydratedRef = useRef(false);
  const rows = specRows(spec);
  const activeSearch =
    searchTabs.find((t) => t.id === activeSearchId) ??
    searchTabs[searchTabs.length - 1] ??
    null;
  const guestMatches = activeSearch?.matches ?? [];
  const guestGap = activeSearch?.overallGap ?? null;
  // Inside an authenticated project the desk shows the PERSISTED matches and
  // nothing else — never the localStorage guest set, not even when the
  // persisted list is empty.
  //
  // This used to read `persist && results.length > 0 ? results : guestMatches`,
  // which silently swapped in guest cards whenever `results` was empty. The
  // /hire route passes no `results` prop at all, so an approved recruiter there
  // rendered guest cards left over from an anonymous search. Those cards carry
  // no `candidateUserId`, so `showTriage` was false and the card fell back to
  // the legacy "Add to request list" button: the project shortlist was
  // unreachable and nothing the recruiter clicked could persist.
  //
  // An empty project now renders as empty, which is honest and debuggable.
  // An approved recruiter NEVER sees guest cards.
  //
  // `guestMatches` is the logged-OUT preview, held in localStorage. It used to
  // render for a signed-in recruiter too, whenever `results` was empty — and
  // the /hire route passes no `results` prop at all. So after logging in, the
  // desk showed stale cards from a pre-login anonymous search. Those cards
  // carry no `candidateUserId`, so `showTriage` was false and the card fell
  // back to the legacy "Add to request list" button, whose action looks up a
  // ProgramMember and answers "Member not found" for anyone outside the one
  // published cohort. That is the whole reported failure.
  //
  // Signed in: show the project's persisted matches, or nothing. An empty desk
  // is honest and sends the recruiter to their project; stale guest cards
  // wearing the wrong button are not.
  const deskMatchesRaw = persist ? (results ?? []) : guestMatches;
  const deskMatches = deskMatchesRaw.map((m) => ({
    ...m,
    ...(triageByRef[m.candidateRef] ?? {}),
    ...(unlockedRefs.has(m.candidateRef)
      ? { engagementStatus: "CONTACT_SHARED" as const }
      : {}),
  }));
  const visibleDeskMatches = hideRejected
    ? deskMatches.filter((m) => m.decision !== "REJECTED")
    : deskMatches;
  const deskGap = persist ? null : guestGap;
  // An empty desk gets one of two things. With the Pro preview on, blurred
  // example profiles showing the format Pro fills in; otherwise the original
  // spec-shaped sample card. Both carry `SampleCardNotice`, which is what keeps
  // the page honest that the pool has nobody matching — neither card is
  // inventory, and only the notice says so in words.
  // "Did the pool answer?" is a threshold question, not a count. A single
  // 41-scoring near-miss is not an answer, and treating it as one is how a
  // recruiter concludes we have nobody rather than that we can find somebody.
  const poolAnswered = hasSufficientRealMatches(deskMatches);
  const virtualProfile = generateVirtualCandidate(spec);
  const deskSamples = !searched || poolAnswered
    ? []
    : proPreview
      ? buildLockedPreviewCards(spec)
      : virtualCandidates && virtualProfile
        ? [virtualCandidateToCard(virtualProfile)]
        : buildSampleCards(spec);

  useEffect(() => {
    if (persist && (results?.length ?? 0) > 0) {
      setSearched(true);
      setMatchCount(results!.length);
    }
  }, [persist, results]);

  useEffect(() => {
    if (!inspect) return;
    openMatchPanel(inspect);
    clearInspect();
    // openMatchPanel is stable for this render; inspect is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plan 120: record on open
  }, [inspect, clearInspect]);

  // Layout effect, not effect: the chrome's class decides the whole page
  // layout (grid, sidebar, header), and the bar's move is measured against it.
  // As a plain effect the chrome switched one painted frame after this
  // component did, so the bar was measured mid-switch and jumped.
  useLayoutEffect(() => {
    if (view === "pod") return;
    setDesk({
      step: searched ? 2 : 1,
      matchCount,
      gap: deskGap,
      // Must be exactly `showLanding` below. The chrome paints the green
      // field and the white dashboard, so any disagreement leaves the landing
      // sitting on the results header — which is what happened while this
      // carried its own copy of the rule.
      // Exactly `hero` below. It flips on the Search press, which is what
      // starts the background morph and brings the workspace in — at the same
      // moment the bar starts to travel, not after the backend answers.
      landing:
        view === "scout" &&
        !freshChat &&
        !(searched || messages.some((m) => m.role === "user")),
    });
  }, [searched, matchCount, deskGap, setDesk, view, messages, freshChat]);

  // The nav card names the open project; off-project it keeps its own
  // "Current Project" label.
  useEffect(() => {
    setDesk({
      projectName: persist && requestId ? projectLabel.trim() || null : null,
    });
  }, [persist, requestId, projectLabel, setDesk]);

  // Plan 133: the nav card lists this project's searches and assessments.
  useEffect(() => {
    setDesk({
      project:
        persist && requestId
          ? {
              id: requestId,
              activeSessionId: sessionId,
              sessions: projectSessions,
              assessments: projectAssessments,
              unassignedAssessments,
            }
          : null,
    });
  }, [
    persist,
    requestId,
    sessionId,
    projectSessions,
    projectAssessments,
    unassignedAssessments,
    setDesk,
  ]);

  useEffect(() => {
    if (hydratedRef.current) return;
    if (persist && (initialMessages.length > 0 || initialRequestId)) return;
    hydratedRef.current = true;
    const saved = readGuestSession();
    if (saved) {
      setSpec(saved.spec);
      if (saved.messages.length > 0) setMessages(saved.messages);
      setSummary(saved.summary);
      setReadyToSearch(saved.readyToSearch);
      setSearched(saved.searched);
    }
    const searches = readGuestMatchCollection();
    if (searches.tabs.length > 0) {
      setSearchTabs(searches.tabs);
      setActiveSearchId(searches.activeId);
      const active =
        searches.tabs.find((t) => t.id === searches.activeId) ??
        searches.tabs[searches.tabs.length - 1]!;
      setMatchCount(active.matches.length);
      setSearched(true);
    }
  }, [persist, initialMessages.length, initialRequestId]);

  // Results: land on rank 1. Pre-search thread: follow the latest question.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // Results snap to rank 1. Smooth-scrolling the list made the cards
    // travel down the pane; the enter motion is CSS `hire-results-in`.
    const behavior: ScrollBehavior =
      searched || pending || prefersReducedMotion() ? "auto" : "smooth";
    const frame = window.requestAnimationFrame(() => {
      root.scrollTo({
        top: searched ? 0 : root.scrollHeight,
        behavior,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, pending, searched, deskMatches.length]);

  useEffect(() => {
    if (!detailsOpen) return;
    function onPointer(e: MouseEvent) {
      if (reqMenuRef.current && !reqMenuRef.current.contains(e.target as Node)) {
        setDetailsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [detailsOpen]);

  // There is deliberately NO auto-search effect here any more.
  //
  // "Finishing the questions IS the trigger" was right for a fixed form that
  // ended: the last answer was an event, so searching on it felt like the
  // conversation arriving somewhere. Scout is an agent now and there is no such
  // moment — `readyToSearch` only means a search *would* mean something, and it
  // goes true the instant a role and a stack exist. Firing on it searched behind
  // the agent's back, mid-brief, and stole the decision from it.
  //
  // A search now happens for exactly two reasons, both explicit: the recruiter
  // tapped the button (`action:search`, handled in `send`), or the agent called
  // its own search tool and the turn came back with `action === "search"`.

  /** Open a candidate from a card or the panel's arrows, stamping it viewed. */
  function openFromList(m: MatchCardData & Partial<MatchTriage>) {
    openMatchPanel(m);
    const userId =
      m.candidateUserId ?? triageByRef[m.candidateRef]?.candidateUserId;
    if (!persist || !requestId || !userId) return;
    setTriageByRef((prev) => ({
      ...prev,
      [m.candidateRef]: {
        candidateUserId: userId,
        viewedAt: prev[m.candidateRef]?.viewedAt ?? new Date().toISOString(),
        decision: prev[m.candidateRef]?.decision ?? m.decision ?? "UNDECIDED",
        isNew: false,
      },
    }));
    void markMatchViewedAction({
      requestId,
      candidateUserId: userId,
    });
  }

  /**
   * `label` is what the recruiter read on the chip, when that differs from the
   * value behind it ("Within 30 days" → "30"). It drives the bubble and what is
   * stored; the engine always parses `value`.
   */
  function send(value: string, label?: string) {
    const message = value.trim();
    if (!message || pending) return;
    if (message === "action:search") {
      runSearch(undefined, searched);
      return;
    }

    const shown = label?.trim() || message;
    // After a search the thread is gone: parse NL once, then re-run search
    // without painting Scout bubbles.
    const hideThread = searched;
    if (!hideThread) {
      setMessages((m) => [...m, { role: "user", content: shown }]);
    }
    setText("");
    startTransition(async () => {
      if (persist) {
        const res = await sendScoutMessageAction({
          requestId: requestId ?? undefined,
          // Absent on the first message of a new search: the server opens a
          // new session in this project rather than continuing the last one.
          sessionId: sessionId ?? undefined,
          message,
          display: shown === message ? undefined : shown,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        setRequestId(res.data.requestId);
        setSessionId(res.data.sessionId);
        const openedSession = res.data.sessionId !== sessionId;
        setSpec(res.data.spec);
        setSummary(res.data.summary);
        setReadyToSearch(res.data.readyToSearch);
        if (!hideThread) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content: res.data.assistantMessage,
              options: res.data.options,
            },
          ]);
        }
        // Search on this turn BEFORE navigating. replace() unmounts this
        // chat; if we kicked search off after it, the first brief never
        // wrote matches and the new page said "No matches yet".
        // On the results screen, a new query always re-runs search after parse.
        if (res.data.action === "search" || hideThread) {
          const match = await runMatchAction({
            requestId: res.data.requestId,
            sessionId: res.data.sessionId,
          });
          if (!match.ok) {
            toast.error(match.message);
          } else {
            setSearched(true);
            setMatchCount(match.data.matchCount);
            if (!hideThread) {
              setMessages((m) => [
                ...m,
                { role: "assistant", content: match.data.overallGap },
              ]);
            }
          }
        }
        // A new project or a new session gets its own URL, so reload and the
        // nav card both land on this search. Same session: refresh in place.
        if (!requestId || openedSession) {
          router.replace(`/hire/${res.data.requestId}?session=${res.data.sessionId}`);
        } else if (res.data.action === "search" || hideThread) router.refresh();
        return;
      }

      const res = await sendGuestScoutMessageAction({
        message,
        display: shown === message ? undefined : shown,
        spec,
        history: messages.map((row) => ({
          role: row.role,
          content: row.content,
        })),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setSpec(res.data.spec);
      setSummary(res.data.summary);
      setReadyToSearch(res.data.readyToSearch);
      if (hideThread) {
        writeGuestSession({
          spec: res.data.spec,
          messages,
          summary: res.data.summary,
          readyToSearch: res.data.readyToSearch,
          searched: true,
        });
      } else {
        setMessages((m) => {
          const next: Msg[] = [
            ...m,
            {
              role: "assistant",
              content: res.data.assistantMessage,
              options: res.data.options,
            },
          ];
          writeGuestSession({
            spec: res.data.spec,
            messages: next,
            summary: res.data.summary,
            readyToSearch: res.data.readyToSearch,
            searched,
          });
          return next;
        });
      }
      // Same rule as the signed-in path: the engine says when to search.
      // After results, a new NL query always re-runs.
      if (res.data.action === "search" || hideThread) {
        runSearch(res.data.spec, hideThread);
      }
    });
  }

  function runSearch(overrideSpec?: JobSpec, quiet = false) {
    if (persist && !requestId) {
      toast.error("Answer at least one question first.");
      return;
    }
    const active = overrideSpec ?? spec;
    startTransition(async () => {
      if (persist) {
        const res = await runMatchAction({
          requestId: requestId!,
          sessionId: sessionId ?? undefined,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        // No session yet (a new search run straight from the button): the
        // server opened one. Move to its URL so the nav card and reload agree.
        if (res.data.sessionId !== sessionId) {
          setSessionId(res.data.sessionId);
          router.replace(`/hire/${requestId}?session=${res.data.sessionId}`);
          return;
        }
        setSearched(true);
        setMatchCount(res.data.matchCount);
        if (!quiet) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: res.data.overallGap },
          ]);
        }
        router.refresh();
        return;
      }

      const res = await runGuestMatchAction({ spec: active });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const cart = new Set(readGuestCart().map((i) => i.candidateRef));
      const cards = res.data.matches.map((m) => ({
        ...m,
        shortlisted: cart.has(m.candidateRef),
      }));
      const payload = {
        label: labelGuestSearch(active, cards.length),
        title: active.title?.trim() || "your requirement",
        overallGap: res.data.overallGap,
        matches: cards,
      };
      if (quiet) {
        const current = readGuestMatchCollection();
        if (current.activeId && current.tabs.some((t) => t.id === current.activeId)) {
          const tabs = current.tabs.map((t) =>
            t.id === current.activeId ? { ...t, ...payload } : t,
          );
          writeGuestMatchCollection({ ...current, tabs });
          setSearchTabs(tabs);
        } else {
          const tab = appendGuestSearch(payload);
          setSearchTabs(readGuestMatchCollection().tabs);
          setActiveSearchId(tab.id);
        }
      } else {
        const tab = appendGuestSearch(payload);
        setSearchTabs(readGuestMatchCollection().tabs);
        setActiveSearchId(tab.id);
      }
      setSearched(true);
      setMatchCount(cards.length);
      if (!quiet) {
        setMessages((m) => {
          const next: Msg[] = [
            ...m,
            { role: "assistant", content: res.data.overallGap },
          ];
          writeGuestSession({
            spec: active,
            messages: next,
            summary,
            readyToSearch: true,
            searched: true,
          });
          return next;
        });
      } else {
        writeGuestSession({
          spec: active,
          messages,
          summary,
          readyToSearch: true,
          searched: true,
        });
      }
    });
  }

  /** Persist the dialog spec and re-rank — never an agent turn. */
  function applyFilters(next: JobSpec) {
    setSpec(next);
    setFiltersOpen(false);
    if (persist && !requestId) {
      toast.error("Answer at least one question first.");
      return;
    }
    startTransition(async () => {
      if (persist) {
        const res = await applyHireFiltersAction({
          requestId: requestId!,
          sessionId: sessionId ?? undefined,
          spec: next,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        setSearched(true);
        setMatchCount(res.data.matchCount);
        router.refresh();
        return;
      }

      const res = await runGuestMatchAction({ spec: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const cart = new Set(readGuestCart().map((i) => i.candidateRef));
      const cards = res.data.matches.map((m) => ({
        ...m,
        shortlisted: cart.has(m.candidateRef),
      }));
      const payload = {
        label: labelGuestSearch(next, cards.length),
        title: next.title?.trim() || "your requirement",
        overallGap: res.data.overallGap,
        matches: cards,
      };
      const current = readGuestMatchCollection();
      if (current.activeId && current.tabs.some((t) => t.id === current.activeId)) {
        const tabs = current.tabs.map((t) =>
          t.id === current.activeId ? { ...t, ...payload } : t,
        );
        writeGuestMatchCollection({ ...current, tabs });
        setSearchTabs(tabs);
      } else {
        const tab = appendGuestSearch(payload);
        setSearchTabs(readGuestMatchCollection().tabs);
        setActiveSearchId(tab.id);
      }
      setSearched(true);
      setMatchCount(cards.length);
      writeGuestSession({
        spec: next,
        messages,
        summary,
        readyToSearch: true,
        searched: true,
      });
    });
  }

  // Only the newest turn offers chips, and they hang off that message rather
  // than off the composer — an answer belongs to the question that asked it.
  // Searching backwards for the last turn *with* options kept stale chips on
  // screen after a search, which have nothing left to answer.
  const lastIndex = messages.length - 1;
  const lastMsg = messages[lastIndex];
  const activeOptions =
    lastMsg?.role === "assistant" ? (lastMsg.options ?? []) : [];
  const askOpen = lastMsg?.role === "assistant" && !pending && !openMatch;
  // Same chips the conversation engine sent for this turn. Show me is
  // `action:search` and only lands when the brief is searchable — do not
  // invent extra pills here. An empty options list still gets the ladder so
  // a salary ask is never a dead end.
  const chips = (() => {
    if (activeOptions.length > 0) return activeOptions;
    if (!askOpen || !lastMsg) return [];
    const ladder = looksLikeSalaryAsk(lastMsg.content)
      ? displaySalaryChips()
      : suggestChips(spec, false);
    if (readyToSearch && !ladder.some((c) => c.value === "action:search")) {
      return [...ladder, { label: "Show me", value: "action:search" }];
    }
    return ladder;
  })();
  const talked = messages.some((m) => m.role === "user") || searched;
  const spoken = detectSpokenBrief(
    [
      ...messages.filter((m) => m.role === "user").map((m) => m.content),
      text,
    ].join(" "),
  );
  const criteria = [
    { key: "Role", on: Boolean(spec.title?.trim()) || spoken.role },
    {
      key: "Years of Experience",
      on:
        spec.seniority != null ||
        spec.minExperience != null ||
        spoken.experience,
    },
    {
      key: "Location",
      on: Boolean(spec.locationCity?.trim()) || spoken.location,
    },
    { key: "Education Qualification", on: spec.requiresDegree != null || spoken.education },
    { key: "Skills", on: (spec.mustHaveStack?.length ?? 0) > 0 || spoken.skills },
    {
      key: "Availability",
      on: spec.workMode != null || spoken.availability,
    },
    {
      key: "Compensation",
      on: spec.salaryMin != null || spec.salaryMax != null || spoken.compensation,
    },
    {
      key: "Type of Employment",
      on: spec.employmentType != null,
    },
    {
      key: "ABtalks Recommended",
      on: (spec.evidencePriority?.length ?? 0) > 0 || spoken.abtalks,
    },
  ] as const;

  /**
   * Keep the newest tick in view.
   *
   * The checklist is one horizontal strip, so on a narrow screen the items that
   * just got ticked are usually the ones off the right edge — exactly the
   * feedback the recruiter is looking for after answering. Scroll the last
   * ticked item into view whenever the ticks change. `inline: "end"` because
   * the list fills left to right, and "nearest" block so the page itself never
   * jumps while someone is typing.
   */
  const tickSignature = criteria.map((c) => (c.on ? "1" : "0")).join("");
  useEffect(() => {
    const list = criteriaRef.current;
    if (!list) return;
    const ticked = list.querySelectorAll<HTMLLIElement>(".scout-criterion.is-on");
    const last = ticked[ticked.length - 1];
    if (!last) return;
    last.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [tickSignature]);

  const REQUIREMENT_ASK: Record<(typeof criteria)[number]["key"], string> = {
    Role: "Let's cover the role — what are you hiring for?",
    "Years of Experience": "What years of experience should they have?",
    Location: "Which city should they be in, or is remote fine?",
    "Education Qualification": "Do they need a degree?",
    Skills: "Which skills are must-haves?",
    Availability: "Remote, hybrid or onsite?",
    Compensation: "What's the budget for this role?",
    "Type of Employment": "Full-time, part-time, internship, contract or freelance?",
    "ABtalks Recommended": "Should we rank on ABTalks verified evidence first?",
  };

  const EMP_FILTERS = [
    { label: "All", value: "All" as const, prompt: "Any employment type is fine." },
    { label: "Full-time", value: "FULL_TIME" as const, prompt: "This is a full-time role." },
    { label: "Part-time", value: "PART_TIME" as const, prompt: "This is a part-time role." },
    { label: "Internship", value: "INTERNSHIP" as const, prompt: "This is an internship." },
    { label: "Contract", value: "CONTRACT" as const, prompt: "This is a contract role." },
    { label: "Freelance", value: "FREELANCE" as const, prompt: "This is a freelance role." },
  ];

  function pickRequirement(key: (typeof criteria)[number]["key"], already: boolean) {
    setDetailsOpen(false);
    if (already || pending) return;
    send(REQUIREMENT_ASK[key]);
  }

  function pickEmployment(value: (typeof EMP_FILTERS)[number]["value"]) {
    const row = EMP_FILTERS.find((f) => f.value === value);
    if (!row || pending) return;
    const current = spec.employmentType ?? "All";
    if (current === value) {
      setDetailsOpen(false);
      return;
    }
    setDetailsOpen(false);
    send(row.prompt);
  }

  /** Everything a search put on screen, back to an empty brief. */
  function clearSearch() {
    setMessages([OPENING]);
    setSpec({});
    setSummary("Not started");
    setReadyToSearch(false);
    setSearched(false);
    setMatchCount(null);
    setActiveSearchId("");
    setText("");
    setDetailsOpen(false);
    setFiltersOpen(false);
    setOpenMatch(null);
    savedScroll.current = null;
  }

  /**
   * Leaving the current search in two beats: the workspace's cards and
   * toolbar fade first (`returning`), THEN the state resets. For New project
   * that reset sends the bar back up and the surface back to green; for New
   * search it just empties the thread in place. Without the first beat the
   * cards vanished in one frame.
   */
  function beginReturn(reset: () => void) {
    if (returning) return;
    if (prefersReducedMotion() || hero) {
      reset();
      return;
    }
    setReturning(true);
    window.setTimeout(() => {
      reset();
      setReturning(false);
      promptRef.current?.focus();
    }, RETURN_EXIT_MS);
  }

  /**
   * New search — a new chat in the SAME project, like starting a new chat
   * inside a Claude project. Stays on screen 2: the white dashboard, the nav
   * card and the bar all stay where they are; only the thread clears (fading
   * out, then the empty chat fading in) and the field takes focus. Nothing is
   * created and `requestId` is kept. A guest's earlier searches stay in the
   * tab history. (A saved project's conversation lives server-side and is
   * not rewritten — the next search continues it.)
   */
  function newSearch() {
    // Plan 133: a NEW session in the SAME project. The previous session stays
    // exactly as it is; the next message here opens session N+1. The URL says
    // so without a navigation (which would remount mid-animation).
    if (persist && requestId) {
      setSessionId(null);
      window.history.replaceState(null, "", `/hire/${requestId}?session=new`);
    }
    beginReturn(() => {
      clearSearch();
      setFreshChat(true);
      setArriving(true);
      window.setTimeout(() => setArriving(false), 600);
      // A guest's session is what a reload restores from; left as it was it
      // still said "searched" and a refresh brought back the closed results.
      if (!persist) {
        writeGuestSession({
          spec: {},
          messages: [OPENING],
          summary: "Not started",
          readyToSearch: false,
          searched: false,
        });
      }
    });
  }

  /**
   * New project — a fresh workspace, nothing carried over — and the Search
   * transition played backwards, in one move rather than "fade, then move".
   *
   * At the press, screen 2's pieces fade out pinned where they are (the
   * mirror of screen 1's heading and suggestions on Search), while the reset
   * sends the SAME bar back up to the centre, the surface morphs back to green
   * and the heading and suggestions settle in behind it (`is-arriving`).
   *
   * For a signed-in recruiter the project IS the TalentRequest, so a new one
   * means `/hire` with no id. The move plays here first, and the navigation
   * lands once it has finished — onto the same screen 1 it just arrived at.
   * A guest has no server project, so the stored session and every search in
   * it go.
   */
  function newProject() {
    if (returning) return;
    // Plan 133: a signed-in recruiter gets a REAL project — named, created now,
    // then opened — instead of a cleared screen that became a project only
    // once something was searched.
    if (persist) {
      setNewProjectOpen(true);
      return;
    }
    if (!hero) {
      ghostFadeOut(
        [
          ".scout__toolbar",
          ".chat-output",
          ".hire-detail",
          ".hire-side",
          ".hire-app__nav > .hire-hbtn",
        ],
        LANDING_EXIT_MS,
      );
    }
    if (requestId) {
      clearSearch();
      setFreshChat(false);
      window.setTimeout(() => router.push("/hire"), HIRE_STAGE_MS);
      return;
    }
    clearGuestSession();
    clearGuestMatches();
    setSearchTabs([]);
    clearSearch();
    setFreshChat(false);
  }



  // "+ Create New Project" lives in the nav card, outside this component. It
  // bumps a counter in the desk context and the reset happens here, where the
  // conversation state is.
  const seenSearchNonce = useRef(newSearchNonce);
  useEffect(() => {
    if (newSearchNonce === seenSearchNonce.current) return;
    seenSearchNonce.current = newSearchNonce;
    newSearch();
    // The actions read state at call time; the counter is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSearchNonce]);

  const seenProjectNonce = useRef(newProjectNonce);
  useEffect(() => {
    if (newProjectNonce === seenProjectNonce.current) return;
    seenProjectNonce.current = newProjectNonce;
    newProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newProjectNonce]);

  // The panel's arrows walk the same list the cards are drawn from.
  const panelList: (MatchCardData & Partial<MatchTriage>)[] =
    visibleDeskMatches.length > 0 ? visibleDeskMatches : deskSamples;
  const openIndex = openMatch
    ? panelList.findIndex((m) => m.candidateRef === openMatch.candidateRef)
    : -1;
  const openDecision = openMatch
    ? (deskMatches.find((m) => m.candidateRef === openMatch.candidateRef)
        ?.decision ?? null)
    : null;

  // The strip shows the five criteria of the results design (Figma 1585:46),
  // in its order, muted until each one is captured. The other four are still
  // tracked and still listed in the Filters menu.
  //
  // It used to render only `criteria.filter(c => c.on)` and stay collapsed
  // until one was — the idea being that grey labels under an empty composer
  // said nothing. In practice the opposite was true: a recruiter could not see
  // what Scout was even trying to collect, and the row appearing mid-typing
  // moved the composer under their hands. Showing the whole list makes the
  // strip a legible target, and its height is now constant, so nothing shifts
  // as ticks land.
  //
  // `is-open` is permanent for the same reason: the slot animates
  // grid-template-rows between 0fr and 1fr, and there is no longer a state
  // where the strip should be closed.
  const STRIP_KEYS = [
    "Location",
    "Years of Experience",
    "Role",
    "Education Qualification",
    "Skills",
  ] as const;
  const stripItems = STRIP_KEYS.map(
    (key) => criteria.find((c) => c.key === key)!,
  );

  /**
   * Screen 1 until the recruiter presses Search — and not a frame longer.
   *
   * The press IS the transition. `send` pushes the recruiter's message
   * synchronously, `talked` flips, and in that same commit the stage changes:
   * the bar starts travelling, the green begins morphing into the dashboard's
   * grey and the workspace comes in, all while the request is in flight. The
   * dashboard then sits in a loading state (skeleton cards) until the backend
   * answers; only the cards wait for the response. Nothing about the motion
   * does.
   */
  // Not gated on `initialRequestId` any more: "New search" inside a saved
  // project returns `/hire/[id]` to screen 1 without leaving the project.
  const hero = view === "scout" && !talked && !freshChat;
  const filterBits = filterSummary(spec);

  // Record where everything sits while it is the hero, so the hand-off has
  // the "before" half of each move. Every hero render: typing reflows the
  // card (the criteria ticks, a wrapping line), and a stale rect would make
  // the bar jump before it moves.
  useLayoutEffect(() => {
    if (!hero) {
      resultsBar.current = measureStage(composerRef.current);
      return;
    }
    const rect = (sel: string) =>
      measureStage(document.querySelector<HTMLElement>(sel));
    heroGeometry.current = {
      bar: measureStage(composerRef.current),
      title: rect(".scout-hero-slot .rsearch__title"),
      below: rect(".scout-hero-slot--below .rsearch__suggest"),
    };
  });

  // The hand-off itself. Layout effect so the bar's inverse transform is in
  // place before the browser paints its new position.
  // Keyed on the chrome's flag rather than `hero`: `hero` flips first, the
  // chrome follows in a synchronous second commit, and only after that second
  // commit is the bar sitting in its real screen-2 position to measure.
  const wasHero = useRef(deskLanding);
  useLayoutEffect(() => {
    const was = wasHero.current;
    wasHero.current = deskLanding;
    if (was === deskLanding) return;

    // Screen 2 -> 1 (New search / New project). The same bar travels back up
    // while the surface morphs back to green; screen 1's pieces come in
    // behind it (`arriving`).
    if (deskLanding) {
      const back = resultsBar.current;
      resultsBar.current = null;
      if (!back) return;
      playStageFlip(composerRef.current, back);
      if (prefersReducedMotion()) return;
      setArriving(true);
      const id = window.setTimeout(() => setArriving(false), 1500);
      return () => window.clearTimeout(id);
    }

    const from = heroGeometry.current;
    heroGeometry.current = null;
    if (!from) return;
    playStageFlip(composerRef.current, from.bar);
    if (prefersReducedMotion()) return;
    setHeroGhost({ title: from.title, below: from.below });
    const id = window.setTimeout(() => setHeroGhost(null), LANDING_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [deskLanding]);

  /** Pin a leaving hero piece where it was, out of the workspace's flow. */
  const pinned = (r: StageRect | null) =>
    r
      ? ({
          position: "fixed",
          top: r.top,
          left: r.left,
          width: r.width,
          margin: 0,
          zIndex: 5,
          pointerEvents: "none",
        } as const)
      : undefined;

  return (
    <section
      className={cn(
        "scout",
        hero && "scout--hero",
        returning && "is-returning",
        arriving && "is-arriving",
      )}
      aria-label="Scout assistant"
    >
      {persist && (
        <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      )}
      {/* One grid (see `.hire-app--results .scout__body`): Filters, the
          thread and the composer stack on the left, the profile panel takes
          the right column. "New search" moved to the nav card's
          "+ Create New Project"; the Requirement menu is behind Filters. */}
      <div className={cn("scout__body", openMatch && "is-open")}>
        <div className="scout__toolbar">
          <button
            type="button"
            className="scout-filters scout-action scout-action--search"
            onClick={newSearch}
            disabled={returning}
          >
            New search
          </button>
          <button
            type="button"
            className="scout-filters scout-action"
            onClick={newProject}
            disabled={returning}
          >
            New project
          </button>
          <div className="hire-req" ref={reqMenuRef}>
            <button
              type="button"
              className="scout-filters"
              aria-expanded={searched ? filtersOpen : detailsOpen}
              aria-haspopup={searched ? "dialog" : "menu"}
              onClick={() => {
                if (searched) setFiltersOpen(true);
                else setDetailsOpen((o) => !o);
              }}
            >
              <span className="scout-filters__icon" aria-hidden="true">
                <img
                  src="/hire/filters-chevron.png"
                  alt=""
                  width={16}
                  height={15}
                />
              </span>
              Filters
            </button>
            {!searched && detailsOpen && (
              <div className="hire-req__menu" role="menu">
                <p className="hire-req__label">Requirement</p>
                {persist && requestId && (
                  <label className="hire-req__name">
                    <span className="hire-req__label">Name this project</span>
                    <input
                      type="text"
                      maxLength={80}
                      value={projectLabel}
                      onChange={(e) => setProjectLabel(e.target.value)}
                      onBlur={() => {
                        const name = projectLabel.trim();
                        if (!name) return;
                        void renameTalentProjectAction({ requestId, name }).then(
                          (res) => {
                            if (!res.ok) toast.error(res.message);
                          },
                        );
                      }}
                      className="hire-req__name-input"
                    />
                  </label>
                )}
                {criteria.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={cn("hire-req__item", c.on && "is-on")}
                    role="menuitemcheckbox"
                    aria-checked={c.on}
                    onClick={() => pickRequirement(c.key, c.on)}
                  >
                    {c.key}
                    <span className="hire-req__dot" />
                  </button>
                ))}
                <p className="hire-req__label hire-req__label--filter">
                  Employment type
                </p>
                <div
                  className="hire-req__filter"
                  role="radiogroup"
                  aria-label="Filter by employment type"
                >
                  {EMP_FILTERS.map((f) => {
                    const checked =
                      f.value === "All"
                        ? spec.employmentType == null
                        : spec.employmentType === f.value;
                    return (
                      <button
                        key={f.value}
                        type="button"
                        className={cn(
                          "hire-req__item hire-req__item--radio",
                          checked && "is-on",
                        )}
                        role="menuitemradio"
                        aria-checked={checked}
                        onClick={() => pickEmployment(f.value)}
                      >
                        {f.label}
                        <span className="hire-req__dot" />
                      </button>
                    );
                  })}
                </div>
                {rows.length > 0 && (
                  <dl className="hire-req__rows">
                    {rows.map((r) => (
                      <div key={r.label}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {recent.length > 0 && (
                  <div className="hire-req__recent">
                    <p className="hire-req__label">Pick up where you left off</p>
                    {recent.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="hire-req__item"
                        onClick={() => router.push(`/hire/${r.id}`)}
                      >
                        <span className="truncate">{r.title}</span>
                        <span className="hire-req__meta">
                          {r.status} · {r.date}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="chat-output" id="hire-results">
          {searched ? (
            <>
              {/* One coherent bar: what this search filtered on, and the way to
                  change it. "Edit filters" belongs here beside the criteria it
                  edits — as a loose button by the composer it read as an
                  unrelated floating link. */}
              <div className="hire-filter-bar">
                <p className="hire-filter-bar__title">Filters from this search</p>
                <div className="hire-filter-bar__chips">
                  {filterBits.chips.length === 0 ? (
                    <span className="hire-filter-bar__empty">No filters set</span>
                  ) : (
                    filterBits.chips.map((c, i) => (
                      <span key={`${c}-${i}`} className="hire-filter-chip">
                        {c}
                      </span>
                    ))
                  )}
                  {filterBits.more > 0 && (
                    <span className="hire-filter-chip hire-filter-chip--more">
                      +{filterBits.more} more
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="hire-filter-bar__edit"
                  onClick={() => setFiltersOpen(true)}
                >
                  Edit filters
                </button>
              </div>
              <div className="scout-thread__results" aria-busy={pending}>
                {!persist && searchTabs.length > 1 && (
                  <div className="scout-tabs">
                    <SearchTabs
                      tabs={searchTabs}
                      activeId={activeSearchId}
                      onSelect={(id) => {
                        setActiveSearchId(id);
                        setActiveGuestSearch(id);
                        const tab = searchTabs.find((t) => t.id === id);
                        setMatchCount(tab?.matches.length ?? 0);
                        setOpenMatch(null);
                        savedScroll.current = null;
                      }}
                    />
                  </div>
                )}
                {persist && requestId && deskMatches.some((m) => m.decision === "REJECTED") && (
                  <label className="hire-hide-rejected">
                    <input
                      type="checkbox"
                      checked={hideRejected}
                      onChange={(e) => setHideRejected(e.target.checked)}
                    />
                    Hide rejected
                  </label>
                )}
                {deskGap && (
                  <p className="scout-gap">{deskGap}</p>
                )}
                {pending && (
                  <p className="hire-filter-bar__status">Updating results…</p>
                )}
                <MatchResults
                  desk
                  matches={visibleDeskMatches}
                  samples={deskSamples}
                  sampleDemand={{
                    spec,
                    requestId,
                    alreadyRecorded: alertWhenAvailable,
                  }}
                  cartCount={
                    persist ? resultsCartCount : readGuestCart().length
                  }
                  requestId={persist ? requestId : null}
                  onOpen={openFromList}
                  onDecision={(m, decision) => {
                    const userId =
                      m.candidateUserId ??
                      triageByRef[m.candidateRef]?.candidateUserId;
                    if (!persist || !requestId || !userId) return;
                    setTriageByRef((prev) => ({
                      ...prev,
                      [m.candidateRef]: {
                        candidateUserId: userId,
                        viewedAt: prev[m.candidateRef]?.viewedAt ?? m.viewedAt ?? null,
                        decision,
                        isNew: false,
                      },
                    }));
                    void setMatchDecisionAction({
                      requestId,
                      candidateUserId: userId,
                      decision,
                    }).then((res) => {
                      if (!res.ok) toast.error(res.message);
                    });
                  }}
                  selectedRef={openMatch?.candidateRef}
                />
                {persist && requestId && matchCount === 0 && (
                  <div className="hire-gap">
                    <GapReport
                      requestId={requestId}
                      overallGap={
                        deskGap?.trim() ||
                        "No verified matches in the published pool for this requirement yet. Your demand is saved."
                      }
                      alertWhenAvailable={alertWhenAvailable}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
          {!talked && (
            <div className="scout-empty">
              <button
                type="button"
                className="scout-pill"
                disabled={pending || (persist && !requestId)}
                onClick={() => runSearch()}
              >
                <Search className="size-3" />
                Search with what I have
              </button>
              <p>
                Answer the rest for a sharper ranking — I&apos;ll search
                when we have enough to go on.
              </p>
            </div>
          )}

          <div className="scout-thread">
              {messages.map((m, i) => {
                const isLastAsk =
                  askOpen && i === lastIndex && m.role === "assistant";
                return (
                  <Fragment key={`${m.role}-${i}`}>
                  <div
                    className={cn(
                      "scout-turn",
                      m.role === "user" && "scout-turn--user",
                    )}
                  >
                    {m.role === "assistant" && (
                      // `scout-mark--id` gives this the header's identity:
                      // same Sparkles, same solid orange plate. Plain
                      // `scout-mark` is the shared geometry, still used by the
                      // user's "You" chip and by the loader core.
                      <span className="scout-mark scout-mark--id">
                        <Sparkles className="size-3" />
                      </span>
                    )}
                    <div className="scout-turn__body">
                      <p
                        className={
                          m.role === "assistant"
                            ? "scout-ask__q"
                            : "scout-turn__text"
                        }
                      >
                        {m.content}
                      </p>
                      {isLastAsk && (chips.length > 0 || talked) && (
                        <div className="scout-follow">
                          {chips.length > 0 && (
                            <div className="scout-chips">
                              {chips.map((o, oi) => (
                                <button
                                  key={`${o.value}-${oi}`}
                                  type="button"
                                  className={cn(
                                    "scout-chip",
                                    o.value === "action:search" &&
                                      "scout-chip--show",
                                  )}
                                  disabled={pending}
                                  onClick={() => send(o.value, chipLabel(o))}
                                >
                                  {chipLabel(o)}
                                </button>
                              ))}
                            </div>
                          )}
                          {talked && !searched && (
                            <p className="scout-follow__hint">
                              Share more details about the candidate
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {m.role === "user" && (
                      <span className="scout-mark">You</span>
                    )}
                  </div>
                  </Fragment>
                );
              })}

              {pending && (
                <div className="scout-turn">
                  <ScoutLoader />
                  <p className="scout-turn__text scout-loader__label">
                    Looking through verified work…
                  </p>
                </div>
              )}
              {/* The workspace is on screen before the backend has answered —
                  the bar has already arrived. Card-shaped placeholders hold
                  the space the results will take, so they populate into it
                  rather than pushing the layout around. */}
              {pending && (
                <div className="hire-skeletons" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="hire-skel">
                      <div className="hire-skel__head">
                        <span className="hire-skel__avatar" />
                        <span className="hire-skel__lines">
                          <span className="hire-skel__line hire-skel__line--name" />
                          <span className="hire-skel__line hire-skel__line--meta" />
                        </span>
                      </div>
                      <div className="hire-skel__chips">
                        {[0, 1, 2, 3, 4].map((c) => (
                          <span key={c} className="hire-skel__chip" />
                        ))}
                      </div>
                      <span className="hire-skel__summary" />
                    </div>
                  ))}
                </div>
              )}
              <div ref={bottomRef} className="scout-thread__end" aria-hidden="true" />
            </div>
            </>
          )}
        </div>

        {openMatch && (
          <CandidateInspector
            // Keyed so each candidate opens at the top of the panel, on the
            // Overview tab, rather than wherever the last one was scrolled.
            key={openMatch.candidateRef}
            match={openMatch}
            decision={openDecision}
            onClose={closeMatchPanel}
            onPrev={
              openIndex > 0
                ? () => openFromList(panelList[openIndex - 1]!)
                : undefined
            }
            onNext={
              openIndex >= 0 && openIndex < panelList.length - 1
                ? () => openFromList(panelList[openIndex + 1]!)
                : undefined
            }
            onCartToggle={(inCart) =>
              setOpenMatch((m) => (m ? { ...m, shortlisted: inCart } : m))
            }
            onContactRevealed={() =>
              markContactRevealed(openMatch.candidateRef)
            }
          />
        )}

        {/* ONE slot either way, so the composer below keeps its position in
            the tree across the stage change — that is what keeps it the same
            DOM node, and what lets it travel instead of being re-created. */}
        <div className="scout-hero-slot">
          {hero ? (
            <RecruiterSearchTitle />
          ) : heroGhost?.title ? (
            <RecruiterSearchTitle leaving frozen={pinned(heroGhost.title)} />
          ) : null}
        </div>

        <form
          ref={composerRef}
          className="scout-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send(text);
            else runSearch(undefined, searched);
          }}
        >
          <div className="scout-composer__row">
            <div className="scout-field">
              <label className="sr-only" htmlFor="scout-prompt">
                Your answer to Scout
              </label>
              <textarea
                id="scout-prompt"
                ref={promptRef}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) send(text);
                    else runSearch(undefined, searched);
                  }
                }}
                placeholder="Type here...."
                disabled={pending}
                maxLength={2000}
              />
            </div>
            <button
              type="submit"
              disabled={pending || (persist && !requestId && !text.trim())}
              className="scout-send"
            >
              {/* An inline SVG, not the 500×500 search-glass.png this used to
                  crop down. That PNG is a hairline outline, and squeezing it
                  into a ~20px box anti-aliased the stroke away to nothing — the
                  icon still took its place in the flex row, so the label sat
                  right of the button's centre with no visible icon to explain
                  why. A stroked SVG keeps its weight at any size and inherits
                  the button's white `currentColor`. */}
              <Search className="scout-send__icon" aria-hidden="true" />
              {pending ? "Searching" : "Search"}
            </button>
          </div>
          {hero && (
          <div className="scout-criteria-slot is-open">
            <div className="scout-criteria-slot__clip">
              <ul
                className="scout-criteria"
                aria-label="Requirements"
                ref={criteriaRef}
              >
                {stripItems.map((c) => (
                  <li
                    key={c.key}
                    className={cn("scout-criterion", c.on && "is-on")}
                  >
                    {/* The tick is drawn for every item so the row does not
                        re-measure when one turns on; `.scout-criterion` already
                        carries the muted colour and `.is-on` the green. */}
                    <span className="scout-criterion__box" aria-hidden="true">
                      ✓
                    </span>
                    <span>{c.key}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          )}
        </form>

        <div className="scout-hero-slot scout-hero-slot--below">
          {hero ? (
            <RecruiterSearchSuggestions
              pending={pending}
              onPick={(query) => {
                setText(query);
                send(query);
              }}
            />
          ) : heroGhost?.below ? (
            <RecruiterSearchSuggestions
              pending
              onPick={() => {}}
              leaving
              frozen={pinned(heroGhost.below)}
            />
          ) : null}
        </div>
      </div>
      <HireFilterDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        spec={spec}
        pending={pending}
        onApply={applyFilters}
      />
    </section>
  );
}

function ScoutLoader() {
  return (
    <span className="scout-loader" aria-label="Scout is thinking">
      <span className="scout-loader__burst" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="scout-mark scout-loader__core">
        <Sparkles className="size-3" />
      </span>
    </span>
  );
}
