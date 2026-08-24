import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { RecruiterLoginForm } from "@/components/talent/recruiter-login-form";

export const metadata: Metadata = {
  title: "Recruiter sign-in | ABTalks",
  description:
    "Sign in to ABTalks Hire with your work email. No password, no Google account.",
};

type Props = { searchParams: Promise<{ from?: string }> };

function safeFrom(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/hire";
  return from;
}

/**
 * Dedicated recruiter sign-in. Public.
 *
 * Registration lives on /talent/register. This page is only the email + code
 * box. Signed-in recruiters are sent on to wherever they were going.
 */
export default async function RecruiterLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const redirectTo = safeFrom(params.from);

  const session = await auth();
  if (session?.user?.id) {
    const state = await getRecruiterState(session.user.id);
    if (state.status === "approved") redirect(redirectTo);
    if (state.status === "pending") redirect("/talent/pending");
  }

  const registerHref = `/talent/register?from=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="mx-auto max-w-md space-y-8 py-4">
      <header className="space-y-2 text-center">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          ABTalks Hire
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Sign in to hire
        </h1>
        <p className="text-sm text-muted-foreground">
          Rank candidates on verified work, not resumes.
        </p>
      </header>

      <div className="rounded-xl border bg-card p-5">
        <RecruiterLoginForm redirectTo={redirectTo} />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={registerHref}
          className="font-medium text-primary hover:underline"
        >
          Register
        </Link>
      </p>
    </div>
  );
}
