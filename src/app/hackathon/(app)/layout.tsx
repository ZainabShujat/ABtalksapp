import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { HackathonShell } from "@/components/hackathon-v2/hackathon-shell";
import "@/app/hackathon/_styles/hackathon-v2.css";

/**
 * Hackathon app routes (dashboard, submission redirect). Same shell as the
 * `/hackathon` landing — the shared ABTalks `DashboardSidebar` plus the
 * hackathon header — so a participant never loses the app navigation.
 * Auth gating stays in each page; this layout only renders chrome.
 */
export default async function HackathonLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  return (
    <HackathonShell
      headerCta={
        <Link
          href="/hackathon"
          className="ab-btn ab-btn--primary ab-header__cta vt-mono-cta"
        >
          Event page
        </Link>
      }
      isAuthed={Boolean(session?.user?.id)}
      user={{
        name: session?.user?.name ?? "",
        email: session?.user?.email ?? "",
        image: session?.user?.image ?? null,
      }}
    >
      {children}
    </HackathonShell>
  );
}
