import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { isDsArchitectEnabled } from "@/lib/feature-flags";
import { SiteSearchSlot } from "@/components/dashboard-hub/site-search-slot";

export default function DsArchitectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isDsArchitectEnabled()) notFound();

  return (
    <div className="theme-abtalks-light theme-abtalks-brand min-h-svh bg-[#F4F4F4] font-content text-black">
      <header className="abt-header">
        <div className="abt-header-inner">
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
          <SiteSearchSlot />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1536px] px-4 py-6">
        {children}
      </main>
    </div>
  );
}
