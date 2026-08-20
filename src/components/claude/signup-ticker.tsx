"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface Signup {
  firstName: string;
  context: string;
  joinedAt: string;
}

interface Props {
  signups: Signup[];
  isPaused: boolean;
}

export function SignupTicker({ signups, isPaused }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (signups.length === 0 || isPaused) return;

    const interval = setInterval(() => {
      setCurrentIndex((i) => (i + 1) % signups.length);
    }, 8000);

    return () => clearInterval(interval);
  }, [signups.length, isPaused]);

  if (signups.length === 0) return null;

  const current = signups[currentIndex];

  return (
    <div className="relative z-10 shrink-0 border-b bg-gradient-to-r from-orange-500/5 via-pink-500/5 to-violet-500/5 backdrop-blur-sm">
      <div className="container mx-auto flex h-10 items-center justify-center overflow-hidden px-4 md:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 whitespace-nowrap text-sm"
          >
            <span className="text-base">👋</span>
            <span className="font-medium">{current.firstName}</span>
            {current.context ? (
              <>
                <span className="text-muted-foreground">from</span>
                <span className="max-w-[180px] truncate font-medium md:max-w-none">
                  {current.context}
                </span>
              </>
            ) : null}
            <span className="text-muted-foreground">just joined</span>
            <span className="ml-2 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
