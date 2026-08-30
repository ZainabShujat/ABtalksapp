import Link from "next/link";
import Image from "next/image";
import { requireProgramMember } from "@/lib/program-auth";
import { ProgramNav } from "@/components/program/program-nav";

const navItems = [
  { href: "/program/dashboard", label: "Dashboard" },
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
    <div className="theme-abtalks-light theme-abtalks-orange min-h-svh bg-[#FBF9F7] font-content text-[#111111]">
      <header className="sticky top-0 z-40 border-b border-[#E0E0E0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1536px] items-center gap-2 px-3 py-2.5 md:gap-6 md:px-4 md:py-4">
          <Link href="/" className="shrink-0" aria-label="ABTalks home">
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={160}
              height={42}
              className="h-5 w-auto brightness-0 md:h-9"
              priority
            />
          </Link>
          <ProgramNav items={navItems} />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1536px] px-4 py-6">
        {children}
      </main>
    </div>
  );
}
