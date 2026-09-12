import Link from "next/link";
import Image from "next/image";
import { requireProgramMember } from "@/lib/program-auth";
import { ProgramNav } from "@/components/program/program-nav";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { SiteSearchSlot } from "@/components/dashboard-hub/site-search-slot";

const navItems = [
  { href: `${PROGRAM_AI_COHORT_BASE}/dashboard`, label: "Dashboard" },
  { href: `${PROGRAM_AI_COHORT_BASE}/videos`, label: "Videos" },
  { href: `${PROGRAM_AI_COHORT_BASE}/leaderboard`, label: "Leaderboard" },
];

export default async function ProgramAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProgramMember();

  return (
    <div className="theme-abtalks-light theme-abtalks-brand min-h-svh bg-[#F4F4F4] font-content text-black">
      <header className="abt-header">
        <div className="abt-header-inner justify-start md:gap-8">
          <Link href="/" className="shrink-0" aria-label="ABTalks home">
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={160}
              height={42}
              className="h-7 w-auto brightness-0"
              priority
            />
          </Link>
          <ProgramNav items={navItems} />
          <SiteSearchSlot className="ml-auto" />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1536px] px-4 py-6">
        {children}
      </main>
    </div>
  );
}
