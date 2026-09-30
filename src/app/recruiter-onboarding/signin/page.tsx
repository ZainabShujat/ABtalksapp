import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { RecruiterAuthClosed } from "@/components/talent/recruiter-auth-closed";
import { SigninScreen } from "@/components/recruiter-onboarding/signin-screen";
import { isEmailLoginEnabled, isRecruiterAuthEnabled } from "@/lib/feature-flags";

export const metadata: Metadata = {
  title: "Recruiter sign-in | ABTalks",
  description:
    "Pick up where you left off. Review candidates, track conversations, and keep your hiring pipeline moving.",
};

type Props = { searchParams: Promise<{ from?: string; email?: string }> };

function safeFrom(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/hire";
  return from;
}

/**
 * Public. Recruiter sign-in in the onboarding's look — the counterpart of
 * /recruiter-onboarding/signup, with the same guards as /talent/login:
 * signed-in recruiters are sent on, and `?email=` prefills the box (sign-up
 * hands off here with it).
 */
export default async function RecruiterSigninPage({ searchParams }: Props) {
  const params = await searchParams;
  const redirectTo = safeFrom(params.from);

  const session = await auth();
  if (session?.user?.id) {
    const state = await getRecruiterState(session.user.id);
    if (state.status === "active") redirect(redirectTo);
  }

  if (!isRecruiterAuthEnabled()) {
    return <RecruiterAuthClosed />;
  }

  // An address, not markup: capped to the RFC maximum and rendered as text.
  const initialEmail = (params.email ?? "").trim().slice(0, 254);

  return (
    <SigninScreen
      initialEmail={initialEmail}
      passwordEnabled={isEmailLoginEnabled()}
    />
  );
}
