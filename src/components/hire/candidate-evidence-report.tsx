"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Award,
  BadgeCheck,
  Briefcase,
  ChevronLeft,
  Download,
  FileCheck2,
  FolderGit2,
  Link2 as LinkIcon,
  Mail,
  Phone,
  Send,
  Wallet,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { COMPENSATION_DISCLAIMER } from "@/features/hire/compensation";
import {
  recruiterRoleLabel,
  recruiterSummary,
  summaryInputFromMatch,
  trackLongLabel,
  verifiedEvidenceFacts,
} from "@/features/hire/candidate-summary";
import {
  recallAiSummary,
  recallEvidence,
} from "@/components/hire/evidence-cache";
import { OpenToWorkBadge } from "@/components/hire/hire-card-facts";
import { SCORE_PARAMS } from "@/components/hire/hire-score-chart";
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
import type { MatchCardData } from "@/components/hire/match-card";
import type { SelfReportedExternalLink } from "@/features/hire/self-reported-links";
import type { RevealedContact } from "@/features/hire/unlock-contact";
import { DUR, EASE_SPARK, useSafeReducedMotion } from "@/lib/motion";

/**
 * The standalone candidate report at `/hire/evidence?ref=…`.
 *
 * ## Why this is not the old evidence sheet
 *
 * The sheet was a grid of labelled cells, and a grid has to fill every cell, so
 * a candidate with no graded projects and no quiz read as a page of "Not
 * shared" / "None recorded" / "0 of 0". That is a report about the platform's
 * missing rows, not about the person. Here every block is conditional: a fact
 * the platform does not hold produces no heading, no empty state and no
 * apology. A recruiter reads only what is true.
 *
 * ## Where the content comes from
 *
 * The cached match (`recallEvidence`) supplies the card-level fields Scout
 * already computed: name, score, the seven parameters, declared skills, the
 * mission and commit counts. Everything richer is loaded by `candidateRef`
 * through the same four server actions the View Details panel uses, so the
 * report and the panel cannot tell a recruiter two different stories. The
 * actions re-resolve the handle themselves, so a guessed ref returns nothing.
 *
 * Contact stays behind the paid unlock (T-229/D-18): this renders the same
 * `UnlockContactDialog` the panel does and reads back what
 * `revealContactAction` returns, which is nothing unless a CONTACT_SHARED row
 * already exists.
 */
export function CandidateEvidenceReport({ lookup }: { lookup: string }) {
  const reduce = useSafeReducedMotion();

  /**
   * The cached match, read through `useSyncExternalStore`.
   *
   * `recallEvidence` reads session storage, so it cannot run during the server
   * pass, and a lazy `useState` initialiser would hydrate a filled report over
   * a server-rendered empty one. The server snapshot is `undefined` ("not
   * looked up yet"), the client snapshot is the cached match or `null`
   * ("looked up, nothing there"), and React re-renders once after hydration
   * when the two differ. Those two states have to stay distinguishable: one is
   * a spinner, the other is the "open it from Scout" page.
   *
   * The snapshot is taken once per lookup because `recallEvidence` re-parses
   * storage on every call and hands back a new object identity each time,
   * which this hook would read as an endless stream of changes.
   */
  const cached = useMemo(() => recallEvidence(lookup), [lookup]);
  // The summary View Details already wrote for this candidate, if this tab
  // opened them. Never generated here: the page only reuses it, and prints the
  // deterministic summary otherwise. Read in the same pass as `cached`, which
  // is what the body renders from, so it never lands in the server pass.
  const storedSummary = useMemo(
    () => (cached ? recallAiSummary(cached.candidateRef) : null),
    [cached],
  );
  const store = useMemo(
    () => ({
      // Nothing writes this cache while the report is open, so there is no
      // change to publish and the unsubscribe is a no-op.
      subscribe: () => () => {},
      getSnapshot: () => cached,
      getServerSnapshot: (): MatchCardData | null | undefined => undefined,
    }),
    [cached],
  );
  const match = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const candidateRef = match?.candidateRef ?? null;
  const sample = candidateRef?.startsWith("SAMPLE:") ?? false;
  const data = useReportData(candidateRef, sample);

  if (match === undefined) {
    return (
      <main className="hire-report">
        <BackToScout />
        <article className="hire-report__doc">
          <div className="hire-report__band hire-report__band--quiet">
            <span className="hire-report__glow" aria-hidden="true" />
            <p className="hire-report__eyebrow">ABTalks candidate report</p>
            <p className="hire-report__loading">Opening the report</p>
          </div>
        </article>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="hire-report">
        <BackToScout />
        <div className="hire-report__blank">
          <span className="hire-report__blankmark" aria-hidden="true">
            <FileCheck2 size={26} strokeWidth={1.4} absoluteStrokeWidth />
          </span>
          <h1 className="hire-report__blankh">This report is not open yet</h1>
          <p className="hire-report__blankp">
            Candidate reports are built from your own search. Run a search in
            Scout, open a candidate, then choose the ••• menu to open their full
            report.
          </p>
          <Link className="hire-report__blankcta" href="/hire">
            Go to Scout
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ReportBody
      variant="page"
      match={match}
      summary={storedSummary ?? undefined}
      sample={sample}
      reduce={reduce}
      contact={data.contact}
      onContactLoaded={data.loadContact}
      workHistory={data.workHistory}
      externalLinks={data.externalLinks}
      trackEvidence={data.trackEvidence}
      verifiedSkills={data.verifiedSkills}
    />
  );
}

/**
 * The same report, opened over Scout from View Details instead of in a new
 * tab. One body, two frames: the page keeps Back and its Download bar; the
 * modal drops Back (the desk is right behind it) and shows Download as an icon
 * beside Close when the reader hovers the report, so nothing sits on the sheet
 * itself. The PDF is the same `window.print()` save as the page, and the print
 * rules for `.hire-report-modal` hide the desk so only the sheet is printed.
 *
 * `Dialog.Popup` unmounts while closed, so the loaders below only run once a
 * recruiter actually opens the report.
 */
export function CandidateReportDialog({
  match,
  summary,
  open,
  onOpenChange,
  onContactLoaded,
}: {
  match: MatchCardData;
  /**
   * View Details' own summary paragraph, so the report never tells a second
   * story. Null while it is still being written.
   */
  summary: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the panel behind pick up an unlock bought inside the report. */
  onContactLoaded?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="hire-app hire-report-modal"
        showCloseButton={false}
        initialFocus={scrollRef}
      >
        <ReportModalBody
          match={match}
          summary={summary}
          scrollRef={scrollRef}
          onContactLoaded={onContactLoaded}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReportModalBody({
  match,
  summary,
  scrollRef,
  onContactLoaded,
}: {
  match: MatchCardData;
  summary: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onContactLoaded?: () => void;
}) {
  const reduce = useSafeReducedMotion();
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const data = useReportData(match.candidateRef, sample);
  const revealed =
    data.contact !== null || match.engagementStatus === "CONTACT_SHARED";

  return (
    <>
      <DialogTitle className="sr-only">Candidate report</DialogTitle>
      <div className="hire-report-modal__tools">
        <DownloadReportButton
          label={reportFileLabel(match, revealed)}
          compact
        />
        <DialogClose
          className="hire-report-modal__tool"
          aria-label="Close report"
          title="Close"
        >
          <X size={17} strokeWidth={1.6} absoluteStrokeWidth aria-hidden="true" />
        </DialogClose>
      </div>
      {/* The sheet scrolls inside the modal; the tools above it stay put. It
          takes the initial focus so arrow keys and Page Down scroll the
          report straight away. */}
      <div ref={scrollRef} className="hire-report-modal__scroll" tabIndex={-1}>
        <ReportBody
          variant="modal"
          match={match}
          summary={summary}
          sample={sample}
          reduce={reduce}
          contact={data.contact}
          onContactLoaded={async () => {
            await data.loadContact();
            onContactLoaded?.();
          }}
          workHistory={data.workHistory}
          externalLinks={data.externalLinks}
          trackEvidence={data.trackEvidence}
          verifiedSkills={data.verifiedSkills}
        />
      </div>
    </>
  );
}

/**
 * The same four loaders the panel fires, plus the contact read. A sample ref
 * has no rows behind it, so it is never sent: the actions would resolve it to
 * empty anyway and the round trip buys nothing.
 */
function useReportData(candidateRef: string | null, sample: boolean) {
  const [contact, setContact] = useState<RevealedContact | null>(null);
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
    if (!candidateRef || sample) return;
    let alive = true;
    void (async () => {
      const [history, links, evidence, skillEvidence, revealed] =
        await Promise.all([
          loadInspectorWorkHistoryAction({ candidateRef }),
          loadInspectorExternalLinksAction({ candidateRef }),
          loadInspectorTrackEvidenceAction({ candidateRef }),
          loadInspectorSkillEvidenceAction({ candidateRef }),
          revealContactAction({ candidateRef }),
        ]);
      if (!alive) return;
      setWorkHistory(
        history.ok ? history.data : { hasNoWorkExperience: false, rows: [] },
      );
      setExternalLinks(links.ok ? links.data.links : []);
      setTrackEvidence(evidence.ok ? evidence.data : { items: [] });
      setVerifiedSkills(skillEvidence.ok ? skillEvidence.data.skills : []);
      setContact(revealed);
    })();
    return () => {
      alive = false;
    };
  }, [candidateRef, sample]);

  async function loadContact() {
    if (!candidateRef) return;
    setContact(await revealContactAction({ candidateRef }));
  }

  return {
    contact,
    loadContact,
    workHistory,
    externalLinks,
    trackEvidence,
    verifiedSkills,
  };
}

/**
 * Named after the candidate, so the saved file is not the same "evidence.pdf"
 * for every one of them. The surname goes in only once it is unlocked: the
 * page blurs it, and a filename is the one place a blur cannot follow.
 */
function reportFileLabel(match: MatchCardData, revealed: boolean): string {
  const years =
    typeof match.evidence?.yearsExperience === "number" &&
    match.evidence.yearsExperience > 0
      ? match.evidence.yearsExperience
      : null;
  const roleLabel = recruiterRoleLabel({
    jobRole: match.jobRole,
    yearsExperience: years,
  });
  if (!match.displayName) return roleLabel;
  if (revealed) return match.displayName;
  return match.displayName.trim().split(/\s+/)[0] ?? roleLabel;
}

function BackToScout() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="hire-back hire-report__back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/hire");
      }}
    >
      <ChevronLeft aria-hidden="true" />
      Back to Scout
    </button>
  );
}

/**
 * Saves the report as a PDF through the browser's own print pipeline.
 *
 * Deliberately not html2canvas or a second @react-pdf document. Rasterising
 * the page would hand a recruiter a picture of a report: no selectable text,
 * no searchable name, no working links, and a fresh set of bugs every time the
 * CSS moves. Re-authoring the layout in @react-pdf would be a second copy of
 * this page that drifts from the first. Printing uses the `@media print` rules
 * this stylesheet already carries, so the PDF is the report, with live text.
 *
 * The document title is what every browser offers as the default filename, so
 * it is swapped for the candidate's own before the dialog opens and put back
 * afterwards. The dialog captures the name as it opens, so the timeout is a
 * safety net for browsers that never fire `afterprint`.
 */
function DownloadReportButton({
  label,
  compact = false,
}: {
  label: string;
  /** Icon only, for the modal's hover tools. Same save, same PDF. */
  compact?: boolean;
}) {
  function save() {
    const original = document.title;
    const safe = `ABTalks report ${label}`
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    document.title = safe;
    window.addEventListener("afterprint", restore);
    window.setTimeout(restore, 1000);
    window.print();
  }

  if (compact) {
    return (
      <button
        type="button"
        className="hire-report-modal__tool hire-report-modal__dl"
        onClick={save}
        aria-label="Download PDF"
        title="Download PDF. Opens your browser's print dialog; choose Save as PDF."
      >
        <Download size={16} strokeWidth={1.6} absoluteStrokeWidth aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="hire-report__pdf"
      onClick={save}
      title="Opens your browser's print dialog. Choose Save as PDF."
    >
      <Download size={15} strokeWidth={1.6} absoluteStrokeWidth aria-hidden="true" />
      Download PDF
    </button>
  );
}

const WORK_MODE: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

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
  // An en dash, not an em dash: this is a date range, which is what an en dash
  // is for, and the copy rule is about the em dash used as a sentence break.
  return from && to ? `${from} – ${to}` : from || to;
}

function monthYearFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return monthYear(d.getUTCMonth() + 1, d.getUTCFullYear());
}

/** Letters for a logo tile: "Acme Systems" → "AS". */
function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : label.trim().slice(0, 2);
  return letters.toUpperCase();
}

/** http(s) LinkedIn URLs only. Unlocked contact is still untrusted input. */
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

/** Declared coding-profile URLs from the server, still untrusted for href. */
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

type Metric = { key: string; label: string; value: string; icon: typeof Award };

function ReportBody({
  variant,
  match,
  summary: summaryOverride,
  sample,
  reduce,
  contact,
  onContactLoaded,
  workHistory,
  externalLinks,
  trackEvidence,
  verifiedSkills,
}: {
  /** "page" is /hire/evidence; "modal" is View Details' in-place report. */
  variant: "page" | "modal";
  match: MatchCardData;
  /**
   * The Candidate summary paragraph as View Details wrote it. Undefined: build
   * the deterministic one here. Null: still being written.
   */
  summary?: string | null;
  sample: boolean;
  reduce: boolean;
  contact: RevealedContact | null;
  onContactLoaded: () => void;
  workHistory: InspectorWorkHistory | null;
  externalLinks: SelfReportedExternalLink[] | null;
  trackEvidence: InspectorTrackEvidence | null;
  verifiedSkills: InspectorSkillEvidenceItem[] | null;
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
  const contactLabel = match.displayName?.trim() || roleLabel;
  const track = trackLongLabel(match.source);
  const workMode = e.workMode ? (WORK_MODE[e.workMode] ?? e.workMode) : null;
  const revealed =
    contact !== null || match.engagementStatus === "CONTACT_SHARED";

  const summaryInput = summaryInputFromMatch(match);
  const summary =
    summaryOverride === undefined
      ? recruiterSummary(match.rationale, summaryInput)
      : summaryOverride;
  const proof = verifiedEvidenceFacts(summaryInput);
  const completions = trackEvidence?.items ?? [];
  // The whole block disappears when there is nothing proven. "No verified
  // evidence" is a sentence about the platform's records, and printing it under
  // somebody's name reads as a verdict on them.
  const hasProof = !sample && (proof.length > 0 || completions.length > 0);

  const metrics: Metric[] = [];
  if (years) {
    metrics.push({
      key: "experience",
      label: "Experience",
      value: `${years} year${years === 1 ? "" : "s"}`,
      icon: Briefcase,
    });
  }
  if (e.projectScores?.length) {
    metrics.push({
      key: "projects",
      label: e.projectScores.length === 1 ? "Graded project" : "Graded projects",
      value: String(e.projectScores.length),
      icon: FolderGit2,
    });
  }
  if (e.certificateIssued) {
    metrics.push({
      key: "certificate",
      label: "Track certificate",
      value: "Issued",
      icon: Award,
    });
  }

  const jobs = workHistory?.rows ?? [];
  // Declared profiles, plus the LinkedIn URL once this recruiter has unlocked
  // contact. All of them carry SELF-REPORTED: the candidate typed the address,
  // and no part of the platform has checked what is behind it.
  const declaredLinks = (externalLinks ?? []).flatMap((link) => {
    const href = safeExternalProfileHref(link.provider, link.url);
    if (!href) return [];
    return [{ key: `${link.provider}:${href}`, label: link.label, href }];
  });
  const linkedinHref = safeLinkedinHref(contact?.linkedinUrl);
  if (linkedinHref) {
    declaredLinks.push({
      key: `LINKEDIN:${linkedinHref}`,
      label: "LinkedIn",
      href: linkedinHref,
    });
  }

  // Provenance decides the group, not a badge on every chip. A skill the
  // platform can vouch for goes under Evidence-backed even when the candidate
  // never listed it; everything they listed and nothing backs goes under
  // Self-declared. Either group disappears when it is empty.
  const declared = e.skills ?? [];
  const verifiedMap = new Map<string, string[]>();
  for (const vs of verifiedSkills ?? []) {
    verifiedMap.set(vs.name.trim().toLowerCase(), vs.sources);
  }
  const evidenceBacked: { name: string; sources: string[] }[] = [];
  const seenVerified = new Set<string>();
  for (const s of declared) {
    const key = s.trim().toLowerCase();
    const sources = verifiedMap.get(key);
    if (sources && sources.length > 0) {
      evidenceBacked.push({ name: s, sources });
      seenVerified.add(key);
    }
  }
  for (const vs of verifiedSkills ?? []) {
    const key = vs.name.trim().toLowerCase();
    if (seenVerified.has(key) || vs.sources.length === 0) continue;
    evidenceBacked.push({ name: vs.name, sources: vs.sources });
    seenVerified.add(key);
  }
  const selfDeclared = declared.filter((s) => {
    const sources = verifiedMap.get(s.trim().toLowerCase());
    return !sources || sources.length === 0;
  });
  const hasSkills = evidenceBacked.length > 0 || selfDeclared.length > 0;

  const hasContactSection = !sample;
  const hasEducation = Boolean(e.educationLevel?.trim());
  const hasExperience = jobs.length > 0;

  // Two motions on this page and no more: the header band arrives, and the
  // sections behind it stagger in once. Both are skipped outright for a reader
  // who asked for reduced motion.
  const bandMotion = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: DUR.slow, ease: EASE_SPARK },
      };
  const flowMotion = reduce
    ? {}
    : {
        initial: "hidden" as const,
        animate: "show" as const,
        variants: { hidden: {}, show: { transition: { staggerChildren: 0.07 } } },
      };
  const itemMotion = reduce
    ? {}
    : {
        variants: {
          hidden: { opacity: 0, y: 12 },
          show: {
            opacity: 1,
            y: 0,
            transition: { duration: DUR.slow, ease: EASE_SPARK },
          },
        },
      };

  const meta = [roleLabel, match.locationLabel, workMode, track].filter(
    (v): v is string => Boolean(v),
  );

  // The numbers down the left edge count the sections this candidate actually
  // has, so a report without Experience runs 01, 02, 03 rather than skipping a
  // number and advertising the gap.
  const sectionOrder = [
    "evidence",
    hasContactSection ? "contact" : null,
    hasExperience ? "experience" : null,
    hasEducation ? "education" : null,
    hasSkills ? "skills" : null,
  ].filter((v): v is string => v !== null);
  const numberOf = (id: string) =>
    String(sectionOrder.indexOf(id) + 1).padStart(2, "0");

  // The page is the document's own <main>; inside the modal the desk already
  // owns <main>, so the same frame is a plain <div>.
  const Frame = variant === "page" ? "main" : "div";

  return (
    <Frame
      className={
        variant === "page" ? "hire-report" : "hire-report hire-report--modal"
      }
    >
      {variant === "page" && (
        <div className="hire-report__bar">
          <BackToScout />
          <DownloadReportButton label={reportFileLabel(match, revealed)} />
        </div>
      )}

      {/* One document. The band, the figures and every section share a single
          white sheet with hairline rules between them, instead of six cards
          floating on a page and each paying for its own border, radius,
          shadow and outer margin. */}
      <motion.article className="hire-report__doc" {...bandMotion}>
        <header className="hire-report__band">
          <span className="hire-report__glow" aria-hidden="true" />
          <div className="hire-report__bandmain">
            <div className="hire-report__who">
              <p className="hire-report__eyebrow">ABTalks candidate report</p>
              <h1 className="hire-report__name">
                {match.displayName ? (
                  <MaskedName name={match.displayName} revealed={revealed} />
                ) : (
                  roleLabel
                )}
                <OpenToWorkBadge openToWork={match.openToWork} />
              </h1>
              {meta.length > 0 && (
                <p className="hire-report__meta">
                  {meta.map((item) => (
                    <span key={item} className="hire-report__metaitem">
                      {item}
                    </span>
                  ))}
                </p>
              )}
            </div>
            {/* The score sits beside the name rather than under it: a third
                stacked line pushed the first section below the fold on a
                laptop and bought nothing. */}
            {!sample ? (
              <p className="hire-report__score">
                <b>{match.score}</b>
                <span>
                  ABTalks score
                  <br />
                  out of 100
                </span>
              </p>
            ) : (
              <p className="hire-report__score hire-report__score--note">
                <span>A sample profile, shaped from your requirement</span>
              </p>
            )}
          </div>
        </header>

        {metrics.length > 0 && (
          <div className="hire-report__strip">
            {metrics.map((m) => (
              <div key={m.key} className="hire-report__metric">
                <m.icon
                  size={17}
                  strokeWidth={1.5}
                  absoluteStrokeWidth
                  aria-hidden="true"
                />
                <span className="hire-report__metricv">{m.value}</span>
                <span className="hire-report__metrick">{m.label}</span>
              </div>
            ))}
          </div>
        )}

        <motion.div className="hire-report__flow" {...flowMotion}>
        <motion.section className="hire-report__section" {...itemMotion}>
          <SectionHead number={numberOf("evidence")} title="ABTalks Evidence" />

          <div className="hire-report__block">
            <h3 className="hire-report__blockh">Candidate summary</h3>
            {summary === null ? (
              <SummarySkeleton />
            ) : (
              <p className="hire-report__lede" aria-live="polite">
                {summary}
              </p>
            )}
          </div>

          {!sample && match.scores && (
            <div className="hire-report__block">
              <h3 className="hire-report__blockh">Candidate parameters</h3>
              <ParameterBars scores={match.scores} total={match.score} />
            </div>
          )}

          {hasProof && (
            <div className="hire-report__block">
              <h3 className="hire-report__blockh">Verified evidence</h3>
              {proof.length > 0 && (
                <ul className="hire-report__proof">
                  {proof.map((fact) => (
                    <li key={fact} className="hire-report__prooflet">
                      <BadgeCheck
                        size={16}
                        strokeWidth={1.5}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              )}
              {completions.length > 0 && (
                <ul className="hire-report__tl">
                  {completions.map((item) => (
                    <li key={item.key} className="hire-report__tlrow">
                      <span className="hire-report__dot" aria-hidden="true" />
                      <div>
                        <p className="hire-report__tltitle">
                          {item.title}
                          <span className="hire-report__tag">
                            {item.outcomeLabel}
                          </span>
                        </p>
                        {item.detail && (
                          <p className="hire-report__tlsub">{item.detail}</p>
                        )}
                        {item.occurredAt && (
                          <p className="hire-report__tldate">
                            {monthYearFromIso(item.occurredAt)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </motion.section>

        {hasContactSection && (
          <motion.section className="hire-report__section" {...itemMotion}>
            <SectionHead number={numberOf("contact")} title="Contact and status" />

            {/* Label left, value right, hairline between. Boxed cards gave
                each one-line fact a 230px card with 16px of padding around a
                short string, which is how four facts filled a screen. */}
            <dl className="hire-report__rows">
              {contact ? (
                <>
                  {contact.email && (
                    <Field icon={Mail} label="Email">
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </Field>
                  )}
                  {contact.phone && (
                    <Field icon={Phone} label="Phone">
                      <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                    </Field>
                  )}
                  <Field icon={Send} label="Message">
                    <OutreachComposeDialog
                      candidateRef={match.candidateRef}
                      candidateLabel={contactLabel}
                    />
                  </Field>
                </>
              ) : (
                <Field icon={Mail} label="Email and phone">
                  <span className="hire-report__unlock">
                    <UnlockContactDialog
                      candidateRef={match.candidateRef}
                      candidateLabel={contactLabel}
                      onUnlocked={onContactLoaded}
                      triggerLabel={"Reveal email  +"}
                      className="hire-report__reveal"
                    />
                    <UnlockContactDialog
                      candidateRef={match.candidateRef}
                      candidateLabel={contactLabel}
                      onUnlocked={onContactLoaded}
                      triggerLabel={"Reveal number  +"}
                      className="hire-report__reveal"
                    />
                  </span>
                </Field>
              )}
              {match.compensationBand && (
                <Field
                  icon={Wallet}
                  label={
                    match.compensationDeclared
                      ? "Expected CTC"
                      : "Est. compensation"
                  }
                >
                  {match.compensationBand}
                  {!match.compensationDeclared && (
                    <span className="hire-report__fine">
                      {COMPENSATION_DISCLAIMER}
                    </span>
                  )}
                </Field>
              )}
              {declaredLinks.map((link) => (
                <Field key={link.key} icon={LinkIcon} label={link.label}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.href}
                  </a>
                  <span className="hire-report__self">SELF-REPORTED</span>
                </Field>
              ))}
            </dl>
          </motion.section>
        )}

        {hasExperience && (
          <motion.section className="hire-report__section" {...itemMotion}>
            <SectionHead
              number={numberOf("experience")}
              title="Experience"
              note={years ? `${years} year${years === 1 ? "" : "s"} total` : null}
            />
            <ul className="hire-report__tl hire-report__tl--jobs">
              {jobs.map((job) => (
                <li key={job.id} className="hire-report__tlrow">
                  <span className="hire-report__tile" aria-hidden="true">
                    {monogram(job.companyName || job.title)}
                  </span>
                  <div>
                    <p className="hire-report__tltitle">{job.title}</p>
                    <p className="hire-report__tlsub">
                      {[job.companyName, job.employmentType, job.locationCity]
                        .map((part) => part?.trim())
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {jobSpan(job) && (
                      <p className="hire-report__tldate">{jobSpan(job)}</p>
                    )}
                    {job.description?.trim() && (
                      <p className="hire-report__tlbody">
                        {job.description.trim()}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        {hasEducation && (
          <motion.section className="hire-report__section" {...itemMotion}>
            <SectionHead number={numberOf("education")} title="Education" />
            <div className="hire-report__edu">
              <span className="hire-report__tile" aria-hidden="true">
                {e.educationLevel!.trim().charAt(0).toUpperCase()}
              </span>
              <div>
                <p className="hire-report__tltitle">{e.educationLevel}</p>
                <p className="hire-report__tlsub">
                  Highest education, declared by the candidate
                </p>
              </div>
            </div>
          </motion.section>
        )}

        {hasSkills && (
          <motion.section className="hire-report__section" {...itemMotion}>
            <SectionHead number={numberOf("skills")} title="Skills" />
            {evidenceBacked.length > 0 && (
              <div className="hire-report__block">
                <h3 className="hire-report__blockh">Evidence-backed</h3>
                <ul className="hire-report__chips">
                  {evidenceBacked.map((s) => (
                    <li
                      key={`backed:${s.name}`}
                      className="hire-report__chip hire-report__chip--proven"
                      title={`Source: ${s.sources.join(", ")}`}
                    >
                      <BadgeCheck
                        size={13}
                        strokeWidth={1.6}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                      {s.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selfDeclared.length > 0 && (
              <div className="hire-report__block">
                <h3 className="hire-report__blockh">Self-declared</h3>
                <ul className="hire-report__chips">
                  {selfDeclared.map((s) => (
                    <li key={`declared:${s}`} className="hire-report__chip">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.section>
        )}
        </motion.div>

        <p className="hire-report__foot">
          Mission, first-attempt, commit and project figures are verified by
          ABTalks. Experience, skills, role and external profile links are
          declared by the candidate.
        </p>
      </motion.article>
    </Frame>
  );
}

/**
 * The summary paragraph's placeholder while Gemini writes it: three soft bars
 * the width of a short paragraph, and a line for screen readers. Used by View
 * Details and the report so both wait the same way.
 */
export function SummarySkeleton() {
  return (
    <div className="hire-summary-skel" role="status">
      <span className="sr-only">Writing the candidate summary</span>
      <span className="hire-summary-skel__line" aria-hidden="true" />
      <span className="hire-summary-skel__line" aria-hidden="true" />
      <span
        className="hire-summary-skel__line hire-summary-skel__line--short"
        aria-hidden="true"
      />
    </div>
  );
}

function SectionHead({
  number,
  title,
  note = null,
}: {
  number: string;
  title: string;
  note?: string | null;
}) {
  return (
    <div className="hire-report__sechead">
      <span className="hire-report__secnum" aria-hidden="true">
        {number}
      </span>
      <h2 className="hire-report__sectitle">{title}</h2>
      {note && <span className="hire-report__secnote">{note}</span>}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Award;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hire-report__row">
      <dt className="hire-report__rowk">
        <Icon size={15} strokeWidth={1.4} absoluteStrokeWidth aria-hidden="true" />
        {label}
      </dt>
      <dd className="hire-report__rowv">{children}</dd>
    </div>
  );
}

/**
 * The seven ranking dimensions as bars.
 *
 * The panel draws these as a donut, which answers "what is this candidate's
 * score made of". A report is read left to right and one parameter at a time,
 * and the question here is "how strong is each of these" — a length against a
 * common baseline answers that at a glance, where seven slices of a ring do
 * not. Same palette as the donut (`SCORE_PARAMS`), so the colours mean the
 * same thing on both surfaces.
 *
 * A dimension the candidate's track cannot produce is `null`, never 0, and it
 * gets no row at all. The panel's legend prints "Not scored" beside those,
 * which on a report is a row of grey text next to an empty bar: the reader
 * counts what is missing instead of reading what is there. The count in the
 * line above accounts for them honestly without spending a row each.
 */
function ParameterBars({
  scores,
  total,
}: {
  scores: NonNullable<MatchCardData["scores"]>;
  total: number;
}) {
  const scored = SCORE_PARAMS.map((p) => ({ ...p, value: scores[p.key] })).filter(
    (r): r is typeof r & { value: number } => r.value !== null,
  );
  if (scored.length === 0) return null;

  return (
    <div className="hire-report__params">
      <p className="hire-report__paramtop">
        <span className="hire-report__paramtotal">{total}</span>
        <span className="hire-report__paramunit">
          out of 100 overall, across {scored.length} scored parameter
          {scored.length === 1 ? "" : "s"}
        </span>
      </p>
      <ul className="hire-report__paramlist">
        {scored.map((row) => (
          <li key={row.key} className="hire-report__param">
            <span className="hire-report__paramk">{row.label}</span>
            <span className="hire-report__track">
              <span
                className="hire-report__fill"
                style={{
                  // A floor of 2% so a real score of 1 is still a visible mark
                  // rather than an empty track that reads as no data.
                  width: `${Math.max(2, Math.min(100, row.value))}%`,
                  background: `linear-gradient(90deg, ${row.color.base}, ${row.color.edge})`,
                }}
              />
            </span>
            <span className="hire-report__paramv">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
