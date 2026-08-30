"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function ClaudeWelcomeSlide() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.5 }}
      className="rounded-3xl border bg-card/80 p-5 text-center shadow-lg backdrop-blur-sm md:p-6"
    >
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10"
      >
        <Sparkles className="h-8 w-8 text-orange-500" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="font-display text-2xl font-bold tracking-tight md:text-3xl"
      >
        Master Claude AI
        <br />
        <span className="text-[#E05226]">
          in 60 Days
        </span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="mt-2 text-sm text-muted-foreground md:text-base"
      >
        A structured journey to master Claude AI, build real projects, and
        future-proof your career. Not a course. A build challenge.
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-2 text-xs text-muted-foreground md:text-sm"
      >
        Launching June 1, 2026
      </motion.p>
    </motion.div>
  );
}
