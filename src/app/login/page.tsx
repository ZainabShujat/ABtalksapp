import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setReferralCookie } from "@/app/actions/referral-actions";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hackathonRedirectForProfilelessUser } from "@/features/hackathon/registration-status";
import { redirect } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LoginClient } from "./login-client";
import { studentProfile } from "@/repositories/legacy/student-profile";

type Props = {
  searchParams: Promise<{ from?: string; ref?: string; as?: string }>;
};

/** Valid same-origin `from`, or null. */
function safeFrom(from: string | undefined): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return null;
  return from;
}

/** Preserve invite ref in URL when sending OAuth-incomplete users to register. */
function registerHrefWithRef(refRaw: string | undefined): string {
  if (typeof refRaw !== "string" || refRaw.trim() === "") {
    return "/register";
  }
  const normalized = refRaw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (normalized.length === 6 && /^[A-Z0-9]{6}$/.test(normalized)) {
    return `/register?ref=${encodeURIComponent(normalized)}`;
  }
  return "/register";
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
    if (!from) redirect("/");

    // Program applicants, recruiters, and hackathon registrants must never hit
    // the student /register redirect below — send them straight to their destination.
    if (
      redirectTo.startsWith("/program") ||
      redirectTo.startsWith("/hire") ||
      redirectTo.startsWith("/talent") ||
      redirectTo.startsWith("/hackathon") ||
      redirectTo === "/dashboard" ||
      redirectTo.startsWith("/dashboard?")
    ) {
      redirect(redirectTo);
    }

    const profile = await studentProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    // Registered = has a StudentProfile. Registration no longer creates an
    // enrollment, so requiring one here would loop every new user back to /register.
    if (profile) {
      redirect(redirectTo);
    }

    const hx = await hackathonRedirectForProfilelessUser(session.user.id);
    if (hx) redirect(hx);
    redirect(registerHrefWithRef(params.ref));
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
  const showDev = process.env.ENABLE_DEV_AUTH === "true";

  return (
    <div className="theme-abtalks-light theme-abtalks-orange flex min-h-svh flex-col bg-[#FBF9F7] text-foreground">
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
              showDev={showDev}
              redirectTo={redirectTo}
              referralRef={referralRef}
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
