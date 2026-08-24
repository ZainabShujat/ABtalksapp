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
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Search,
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
import { CandidateInspector } from "@/components/hire/candidate-inspector";
import { GapReport } from "@/components/hire/gap-report";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import { readGuestCart } from "@/components/hire/guest-cart";
import { buildSampleCards } from "@/features/hire/sample-card";
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
  const [searched, setSearched] = useState(
    initialSearched || (results?.length ?? 0) > 0,
  );
  const [matchCount, setMatchCount] = useState<number | null>(
    results != null ? results.length : null,
  );
  const [searchTabs, setSearchTabs] = useState<GuestSearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openMatch, setOpenMatch] = useState<MatchCardData | null>(null);
  /** Cards sit under this message index so a later turn starts below them. */
  const [resultsPin, setResultsPin] = useState<number | null>(
    initialSearched || (results?.length ?? 0) > 0
      ? Math.max(0, (initialMessages.length || 1) - 1)
      : null,
  );
  const { setDesk, view, inspect, clearInspect } = useHireDesk();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

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
  const deskSamples =
    searched && deskMatches.length === 0 ? buildSampleCards(spec) : [];

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

  useEffect(() => {
    if (view === "pod") return;
    setDesk({
      step: searched ? 2 : 1,
      matchCount,
      gap: deskGap,
    });
  }, [searched, matchCount, deskGap, setDesk, view]);

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
    startTransition(async () => {
      if (persist) {
        const res = await runMatchAction({ requestId: requestId! });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        setSearched(true);
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

  const REQUIREMENT_ASK: Record<(typeof criteria)[number]["key"], string> = {
    Role: "Let's cover the role — what are you hiring for?",
    "Years of Experience": "What years of experience should they have?",
    Location: "Which city should they be in, or is remote fine?",
    "Education Qualification": "Do they need a degree?",
    Skills: "Which skills are must-haves?",
    Availability: "Remote, hybrid or onsite?",
    Compensation: "What's the budget for this role?",
    "Type of Employment": "Full-time, part-time, internship or contract?",
    "ABtalks Recommended": "Should we rank on ABTalks verified evidence first?",
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
  }

  return (
    <section className={cn("scout", expanded && "is-expanded")} aria-label="Scout assistant">
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
        </div>
      </div>

      <div className={cn("scout__body", openMatch && "is-open")}>
        <div ref={scrollRef} className="chat-output" id="hire-results">
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
                      <span className="scout-mark">
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
                  {searched && resultsPin === i && (
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
                          Contact stays hidden until you place a request and
                          the candidate agrees.
                        </p>
                      )}
                      {deskGap && (
                        <p className="scout-gap">{deskGap}</p>
                      )}
                      <MatchResults
                        desk
                        matches={deskMatches}
                        samples={deskSamples}
                        sampleDemand={{
                          spec,
                          requestId,
                          alreadyRecorded: alertWhenAvailable,
                        }}
                        cartCount={
                          persist ? resultsCartCount : readGuestCart().length
                        }
                        onOpen={setOpenMatch}
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
                  )}
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
              <div ref={bottomRef} className="scout-thread__end" aria-hidden="true" />
            </div>
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
                  else runSearch();
                }
              }}
              placeholder="Type your answer, or ask me anything..."
              disabled={pending}
              maxLength={2000}
            />
          </div>
          <button
            type="submit"
            disabled={pending || (persist && !requestId && !text.trim())}
            className="scout-send"
          >
            {pending ? "…" : "Search"}
          </button>
        </div>
        <ul className="scout-criteria" aria-label="Requirement checklist">
          {criteria.map((c) => (
            <li
              key={c.key}
              className={cn("scout-criterion", c.on && "is-on")}
            >
              <span className="scout-criterion__box" aria-hidden="true">
                ✓
              </span>
              <span>{c.key}</span>
            </li>
          ))}
        </ul>
      </form>
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
