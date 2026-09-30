import { redirect } from "next/navigation";
import { getRefCookie } from "@/lib/cookies";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isEmailLoginEnabled, isOtpVerificationRequired } from "@/lib/feature-flags";
import {
  hasUsablePassword,
  isFreshSignIn,
  isGoogleOnlyAccount,
} from "@/lib/email-auth";
import {
  CORE_TRACK_PATH,
  createCoreEnrollment,
  isCoreDomain,
} from "@/features/enrollment/create-core-enrollment";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RegistrationForm } from "./registration-form";
import { findChallengeEnrollment } from "@/repositories/learning";
import { safeNextPath, isCandidateRegistered } from "@/features/registration/registration-gate";
import { getResumeView } from "@/features/resume/service";

type PageProps = {
  searchParams: Promise<{ ref?: string; domain?: string; next?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const requestedDomain = params.domain;
  /**
   * Where this registration ends. Set by whichever gate sent them here — the
   * hackathon pages pass `/hackathon/dashboard`, everything else falls through
   * to the hub. Validated same-origin, so it cannot become an open redirect.
   */
  const nextPath = safeNextPath(params.next);

  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, password: true },
  });

  if (!userExists) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  if (session.user.isAdmin || userExists.role === "ADMIN") {
    redirect("/admin");
  }

  const registered = await isCandidateRegistered(session.user.id);

  // Registered = CandidateProfile (W4-B). Registration no longer requires a
  // StudentProfile identity row.
  if (registered) {
    if (isCoreDomain(requestedDomain)) {
      const existing = await findChallengeEnrollment(session.user.id, {
        domain: requestedDomain,
      });

      // ABANDONED blocks this track only — other tracks stay joinable.
      if (existing?.status === "ABANDONED") {
        redirect(`/dashboard?joinBlocked=${requestedDomain}`);
      }

      if (!existing) {
        const result = await createCoreEnrollment(session.user.id, requestedDomain);
        if (!result.ok && result.reason === "abandoned") {
          redirect(`/dashboard?joinBlocked=${requestedDomain}`);
        }
        if (!result.ok && result.reason !== "already_enrolled") {
          redirect(`/dashboard?joinError=${result.reason}`);
        }
      }

      redirect(CORE_TRACK_PATH[requestedDomain]);
    }

    redirect(nextPath);
  }

  const refParam = params.ref;
  const refFromUrlNormalized =
    typeof refParam === "string"
      ? refParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
      : "";
  const refFromUrl =
    refFromUrlNormalized.length > 0 ? refFromUrlNormalized : undefined;
  const refFromCookieRaw = await getRefCookie();
  const refFromCookieNormalized =
    typeof refFromCookieRaw === "string"
      ? refFromCookieRaw
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 6)
      : "";
  const refFromCookie =
    refFromCookieNormalized.length > 0 ? refFromCookieNormalized : undefined;
  const initialRef = refFromUrl ?? refFromCookie ?? "";

  const initialName = session.user.name?.trim() ?? "";

  // A résumé may already be attached: uploads happen before submit, so a reload
  // or an abandoned first attempt must not ask for the file a second time.
  const resume = await getResumeView(session.user.id);

  // Plan 154: an optional password, offered only where saving it cannot be
  // refused — no password yet, not an admin, and a sign-in recent enough that
  // setPasswordAction needs no emailed code. Everyone else can still set one
  // at /settings/security.
  const offerPassword =
    isEmailLoginEnabled() &&
    !hasUsablePassword(userExists) &&
    isFreshSignIn(session.authTime) &&
    !(await isGoogleOnlyAccount(userExists.email, userExists));

  return (
    <div className="theme-abtalks-light theme-abtalks-brand flex min-h-svh flex-col bg-[#F4F4F4]">
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <Card className="w-full max-w-2xl border-border/60 shadow-md">
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Create Your Profile on ABTalks
            </CardTitle>
            {/* Track-neutral: this page is now the shared door for the
                challenge, the hackathon and the cohort funnels alike. */}
            <CardDescription className="text-base">
              Complete your profile to get started. You&apos;re signed in as{" "}
              <span className="font-medium text-foreground">
                {session.user.email ?? session.user.id}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RegistrationForm
              initialName={initialName}
              initialRef={initialRef}
              nextPath={nextPath}
              resumeReady={resume?.status === "READY"}
              resumeFileName={resume?.fileName ?? null}
              otpVerificationRequired={isOtpVerificationRequired()}
              offerPassword={offerPassword}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
