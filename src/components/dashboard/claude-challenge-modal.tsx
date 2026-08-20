"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  Rocket,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { enrollInClaudeChallenge } from "@/app/actions/enrollment-actions";
import { Button } from "@/components/ui/button";

const SESSION_DISMISS_KEY = "claude-modal-dismissed-session";

export const OPEN_CLAUDE_MODAL_EVENT = "claude-challenge-modal-open";

interface ClaudeChallengeModalProps {
  startsAt: Date | string;
  forceOpen?: boolean;
  onClose?: () => void;
}

const CHALLENGE_CARDS = [
  {
    title: "Prompt Engineering",
    icon: "💬",
    bg: "bg-emerald-500/10",
  },
  {
    title: "Claude Artifacts",
    icon: "✨",
    bg: "bg-orange-500/10",
  },
  {
    title: "MCP Servers & Connectors",
    icon: "🔌",
    bg: "bg-blue-500/10",
  },
  {
    title: "AI Automations",
    icon: "⚡",
    bg: "bg-violet-500/10",
  },
  {
    title: "APIs & Web Apps",
    icon: "🌐",
    bg: "bg-cyan-500/10",
  },
  {
    title: "Agentic AI Workflows",
    icon: "🤖",
    bg: "bg-pink-500/10",
  },
];

function useCountdown(targetDate: Date) {
  const [time, setTime] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const target = targetDate.getTime();
      const diff = Math.max(0, target - now);

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTime({ days, hours, minutes, seconds });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return time;
}

export function ClaudeChallengeModal({
  startsAt,
  forceOpen,
  onClose,
}: ClaudeChallengeModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const targetDate =
    typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const time = useCountdown(targetDate);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }

    const dismissed = sessionStorage.getItem(SESSION_DISMISS_KEY);
    if (!dismissed) {
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [forceOpen]);

  useEffect(() => {
    if (forceOpen) return;

    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_CLAUDE_MODAL_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_CLAUDE_MODAL_EVENT, handleOpen);
  }, [forceOpen]);

  const handleDismiss = () => {
    setOpen(false);
    if (!forceOpen) {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    }
    onClose?.();
  };

  const handleRegister = async () => {
    setEnrolling(true);
    try {
      const result = await enrollInClaudeChallenge();
      if (result.ok) {
        toast.success("Welcome to the Claude Challenge! 🚀");
        setOpen(false);
        onClose?.();
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="relative my-4 max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl md:my-8 md:p-6"
          >
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close modal"
              className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-muted transition-colors hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mx-auto mb-4 w-fit rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
              🚀 60-DAY CHALLENGE
            </div>

            <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">
              Become AI-Ready
              <br />
              in{" "}
              <span className="bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 bg-clip-text text-transparent">
                60 Days
              </span>
            </h2>

            <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground md:text-base">
              A structured journey to master Claude AI, build real projects and
              future-proof your career.
            </p>

            <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-xl border bg-muted/30 p-4 md:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold">
                      1,284+
                    </div>
                    <div className="text-xs text-muted-foreground">
                      builders joined
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t border-border/60 pt-4">
                  <div className="rounded-lg bg-emerald-500/10 p-2">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold">324</div>
                    <div className="text-xs text-muted-foreground">
                      completed today.
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  Challenge starts in
                </div>
                <div className="flex flex-wrap items-baseline gap-1 font-display font-bold">
                  <span className="text-2xl tabular-nums">
                    {String(time.days).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-muted-foreground">:</span>
                  <span className="text-2xl tabular-nums">
                    {String(time.hours).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-muted-foreground">:</span>
                  <span className="text-2xl tabular-nums">
                    {String(time.minutes).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-muted-foreground">:</span>
                  <span className="text-2xl tabular-nums">
                    {String(time.seconds).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
                  <span className="w-8 text-center">DAYS</span>
                  <span className="w-2" />
                  <span className="w-8 text-center">HOURS</span>
                  <span className="w-2" />
                  <span className="w-8 text-center">MIN</span>
                  <span className="w-2" />
                  <span className="w-8 text-center">SEC</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-3 flex items-center gap-2 font-display font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                What you&apos;ll learn
              </h3>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {CHALLENGE_CARDS.map((card) => (
                  <div
                    key={card.title}
                    className="flex items-center gap-2 rounded-lg border bg-background/50 p-2.5"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${card.bg}`}
                    >
                      <span className="text-base">{card.icon}</span>
                    </div>
                    <span className="text-xs font-medium leading-tight text-foreground">
                      {card.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Button
                type="button"
                onClick={handleRegister}
                disabled={enrolling}
                size="lg"
                className="w-full bg-gradient-to-r from-pink-500 to-violet-500 font-semibold text-white hover:from-pink-600 hover:to-violet-600"
              >
                <Rocket className="mr-2 h-4 w-4" />
                {enrolling ? "Joining..." : "Register Now"}
              </Button>

              <Button
                type="button"
                onClick={handleDismiss}
                variant="outline"
                size="lg"
                className="w-full"
              >
                Maybe Later
              </Button>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Built for Students, Developers, PMs & Analysts 💜
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
