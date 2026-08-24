"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth-actions";
import { RecruiterAccountMenu } from "@/components/hire/recruiter-account-menu";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  // The pool browser is not linked anywhere while it has nothing useful to
  // show. The route stays — the cart and the member profiles live under it.
  { href: "/hire", label: "Scout" },
  // One name for one thing: "Shortlist" here and "cart" everywhere else
  // read as two features, which is why the cart was never found.
  { href: "/talent/shortlist", label: "Cart" },
];

const HIDE_NAV = ["/talent/login", "/talent/register", "/talent/pending"];

export function TalentShell({
  children,
  account = null,
}: {
  children: React.ReactNode;
  account?: RecruiterAccountSnapshot | null;
}) {
  const pathname = usePathname();
  const showNav = !HIDE_NAV.some((p) => pathname === p);
  const { openAuth, signedIn, pending } = useHireAuth();

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
          <div className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <Link href="/" aria-label="ABTalks home">
            <span className="logo-link">
              <Image
                src="/abtalks-logo.png"
                alt="ABTalks"
                width={300}
                height={84}
                priority
                className="logo-image"
              />
            </span>
            </Link>
            {/* /talent is gone — the pool browser was removed. Scout is the
                portal now. */}
            <Link href={showNav ? "/hire" : "/talent/register"} className="text-primary">
              Talent
            </Link>
          </div>
          {showNav && (
            <nav className="flex gap-4 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    pathname === item.href && "font-medium text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {account ? (
                <RecruiterAccountMenu account={account} />
              ) : signedIn ? (
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {pending ? "Pending · Sign out" : "Sign out"}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuth("nav")}
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Sign in
                </button>
              )}
            </nav>
          )}
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
