import Link from "next/link";
import Image from "next/image";
import { requireProgramMember } from "@/lib/program-auth";
import { ProgramNav } from "@/components/program/program-nav";

const navItems = [
  { href: "/program/dashboard", label: "Dashboard" },
  { href: "/program/curriculum", label: "Curriculum" },
  { href: "/program/videos", label: "Videos" },
  { href: "/program/leaderboard", label: "Leaderboard" },
];

export default async function ProgramAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProgramMember();

  return (
    <div className="min-h-svh bg-[#040A12] text-white">
      <header className="sticky top-0 z-40 border-b border-[#1E1E1E] bg-[#040A12]/95 backdrop-blur">
        <div className="container mx-auto flex items-center gap-4 px-4 py-3 md:gap-6">
          <Link href="/" className="shrink-0" aria-label="ABTalks home">
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={160}
              height={42}
              className="h-8 w-auto md:h-9"
              priority
            />
          </Link>
          <div className="hidden items-center gap-2 sm:flex">
            <Link
              href="/program/dashboard"
              className="shrink-0 text-base font-semibold tracking-tight"
            >
              <span className="text-[#968BEC]">AI</span>{" "}
              <span className="text-white">Cohort</span>
            </Link>
          </div>
          <ProgramNav items={navItems} />
        </div>
      </header>
      <main className="container mx-auto min-w-0 px-4 py-6">{children}</main>
    </div>
  );
}
