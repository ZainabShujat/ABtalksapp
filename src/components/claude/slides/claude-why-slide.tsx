"use client";

import { motion } from "framer-motion";
import { Clock, TrendingUp, Zap } from "lucide-react";

interface Props {
  totalCount: number;
}

function BuildersBadge({ totalCount }: { totalCount: number }) {
  const isEarly = totalCount < 50;
  const displayCount = Math.max(50, Math.floor(totalCount / 50) * 50);
  const badgeText = isEarly
    ? "🔥 Be among the first 100 builders"
    : `🔥 Join ${displayCount}+ builders already enrolled`;

  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1">
      <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
        {badgeText}
      </span>
    </div>
  );
}

export function ClaudeWhySlide({ totalCount }: Props) {
  const items = [
    {
      icon: Clock,
      stat: "5 hrs/wk",
      label: "saved by power users on avg",
      sub: "through workflows & automation",
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
    {
      icon: Zap,
      stat: "10x",
      label: "faster output",
      sub: "with AI-powered workflows",
      color: "text-pink-500",
      bg: "bg-pink-500/10",
    },
    {
      icon: TrendingUp,
      stat: "0→1",
      label: "zero to hero",
      sub: "no prior AI needed",
      color: "text-violet-500",
      bg: "bg-violet-500/10",
    },
  ] as const;

  return (
    <motion.div className="rounded-3xl border bg-card/80 p-5 shadow-lg backdrop-blur-sm md:p-6">
      <BuildersBadge totalCount={totalCount} />
      <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
        Why Claude AI Mastery?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Claude is the #1 AI benchmark globally yet most people use only 10% of
        its power.
      </p>

      <motion.div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.stat}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
              className="rounded-xl border bg-background/50 p-3"
            >
              <motion.div
                className={`mb-1.5 inline-flex rounded-lg p-1.5 ${item.bg}`}
              >
                <Icon className={`h-4 w-4 ${item.color}`} />
              </motion.div>
              <motion.div className="font-display text-xl font-bold md:text-2xl">
                {item.stat}
              </motion.div>
              <motion.div className="font-display text-sm font-semibold">
                {item.label}
              </motion.div>
              <motion.div className="text-[11px] text-muted-foreground md:text-xs">
                {item.sub}
              </motion.div>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
