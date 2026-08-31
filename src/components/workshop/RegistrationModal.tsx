"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import RegistrationForm from "@/components/workshop/RegistrationForm";

/**
 * Wraps the registration form in an overlay, opened by the `#register` hash.
 *
 * Driving it off the hash rather than a callback means every existing entry
 * point keeps working untouched — the hero CTA, the sticky header button, the
 * calendar tiles, and cross-page links like `/workshop#register` from the
 * events page — none of which can carry an onClick, since several live in
 * Server Components.
 */
export default function RegistrationModal(
  props: React.ComponentProps<typeof RegistrationForm>,
) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOpen(window.location.hash === "#register");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Clearing the hash on close matters: without it, clicking the same
  // `#register` link again would not fire `hashchange` and nothing would open.
  const close = useCallback(() => {
    setOpen(false);
    if (window.location.hash === "#register") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Reserve your seat"
          className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto p-4 py-10 sm:items-center"
          style={{
            background: "var(--wk-scrim)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.97, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="relative my-auto w-full max-w-xl"
          >
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-6 top-4 z-10 flex size-9 items-center justify-center rounded-full transition-colors"
              style={{ background: "var(--wk-chip)", color: "var(--wk-text-dim)" }}
            >
              <X className="size-4" aria-hidden />
            </button>

            <RegistrationForm {...props} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
