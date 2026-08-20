"use client";

import { motion } from "framer-motion";
import { ExternalLink, MessageCircle } from "lucide-react";

const WHATSAPP_LINK = "https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi";

export function CommunitySlide() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.5 }}
      className="rounded-3xl border bg-card/80 p-5 text-center shadow-lg backdrop-blur-sm md:p-6"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10"
      >
        <MessageCircle className="h-8 w-8 text-emerald-500" />
      </motion.div>

      <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
        Join the Community
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect with fellow learners on WhatsApp. Get help, share progress, and
        stay motivated together.
      </p>

      <a
        href={WHATSAPP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        Join WhatsApp Community
        <ExternalLink className="h-4 w-4" />
      </a>

      <p className="mt-2 text-xs text-muted-foreground">
        Joining is optional but highly recommended.
      </p>
    </motion.div>
  );
}
