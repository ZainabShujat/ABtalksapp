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
    <Button
      type="button"
      size="icon-lg"
      onClick={onToggle}
      aria-label={open ? "Close chat" : "Open chat"}
      aria-expanded={open}
      className="theme-abtalks-orange fixed bottom-4 right-4 z-50 size-12 rounded-full shadow-lg"
    >
      {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
    </Button>
  );
}

export default ChatLauncher;
