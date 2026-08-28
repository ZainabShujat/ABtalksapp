"use client";

import { motion } from "framer-motion";

const PHASES = [
  {
    number: "01",
    title: "Foundations & Productivity",
    days: "Days 1–15",
    desc: "Claude setup · Prompt engineering · Graphify · Caveman Method · Claude Counter · Business communication",
    color: "border-[#E05226]/30 bg-[#FFF5F0]",
  },
  {
    number: "02",
    title: "Business Domains + Data",
    days: "Days 16–35",
    desc: "Business analysis · Scrum & Agile · PPT & presentations · Excel & financial dashboards · UI/UX wireframes",
    color: "border-pink-500/30 bg-pink-500/5",
  },
  {
    number: "03",
    title: "Build + Deploy + Automate",
    days: "Days 36–55",
    desc: "Web dev & code generation · QA testing · DevOps & CI/CD · Docker · GitHub Actions · MCP connectors",
    color: "border-teal-500/30 bg-teal-500/5",
  },
  {
    number: "04",
    title: "Career Branding & Capstone",
    days: "Days 56–60",
    desc: "Resume & ATS optimisation · LinkedIn overhaul · Portfolio building · End-to-end capstone project",
    color: "border-orange-500/30 bg-orange-500/5",
  },
] as const;

export function ClaudeRoadmapSlide() {
  return (
    <motion.div className="rounded-3xl border bg-card/80 p-5 shadow-lg backdrop-blur-sm md:p-6">
      <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
        The 4-Phase Roadmap
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Each phase builds on the last. By Day 60, you&apos;ll have shipped a
        capstone.
      </p>

      <motion.div className="mt-4 space-y-2">
        {PHASES.map((phase, i) => (
          <motion.div
            key={phase.number}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
            className={`flex items-start gap-3 rounded-xl border p-4 ${phase.color}`}
          >
            <motion.div className="shrink-0 font-display text-3xl font-bold text-muted-foreground/60 md:text-4xl">
              {phase.number}
            </motion.div>
            <motion.div className="min-w-0 flex-1">
              <motion.div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-display text-sm font-semibold md:text-base">
                  {phase.title}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {phase.days}
                </span>
              </motion.div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {phase.desc}
              </p>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
