"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Award,
  Check,
  CircleMinus,
  Copy,
  Gauge,
  Lock,
  Mail,
  Phone,
  Send,
  Tag,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  NO_VERIFIED_EVIDENCE,
  recruiterRoleLabel,
  recruiterSummary,
  summaryInputFromMatch,
  trackLongLabel,
  verifiedEvidenceSentence,
} from "@/features/hire/candidate-summary";
import { isLockedPreview } from "@/features/hire/locked-preview";
import {
  LockedField,
  UpgradeNotice,
  useUpgradePrompt,
} from "@/components/hire/locked-field";
import { COMPENSATION_DISCLAIMER } from "@/features/hire/compensation";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import {
  evidenceResumeHref,
  rememberEvidence,
} from "@/components/hire/evidence-cache";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { AddToPipelineButton } from "@/components/hire/pipeline/add-to-pipeline-button";
import { PanelResizer } from "@/components/hire/panel-resizer";
import { HireScoreChart } from "@/components/hire/hire-score-chart";
import {
  buildCardPills,
  OpenToWorkBadge,
} from "@/components/hire/hire-card-facts";
import type { MatchCardData, MatchDecision } from "@/components/hire/match-card";
import { cn } from "@/lib/utils";
import { MaskedName } from "@/components/hire/desk-match-card";
import { UnlockContactDialog } from "@/components/hire/unlock-contact-dialog";
import { OutreachComposeDialog } from "@/components/hire/outreach-compose-dialog";
import { revealContactAction } from "@/app/actions/hire-unlock-actions";
import {
  loadInspectorExternalLinksAction,
  loadInspectorSkillEvidenceAction,
  loadInspectorTrackEvidenceAction,
  loadInspectorWorkHistoryAction,
  type InspectorSkillEvidenceItem,
  type InspectorTrackEvidence,
  type InspectorWorkHistory,
} from "@/app/actions/hire-view-actions";
import type { SelfReportedExternalLink } from "@/features/hire/self-reported-links";
import type { RevealedContact } from "@/features/hire/unlock-contact";

const WORK_MODE: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

/**
 * The panel's tabs jump to sections of one scroll, as in the design.
 *
 * ABTalks Evidence leads. It is the only thing on this panel a CV cannot claim,
 * and it used to open below a Status / AB score / Email / Phone / Tags block
 * that told a recruiter nothing they had not already read on the card. Contact
 * and status are still here: View expands the rows; Reveal buys the values.
 */
const TABS = [
  { id: "evidence", label: "ABTalks Evidence" },
  { id: "contact", label: "Contact" },
  { id: "experience", label: "Experience" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
] as const;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthYear(month: number | null, year: number | null): string {
  if (!year) return "";
  const name = month && month >= 1 && month <= 12 ? MONTH_SHORT[month - 1] : "";
  return name ? `${name} ${year}` : String(year);
}

function jobSpan(row: InspectorWorkHistory["rows"][number]): string {
  const from = monthYear(row.startMonth, row.startYear);
  const to = row.isCurrent ? "Present" : monthYear(row.endMonth, row.endYear);
  if (!from && !to) return "";
  return from && to ? `${from} – ${to}` : from || to;
}

function monthYearFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return monthYear(d.getUTCMonth() + 1, d.getUTCFullYear());
}

type TabId = (typeof TABS)[number]["id"];

/**
 * Whether this viewer asked the OS to reduce motion.
 *
 * Read at click time rather than during render: it is a live browser query, so
 * calling it in the render body would be impure and would also miss the user
 * changing the setting mid-session. Guarded for the server pass, where there
 * is no `window` and the value is never needed.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** http(s) LinkedIn URLs only — unlocked contact is still untrusted input. */
function safeLinkedinHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Declared coding-profile URLs from the server — still untrusted for href. */
function safeExternalProfileHref(
  provider: SelfReportedExternalLink["provider"],
  url: string,
): string | null {
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url.trim())
      ? url.trim()
      : `https://${url.trim()}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (provider === "GITHUB") {
      if (host !== "github.com" && host !== "www.github.com") return null;
    } else if (provider === "LEETCODE") {
      if (host !== "leetcode.com" && host !== "www.leetcode.com") return null;
    } else if (provider === "CODECHEF") {
      if (host !== "codechef.com" && host !== "www.codechef.com") return null;
    } else {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function LinkedInMark({
  href,
  locked,
  candidateRef,
  candidateLabel,
  onUnlocked,
}: {
  href: string | null;
  locked: boolean;
  candidateRef: string;
  candidateLabel: string;
  onUnlocked: () => void;
}) {
  if (href) {
    return (
      <span className="hire-profile__in-wrap">
        <a
          className="hire-profile__in"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open LinkedIn profile (self-reported)"
        >
          in
        </a>
        <span className="hire-profile__self-reported">SELF-REPORTED</span>
      </span>
    );
  }
  if (locked) {
    return (
      <UnlockContactDialog
        candidateRef={candidateRef}
        candidateLabel={candidateLabel}
        onUnlocked={onUnlocked}
        className="hire-profile__in"
        triggerLabel="in"
        triggerAriaLabel="Unlock contact to open LinkedIn"
        triggerTitle="LinkedIn connected"
      />
    );
  }
  return (
    <span className="hire-profile__in" title="LinkedIn connected">
      in
    </span>
  );
}

const DECISION_LABEL: Record<MatchDecision, string | null> = {
  SHORTLISTED: "Shortlisted",
  REJECTED: "Rejected",
  UNDECIDED: null,
};

/** Letters for a logo tile: "US cohort" → "UC", "Hackathon" → "HA". */
function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : label.trim().slice(0, 2);
  return letters.toUpperCase();
}

type Role = { key?: string; title: string; value: ReactNode; badge?: string; note?: string };

/**
 * The candidate profile panel (Figma 1585:189).
 *
 * Experience is the candidate's own jobs (`CandidateExperience`, typed or
 * resume-merged), loaded on open. ABTalks Evidence is completed tracks and
 * hackathon placements, also loaded on open. Education is
 * the declared level. Contact values are behind the paid unlock (T-229):
 * "View Contact Details" only expands the section; "Reveal email" /
 * "Reveal number" open the unlock dialog, which states the cost before
 * charging. Resume uses the same credit unlock — billing is not enabled, so
 * the plans dialog must not be the gate.
 */
export function CandidateInspector({
  match,
  onClose,
  onCartToggle,
  onPrev,
  onNext,
  onContactRevealed,
  decision = null,
}: {
  match: MatchCardData;
  onClose: () => void;
  onCartToggle?: (inCart: boolean) => void;
  /** The panel's arrows walk the result list; absent at either end. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Fired once this recruiter's CONTACT_SHARED contact payload is in hand. */
  onContactRevealed?: () => void;
  /** Project triage state, when this candidate sits in a talent project. */
  decision?: MatchDecision | null;
}) {
  const e = match.evidence ?? {};
  const years =
    typeof e.yearsExperience === "number" && e.yearsExperience > 0
      ? e.yearsExperience
      : null;
  const roleLabel = recruiterRoleLabel({
    jobRole: match.jobRole,
    yearsExperience: years,
  });
  // What a dialog may print when it has to name this candidate. Never the
  // `AB-####` reference: it is a hash of an internal id, it is not something a
  // recruiter can act on, and it is no longer shown anywhere on search.
  const contactLabel = match.displayName?.trim() || roleLabel;
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const preview = isLockedPreview(match) ? match.preview : null;
  const { upgradeOpen, openUpgrade, dismissUpgrade } = useUpgradePrompt();
  const track = trackLongLabel(match.source);
  const skills = e.skills ?? [];
  const languages = e.workingLanguages ?? [];
  const workMode = e.workMode ? (WORK_MODE[e.workMode] ?? e.workMode) : null;
  const tierLabel =
    match.tier === "STRONG"
      ? "Recommended"
      : match.tier && match.tier !== "NONE"
        ? match.tier.charAt(0) + match.tier.slice(1).toLowerCase()
        : null;
  const tags = buildCardPills(match, 12).filter(
    (pill) => !pill.key.startsWith("skill:"),
  );
  const status = decision ? DECISION_LABEL[decision] : null;
  const resumeHref = evidenceResumeHref(match.candidateRef);
  const [tab, setTab] = useState<TabId>("evidence");
  const scrollRef = useRef<HTMLDivElement>(null);

  const [contact, setContact] = useState<RevealedContact | null>(null);
  /** Free expand only — does not unlock. Cleared when the candidate changes. */
  const [contactOpen, setContactOpen] = useState(false);
  const onContactRevealedRef = useRef(onContactRevealed);
  onContactRevealedRef.current = onContactRevealed;

  function applyContact(found: RevealedContact | null) {
    setContact(found);
    if (found) onContactRevealedRef.current?.();
  }
  const [workHistory, setWorkHistory] = useState<InspectorWorkHistory | null>(
    null,
  );
  const [externalLinks, setExternalLinks] = useState<
    SelfReportedExternalLink[] | null
  >(null);
  const [trackEvidence, setTrackEvidence] =
    useState<InspectorTrackEvidence | null>(null);
  const [verifiedSkills, setVerifiedSkills] = useState<
    InspectorSkillEvidenceItem[] | null
  >(null);

  useEffect(() => {
    rememberEvidence([match]);
  }, [match]);

  // What this recruiter has already paid for. `revealContactAction` returns
  // null unless a CONTACT_SHARED row exists, so it reveals nothing on its own.
  // The `alive` flag stops a slow answer for the previous candidate landing on
  // the one now open.
  useEffect(() => {
    let alive = true;
    setContactOpen(false);
    void (async () => {
      const found = sample
        ? null
        : await revealContactAction({ candidateRef: match.candidateRef });
      if (alive) applyContact(found);
    })();
    return () => {
      alive = false;
    };
  }, [match.candidateRef, sample]);

  useEffect(() => {
    let alive = true;
    if (sample) {
      setWorkHistory({ hasNoWorkExperience: false, rows: [] });
      setExternalLinks([]);
      setTrackEvidence({ items: [] });
      setVerifiedSkills([]);
      return () => {
        alive = false;
      };
    }
    setWorkHistory(null);
    setExternalLinks(null);
    setTrackEvidence(null);
    setVerifiedSkills(null);
    void (async () => {
      const [historyResult, linksResult, evidenceResult, skillEvidenceResult] = await Promise.all([
        loadInspectorWorkHistoryAction({
          candidateRef: match.candidateRef,
        }),
        loadInspectorExternalLinksAction({
          candidateRef: match.candidateRef,
        }),
        loadInspectorTrackEvidenceAction({
          candidateRef: match.candidateRef,
        }),
        loadInspectorSkillEvidenceAction({
          candidateRef: match.candidateRef,
        }),
      ]);
      if (!alive) return;
      setWorkHistory(
        historyResult.ok
          ? historyResult.data
          : { hasNoWorkExperience: false, rows: [] },
      );
      setExternalLinks(linksResult.ok ? linksResult.data.links : []);
      setTrackEvidence(
        evidenceResult.ok ? evidenceResult.data : { items: [] },
      );
      setVerifiedSkills(
        skillEvidenceResult.ok ? skillEvidenceResult.data.skills : [],
      );
    })();
    return () => {
      alive = false;
    };
  }, [match.candidateRef, sample]);

  async function loadContact() {
    applyContact(
      await revealContactAction({ candidateRef: match.candidateRef }),
    );
  }

  // A click sets the tab AND suppresses the spy for the length of the smooth
  // scroll. Without this the animation sweeps through every section between
  // here and the target, and the spy would repaint the active tab two or three
  // times on the way — the nav would flicker on its own click.
  const jumpingRef = useRef(false);
  const jumpTimerRef = useRef<number | undefined>(undefined);

  function jump(id: TabId) {
    setTab(id);
    jumpingRef.current = true;
    window.clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = window.setTimeout(() => {
      jumpingRef.current = false;
    }, 700);
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-section="${id}"]`)
      ?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
  }

  useEffect(() => () => window.clearTimeout(jumpTimerRef.current), []);

  // On a narrow panel the tab strip scrolls sideways, so the active tab (set by
  // a click or by the scroll-spy below) is brought to the middle of the strip.
  // `scrollTo` on the strip itself: `scrollIntoView` would also move the
  // panel's vertical scroll and fight the spy.
  const tabsRef = useRef<HTMLElement>(null);

  // Phones: once the name has scrolled out of the panel, a compact copy rides
  // above the tabs so the recruiter always knows whose profile they are in.
  const nameRef = useRef<HTMLHeadingElement>(null);
  const [nameStuck, setNameStuck] = useState(false);
  useEffect(() => {
    const root = scrollRef.current;
    const heading = nameRef.current;
    if (!root || !heading) return;
    const check = () => {
      setNameStuck(
        heading.getBoundingClientRect().bottom <
          root.getBoundingClientRect().top + 4,
      );
    };
    root.addEventListener("scroll", check, { passive: true });
    check();
    return () => root.removeEventListener("scroll", check);
  }, []);
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>(".hire-profile__tab.is-active");
    if (!active) return;
    strip.scrollTo({
      left: active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [tab]);

  // Scroll-spy: the tabs follow the scroll, not just drive it.
  //
  // A scroll listener over `getBoundingClientRect`, NOT an IntersectionObserver.
  // `.hire-app--results` carries `zoom: var(--hire-zoom)` to fit the design
  // frame to the viewport, and inside a zoomed subtree Chromium's
  // IntersectionObserver never fires for a non-viewport `root` — verified here:
  // an observer rooted on this panel reported no entries at all, not even the
  // initial callback. `getBoundingClientRect` is zoom-correct, so the spy reads
  // positions directly.
  //
  // The active section is the LAST anchor whose top has passed the reading
  // line a quarter of the way down the panel. That keeps the final section
  // reachable: at the bottom of the scroll several anchors sit above the line
  // at once, and taking the last of them is the one actually being read.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    let frame = 0;

    const measure = () => {
      frame = 0;
      // A click's smooth scroll owns the tab until it settles.
      if (jumpingRef.current) return;
      const anchors = Array.from(
        root.querySelectorAll<HTMLElement>("[data-section]"),
      );
      if (anchors.length === 0) return;

      // Both halves from the same rect. `clientHeight` reports unzoomed CSS
      // pixels while `getBoundingClientRect()` reports painted ones, so mixing
      // the two puts the reading line in the wrong place under the desk zoom.
      const rootRect = root.getBoundingClientRect();
      const line = rootRect.top + rootRect.height * 0.25;

      let current = anchors[0]!.dataset.section;
      for (const el of anchors) {
        if (el.getBoundingClientRect().top <= line) current = el.dataset.section;
        else break;
      }
      if (current) {
        setTab((prev) => (prev === current ? prev : (current as TabId)));
      }
    };

    const onScroll = () => {
      // One measurement per frame, however fast the wheel spins.
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
    // Re-reads when the candidate changes: a different profile can render a
    // different set of sections.
  }, [match.candidateRef]);

  const name = preview ? (
    <LockedField
      value={preview.displayName}
      label="Candidate name"
      onReveal={openUpgrade}
    />
  ) : match.displayName ? (
    // Same treatment as the result card — see `MaskedName`. Unblur only after
    // this recruiter has paid (contact loaded) or already holds CONTACT_SHARED.
    <MaskedName
      name={match.displayName}
      revealed={
        contact !== null || match.engagementStatus === "CONTACT_SHARED"
      }
    />
  ) : (
    roleLabel
  );

  const orgs = [roleLabel, track].filter((v): v is string => Boolean(v));

  const evidenceItems = trackEvidence?.items ?? [];
  // Completed tracks and hackathon placements. Compensation is deliberately not
  // in this list any more: an ABTalks estimate is not verified evidence, and it
  // now sits with the other availability facts under Contact.
  const evidenceRoles: Role[] = evidenceItems.map((item) => ({
    key: item.key,
    title: item.title,
    value: item.detail ?? item.outcomeLabel,
    badge: item.outcomeLabel,
    note: item.occurredAt ? monthYearFromIso(item.occurredAt) : undefined,
  }));

  const summaryInput = summaryInputFromMatch({
    ...match,
    locked: Boolean(preview),
  });
  const detailedSummary = sample
    ? "Figures are taken from your requirement, not from a candidate."
    : recruiterSummary(match.rationale, summaryInput);
  const verifiedLine = verifiedEvidenceSentence(summaryInput);
  const hasVerified =
    !sample && (verifiedLine !== NO_VERIFIED_EVIDENCE || evidenceRoles.length > 0);

  const platforms: { title: string; sub: string; date: string }[] = sample
    ? []
    : [
      ...(e.certificateIssued
        ? [
          {
            title: "Track certificate",
            sub: track ?? "ABTalks",
            date: "Issued",
          },
        ]
        : []),
      {
        title: "GitHub",
        sub: e.githubConnected
          ? typeof e.commitDayCount === "number"
            ? `${e.commitDayCount} verified commit days`
            : "Connected"
          : "Not connected",
        // Declared profile links are never "Verified" — commit days above are
        // ABTalks evidence wording only. The profile URL is SELF-REPORTED.
        date: "",
      },
      {
        title: "LinkedIn",
        sub: e.linkedinConnected ? "Connected" : "Not connected",
        date: "",
      },
    ];

  const experienceSummary = [
    years ? `${years} year${years === 1 ? "" : "s"} total` : null,
  ].filter(Boolean);

  const jobs = workHistory?.rows ?? [];
  const declaredLinks = (externalLinks ?? []).flatMap((link) => {
    const href = safeExternalProfileHref(link.provider, link.url);
    if (!href) return [];
    return [{ ...link, href }];
  });

  return (
    <aside className="hire-detail hire-profile" aria-label="Candidate details">
      {/* Outside the scroll container so it stays on the seam as the panel
          scrolls. */}
      <PanelResizer />
      <div ref={scrollRef} className="hire-detail__scroll">
        <div className="hire-profile__controls">
          <div className="hire-profile__history">
            <button
              type="button"
              className="hire-profile__ctl"
              aria-label="Previous candidate"
              disabled={!onPrev}
              onClick={onPrev}
            >
              <ArrowLeft size={15} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
            </button>
            <button
              type="button"
              className="hire-profile__ctl"
              aria-label="Next candidate"
              disabled={!onNext}
              onClick={onNext}
            >
              <ArrowRight size={15} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
            </button>
          </div>
          <div className="hire-profile__window">
            <button
              type="button"
              className="hire-profile__ctl"
              aria-label="Back to results"
              onClick={onClose}
            >
              {/* <ArrowLeft size={17} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" /> */}
            </button>
            {!sample && (
              <Link
                href={resumeHref}
                className="hire-profile__more"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View the full candidate report in a new tab"
                title="View the full candidate report"
              >
                View as Report
                <ArrowUpRight
                  size={14}
                  strokeWidth={1.8}
                  absoluteStrokeWidth
                  aria-hidden="true"
                />
              </Link>
            )}
            <button
              type="button"
              className="hire-profile__ctl"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="hire-profile__identity">
          <div className="hire-profile__namerow">
            <h3 ref={nameRef} className="hire-profile__name">
              {name}
              <OpenToWorkBadge openToWork={match.openToWork} />
            </h3>
            {e.linkedinConnected && (
              <LinkedInMark
                href={safeLinkedinHref(contact?.linkedinUrl)}
                locked={!sample && !preview && !contact}
                candidateRef={match.candidateRef}
                candidateLabel={contactLabel}
                onUnlocked={() => {
                  void loadContact();
                }}
              />
            )}
          </div>
          <p className="hire-profile__loc">
            {preview ? (
              <LockedField
                value={preview.locationLabel}
                label="Location"
                onReveal={openUpgrade}
              />
            ) : sample ? (
              "Sample profile, not a person in the pool"
            ) : (
              // No `AB-####` here. It is a hash of an internal id, it addresses
              // nothing a recruiter can act on, and it was the first thing they
              // read under the name.
              [match.locationLabel, workMode].filter(Boolean).join(" · ")
            )}
          </p>
          {orgs.length > 0 && (
            <div className="hire-profile__orgs">
              {orgs.map((label) => (
                <span key={label} className="hire-profile__org">
                  <span className="hire-profile__orglogo" aria-hidden="true">
                    {label.trim().charAt(0).toUpperCase()}
                  </span>
                  <span>{label}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {!sample && (
          <div className="hire-profile__actions">
            <ShortlistButton
              candidateRef={match.candidateRef}
              programMemberId={match.programMemberId}
              initialShortlisted={match.shortlisted ?? false}
              jobRole={match.jobRole}
              totalScore={match.score}
              displayName={match.displayName}
              skills={skills}
              snapshot={match}
              onToggle={onCartToggle}
              className={cn("desk-pod", match.shortlisted && "desk-pod--on")}
              podLabel
            />
            <DeskShortlistButton
              candidateRef={match.candidateRef}
              jobRole={match.jobRole}
              match={match}
            />
            {/* T-240: promote the row into the persistent hiring pipeline
                board. Idempotent, so a repeat click stays a no-op. */}
            <AddToPipelineButton
              candidateRef={match.candidateRef}
              fallbackLabel={match.displayName ?? match.jobRole}
            />
            {/* The eye that jumped to Resume is gone: the Resume tab above does
                the same thing with a label on it, and an unlabelled icon beside
                three labelled buttons was read as a fourth action. A locked
                preview still reaches the plan dialog through its blurred
                fields; "•••" remains the way to the full page. */}
          </div>
        )}

        <div className={cn("hire-profile__stick", nameStuck && "is-stuck")}>
        {/* A visual repeat of the heading above, so hidden from assistive tech;
            a locked preview shows the role rather than a second locked field. */}
        <div className="hire-profile__stickname" aria-hidden="true">
          <span className="hire-profile__stickname-inner">
            <span className="hire-profile__stickname-text">
              {preview ? match.jobRole : name}
            </span>
          </span>
        </div>
        <nav
          ref={tabsRef}
          className="hire-profile__tabs"
          aria-label="Profile sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn("hire-profile__tab", tab === t.id && "is-active")}
              aria-current={tab === t.id ? "true" : undefined}
              onClick={() => jump(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        </div>

        {/* The panel opens on what ABTalks can prove. Its three subheads are
            the summary, the parameter breakdown and the verified counts — the
            first two used to sit at the bottom under "More", where a recruiter
            who scrolled that far had already decided. */}
        <section
          data-section="evidence"
          className="hire-profile__section"
          aria-label="ABTalks Evidence"
        >
          <h4 className="hire-profile__h">ABTalks Evidence</h4>

          <div className="hire-profile__group">
            <p className="hire-profile__group-h">Candidate summary</p>
            <p className="hire-profile__text">{detailedSummary}</p>
            {sample ? (
              <p className="hire-profile__note">
                This is an illustration of the requirement. Nobody in the pool
                matches it yet, and the figures are taken from what you asked for
                rather than from a candidate.
              </p>
            ) : null}
          </div>

          {!sample && match.scores && (
            <div className="hire-profile__group">
              <p className="hire-profile__group-h">Candidate parameters</p>
              <HireScoreChart scores={match.scores} total={match.score} />
              {/* <p className="hire-profile__note">
                Slice size is each parameter&apos;s share of this candidate&apos;s
                combined score; the exact value out of 100 is listed beside it.
                Scores are derived from the evidence on record, so they are
                indicative rather than a validated psychometric measure.
              </p> */}
            </div>
          )}

          <div className="hire-profile__group">
            <p className="hire-profile__group-h">Verified evidence</p>
            {sample ? (
              <p className="hire-profile__meta">
                Figures are taken from your requirement, not from a candidate.
              </p>
            ) : !hasVerified ? (
              // Nothing passed, nothing committed, no completion on record. One
              // plain sentence, and deliberately not a list of declared skills
              // dressed up as "Verified: ..." — the Skills section already says
              // what the candidate claims, and says whose claim it is.
              <p className="hire-profile__meta">{NO_VERIFIED_EVIDENCE}</p>
            ) : (
              <div className="hire-profile__org-block">
                <span className="hire-profile__tile" aria-hidden="true">
                  {monogram("ABTalks")}
                </span>
                <div className="hire-profile__org-main">
                  <div>
                    <p className="hire-profile__org-name">
                      Verified work on ABTalks
                    </p>
                    <p className="hire-profile__org-sub">{verifiedLine}</p>
                  </div>
                  {evidenceRoles.length > 0 && (
                    <ul className="hire-profile__roles">
                      {evidenceRoles.map((r) => (
                        <li key={r.key ?? r.title} className="hire-profile__role">
                          <span
                            className="hire-profile__timeline"
                            aria-hidden="true"
                          />
                          <div className="hire-profile__role-body">
                            <div className="hire-profile__role-head">
                              <p className="hire-profile__role-title">{r.title}</p>
                              {r.badge && (
                                <span className="hire-profile__promo">
                                  {r.badge}
                                </span>
                              )}
                            </div>
                            <p className="hire-profile__meta">{r.value}</p>
                            {r.note && (
                              <p className="hire-profile__text">{r.note}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Directly under ABTalks Evidence, above Experience — status, unlock,
            tags and external profiles stay one scroll away from the proof. */}
        <section
          data-section="contact"
          className="hire-profile__overview hire-profile__section--ruled"
          aria-label="Contact and status"
        >
          {/* View expands the contact rows for free. Reveal email / Reveal
              number open the paid unlock dialog (one purchase fills both). */}
          <div className="hire-profile__headrow">
            <h4 className="hire-profile__h">Contact and status</h4>
            {!sample && !preview && !contact && !contactOpen && (
              <button
                type="button"
                className="hire-profile__unlockcta"
                onClick={() => setContactOpen(true)}
              >
                {/* <Lock
                  size={13}
                  strokeWidth={1.8}
                  absoluteStrokeWidth
                  aria-hidden="true"
                /> */}
                View Contact Details
              </button>
            )}
          </div>
          <Row icon={CircleMinus} label="Status" muted={!status}>
            {status ?? "No status"}
          </Row>
          {!sample && (
            <Row icon={Gauge} label="AB score">
              {match.score}/100{tierLabel ? ` · ${tierLabel}` : ""}
            </Row>
          )}
          {preview ? (
            <>
              <Row icon={Mail} label="Email">
                <LockedField
                  value={preview.email}
                  label="Email address"
                  onReveal={openUpgrade}
                />
              </Row>
              <Row icon={Phone} label="Phone">
                <LockedField
                  value={preview.phone}
                  label="Phone number"
                  onReveal={openUpgrade}
                />
              </Row>
            </>
          ) : contact ? (
            <>
              <Row icon={Mail} label="Email" muted={!contact.email}>
                {contact.email ? (
                  <CopyableContact
                    value={contact.email}
                    href={`mailto:${contact.email}`}
                    copyLabel="Copy email"
                  />
                ) : (
                  "Not provided"
                )}
              </Row>
              <Row icon={Phone} label="Phone" muted={!contact.phone}>
                {contact.phone ? (
                  <CopyableContact
                    value={contact.phone}
                    href={`tel:${contact.phone}`}
                    copyLabel="Copy phone"
                  />
                ) : (
                  "Not provided"
                )}
              </Row>
              {/* T-232: message them from here, where the unlocked email is. */}
              <Row icon={Send} label="Message">
                <OutreachComposeDialog
                  candidateRef={match.candidateRef}
                  candidateLabel={contactLabel}
                />
              </Row>
            </>
          ) : contactOpen ? (
            <>
              <Row icon={Mail} label="Email">
                <UnlockContactDialog
                  candidateRef={match.candidateRef}
                  candidateLabel={contactLabel}
                  onUnlocked={loadContact}
                  className="hire-profile__reveal"
                  triggerLabel="Reveal email"
                />
              </Row>
              <Row icon={Phone} label="Phone">
                <UnlockContactDialog
                  candidateRef={match.candidateRef}
                  candidateLabel={contactLabel}
                  onUnlocked={loadContact}
                  className="hire-profile__reveal"
                  triggerLabel="Reveal number"
                />
              </Row>
            </>
          ) : null}
          {/* T-229: Reveal email / Reveal number open the unlock dialog, which
              states the cost before charging. View Contact Details only expands
              these rows; it never charges. */}
          {preview ? (
            <Row icon={Wallet} label="Expected compensation">
              <LockedField
                value={preview.compensationBand}
                label="Expected compensation"
                onReveal={openUpgrade}
              />
            </Row>
          ) : match.compensationBand ? (
            <Row
              icon={Wallet}
              label={
                match.compensationDeclared ? "Expected CTC" : "Est. compensation"
              }
            >
              {match.compensationBand}
              {!match.compensationDeclared && (
                <span className="hire-profile__note">
                  {COMPENSATION_DISCLAIMER}
                </span>
              )}
            </Row>
          ) : null}
          <Row icon={Tag} label="Tags" muted={tags.length === 0}>
            {tags.length > 0 ? (
              <span className="hire-profile__tags">
                {tags.map((pill) => (
                  <span key={pill.key} className={pill.className}>
                    {pill.label}
                  </span>
                ))}
              </span>
            ) : (
              "No tags"
            )}
          </Row>
          {upgradeOpen && <UpgradeNotice onDismiss={dismissUpgrade} />}
          {preview && (
            <p className="hire-profile__note">
              This is an example of the full profile format. The details behind
              the blur are generated, not a candidate.
            </p>
          )}

          {!sample && externalLinks === null ? (
            <div className="hire-profile__group">
              <p className="hire-profile__group-h">External profiles</p>
              <p className="hire-profile__meta hire-profile__ext-empty">
                Loading profiles…
              </p>
            </div>
          ) : declaredLinks.length > 0 ? (
            <div className="hire-profile__group">
              <p className="hire-profile__group-h">
                External profiles <small>· {declaredLinks.length}</small>
              </p>
              {declaredLinks.map((link) => (
                <div
                  key={`${link.provider}:${link.href}`}
                  className="hire-profile__cert"
                >
                  <Award
                    size={14}
                    strokeWidth={1.2}
                    absoluteStrokeWidth
                    color="#03535F"
                    aria-hidden="true"
                  />
                  <span className="hire-profile__cert-body">
                    <span className="hire-profile__cert-title">{link.label}</span>
                    <a
                      className="hire-profile__cert-sub hire-profile__ext-link"
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.href}
                    </a>
                  </span>
                  <span className="hire-profile__self-reported">SELF-REPORTED</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="hire-profile__group">
              <p className="hire-profile__group-h">External profiles</p>
              <p className="hire-profile__meta hire-profile__ext-empty">
                No external profiles declared
              </p>
            </div>
          )}

          {platforms.length > 0 && (
            <div className="hire-profile__group">
              <p className="hire-profile__group-h">
                Credentials <small>· {platforms.length}</small>
              </p>
              {platforms.map((p) => (
                <div key={p.title} className="hire-profile__cert">
                  <Award
                    size={14}
                    strokeWidth={1.2}
                    absoluteStrokeWidth
                    color="#F97316"
                    aria-hidden="true"
                  />
                  <span className="hire-profile__cert-body">
                    <span className="hire-profile__cert-title">{p.title}</span>
                    <span className="hire-profile__cert-sub">{p.sub}</span>
                  </span>
                  {p.date ? (
                    <span className="hire-profile__cert-date">{p.date}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          data-section="experience"
          className="hire-profile__section hire-profile__section--ruled"
          aria-label="Experience"
        >
          <h4 className="hire-profile__h">
            Experience
            {experienceSummary.length > 0 && (
              <small>· {experienceSummary.join(" · ")}</small>
            )}
          </h4>
          {sample ? (
            <p className="hire-profile__meta">
              Figures are taken from your requirement, not from a candidate.
            </p>
          ) : workHistory === null ? (
            <p className="hire-profile__meta">Loading experience…</p>
          ) : jobs.length > 0 ? (
            jobs.map((job) => (
              <div key={job.id} className="hire-profile__org-block">
                <span className="hire-profile__tile" aria-hidden="true">
                  {monogram(job.companyName || job.title)}
                </span>
                <div className="hire-profile__org-main">
                  <div>
                    <p className="hire-profile__org-name">{job.companyName}</p>
                    <p className="hire-profile__org-sub">
                      {[job.title, job.employmentType, job.locationCity]
                        .map((part) => part?.trim())
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <ul className="hire-profile__roles">
                    <li className="hire-profile__role">
                      <span
                        className="hire-profile__timeline"
                        aria-hidden="true"
                      />
                      <div className="hire-profile__role-body">
                        <div className="hire-profile__role-head">
                          <p className="hire-profile__role-title">{job.title}</p>
                        </div>
                        <p className="hire-profile__meta">{jobSpan(job)}</p>
                        {job.description?.trim() ? (
                          <p className="hire-profile__text">
                            {job.description.trim()}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            ))
          ) : (
            <p className="hire-profile__meta">No work experience recorded</p>
          )}
        </section>

        <section className="hire-profile__section hire-profile__section--ruled hire-profile__section--wide">
          <div data-section="education" className="hire-profile__block">
            <h4 className="hire-profile__h">Education</h4>
            <div className="hire-profile__org-block">
              <span
                className="hire-profile__tile hire-profile__tile--school"
                aria-hidden="true"
              >
                {(e.educationLevel ?? "?").trim().charAt(0).toUpperCase()}
              </span>
              <div className="hire-profile__org-main">
                <div>
                  <p className="hire-profile__org-name hire-profile__org-name--lg">
                    {preview ? (
                      <LockedField
                        value={preview.educationLine}
                        label="Education"
                        onReveal={openUpgrade}
                      />
                    ) : (
                      (e.educationLevel ?? "Not disclosed")
                    )}
                  </p>
                  <p className="hire-profile__org-sub">
                    Highest education · declared by the candidate
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div data-section="skills" className="hire-profile__block">
            <h4 className="hire-profile__h">Skill Map</h4>
            {(() => {
              const verifiedMap = new Map<string, string[]>();
              for (const vs of verifiedSkills ?? []) {
                verifiedMap.set(vs.name.trim().toLowerCase(), vs.sources);
              }
              // One section per provenance — not a badge on every chip. A skill
              // with evidence goes under Evidence-backed; everything else under
              // Self-declared. Verified skills that never appear on the
              // declared list still show in Evidence-backed.
              const evidenceBacked: { name: string; sources: string[] }[] = [];
              const seenVerified = new Set<string>();
              for (const s of skills) {
                const key = s.trim().toLowerCase();
                const sources = verifiedMap.get(key);
                if (sources && sources.length > 0) {
                  evidenceBacked.push({ name: s, sources });
                  seenVerified.add(key);
                }
              }
              for (const vs of verifiedSkills ?? []) {
                const key = vs.name.trim().toLowerCase();
                if (seenVerified.has(key)) continue;
                evidenceBacked.push({ name: vs.name, sources: vs.sources });
                seenVerified.add(key);
              }
              const selfDeclared = skills.filter(
                (s) => !verifiedMap.has(s.trim().toLowerCase()),
              );

              if (
                evidenceBacked.length === 0 &&
                selfDeclared.length === 0
              ) {
                return <p className="hire-profile__meta">No skills declared.</p>;
              }

              return (
                <div className="space-y-4">
                  {evidenceBacked.length > 0 && (
                    <div className="hire-profile__group">
                      <p className="hire-profile__group-h">Evidence-backed</p>
                      <ul className="hire-profile__chips">
                        {evidenceBacked.map((s) => (
                          <li
                            key={`verified:${s.name}`}
                            className="hire-profile__chip border-[#03535f]/40 bg-[#03535f]/5"
                            title={
                              s.sources.length > 0
                                ? `Source: ${s.sources.join(", ")}`
                                : undefined
                            }
                          >
                            {s.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selfDeclared.length > 0 && (
                    <div className="hire-profile__group">
                      <p className="hire-profile__group-h">Self-declared</p>
                      <ul className="hire-profile__chips">
                        {selfDeclared.map((s) => (
                          <li key={`declared:${s}`} className="hire-profile__chip">
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
            {languages.length > 0 && (
              <div className="hire-profile__group mt-4">
                <p className="hire-profile__group-h">Verified working languages</p>
                <ul className="hire-profile__chips">
                  {languages.map((l) => (
                    <li key={l} className="hire-profile__chip">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function Row({
  icon: Icon,
  label,
  muted = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="hire-profile__row">
      <span className="hire-profile__label">
        <Icon size={20} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
        {label}
      </span>
      <div className={cn("hire-profile__value", muted && "is-muted")}>
        {children}
      </div>
    </div>
  );
}

/** Mailto/tel plus a one-shot copy control — inspector unlocked contact only. */
function CopyableContact({
  value,
  href,
  copyLabel,
}: {
  value: string;
  href: string;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <span className="hire-profile__contact-val">
      <a href={href}>{value}</a>
      <button
        type="button"
        className="hire-profile__copy"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => {
          void copy();
        }}
      >
        {copied ? (
          <Check size={14} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
