import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { RecruiterRegisterForm } from "@/components/talent/recruiter-register-form";

export const metadata: Metadata = {
  title: "Register as a recruiter | ABTalks",
  description:
    "Register to hire on ABTalks with your work email. No password, no Google account.",
};

type Props = { searchParams: Promise<{ from?: string }> };

function safeFrom(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/hire";
  return from;
}

/**
 * Dedicated recruiter registration. Public.
 *
 * Returning recruiters do not sign in on this page — a blue link under the
 * form takes them to /talent/login. Both routes stay public (middleware
 * exact-path exceptions) so neither half is trapped behind the other.
 */
export default async function TalentRegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const redirectTo = safeFrom(params.from);

  const session = await auth();
  if (session?.user?.id) {
    const state = await getRecruiterState(session.user.id);
    if (state.status === "approved") redirect(redirectTo);
    if (state.status === "pending") redirect("/talent/pending");
  }

  const loginHref = `/talent/login?from=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="mx-auto max-w-md space-y-8 py-4">
      <header className="space-y-2 text-center">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          ABTalks Hire
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Register to hire
        </h1>
        <p className="text-sm text-muted-foreground">
          Rank candidates on verified work, not resumes.
        </p>
      </header>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          We verify your email, then someone from ABTalks confirms your
          company before access opens.
        </p>
        <RecruiterRegisterForm />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href={loginHref} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
