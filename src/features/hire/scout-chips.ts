/**
 * The quick replies under Scout's message.
 *
 * These used to BE the conversation: ten fixed slots, asked in order, and a
 * recruiter who stated four facts in one sentence still got asked about them one
 * at a time. That march is gone — the agent asks what it actually needs. Chips
 * are now suggestions computed from whatever the brief is still missing, and
 * typing is always allowed.
 *
 * They are not decoration. A tap is answered by the protocol layer with no model
 * call at all, which on an 8000-tokens-per-minute plan is the difference between
 * a conversation that costs nothing and one that costs a hop. Keeping the useful
 * ones on screen is a capacity decision as much as a UX one.
 *
 * Pure: no model, no database, no `server-only`. Same values the old chips used,
 * so the protocol handler in `scout-conversation.ts` is unchanged.
 */
import type { JobSpec } from "@/lib/validations/hire";
import { isSlotFilled, type HireSlot } from "@/lib/validations/hire";
import { isMonthlyContext } from "@/features/hire/spec-fields";
import { readPoolExtra } from "@/features/hire/pool-brief";

export type ScoutChip = { label: string; value: string };

/**
 * Stack suggestions chosen from the role the recruiter already named.
 *
 * The chips were once a fixed list of engineering stacks, so a UI/UX designer
 * was asked to choose between "Python + SQL" and "Java + Spring". The title was
 * in the spec and simply not read. This is a keyword map, not intelligence: it
 * covers the roles this platform trains for and falls back to the engineering
 * set.
 */
const STACK_SUGGESTIONS: { match: RegExp; chips: [string, string][] }[] = [
  {
    match: /\b(ui|ux|product design|designer|design|graphic|visual)\b/i,
    chips: [
      ["Figma + prototyping", "Figma, Prototyping"],
      ["Design systems", "Figma, Design systems"],
      ["User research", "User research, Usability testing"],
      ["Interaction / motion", "Figma, Interaction design"],
    ],
  },
  {
    match: /\b(data analyst|analytics|business intelligence|bi)\b/i,
    chips: [
      ["SQL + Excel", "SQL, Excel"],
      ["SQL + Python", "SQL, Python"],
      ["Power BI / Tableau", "Power BI, Tableau"],
      ["dbt + warehouse", "dbt, SQL"],
    ],
  },
  {
    match: /\b(ml|machine learning|ai engineer|data scientist|deep learning)\b/i,
    chips: [
      ["Python + PyTorch", "Python, PyTorch"],
      ["Python + scikit-learn", "Python, scikit-learn"],
      ["LLMs + RAG", "Python, LLMs, RAG"],
      ["MLOps", "MLOps"],
    ],
  },
  {
    match: /\bfront[\s-]?end\b/i,
    chips: [
      ["TypeScript + React", "TypeScript, React"],
      ["Next.js", "Next.js"],
      ["Vue", "Vue"],
      ["CSS + accessibility", "CSS, Accessibility"],
    ],
  },
  {
    match: /\bback[\s-]?end\b/i,
    chips: [
      ["Python + SQL", "Python, SQL"],
      ["Node + Postgres", "Node, PostgreSQL"],
      ["Java + Spring", "Java, Spring"],
      ["Go", "Go"],
    ],
  },
  {
    match: /\b(mobile|android|ios|flutter|react native)\b/i,
    chips: [
      ["React Native", "React Native, TypeScript"],
      ["Flutter", "Flutter, Dart"],
      ["Android / Kotlin", "Kotlin, Android"],
      ["iOS / Swift", "Swift, iOS"],
    ],
  },
  {
    match: /\b(devops|sre|infra|platform|cloud)\b/i,
    chips: [
      ["AWS + Docker", "AWS, Docker"],
      ["Kubernetes", "Kubernetes, Docker"],
      ["CI/CD", "CI/CD, GitHub Actions"],
      ["Terraform", "Terraform, AWS"],
    ],
  },
];

const DEFAULT_STACK_CHIPS: [string, string][] = [
  ["Python + SQL", "Python, SQL"],
  ["TypeScript + React", "TypeScript, React"],
  ["Java + Spring", "Java, Spring"],
  ["Node + Postgres", "Node, PostgreSQL"],
];

function stackChips(spec: JobSpec): ScoutChip[] {
  const title = spec.title ?? "";
  const hit = title
    ? STACK_SUGGESTIONS.find((s) => s.match.test(title))
    : undefined;
  return [
    ...(hit?.chips ?? DEFAULT_STACK_CHIPS).map(([label, value]) => ({
      label,
      value,
    })),
    // Every suggestion needs a way past it. Without this, a recruiter whose
    // answer was "none of those" had nowhere to go but repeat themselves.
    { label: "No hard requirement", value: "skip:mustHaveStack" },
  ];
}

function seniorityChips(): ScoutChip[] {
  return [
    { label: "Intern", value: "INTERN" },
    { label: "Junior (0-2 yrs)", value: "JUNIOR" },
    { label: "Mid (2-5 yrs)", value: "MID" },
    { label: "Senior (5+ yrs)", value: "SENIOR" },
  ];
}

/**
 * Budget bands, in the units the role is actually paid in.
 *
 * Chip values are always annual rupees; the period is read from the role rather
 * than the chip, so one set of values serves a salary and a stipend.
 */
export function salaryChips(spec: JobSpec): ScoutChip[] {
  return isMonthlyContext(spec)
    ? [
        { label: "₹10-20k / month", value: "salary:120000-240000" },
        { label: "₹20-40k / month", value: "salary:240000-480000" },
        { label: "₹40-60k / month", value: "salary:480000-720000" },
        { label: "Not decided", value: "skip:salary" },
      ]
    : [
        { label: "₹5-10 LPA", value: "salary:500000-1000000" },
        { label: "₹10-20 LPA", value: "salary:1000000-2000000" },
        { label: "₹20-35 LPA", value: "salary:2000000-3500000" },
        { label: "Not decided", value: "skip:salary" },
      ];
}

/** Chips for a brief that can already be searched. */
function readyChips(): ScoutChip[] {
  return [
    { label: "Show me", value: "action:search" },
    { label: "Change the stack", value: "edit:mustHaveStack" },
    { label: "Change the budget", value: "edit:salary" },
    { label: "Start a new search", value: "action:reset" },
  ];
}

/**
 * Chips the agent offered on the previous turn, stashed on the spec so a tap
 * can be recognised without the model. Written by `turnFor`; read by
 * `isChipValue`. Not a display source — display takes the third argument of
 * `suggestChips` on the turn they were offered.
 */
export function readOfferedChips(spec: JobSpec): ScoutChip[] | null {
  const raw = (spec.extra as { offeredChips?: unknown } | null | undefined)
    ?.offeredChips;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const chips: ScoutChip[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const label = (row as { label?: unknown }).label;
    const value = (row as { value?: unknown }).value;
    if (typeof label === "string" && label && typeof value === "string" && value) {
      chips.push({ label, value });
    }
  }
  return chips.length ? chips : null;
}

/**
 * Up to four suggestions for where the conversation can go next.
 *
 * `ready` is the engine's judgement that a search would mean something — it is
 * not the model's, and not a claim that the brief is finished. A recruiter can
 * always keep talking instead of tapping.
 *
 * `agentChips`, when present, are what Scout just asked — they win over the
 * fixed ladder. The stable "change the stack / change the budget / start a new
 * search" chips stay on a ready brief so those exits never disappear.
 */
export function suggestChips(
  spec: JobSpec,
  ready: boolean,
  agentChips?: ScoutChip[] | null,
): ScoutChip[] {
  if (agentChips && agentChips.length > 0) {
    if (!ready) return agentChips;
    const stable = readyChips().filter((c) => c.value !== "action:search");
    const seen = new Set(agentChips.map((c) => c.value));
    return [...agentChips, ...stable.filter((c) => !seen.has(c.value))];
  }

  // A searchable brief is not a finished brief. Jumping to "Change the stack"
  // while Scout is still asking seniority is how the chips stop matching the
  // question on screen. Keep the ladder; hang the stable exits off the end.
  const wanted: HireSlot[] = ["mustHaveStack", "seniority", "salary"];
  for (const slot of wanted) {
    if (isSlotFilled(spec, slot)) continue;
    const slotChips =
      slot === "mustHaveStack"
        ? stackChips(spec)
        : slot === "seniority"
          ? seniorityChips()
          : salaryChips(spec);
    if (!ready) return slotChips;
    const seen = new Set(slotChips.map((c) => c.value));
    return [
      ...slotChips,
      ...readyChips().filter((c) => !seen.has(c.value)),
    ];
  }

  if (ready) return readyChips();

  // Nothing obvious left to suggest, but a pool brief with no role can still be
  // searched, so offer that rather than nothing.
  const extra = readPoolExtra(spec);
  if (extra.sources.length > 0) return readyChips();
  return [];
}
