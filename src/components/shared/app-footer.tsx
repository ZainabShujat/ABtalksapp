"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1-.004-4.125 2.062 2.062 0 0 1 .004 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.727-8.831L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

type SocialLink = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const SOCIAL_LINKS: SocialLink[] = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/abtalksonai/",
    icon: InstagramIcon,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/abtalks-on-ai/",
    icon: LinkedInIcon,
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@ABTalksOnAI",
    icon: YouTubeIcon,
  },
  {
    label: "X",
    href: "https://x.com/abtalksonai",
    icon: XIcon,
  },
  {
    label: "Discord",
    href: "https://discord.gg/j4Q8tvDj6",
    icon: DiscordIcon,
  },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/contact", label: "Contact" },
] as const;

const socialIconClassName = cn(
  "inline-flex size-9 items-center justify-center rounded-full text-primary",
  "transition-all duration-200 ease-out",
  "hover:-translate-y-0.5 hover:scale-110 hover:bg-primary/10 hover:text-primary",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
);

export function AppFooter() {
  const pathname = usePathname();
  const isMarketplace =
    pathname === "/marketplace" || pathname.startsWith("/marketplace/");
  const isWorkshop =
    pathname === "/ai-workshop" || pathname.startsWith("/ai-workshop/");
  const isCohortRegister =
    pathname === "/ai-cohort-register" ||
    pathname.startsWith("/ai-cohort-register/");
  const isCohortIndia =
    pathname === "/ai-cohort-india" ||
    pathname.startsWith("/ai-cohort-india/");
  const isProgram =
    pathname === "/program" || pathname.startsWith("/program/");
  const isTalent = pathname === "/talent" || pathname.startsWith("/talent/");
  const isHackathon =
    pathname === "/hackathon" || pathname.startsWith("/hackathon/");
  const supportEmail = "team@abtalks.in";

  // The workshop pages carry their own branded footer, which links legal
  // inline — anything here would duplicate their copyright line.
  if (isWorkshop) return null;

  // The remaining funnel routes have no footer of their own, but must still
  // surface the legal links — a minimal strip instead of the full footer.
  if (isCohortRegister || isCohortIndia || isProgram || isTalent || isHackathon) {
    return (
      <footer className="mt-auto border-t border-border/60 pb-16 md:pb-0">
        <div className="container mx-auto flex flex-col items-center gap-2 px-6 py-5 text-center text-xs text-muted-foreground">
          <nav
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
            aria-label="Legal"
          >
            {LEGAL_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="hover:text-primary hover:underline"
              >
                {label}
              </Link>
            ))}
          </nav>
          <span>© {new Date().getFullYear()} ABTalks</span>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className={cn(
        "mt-auto border-t pb-16 backdrop-blur-sm md:pb-0",
        isMarketplace
          ? "border-[#030712] bg-[#050C1D] text-white/80"
          : "bg-card/50 text-muted-foreground",
      )}
    >
      <div className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 items-center gap-4 text-sm md:grid-cols-3">
          <div
            className={cn(
              "flex flex-col gap-2 font-display font-medium md:justify-self-start",
              isMarketplace ? "text-white" : "text-foreground",
            )}
          >
            <span>ABTalks</span>
            <nav
              className={cn(
                "flex flex-wrap gap-x-4 gap-y-1 text-xs font-sans font-normal",
                isMarketplace ? "text-white/70" : "text-muted-foreground",
              )}
              aria-label="Legal"
            >
              {LEGAL_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="hover:text-primary hover:underline"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center justify-center gap-1">
            {SOCIAL_LINKS.map(({ label, href, icon: Icon }) =>
              href ? (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className={socialIconClassName}
                >
                  <Icon className="size-4" />
                </a>
              ) : (
                <span
                  key={label}
                  aria-label={`${label} (coming soon)`}
                  title={`${label} — coming soon`}
                  className={cn(
                    socialIconClassName,
                    "cursor-default opacity-60 hover:translate-y-0 hover:scale-100 hover:bg-transparent",
                  )}
                >
                  <Icon className="size-4" />
                </span>
              ),
            )}
          </div>
          <div className="flex items-center justify-center gap-2 md:justify-self-end">
            <Mail className="h-4 w-4" />
            <span>For any issue or enquiry:</span>
            <a
              href={`mailto:${supportEmail}`}
              className="font-medium text-primary hover:underline"
            >
              {supportEmail}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
