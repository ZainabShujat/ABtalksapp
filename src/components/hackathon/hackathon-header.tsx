import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { AccountMenu } from "@/components/hackathon/account-menu";
import { SynergyChip } from "@/components/shared/synergy-chip";

export async function HackathonHeader() {
  const session = await auth();
  const email = session?.user?.email;

  return (
    <header className="relative z-50 w-full bg-black">
      <div className="mx-auto flex h-[72px] w-full max-w-[1897px] items-center justify-between px-4 sm:h-[100px] sm:px-9">
        <Link href="/" className="inline-flex shrink-0 items-center" aria-label="ABTalks home">
          <Image
            src="/abtalks-logo.png"
            alt="ABTalks"
            width={300}
            height={84}
            className="logo-image logo-image-no-invert h-7 w-auto sm:h-9"
            priority
          />
        </Link>

        {email ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <SynergyChip />
            <AccountMenu email={email} />
          </div>
        ) : (
          <Link
            href="/login?from=/hackathon/register"
            className="inline-flex h-8 items-center justify-center rounded-[8px] bg-[#403880] px-4 text-center text-[11px] font-bold leading-none text-white transition-opacity hover:opacity-90 sm:h-[47px] sm:rounded-[10px] sm:px-8 sm:text-[16px]"
          >
            Log In / Sign Up
          </Link>
        )}
      </div>
    </header>
  );
}
