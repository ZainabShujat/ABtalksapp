import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setReferralCookie } from "@/app/actions/referral-actions";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LoginClient } from "./login-client";
import { isEmailLoginEnabled } from "@/lib/feature-flags";
import {
  postRegisterDestination,
  registerHref,
  isCandidateRegistered,
} from "@/features/registration/registration-gate";

type Props = {
  searchParams: Promise<{
    from?: string;
    ref?: string;
    as?: string;
    error?: string;
  }>;
};

/** Valid same-origin `from`, or null. */
function safeFrom(from: string | undefined): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return null;
  return from;
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const from = safeFrom(params.from);
  // This page is the candidate door and nothing else. Recruiters have their own,
  // and the old `?as=recruiter` links are forwarded there rather than left to
  // land on a Google button that was never meant for them.
  if (params.as === "recruiter") {
    redirect(from ?? "/hire");
  }

  const redirectTo = from ?? "/dashboard";

  const session = await auth();
  if (session?.user?.id) {
    if (session.user.isAdmin || (session.user as { role?: string }).role === "ADMIN") {
      redirect("/admin");
    }

    if (!from) redirect("/");

    // Recruiters and program applicants have their own funnels and their own
    // profile rows — a recruiter has no StudentProfile and never will, so the
    // candidate check below would loop them forever.
    if (
      redirectTo.startsWith("/program") ||
      redirectTo.startsWith("/hire") ||
      redirectTo.startsWith("/talent")
    ) {
      redirect(redirectTo);
    }

    const registered = await isCandidateRegistered(session.user.id);

    // Registered = CandidateProfile (W4-B). Registration no longer requires a
    // StudentProfile identity row.
    if (registered) {
      redirect(redirectTo);
    }

    // Not registered. `/dashboard` and `/hackathon/*` used to be waved through
    // above, which is how a Google sign-in could complete without ever reaching
    // /register. They go to the form now, and `next` remembers where they were
    // actually headed so the form can send them on afterwards.
    redirect(registerHref(postRegisterDestination(redirectTo), params.ref));
  }

  const refRaw = params.ref;
  const normalizedRef =
    typeof refRaw === "string"
      ? refRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
      : "";
  if (normalizedRef && /^[A-Z0-9]{6}$/.test(normalizedRef)) {
    await setReferralCookie(normalizedRef);
  }
  const referralRef =
    typeof params.ref === "string" && params.ref.trim() !== ""
      ? params.ref.trim()
      : undefined;

  const showGoogle = Boolean(process.env.AUTH_GOOGLE_ID);
  const showEmail = isEmailLoginEnabled();

  return (
    <div className="theme-abtalks-light theme-abtalks-brand flex min-h-svh flex-col bg-[#F4F4F4] text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md border-border/60 bg-card text-card-foreground shadow-md">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="font-display text-3xl font-bold tracking-tight">
              <span className="text-primary">A</span>BTalks
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Build your coding habit. Get discovered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginClient
              showGoogle={showGoogle}
              showEmail={showEmail}
              redirectTo={redirectTo}
              referralRef={referralRef}
              authError={params.error}
            />
          </CardContent>
        </Card>
        <p className="mt-8 max-w-md text-center text-xs text-muted-foreground">
          Built by Anil Bajpai&apos;s ABTalks community
        </p>
      </div>
    </div>
  );
}
