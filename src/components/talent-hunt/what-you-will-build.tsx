import { BrainCircuit, Cloud, Shield, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const modules = [
  {
    icon: Sparkles,
    title: "AI Enterprise & Ecosystem",
    bullets: [
      "Enterprise AI strategy and business case development",
      "AI vendor landscape and build vs. buy decisions",
      "Responsible AI governance and compliance frameworks",
      "Cross-functional stakeholder alignment",
    ],
  },
  {
    icon: Cloud,
    title: "APIs, Microservices & AI Infrastructure",
    bullets: [
      "RESTful and event-driven API design for AI services",
      "Containerization and cloud-native AI deployment",
      "Vector databases and retrieval pipelines",
      "Scalable microservices architecture patterns",
    ],
  },
  {
    icon: BrainCircuit,
    title: "LLMs, Reasoning & Agentic AI",
    bullets: [
      "Prompt engineering and chain-of-thought techniques",
      "Fine-tuning and RAG implementation",
      "Multi-agent orchestration and tool use",
      "Evaluation and benchmarking of LLM applications",
    ],
  },
  {
    icon: Shield,
    title: "MCP, AI Security, MLOps & Adoption",
    bullets: [
      "Model Context Protocol (MCP) integration",
      "AI security, red-teaming, and threat modeling",
      "CI/CD pipelines for ML models (MLOps)",
      "Change management and enterprise AI adoption",
    ],
  },
] as const;

type Props = {
  compact?: boolean;
};

export function WhatYouWillBuild({ compact = false }: Props) {
  return (
    <section
      className={cn(
        "px-4",
        compact ? "py-4 md:py-6" : "bg-muted/30 py-16",
      )}
    >
      <div className="container mx-auto max-w-5xl">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
          What You Will Build
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          Four core modules - each culminating in a live project you can showcase
          to employers.
        </p>

        <div className={cn("grid gap-4 sm:grid-cols-2", compact ? "mt-6" : "mt-10")}>
          {modules.map(({ icon: Icon, title, bullets }) => (
            <Card
              key={title}
              className="border-border/60 bg-card shadow-[var(--shadow-card)]"
            >
              <CardHeader className="gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
