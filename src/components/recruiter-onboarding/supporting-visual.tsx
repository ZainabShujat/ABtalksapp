"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  Clock,
  Globe,
  MailCheck,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_SPARK } from "@/lib/motion";
import {
  VISUAL_PERSPECTIVE_PX,
  useIsDesktop,
  visualTransition,
} from "./motion";

/*
 * The right-hand composition. One persistent scene rather than a slideshow:
 * the same workspace window, recruiter card, company card, verification card
 * and candidate cards stay mounted, and each step gives every piece a pose
 * (position, depth, scale, opacity). Moving between steps therefore animates
 * each piece from where it is — the recruiter card steps back as the company
 * card comes forward — and deeper pieces settle a beat later
 * (visualTransition), which is the layered parallax.
 *
 * The cards show what the recruiter has typed, so the preview is always about
 * the current step. On a mouse, the scene tilts a few degrees toward the
 * pointer; the depth of each piece turns that into parallax. Reduced motion
 * gets no tilt and no pointer tracking.
 *
 * Desktop only: below 1024px nothing is mounted. Decorative, so aria-hidden.
 */

export type VisualStage =
  | "welcome"
  | "identity"
  | "company"
  | "verify"
  | "account"
  | "complete"
  | "signin";

export type VisualData = {
  fullName: string;
  email: string;
  company: string;
  website: string;
  industry: string;
  companySize: string;
  companyLocation: string;
};

export const EMPTY_VISUAL: VisualData = {
  fullName: "",
  email: "",
  company: "",
  website: "",
  industry: "",
  companySize: "",
  companyLocation: "",
};

const SCENE = { w: 600, h: 540 } as const;
const BASE_TILT = { x: 4, y: -6 } as const;

const CAPTIONS: Record<VisualStage, string> = {
  welcome: "Search, shortlist and reach out in one workspace",
  identity: "How you appear when you reach out to candidates",
  company: "Your company card on outreach and job posts",
  verify: "A verified work email keeps the talent pool trusted",
  account: "Account created. One sign-in code to go",
  complete: "Your recruiting workspace",
  signin: "Your workspace, where you left it",
};

type Pose = { x: number; y: number; z: number; scale: number; opacity: number };
const p = (x: number, y: number, z: number, scale: number, opacity = 1): Pose => ({
  x,
  y,
  z,
  scale,
  opacity,
});

function framePose(stage: VisualStage): Pose {
  if (stage === "welcome" || stage === "signin") return p(30, 110, 0, 0.96);
  if (stage === "complete") return p(30, 80, 0, 1.02);
  return p(40, 150, -200, 0.9, 0.4);
}

function recruiterPose(stage: VisualStage): Pose {
  switch (stage) {
    case "identity":
      return p(160, 210, 120, 1.06);
    case "company":
      return p(24, 36, 30, 0.84);
    case "verify":
    case "account":
      return p(30, 60, 20, 0.86);
    default:
      return p(160, 240, -60, 0.9, 0);
  }
}

function companyPose(stage: VisualStage): Pose {
  switch (stage) {
    case "welcome":
    case "signin":
      return p(0, 24, 90, 0.8);
    case "company":
      return p(150, 180, 130, 1.06);
    case "verify":
    case "account":
      return p(320, 40, -10, 0.8, 0.95);
    case "complete":
      return p(40, 300, -40, 0.5, 0);
    default:
      return p(300, 60, -60, 0.8, 0);
  }
}

// Complete: the three cards drop into the workspace window's result grid.
// Slots are the window's own layout (sidebar 120, padding 16, search 36)
// mapped through its pose at (30, 80) × 1.02.
const RESULT_SLOTS = [p(168.7, 188, 1, 0.795), p(364.6, 188, 1, 0.795), p(168.7, 283, 1, 0.795)];

function candidatePose(stage: VisualStage, i: number): Pose {
  if (stage === "complete") return RESULT_SLOTS[i]!;
  if (stage === "welcome" || stage === "signin") {
    return [p(330, 250, 70, 0.9), p(350, 372, 40, 0.9), p(360, 460, 0, 0.9, 0)][i]!;
  }
  return [p(80, 400, -80, 0.85, 0), p(320, 420, -80, 0.85, 0), p(200, 460, -80, 0.85, 0)][i]!;
}

function verifyPose(stage: VisualStage): Pose {
  if (stage === "verify" || stage === "account") return p(150, 210, 150, 1.06);
  return p(150, 260, -40, 0.9, 0);
}

function shortlistPose(stage: VisualStage): Pose {
  if (stage === "welcome" || stage === "signin") return p(430, 60, 110, 1);
  if (stage === "complete") return p(440, 86, 2, 0.82);
  return p(430, 30, -40, 0.9, 0);
}

export function SupportingVisual(props: {
  stage: VisualStage;
  data: VisualData;
  /** Skip transitions (restoring a saved step on load). */
  instant?: boolean;
}) {
  const desktop = useIsDesktop();
  if (!desktop) return null;
  return <VisualPanel {...props} />;
}

function VisualPanel({
  stage,
  data,
  instant = false,
}: {
  stage: VisualStage;
  data: VisualData;
  instant?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLElement>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setFit(Math.max(0.5, Math.min((width - 72) / SCENE.w, (height - 132) / SCENE.h, 1.2)));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // Pointer tilt: two motion values, sprung, mapped to degrees. No re-renders.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 60, damping: 18, mass: 0.6 });
  const rotateY = useTransform(sx, (v) => (reduced ? 0 : BASE_TILT.y + v * 6));
  const rotateX = useTransform(sy, (v) => (reduced ? 0 : BASE_TILT.x - v * 5));

  const layer = (n: number) => visualTransition(n, instant);

  return (
    <aside
      ref={panelRef}
      aria-hidden
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== "mouse") return;
        const rect = event.currentTarget.getBoundingClientRect();
        px.set((event.clientX - rect.left) / rect.width - 0.5);
        py.set((event.clientY - rect.top) / rect.height - 0.5);
      }}
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
      className="relative isolate hidden overflow-hidden rounded-[24px] border border-[#D4EBEC] bg-[#EEF6F6] lg:block"
    >
      {/* Static dot grid: a surface for the cards to sit over, never animated. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#CFE5E6_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_85%)]" />

      <div className="absolute left-6 top-6 inline-flex items-center gap-2 rounded-full border border-[#D4EBEC] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#03535F]">
        <span className="size-1.5 rounded-full bg-[#18D39B]" />
        {stage === "complete" || stage === "signin" ? "Workspace" : "Live preview"}
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center pt-4"
        style={{ perspective: VISUAL_PERSPECTIVE_PX }}
      >
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_SPARK, delay: 0.1 }}
          style={{ width: SCENE.w, height: SCENE.h, scale: fit, transformStyle: "preserve-3d" }}
        >
          <motion.div
            className="relative size-full"
            style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
          >
            <Piece pose={framePose(stage)} transition={layer(0)} width={540}>
              <WorkspaceWindow stage={stage} data={data} />
            </Piece>

            <Piece pose={companyPose(stage)} transition={layer(1)} width={300}>
              <CompanyCard data={data} focused={stage === "company"} />
            </Piece>

            <Piece pose={recruiterPose(stage)} transition={layer(2)} width={280}>
              <RecruiterCard data={data} focused={stage === "identity"} />
            </Piece>

            {[0, 1, 2].map((i) => (
              <Piece key={i} pose={candidatePose(stage, i)} transition={layer(4 + i)} width={230}>
                <CandidateCard index={i} />
              </Piece>
            ))}

            <Piece pose={verifyPose(stage)} transition={layer(3)} width={320}>
              <VerifyCard email={data.email} verified={stage === "account"} />
            </Piece>

            <Piece pose={shortlistPose(stage)} transition={layer(7)} width={132}>
              <div className="flex h-[34px] items-center gap-2 rounded-full border border-[#E9E9E9] bg-white pl-3 pr-1.5 text-[12px] font-medium text-[#161616] shadow-[0_10px_24px_-14px_rgba(16,41,44,0.35)]">
                <Star className="size-3.5 fill-[#03535F] text-[#03535F]" />
                Shortlist
                <span className="ml-auto flex size-[22px] items-center justify-center rounded-full bg-[#03535F] text-[11px] font-semibold text-white">
                  3
                </span>
              </div>
            </Piece>
          </motion.div>
        </motion.div>
      </div>

      <div className="absolute inset-x-6 bottom-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: EASE_SPARK }}
            className="text-sm text-[#03535F]/80"
          >
            {CAPTIONS[stage]}
          </motion.p>
        </AnimatePresence>
      </div>
    </aside>
  );
}

function Piece({
  pose,
  transition,
  width,
  children,
}: {
  pose: Pose;
  transition: ReturnType<typeof visualTransition>;
  width: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="absolute left-0 top-0 origin-top-left"
      style={{ width }}
      initial={false}
      animate={pose}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}

const CARD =
  "rounded-[12px] border border-[#E9E9E9] bg-white transition-shadow duration-500";
const CARD_FOCUS = "shadow-[0_24px_48px_-24px_rgba(16,41,44,0.38)] border-[#D4EBEC]";
const CARD_REST = "shadow-[0_12px_28px_-18px_rgba(16,41,44,0.28)]";

function initials(name: string, fallback: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || fallback;
}

function domain(website: string) {
  return website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

function Placeholder({ text, className }: { text: string; className?: string }) {
  return <span className={cn("text-[#A5A5A5]", className)}>{text}</span>;
}

/** Text that crossfades when the value it shows changes. */
function Live({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2, ease: EASE_SPARK }}
        className={cn("block truncate", className)}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

function WorkspaceWindow({ stage, data }: { stage: VisualStage; data: VisualData }) {
  const complete = stage === "complete";
  const query = complete
    ? "Describe the role you're hiring for"
    : "Frontend developer · React · Bengaluru";

  return (
    <div className="h-[380px] w-[540px] overflow-hidden rounded-[14px] border border-[#D4EBEC] bg-white shadow-[0_32px_64px_-32px_rgba(16,41,44,0.4)]">
      <div className="flex h-10 items-center gap-1.5 border-b border-[#EEF3F3] px-4">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 rounded-full bg-[#E3E8E8]" />
        ))}
        <span className="ml-3 flex h-5 w-44 items-center rounded-full bg-[#F4F7F7] px-3 text-[10px] text-[#8F8F8F]">
          abtalks.in/hire
        </span>
      </div>
      <div className="flex h-[340px]">
        <div className="flex w-[120px] flex-col gap-1 border-r border-[#EEF3F3] bg-[#FAFCFC] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#03535F] text-[10px] font-semibold text-white">
              {initials(data.company, "AB")}
            </span>
            <span className="truncate text-[10px] font-semibold text-[#161616]">
              {complete && data.company.trim() ? data.company.trim() : "Workspace"}
            </span>
          </div>
          {["Scout", "Projects", "Pipeline", "Messages"].map((item, i) => (
            <span
              key={item}
              className={cn(
                "rounded-md px-2 py-1.5 text-[10px]",
                i === 0 ? "bg-[#EEF6F6] font-semibold text-[#03535F]" : "text-[#787878]",
              )}
            >
              {item}
            </span>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] transition-colors duration-500",
              complete ? "border-[#03535F] text-[#161616]" : "border-[#E9E9E9] text-[#8F8F8F]",
            )}
          >
            <Search className="size-3.5 shrink-0 text-[#03535F]" />
            <Live value={query} className="flex-1">
              {query}
            </Live>
          </div>
          <div className="mt-3.5 grid grid-cols-[180px_180px] gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[81px] rounded-[10px] border border-dashed border-[#E3ECEC] bg-[#FAFCFC]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecruiterCard({ data, focused }: { data: VisualData; focused: boolean }) {
  const name = data.fullName.trim();
  const email = data.email.trim();
  return (
    <div className={cn(CARD, focused ? CARD_FOCUS : CARD_REST, "flex items-center gap-3 p-4")}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#03535F] font-heading text-base font-semibold text-white">
        {name ? initials(name, "") : <UserRound className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#0E7F8A]">
          Recruiter
        </p>
        <Live value={name} className="mt-0.5 text-[15px] font-semibold text-[#161616]">
          {name || <Placeholder text="Your name" />}
        </Live>
        <Live value={email} className="mt-0.5 text-[12px] text-[#626262]">
          {email || <Placeholder text="you@company.com" />}
        </Live>
      </div>
    </div>
  );
}

function CompanyCard({ data, focused }: { data: VisualData; focused: boolean }) {
  const company = data.company.trim();
  const rows: { Icon: typeof Globe; label: string; value: string }[] = [
    { Icon: Briefcase, label: "Industry", value: data.industry },
    { Icon: UserRound, label: "Size", value: data.companySize ? `${data.companySize} people` : "" },
    { Icon: MapPin, label: "HQ", value: data.companyLocation.trim() },
  ];
  return (
    <div className={cn(CARD, focused ? CARD_FOCUS : CARD_REST, "p-5")}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-[#E7F2F3] font-heading text-lg font-semibold text-[#03535F]">
          {company ? company[0]!.toUpperCase() : <Building2 className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <Live value={company} className="font-heading text-[17px] font-semibold text-[#10292C]">
            {company || <Placeholder text="Your company" />}
          </Live>
          <Live value={data.website} className="mt-0.5 text-[12px] text-[#0E7F8A]">
            {domain(data.website) || <Placeholder text="company.com" />}
          </Live>
        </div>
      </div>
      <div className="mt-4 space-y-2 border-t border-[#F0F0F0] pt-3.5">
        {rows.map(({ Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2 text-[12px]">
            <Icon className="size-3.5 text-[#8F8F8F]" />
            <span className="w-14 text-[#8F8F8F]">{label}</span>
            <Live value={value} className="min-w-0 flex-1 font-medium text-[#353535]">
              {value || <Placeholder text="—" />}
            </Live>
          </div>
        ))}
      </div>
    </div>
  );
}

const CANDIDATES = [
  { id: "AB-2417", match: "Strong match", years: "3 yrs" },
  { id: "AB-3108", match: "Strong match", years: "2 yrs" },
  { id: "AB-1954", match: "Good match", years: "4 yrs" },
] as const;

const SAMPLE_SKILLS = ["React", "TypeScript", "Node.js", "SQL"];

function CandidateCard({ index }: { index: number }) {
  const candidate = CANDIDATES[index]!;
  const skills = [
    SAMPLE_SKILLS[index % SAMPLE_SKILLS.length]!,
    SAMPLE_SKILLS[(index + 1) % SAMPLE_SKILLS.length]!,
  ];
  return (
    <div className={cn(CARD, CARD_REST, "p-3.5")}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-[#E7F2F3] text-[#03535F]">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#161616]">{candidate.id}</p>
          <p className="text-[11px] text-[#787878]">Software engineer</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            index < 2 ? "bg-[#D6F7EC] text-[#03535F]" : "bg-[#F4F4F4] text-[#626262]",
          )}
        >
          {candidate.match}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        {skills.map((skill) => (
          <span key={skill} className="truncate rounded-full bg-[#F4F7F7] px-2 py-0.5 text-[10px] text-[#353535]">
            {skill}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[#0E7F8A]">
          <BadgeCheck className="size-3" />
          {candidate.years}
        </span>
      </div>
    </div>
  );
}

function VerifyCard({ email, verified }: { email: string; verified: boolean }) {
  return (
    <div className={cn(CARD, CARD_FOCUS, "p-5")}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition-colors duration-500",
            verified ? "bg-[#D6F7EC] text-[#03535F]" : "bg-[#E7F2F3] text-[#03535F]",
          )}
        >
          {verified ? <ShieldCheck className="size-5" /> : <MailCheck className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0E7F8A]">
            Work email
          </p>
          <p className="truncate text-[14px] font-semibold text-[#161616]">
            {email.trim() || "you@company.com"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[12px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={verified ? "verified" : "pending"}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.25, ease: EASE_SPARK }}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-medium",
              verified ? "bg-[#D6F7EC] text-[#03535F]" : "bg-[#F4F4F4] text-[#626262]",
            )}
          >
            {verified ? <BadgeCheck className="size-3.5" /> : <Clock className="size-3.5" />}
            {verified ? "Verified" : "6-digit code"}
          </motion.span>
        </AnimatePresence>
        <span className="whitespace-nowrap text-[#8F8F8F]">No password needed</span>
      </div>
    </div>
  );
}
