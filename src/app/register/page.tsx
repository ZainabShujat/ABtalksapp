import { redirect } from "next/navigation";
import { getRefCookie } from "@/lib/cookies";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isClaudeEnabled, isOtpVerificationRequired } from "@/lib/feature-flags";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RegistrationForm } from "./registration-form";

type PageProps = {
  searchParams: Promise<{ ref?: string; domain?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });

  if (!userExists) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId: session.user.id },
    select: { id: true, status: true },
  });

  if (enrollment?.status === "ABANDONED") {
    redirect("/dashboard");
  }

  if (profile && enrollment) {
    redirect("/dashboard");
  }

  if (profile && !enrollment) {
    await prisma.studentProfile.delete({
      where: { userId: session.user.id },
    });
  }

  const params = await searchParams;
  const claudeEnabled = isClaudeEnabled();
  const requested = params.domain;
  const initialDomain =
    requested === "CLAUDE"
      ? (claudeEnabled ? "CLAUDE" : undefined)
      : requested === "SE" || requested === "DS" || requested === "AI"
        ? requested
        : undefined;
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

  return (
    <div className="flex min-h-svh flex-col bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <Card className="w-full max-w-2xl border-border/60 shadow-md">
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome to ABTalks!
            </CardTitle>
            <CardDescription className="text-base">
              Complete your profile to start your 60-day journey. You&apos;re
              signed in as{" "}
              <span className="font-medium text-foreground">
                {session.user.email ?? session.user.id}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RegistrationForm
              initialName={initialName}
              initialRef={initialRef}
              claudeEnabled={claudeEnabled}
              initialDomain={initialDomain}
              otpVerificationRequired={isOtpVerificationRequired()}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
