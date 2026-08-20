import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Domain } from "@prisma/client";
import { ExternalLink, Users } from "lucide-react";
import { auth } from "@/auth";
import { getProfile } from "@/features/profile/get-profile";
import { AppHeader } from "@/components/shared/app-header";
import { CopyReferralLinkButton } from "@/components/profile/copy-referral-link-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { SoundPreferences } from "@/components/profile/sound-preferences";
import { ProfileForm } from "./profile-form";
import type { ProfileFormValues } from "@/lib/validations/profile";
import { userTypeLabel } from "@/lib/profile-display";
import { UserType } from "@prisma/client";
import { isClaudeEnabled, isOtpVerificationRequired } from "@/lib/feature-flags";
import { shouldShowClaudeBanner } from "@/features/user/check-claude-enrollment";
import { getMyRedemptions } from "@/features/marketplace/get-my-redemptions";
import { ClaudeEnrollmentBanner } from "@/components/shared/claude-enrollment-banner";

function domainDisplayName(domain: Domain) {
  switch (domain) {
    case Domain.SE:
      return "Software Engineering";
    case Domain.DS:
      return "Data Science";
    case Domain.AI:
      return "Artificial Intelligence";
    default:
      return domain;
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export default async function ProfilePage() {
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

  const userId = session.user.id;
  const claudeEnabled = isClaudeEnabled();
  const [bundle, claudeBanner, myRedemptions] = await Promise.all([
    getProfile(userId),
    claudeEnabled
      ? shouldShowClaudeBanner(userId)
      : Promise.resolve({ show: false, startsAt: null as Date | null }),
    getMyRedemptions(userId),
  ]);

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  if (!bundle.profile) {
    return (
      <div className="flex min-h-svh flex-col">
        <AppHeader user={headerUser} />
        {claudeBanner.show && claudeBanner.startsAt ? (
          <ClaudeEnrollmentBanner claudeStartsAt={claudeBanner.startsAt} />
        ) : null}
        <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <h1 className="font-display text-lg font-semibold">
            Complete your registration first
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your student profile is not set up yet. Registration will be available
            soon. For now you can return to the dashboard.
          </p>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "default" }), "mt-6")}
          >
            Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  const { user, profile } = bundle;

  const headersList = await headers();
  const host = headersList.get("host") ?? "abtalks.in";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;
  const referralLink = `${baseUrl}/?ref=${profile.referralCode}`;

  const commonFields = {
    fullName: profile.fullName,
    skills: [...profile.skills],
    linkedinUrl: profile.linkedinUrl ?? "",
    resumeUrl: profile.resumeUrl ?? "",
    phone: profile.phone ?? "",
    githubUsername: profile.githubUsername ?? "",
  };

  const formDefaults: ProfileFormValues =
    profile.userType === UserType.STUDENT
      ? {
          userType: "STUDENT",
          ...commonFields,
          college: profile.college ?? "",
          collegeId: profile.collegeId ?? "",
          graduationYear: profile.graduationYear ?? 2026,
        }
      : {
          userType: "PROFESSIONAL",
          ...commonFields,
          organization: profile.organization ?? "",
          role: profile.role ?? "",
          yearsExperience: profile.yearsExperience ?? 0,
        };

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} domain={profile.domain} />
      {claudeBanner.show && claudeBanner.startsAt ? (
        <ClaudeEnrollmentBanner claudeStartsAt={claudeBanner.startsAt} />
      ) : null}
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 space-y-5 px-4 py-5 sm:space-y-8 sm:py-8">
        <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Profile</h1>

        <SoundPreferences />

        <div className="grid min-w-0 gap-5 sm:gap-8 lg:grid-cols-2 lg:items-start">
          <Card className="min-w-0">
            <CardContent className="flex flex-row items-center gap-3 p-4 text-left sm:items-start sm:gap-4 sm:p-6">
              <Avatar size="lg" className="size-14 text-base sm:size-20 sm:text-lg">
                {user.image ? (
                  <AvatarImage src={user.image} alt="" />
                ) : null}
                <AvatarFallback>{initials(profile.fullName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1 sm:space-y-2">
                <p className="text-lg font-semibold tracking-tight sm:text-2xl">
                  {profile.fullName}
                </p>
                <p className="break-words text-xs text-muted-foreground sm:text-sm">
                  {user.email}
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <Badge variant="outline">{userTypeLabel(profile.userType)}</Badge>
                  <Badge variant="secondary">
                    {domainDisplayName(profile.domain)}
                  </Badge>
                  {profile.isReadyForInterview ? (
                    <Badge className="bg-green-600 text-white hover:bg-green-600/90">
                      Ready for interview
                    </Badge>
                  ) : null}
                </div>
                {profile.userType === UserType.STUDENT ? (
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {profile.college}
                    {profile.graduationYear != null
                      ? ` · Class of ${profile.graduationYear}`
                      : null}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {profile.role}
                    {profile.organization ? ` at ${profile.organization}` : null}
                    {profile.yearsExperience != null
                      ? ` · ${profile.yearsExperience} yr${profile.yearsExperience === 1 ? "" : "s"} experience`
                      : null}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-4 sm:space-y-6">
            <Card className="min-w-0">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle>Your information</CardTitle>
                <CardDescription>
                  Domain and email cannot be changed here.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                <ProfileForm
                  initialProfile={formDefaults}
                  phoneVerified={profile.phoneVerified}
                  otpVerificationRequired={isOtpVerificationRequired()}
                />
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle>Resume</CardTitle>
                <CardDescription>Visible to you and admins only.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                {profile.resumeUrl ? (
                  <Link
                    href={profile.resumeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline"
                  >
                    View Resume <ExternalLink className="size-3.5" />
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No resume link added yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle>Your Achievements</CardTitle>
                <CardDescription>Certificates and milestones you&apos;ve earned.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                <Link href="/achievements" className={cn(buttonVariants({ variant: "outline" }))}>
                  View achievements
                </Link>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle>My Redemptions</CardTitle>
                <CardDescription>
                  Items you&apos;ve redeemed with synergy points.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                {myRedemptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No redemptions yet. Visit the{" "}
                    <Link href="/marketplace" className="text-primary underline">
                      marketplace
                    </Link>{" "}
                    to spend your points.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {myRedemptions.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between rounded-lg border p-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">{r.itemTitle}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.dateIso.split("T")[0]} · {r.costSP} SP
                          </p>
                        </div>
                        <Badge>{r.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle>Refer &amp; Earn</CardTitle>
                <CardDescription>
                  Share your link with friends. When they sign up using it, they
                  show up here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 p-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs md:text-sm">
                    {referralLink}
                  </code>
                  <CopyReferralLinkButton link={referralLink} />
                </div>

                <div className="text-xs text-muted-foreground">
                  Or share your code:{" "}
                  <code className="font-mono font-semibold">
                    {profile.referralCode}
                  </code>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Users className="h-5 w-5 text-primary" aria-hidden />
                  </div>
                  <div>
                    <div className="font-display text-xl font-bold">
                      {profile.referralCount}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {profile.referralCount === 1
                        ? "person signed up"
                        : "people signed up"}{" "}
                      using your link
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
