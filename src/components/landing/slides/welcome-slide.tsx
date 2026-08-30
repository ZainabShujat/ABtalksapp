"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function WelcomeSlide() {
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
        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
      >
        <Sparkles className="h-8 w-8 text-primary" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="font-display text-2xl font-bold tracking-tight md:text-3xl"
      >
        Welcome to the
        <br />
        <span className="text-primary">
          60-Day Coding Challenge
        </span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="mt-2 text-sm text-muted-foreground md:text-base"
      >
        Code consistently. Post publicly. Get noticed.
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-2 text-xs text-muted-foreground md:text-sm"
      >
        By Anil Bajpai&apos;s ABTalks community.
      </motion.p>
    </motion.div>
  );
}
