"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Sparkles,
} from "lucide-react";
import { suggestChips } from "@/features/hire/scout-chips";
import { toast } from "sonner";
import {
  runMatchAction,
  sendScoutMessageAction,
} from "@/app/actions/hire-actions";
import {
  runGuestMatchAction,
  sendGuestScoutMessageAction,
} from "@/app/actions/hire-guest-actions";
import { MatchResults } from "@/components/hire/match-results";
import { DeskCardSkeleton } from "@/components/hire/desk-card-skeleton";
import { ScoutUnderstood } from "@/components/hire/scout-understood";
import { CandidateInspector } from "@/components/hire/candidate-inspector";
import { GapReport } from "@/components/hire/gap-report";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import { readGuestCart } from "@/components/hire/guest-cart";
import { buildSampleCards } from "@/features/hire/sample-card";
import { hasSufficientRealMatches } from "@/features/hire/match-config";
import {
  generateVirtualCandidate,
  virtualCandidateToCard,
} from "@/features/hire/virtual-candidate";
import { buildLockedPreviewCards } from "@/features/hire/locked-preview";
import type { MatchCardData } from "@/components/hire/match-card";
import { SearchTabs } from "@/components/hire/search-tabs";
import {
  appendGuestSearch,
  clearGuestMatches,
  labelGuestSearch,
  readGuestMatchCollection,
  setActiveGuestSearch,
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
  results?: MatchCardData[];
  resultsCartCount?: number;
  recent?: RecentRequest[];
  alertWhenAvailable?: boolean;
  /** True when this TalentRequest has already been searched. */
  initialSearched?: boolean;
  /** Server flag: fill an empty desk with blurred example profiles. */
  proPreview?: boolean;
  virtualCandidates?: boolean;
};

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

/**
 * Starting points, not answers.
 *
 * These are the five roles the opening turn used to offer as chips. As chips
 * they were a multiple-choice question; as examples they fill the composer and
 * wait to be edited, which is the difference between being asked and being
 * helped. Each one is a whole query, so it also teaches the input's range.
 */
const EXAMPLE_QUERIES = [
  "Backend engineer, Python, 2+ years",
  "AI engineer in Delhi, 3+ years",
];

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

/**
 * Status text while a search runs.
 *
 * These are timed, not reported: `runMatchAction` is a single call and exposes
 * no progress events. Each line is therefore something the call genuinely does
 * in every ordering — never a claim that a particular step has finished. The
 * timings only pace the reading; the last line holds until the call returns.
 */
const SEARCH_STAGES = [
  "Reading your requirement…",
  "Matching verified candidates…",
  "Ranking on evidence…",
] as const;
const SEARCH_STAGE_AT = [0, 900, 2100] as const;
const REPLY_LABEL = "Thinking it through…";

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

/** Juicebox-style: ticks go green as the recruiter types, not only after Scout stores the spec. */
function detectSpoken(raw: string) {
  const text = raw.toLowerCase();
  const role =
    /\b(backend|front-?end|full[-\s]?stack|data\s*\/?\s*ml|ai|ml|software|react|python|node|java|ios|android|mobile|devops|platform|cloud|security|qa|product)\b.{0,20}\b(engineer|developer|designer|scientist|analyst|manager|architect)\b/.test(
      text,
    ) ||
    /\b(hiring|need|looking\s+for|want|recruit)\b.{0,28}\b(engineer|developer|designer|scientist|analyst)\b/.test(
      text,
    );
  const experience =
    /\b\d{1,2}\s*(\+|plus)?\s*(yrs?|years?)\b/.test(text) ||
    /\b(fresher|entry[-\s]?level|junior|jr\.?|mid[-\s]?level|senior|sr\.?|staff|principal|lead|intern)\b/.test(
      text,
    );
  const location =
    /\b(delhi|ncr|mumbai|bangalore|bengaluru|hyderabad|chennai|pune|kolkata|gurgaon|gurugram|noida|india|remote|hybrid|onsite|on-site|wfh|work from home|anywhere)\b/.test(
      text,
    );
  const education =
    /\b(b\.?\s?tech|m\.?\s?tech|bca|mca|mba|bachelor|master|degree|diploma|graduate|iit|nit)\b/.test(
      text,
    );
  const skills =
    /\b(python|java|javascript|typescript|react|node|next\.?js|sql|postgres|mongodb|aws|docker|kubernetes|golang|go\b|rust|django|flask|spring|redis|graphql|html|css|tailwind|pytorch|tensorflow|langchain)\b/.test(
      text,
    );
  const availability =
    /\b(remote|hybrid|onsite|on-site|wfh|immediate|notice|available|full[-\s]?time|contract|intern(ship)?|part[-\s]?time)\b/.test(
      text,
    );
  const compensation =
    /\b(\d+(\.\d+)?\s*(-\s*\d+(\.\d+)?)?\s*(lpa|lakh|ctc)|salary|budget|₹|inr|compensation|stipend)\b/.test(
      text,
    );
  const abtalks =
    /\b(ab\s?talks?.{0,40}(recommend|verif|rank|approv|vett|certif|score)|platform[-\s]verified)\b/.test(
      text,
    );
  return {
    role,
    experience,
    location,
    education,
    skills,
    availability,
    compensation,
    abtalks,
  };
}

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
  alertWhenAvailable = false,
  initialSearched = false,
  proPreview = false,
  virtualCandidates = false,
}: Props) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string | null>(initialRequestId);
  const [messages, setMessages] = useState<Msg[]>(
    initialMessages.length ? initialMessages : [OPENING],
  );
  const [spec, setSpec] = useState<JobSpec>(initialSpec);
  const [summary, setSummary] = useState(initialSummary);
  const [readyToSearch, setReadyToSearch] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  /** Which kind of work `pending` covers — a one-line reply, or a full search. */
  const [phase, setPhase] = useState<"reply" | "search">("reply");
  const [stage, setStage] = useState(0);
  const [searched, setSearched] = useState(
    initialSearched || (results?.length ?? 0) > 0,
  );
  const [matchCount, setMatchCount] = useState<number | null>(
    results != null ? results.length : null,
  );
  const [searchTabs, setSearchTabs] = useState<GuestSearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** The full turn record, collapsed by default. Available, not in the way. */
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Ghost text sitting behind the cursor after a criterion is tapped.
   * `prefix` is the label written into the field; the hint clears the moment
   * what is typed stops being exactly that label.
   */
  const [hint, setHint] = useState<{ prefix: string; text: string } | null>(
    null,
  );
  /**
   * Once a search has run the card is folded to the query that produced it,
   * because the candidates are what the recruiter came for. `reopened` is
   * them asking for the full copilot back; scrolling into the list clears it.
   */
  const [reopened, setReopened] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  /** Folded unless the recruiter asked for the copilot back, or Scout is busy. */
  const condensed = searched && !reopened && !pending;
  const [expanded, setExpanded] = useState(false);
  const [openMatch, setOpenMatch] = useState<MatchCardData | null>(null);
  /** Cards sit under this message index so a later turn starts below them. */
  const [resultsPin, setResultsPin] = useState<number | null>(
    initialSearched || (results?.length ?? 0) > 0
      ? Math.max(0, (initialMessages.length || 1) - 1)
      : null,
  );
  /** Criteria keys already acknowledged once, so a tick animates only on the
   *  turn it actually goes green — not on every later re-render. */
  const seenCriteriaRef = useRef<Set<string>>(new Set());
  const [justOn, setJustOn] = useState<string[]>([]);
  const { setDesk, view, inspect, clearInspect } = useHireDesk();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);
  const reqMenuRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);
  const rows = specRows(spec);
  const activeSearch =
    searchTabs.find((t) => t.id === activeSearchId) ??
    searchTabs[searchTabs.length - 1] ??
    null;
  const guestMatches = activeSearch?.matches ?? [];
  const guestGap = activeSearch?.overallGap ?? null;
  const deskMatches =
    persist && (results?.length ?? 0) > 0 ? (results ?? []) : guestMatches;
  const deskGap = persist && (results?.length ?? 0) > 0 ? null : guestGap;
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
    setOpenMatch(inspect);
    clearInspect();
  }, [inspect, clearInspect]);

  /** Hoisted above the desk effect: the chrome needs it to lay itself out. */
  const talked = messages.some((m) => m.role === "user") || searched;

  useEffect(() => {
    if (view === "pod") return;
    setDesk({
      step: searched ? 2 : 1,
      // Once true this never goes back to false except through a desk reset,
      // so the workspace cannot flicker back to its landing layout mid-search.
      started: talked,
      matchCount,
      gap: deskGap,
    });
  }, [searched, talked, matchCount, deskGap, setDesk, view]);

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

  // ChatGPT-style: always land on the latest turn. Cards pin under the
  // search message so the next question is below them, not above.
  useEffect(() => {
    if (searched && resultsPin == null && messages.length > 0) {
      setResultsPin(messages.length - 1);
    }
  }, [searched, resultsPin, messages.length]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const frame = window.requestAnimationFrame(() => {
      root.scrollTo({
        top: root.scrollHeight,
        behavior: pending ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    messages.length,
    pending,
    searched,
    deskMatches.length,
    resultsPin,
    expanded,
    detailsOpen,
  ]);

  /**
   * Collapse and expand at a measured height.
   *
   * The card's parts are removed from layout when it folds, so there is no
   * intrinsic height to interpolate between. The previous height is kept and
   * replayed on the element for one transition, then handed back to the
   * stylesheet. Only a change of fold state animates, so ordinary reflows
   * inside the card (a new chip row, a longer line) are not caught up in it.
   */
  const foldHeightRef = useRef<number | null>(null);
  /** Height mid-flight when a transition is cut short by the next toggle. */
  const interruptedRef = useRef<number | null>(null);
  const wasCondensedRef = useRef(condensed);
  useLayoutEffect(() => {
    const el = shellRef.current;
    const changed = wasCondensedRef.current !== condensed;
    wasCondensedRef.current = condensed;
    if (!el || !searched) {
      foldHeightRef.current = null;
      return;
    }
    const to = el.offsetHeight;
    // Toggling again mid-transition should carry on from where the card
    // actually is, not from where the last one finished; otherwise it jumps to
    // the old resting height first and the movement reads as a stutter.
    const from = interruptedRef.current ?? foldHeightRef.current;
    interruptedRef.current = null;
    foldHeightRef.current = to;
    if (!changed || from == null || from === to) return;

    el.style.overflow = "hidden";
    el.style.height = `${from}px`;
    // Force the start height to be committed before the target is set.
    void el.offsetHeight;
    el.style.transition = "height var(--dur-state) var(--ease-slide)";
    el.style.height = `${to}px`;
    const done = () => {
      el.style.height = "";
      el.style.transition = "";
      el.style.overflow = "";
    };
    // transitionend bubbles. A chip or button inside the card finishing its own
    // 180ms hover would otherwise end the card's transition a third of the way
    // through, drop the inline height and snap the rest of the way. Only this
    // element's own height counts.
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el || e.propertyName !== "height") return;
      el.removeEventListener("transitionend", onEnd);
      done();
    };
    el.addEventListener("transitionend", onEnd);
    // A transition that never fires (interrupted by a tab switch, or a height
    // that resolves to the same value) must not leave the card pinned.
    const failsafe = window.setTimeout(done, 1600);
    return () => {
      window.clearTimeout(failsafe);
      el.removeEventListener("transitionend", onEnd);
      if (el.style.height) interruptedRef.current = el.offsetHeight;
      done();
    };
  }, [condensed, searched]);

  /**
   * Re-fold when the recruiter scrolls into the list.
   *
   * The fold is the default once a search has run, so this only undoes a
   * manual expand. It deliberately does not expand on the way back up: at the
   * top the results are what should be on screen, and a card that reopened by
   * itself was the reason half the viewport went back to being Scout.
   */
  useEffect(() => {
    if (!searched || !reopened) return;
    const region = shellRef.current?.closest(".hire-scout-region");
    if (!region) return;
    const onScroll = () => {
      if (region.scrollTop > 120) setReopened(false);
    };
    region.addEventListener("scroll", onScroll, { passive: true });
    return () => region.removeEventListener("scroll", onScroll);
  }, [searched, reopened]);

  // Contextual loading. The stage index only advances while a search is the
  // thing being waited on; a one-line reply keeps a single calm label.
  // The stage resets where the phase is set, not here — a setState in this
  // effect would just cascade a render for a value the caller already knows.
  useEffect(() => {
    if (!pending || phase !== "search") return;
    const timers = SEARCH_STAGE_AT.slice(1).map((at, i) =>
      window.setTimeout(() => setStage(i + 1), at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pending, phase]);

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

  /**
   * `label` is what the recruiter read on the chip, when that differs from the
   * value behind it ("Within 30 days" → "30"). It drives the bubble and what is
   * stored; the engine always parses `value`.
   */
  function send(value: string, label?: string) {
    const message = value.trim();
    if (!message || pending) return;
    if (message === "action:search") {
      runSearch();
      return;
    }

    const shown = label?.trim() || message;
    setMessages((m) => [...m, { role: "user", content: shown }]);
    setText("");
    setHint(null);
    setPhase("reply");
    setStage(0);
    startTransition(async () => {
      if (persist) {
        const res = await sendScoutMessageAction({
          requestId: requestId ?? undefined,
          message,
          display: shown === message ? undefined : shown,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        setRequestId(res.data.requestId);
        setSpec(res.data.spec);
        setSummary(res.data.summary);
        setReadyToSearch(res.data.readyToSearch);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: res.data.assistantMessage,
            options: res.data.options,
          },
        ]);
        // Search on this turn BEFORE navigating. replace() unmounts this
        // chat; if we kicked search off after it, the first brief never
        // wrote matches and the new page said "No matches yet".
        if (res.data.action === "search") {
          setPhase("search");
          setStage(0);
          const match = await runMatchAction({
            requestId: res.data.requestId,
          });
          if (!match.ok) {
            toast.error(match.message);
          } else {
            setSearched(true);
            setMatchCount(match.data.matchCount);
            setMessages((m) => {
              const next: Msg[] = [
                ...m,
                { role: "assistant", content: match.data.overallGap },
              ];
              setResultsPin(next.length - 1);
              return next;
            });
          }
        }
        if (!requestId) router.replace(`/hire/${res.data.requestId}`);
        else if (res.data.action === "search") router.refresh();
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
      // Same rule as the signed-in path: the engine says when to search.
      if (res.data.action === "search") {
        runSearch(res.data.spec);
      }
    });
  }

  function runSearch(overrideSpec?: JobSpec) {
    if (persist && !requestId) {
      toast.error("Answer at least one question first.");
      return;
    }
    const active = overrideSpec ?? spec;
    setPhase("search");
    setStage(0);
    startTransition(async () => {
      if (persist) {
        const res = await runMatchAction({ requestId: requestId! });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        setSearched(true);
        setReopened(false);
        setMatchCount(res.data.matchCount);
        setMessages((m) => {
          const next: Msg[] = [
            ...m,
            { role: "assistant", content: res.data.overallGap },
          ];
          setResultsPin(next.length - 1);
          return next;
        });
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
      const tab = appendGuestSearch({
        label: labelGuestSearch(active, cards.length),
        title: active.title?.trim() || "your requirement",
        overallGap: res.data.overallGap,
        matches: cards,
      });
      setSearchTabs(readGuestMatchCollection().tabs);
      setActiveSearchId(tab.id);
      setSearched(true);
      setMatchCount(cards.length);
      setMessages((m) => {
        const next: Msg[] = [
          ...m,
          { role: "assistant", content: res.data.overallGap },
        ];
        setResultsPin(next.length - 1);
        writeGuestSession({
          spec: active,
          messages: next,
          summary,
          readyToSearch: true,
          searched: true,
        });
        return next;
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
  /**
   * The one Scout line that is still live.
   *
   * The thread is no longer the interface, so only the newest assistant turn is
   * on screen — as interpretation of the query, above the workspace. Everything
   * else is intact in `messages`, behind the history disclosure, and is still
   * sent to the agent as context.
   */
  const lede =
    [...messages].reverse().find((m) => m.role === "assistant") ?? null;
  /**
   * The transcript, minus the turn nobody saw.
   *
   * `OPENING` seeds `messages` so the agent has an opening line in its context,
   * but the workspace never renders it — showing it in the history put a
   * question at the top that the recruiter was never asked and did not answer.
   */
  const transcript = messages.filter(
    (m, i) => !(i === 0 && m.role === "assistant" && m.content === OPENING.content),
  );
  /**
   * Everything before the line currently on screen.
   *
   * The disclosure counts and shows only these, and sits above the latest
   * message rather than under it: what is folded away happened *before* what
   * you are reading, so that is where the reader expects the handle to be.
   */
  const priorTurns = lede ? transcript.filter((m) => m !== lede) : transcript;
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
  const spoken = detectSpoken(
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
    // Only where the strip still scrolls — the phone breakpoint. Once it wraps
    // every criterion is already visible, and scrolling a non-scrolling list
    // just nudges the page under someone who is typing.
    if (list.scrollWidth <= list.clientWidth) return;
    const ticked = list.querySelectorAll<HTMLLIElement>(".scout-criterion.is-on");
    const last = ticked[ticked.length - 1];
    if (!last) return;
    last.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [tickSignature]);

  /**
   * Play the acknowledgement, once, on the tick that just landed.
   *
   * The strip renders only met criteria, so a newly detected requirement mounts
   * already green and the neutral→green moment is never seen. Marking just the
   * newly-on keys replays it from grey — which is the whole point of ticking as
   * the recruiter types rather than after the turn is parsed.
   */
  const onKeys = criteria
    .filter((c) => c.on)
    .map((c) => c.key)
    .join("|");
  useEffect(() => {
    const keys = onKeys ? onKeys.split("|") : [];
    const fresh = keys.filter((k) => !seenCriteriaRef.current.has(k));
    if (fresh.length === 0) return;
    fresh.forEach((k) => seenCriteriaRef.current.add(k));
    setJustOn(fresh);
    const timer = window.setTimeout(() => setJustOn([]), 420);
    return () => window.clearTimeout(timer);
  }, [onKeys]);

  /**
   * What a value for this criterion tends to look like.
   *
   * Tapping a criterion no longer sends anything. It writes "Role: " into the
   * composer and shows one of these behind the cursor, so the recruiter answers
   * in their own words in the one field they were already using. The typed
   * result is an ordinary free-text message, which is what the agent has always
   * parsed best.
   */
  const REQUIREMENT_HINT: Record<(typeof criteria)[number]["key"], string> = {
    Role: "UI/UX designer, backend engineer, data analyst…",
    "Years of Experience": "3+ years, fresher, senior…",
    Location: "Bangalore, Delhi NCR, remote…",
    "Education Qualification": "B.Tech, MCA, no degree needed…",
    Skills: "Python, React, PyTorch…",
    Availability: "remote, hybrid, immediate joiner…",
    Compensation: "12 to 18 LPA, 40k per month…",
    "Type of Employment": "full-time, internship, contract…",
    "ABtalks Recommended": "rank on verified project quality…",
  };

  const EMP_FILTERS = [
    { label: "All", value: "All" as const, prompt: "Any employment type is fine." },
    { label: "Full-time", value: "FULL_TIME" as const, prompt: "This is a full-time role." },
    { label: "Part-time", value: "PART_TIME" as const, prompt: "This is a part-time role." },
    { label: "Internship", value: "INTERNSHIP" as const, prompt: "This is an internship." },
    { label: "Contract", value: "CONTRACT" as const, prompt: "This is a contract role." },
  ];

  function pickRequirement(key: (typeof criteria)[number]["key"], already: boolean) {
    setDetailsOpen(false);
    if (already || pending) return;
    const prefix = `${key}: `;
    setText(prefix);
    setHint({ prefix, text: REQUIREMENT_HINT[key] });
    const field = promptRef.current;
    if (field) {
      field.focus();
      // Caret after the label, not before it.
      requestAnimationFrame(() =>
        field.setSelectionRange(prefix.length, prefix.length),
      );
    }
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

  /** Load an example into the composer. Deliberately does not send. */
  function applyExample(query: string) {
    setText(query);
    promptRef.current?.focus();
  }

  function resetDesk() {
    if (requestId) {
      router.push("/hire");
      return;
    }
    clearGuestSession();
    clearGuestMatches();
    setMessages([OPENING]);
    setSpec({});
    setSummary("Not started");
    setReadyToSearch(false);
    setSearched(false);
    setMatchCount(null);
    setSearchTabs([]);
    setActiveSearchId("");
    setText("");
    setDetailsOpen(false);
    setOpenMatch(null);
    setHint(null);
  }

  // The strip shows all nine criteria from the first render, muted until each
  // one is captured.
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
  const stripItems = criteria;
  /**
   * The strip appears when there is something to interpret.
   *
   * On an untouched desk it is nine grey labels under an empty field, which
   * says nothing and pushes the composer off centre. It opens on the first
   * keystroke, which is also the first moment it can be right, and once
   * anything has been captured it stays open so the row never flickers
   * between turns.
   */
  const stripOpen = text.trim().length > 0 || criteria.some((c) => c.on);

  /** What the recruiter actually asked for, to show on the folded card. */
  const lastAsk = [...messages].reverse().find((m) => m.role === "user");
  const queryLabel = lastAsk?.content.trim() || summary || "your search";

  const loadingLabel =
    phase === "search"
      ? (SEARCH_STAGES[Math.min(stage, SEARCH_STAGES.length - 1)] as string)
      : REPLY_LABEL;

  return (
    <>
      <section
      className={cn(
        "scout",
        expanded && "is-expanded",
        // Landing: the query is the page. The composer leaves the bottom of
        // the card and centres with the heading, and Scout's identity drops
        // back to a line of text. Everything else about the desk is unchanged.
        !talked && "is-landing",
        // Once results exist Scout stops being the page and becomes the bar
        // above it: fixed height, stuck to the top, still fully conversational.
        searched && "is-compact",
        condensed && "is-condensed",
      )}
      ref={shellRef}
      aria-label="Scout assistant"
    >

      {/* Folded: the search, not the conversation. Tapping it brings the whole
          copilot back without moving the results underneath. */}
      {searched && (
        <button
          type="button"
          className="scout__folded"
          hidden={!condensed}
          onClick={() => setReopened(true)}
        >
          <span className="scout-mark scout-mark--id" aria-hidden="true">
            <Sparkles className="size-3" />
          </span>
          <span className="scout__folded-q">{queryLabel}</span>
          {matchCount != null && (
            <span className="scout__folded-meta">
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </span>
          )}
          <ChevronDown className="size-4 scout__folded-caret" aria-hidden="true" />
        </button>
      )}
      <div className="scout__bar">
        <div className="scout__id">
          <span className="scout__avatar" aria-hidden="true">
            <Sparkles className="size-4" />
          </span>
          <div className="scout__meta">
            <span className="scout__name">Scout</span>
            <span className="scout__status">
              {summary || "Not started"}
            </span>
          </div>
        </div>
        <div className="scout__tools">
          <button type="button" className="scout-tbtn" onClick={resetDesk}>
            New search
          </button>
          <div className="hire-req" ref={reqMenuRef}>
            <button
              type="button"
              className="scout-tbtn"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((o) => !o)}
            >
              Requirement
              <ChevronDown
                className={cn("size-3.5", detailsOpen && "rotate-180")}
              />
            </button>
            {detailsOpen && (
              <div className="hire-req__menu" role="menu">
                <p className="hire-req__label">Requirement</p>
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
          {/* The same corner button, reversed once results exist.
              Full screen is the right offer while Scout is the page; once the
              candidates are the page it would cover the very list it sits
              above, so it folds the card down to the query instead, which is
              the gesture that actually matters there. */}
          {searched ? (
            <button
              type="button"
              className="scout-tbtn scout-tbtn--icon"
              aria-label="Collapse Scout to the search bar"
              title="Collapse"
              onClick={() => setReopened(false)}
            >
              <Minimize2 className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              className={cn("scout-tbtn scout-tbtn--icon", expanded && "is-on")}
              aria-label={expanded ? "Exit full screen" : "Expand Scout"}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className={cn("scout__body", openMatch && "is-open")}>
        <div ref={scrollRef} className="chat-output" id="hire-results">
          {!talked && (
            <div className="scout-hero">
              <h2 className="scout-hero__h">Who are you hiring?</h2>
            </div>
          )}

          {/* Scout's latest line reads as interpretation of the query, not as
              a message in a thread. It keeps every ability it had — asking for
              something missing included — but an ask arrives as guidance above
              the workspace rather than as a question the recruiter owes an
              answer to. */}
          {talked && lede && (
            <div className="scout-lede">
              {priorTurns.length > 0 && (
                <div className="scout-lede__prior">
                  <button
                    type="button"
                    className="scout-history__toggle"
                    aria-expanded={historyOpen}
                    onClick={() => setHistoryOpen((o) => !o)}
                  >
                    <ChevronDown
                      className={cn("size-3.5", historyOpen && "rotate-180")}
                    />
                    {historyOpen
                      ? "Hide conversation"
                      : `Conversation (${priorTurns.length})`}
                  </button>
                  {historyOpen && (
                    <ol
                      className="scout-history"
                      aria-label="Earlier in this conversation"
                    >
                      {priorTurns.map((m, i) => (
                        <li
                          key={`${m.role}-${i}`}
                          className={cn(
                            "scout-history__row",
                            m.role === "user" && "is-user",
                          )}
                        >
                          <span className="scout-history__who">
                            {m.role === "user" ? "You" : "Scout"}
                          </span>
                          <p className="scout-history__text">{m.content}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              <div className="scout-lede__row">
                <span className="scout-mark scout-mark--id" aria-hidden="true">
                  <Sparkles className="size-3" />
                </span>
                <div className="scout-lede__body">
                  <p className="scout-lede__text">{lede.content}</p>
                  {askOpen && chips.length > 0 && (
                    <div className="scout-chips">
                      {chips.map((o, oi) => (
                        <button
                          key={`${o.value}-${oi}`}
                          type="button"
                          className={cn(
                            "scout-chip",
                            o.value === "action:search" && "scout-chip--show",
                          )}
                          disabled={pending}
                          onClick={() => send(o.value, chipLabel(o))}
                        >
                          {chipLabel(o)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}


          <div
            ref={bottomRef}
            className="scout-thread__end"
            aria-hidden="true"
          />
        </div>

      </div>

      <form
        className="scout-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text);
          else runSearch();
        }}
      >
        <div className="scout-composer__row">
          <div className="scout-field">
            <label className="sr-only" htmlFor="scout-prompt">
              Describe who you are hiring
            </label>
            <div className="scout-field__box">
            {hint && text === hint.prefix && (
              /* Mirrors the textarea's own metrics so the hint lands exactly
                 where the next character will. The typed label is repeated
                 transparently to push the hint along; only the grey half is
                 ever seen. */
              <span className="scout-ghost" aria-hidden="true">
                <span className="scout-ghost__typed">{text}</span>
                <span className="scout-ghost__hint">{hint.text}</span>
              </span>
            )}
            <textarea
              id="scout-prompt"
              ref={promptRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (hint && e.target.value !== hint.prefix) setHint(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim()) send(text);
                  else runSearch();
                }
              }}
              /* No placeholder by request — the field reads empty. The
                 accessible name comes from aria-label below, so screen readers
                 still get one. */
              placeholder=""
              disabled={pending}
              maxLength={2000}
            />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending || (persist && !requestId && !text.trim())}
            className="scout-send"
          >
            {pending ? "…" : "Search"}
          </button>
        </div>
          {/* Suggestions sit under the field, not above it: anything above
              pushes the composer off the optical centre, and an example is
              only useful once you have seen where it lands. */}
          {!talked && (
            <ul className="scout-hero__examples" aria-label="Example searches">
              {EXAMPLE_QUERIES.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    className="scout-example"
                    onClick={() => applyExample(q)}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          )}

        <div className={cn("scout-criteria-slot", stripOpen && "is-open")}>
          <div className="scout-criteria-slot__clip">
            <ul
              className="scout-criteria"
              aria-label="Requirements"
              ref={criteriaRef}
            >
              {stripItems.map((c) => (
                <li
                  key={c.key}
                  className={cn(
                    "scout-criterion",
                    c.on && "is-on",
                    justOn.includes(c.key) && "is-fresh",
                  )}
                >
                  {/* The tick is drawn for every item so the row does not
                      re-measure when one turns on; `.scout-criterion` already
                      carries the muted colour and `.is-on` the green.

                      An unset one is also a button: it is a refinement the
                      recruiter may take, not a question they owe an answer
                      to. It routes through the same `pickRequirement` the
                      Requirement menu uses, so the agent protocol is
                      untouched. */}
                  {c.on ? (
                    <>
                      <span
                        className="scout-criterion__box"
                        aria-hidden="true"
                      >
                        &#10003;
                      </span>
                      <span>{c.key}</span>
                      <span className="sr-only">, captured</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="scout-criterion__add"
                      disabled={pending}
                      onClick={() => pickRequirement(c.key, false)}
                    >
                      <span
                        className="scout-criterion__box"
                        aria-hidden="true"
                      >
                        &#10003;
                      </span>
                      <span>{c.key}</span>
                      <span className="sr-only">
                        {" "}
                       , not set. Add it to sharpen the ranking.
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </form>
    </section>

      {/* The results are the page, not a panel inside the chat.
          They live beside the Scout card rather than in it, so the region
          scrolls through candidates while the card stays put at the top.
          Nothing about the cards, the ranking or the actions changed; only
          which element they hang off. */}
      {(searched || openMatch) && (
        <div className={cn("scout-results-page", openMatch && "is-open")}>
          <div className="scout-results-page__list">
        {searched && (
          <div className="scout-thread__results">
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
                  }}
                />
              </div>
            )}
            {deskMatches.length > 0 && (
              <p className="scout-privacy">
                Contact stays hidden until you place a request and the
                candidate agrees.
              </p>
            )}
            {/* The lede already carries this sentence when it is the newest
                turn; printing it twice reads as the interface stuttering. */}
            {deskGap && deskGap !== lede?.content && (
              <p className="scout-gap">{deskGap}</p>
            )}
            {pending && phase === "search" ? (
              <DeskCardSkeleton
                count={Math.min(2, Math.max(1, matchCount ?? 2))}
              />
            ) : (
              <MatchResults
                desk
                matches={deskMatches}
                samples={deskSamples}
                sampleDemand={{
                  spec,
                  requestId,
                  alreadyRecorded: alertWhenAvailable,
                }}
                cartCount={persist ? resultsCartCount : readGuestCart().length}
                onOpen={setOpenMatch}
                selectedRef={openMatch?.candidateRef}
              />
            )}
            {/* A search that returns nobody and cannot describe a sample
                either, because the brief has no role and no stack, would
                otherwise leave the results area completely blank. */}
            {!pending &&
              deskMatches.length === 0 &&
              deskSamples.length === 0 && (
                <p className="scout-noresults">
                  Nothing to rank yet. Add a role or a skill above and search
                  again.
                </p>
              )}
            {persist && requestId && matchCount === 0 && !pending && (
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
        )}

        {pending && phase === "search" && rows.length > 0 && (
          <ScoutUnderstood rows={rows} onEdit={() => setDetailsOpen(true)} />
        )}

        {pending && (
          <div className="scout-turn">
            <ScoutLoader />
            <p
              key={loadingLabel}
              className="scout-turn__text scout-loader__label"
            >
              {loadingLabel}
            </p>
          </div>
        )}
          </div>
        {openMatch && (
          <CandidateInspector
            match={openMatch}
            onClose={() => setOpenMatch(null)}
            onCartToggle={(inCart) =>
              setOpenMatch((m) => (m ? { ...m, shortlisted: inCart } : m))
            }
          />
        )}
        </div>
      )}
    </>
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
