"use client";

import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { AnimatePresence, motion } from "framer-motion";

type ChatLauncherProps = {
  open: boolean;
  onToggle: () => void;
};

/** The floating corner button that opens/closes the chat panel — distinct from ChatBubble.tsx, which renders a single message. */
export function ChatLauncher({ open, onToggle }: ChatLauncherProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3">
      <AnimatePresence>
        {!open && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="hidden sm:block rounded-2xl rounded-br-sm bg-card border px-4 py-2.5 text-sm font-medium shadow-lg"
          >
            How can I help you?
          </motion.div>
        )}
      </AnimatePresence>
      <Button
        type="button"
        size="icon-lg"
        onClick={onToggle}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
        className="size-12 shrink-0 rounded-full shadow-lg"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </Button>
    </div>
  );
}

export default ChatLauncher;
