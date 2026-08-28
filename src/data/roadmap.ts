import {
  Boxes,
  BrainCircuit,
  Cpu,
  Database,
  Network,
  Scale,
  Server,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type RoadmapPhase = {
  phase: number;
  displayNumber: string;
  title: string;
  subtitle: string;
  days: string;
  startDay: number;
  endDay: number;
  accent: string;
  accentRgb: string;
  icon: LucideIcon;
};

export const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    phase: 1,
    displayNumber: "01",
    title: "Env & Tooling",
    subtitle: "Local AI stack, Git, Ollama",
    days: "Days 1–3",
    startDay: 1,
    endDay: 3,
    accent: "#E05226",
    accentRgb: "224, 82, 38",
    icon: Cpu,
  },
  {
    phase: 2,
    displayNumber: "02",
    title: "Data",
    subtitle: "Coverage data & structured queries",
    days: "Days 4–6",
    startDay: 4,
    endDay: 6,
    accent: "#3B82F6",
    accentRgb: "59, 130, 246",
    icon: Database,
  },
  {
    phase: 3,
    displayNumber: "03",
    title: "Embeddings & Vector",
    subtitle: "Knowledge base + retrieval",
    days: "Days 7–10",
    startDay: 7,
    endDay: 10,
    accent: "#14B8A6",
    accentRgb: "20, 184, 166",
    icon: Sparkles,
  },
  {
    phase: 4,
    displayNumber: "04",
    title: "LLM & Prompting",
    subtitle: "Prompting, fine-tune basics",
    days: "Days 11–15",
    startDay: 11,
    endDay: 15,
    accent: "#C9411C",
    accentRgb: "201, 65, 28",
    icon: BrainCircuit,
  },
  {
    phase: 5,
    displayNumber: "05",
    title: "App Build",
    subtitle: "Streamlit chatbot + FastAPI",
    days: "Days 16–20",
    startDay: 16,
    endDay: 20,
    accent: "#EC4899",
    accentRgb: "236, 72, 153",
    icon: Boxes,
  },
  {
    phase: 6,
    displayNumber: "06",
    title: "Agentic + MCP",
    subtitle: "Tools, agents, MCP servers",
    days: "Days 21–24",
    startDay: 21,
    endDay: 24,
    accent: "#F59E0B",
    accentRgb: "245, 158, 11",
    icon: Network,
  },
  {
    phase: 7,
    displayNumber: "07",
    title: "Governance & Eval",
    subtitle: "Guardrails, evals, safety",
    days: "Days 25–27",
    startDay: 25,
    endDay: 27,
    accent: "#E05226",
    accentRgb: "224, 82, 38",
    icon: Scale,
  },
  {
    phase: 8,
    displayNumber: "08",
    title: "Docker / K8s / Prod",
    subtitle: "Ship to production",
    days: "Days 28–31",
    startDay: 28,
    endDay: 31,
    accent: "#10B981",
    accentRgb: "16, 185, 129",
    icon: Server,
  },
];

export type HowItWorksStep = {
  step: number;
  title: string;
  detail: string;
};

export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    step: 1,
    title: "Apply",
    detail: "Confirm your laptop and GitHub setup.",
  },
  {
    step: 2,
    title: "31 days of missions",
    detail: "Build locally; we verify your GitHub artifacts.",
  },
  {
    step: 3,
    title: "AI interview",
    detail: "A real-time voice interview to close it out.",
  },
  {
    step: 4,
    title: "Recruiter visibility",
    detail: "Ranked profile + your build portfolio.",
  },
];

export const ROADMAP_PHASE_DURATION_MS = 700;
export const ROADMAP_CONNECTOR_MS = 350;
export const ROADMAP_NODE_MS = 180;
export const ROADMAP_CARD_MS = 450;
