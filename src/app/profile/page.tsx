import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CandidatePersona } from "@prisma/client";
import { Users } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { getCandidateDetail } from "@/repositories/candidate-detail";
import { getProfileEvidence } from "@/features/profile/get-evidence";
import { computeCompleteness } from "@/features/profile/completeness";
import { getPopularSkills } from "@/features/skill/search-skills";
import { getMyRedemptions } from "@/features/marketplace/get-my-redemptions";
import { getActiveAttempt, getHistory } from "@/features/interview/platform/service";
import { Mic } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { CopyReferralLinkButton } from "@/components/profile/copy-referral-link-button";
import { SoundPreferences } from "@/components/profile/sound-preferences";
import { ProfileStrength } from "@/components/profile/profile-strength";
import { ProfileSection } from "@/components/profile/profile-section";
import { BasicInfoSection } from "@/components/profile/basic-info-section";
import { ExperienceSection } from "@/components/profile/experience-section";
import { EducationSection } from "@/components/profile/education-section";
import { ProjectsSection } from "@/components/profile/projects-section";
import { MockInterviewsSection } from "@/components/profile/mock-interviews-section";
import { SkillsSection } from "@/components/profile/skills-section";
import { CertificationsSection } from "@/components/profile/certifications-section";
import { LinksSection } from "@/components/profile/links-section";
import { PreferencesSection } from "@/components/profile/preferences-section";
import { EvidenceSection } from "@/components/profile/evidence-section";
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
import { PERSONA_LABELS } from "@/lib/candidate-vocab";

/** Nulls become "" so every input stays controlled from first render. */
const s = (v: string | null | undefined) => v ?? "";

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

  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, image: true },
  });

  if (!user) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  const shellUser = {
    name: session.user.name ?? user.email ?? "",
    email: user.email ?? "",
    image: user.image ?? null,
  };

  // Canonical: the 078 candidate tables, read directly. These sections have no
  // legacy equivalent, so nothing here branches on ENABLE_NEW_CANDIDATE.
  const detail = await getCandidateDetail(userId);

  if (!detail) {
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={session.user.isAdmin ?? false}
        showSectionNav={false}
      >
        <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <h1 className="font-display text-lg font-semibold">
            Complete your registration first
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your candidate profile is not set up yet. Once you have registered
            for a track you can build out your full profile here.
          </p>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "default" }), "mt-6")}
          >
            Back to dashboard
          </Link>
        </main>
      </DashboardShell>
    );
  }

  const [
    evidence,
    popularSkills,
    myRedemptions,
    referralCount,
    headersList,
    mockInterviewHistory,
    activeMockInterview,
  ] = await Promise.all([
      getProfileEvidence(userId),
      getPopularSkills(10),
      getMyRedemptions(userId),
      prisma.referral.count({ where: { referrerId: userId } }),
      headers(),
      // The MockInterview tables exist on demo but the migration has not been
      // applied to production, so this query throws there until it is. The
      // profile must not 500 over it — it degrades to an empty list, which
      // renders the section's "none taken yet" copy.
      getHistory(userId).catch((e: unknown) => {
        logger.warn("[profile] mock interview history unavailable", {
          message: e instanceof Error ? e.message : String(e),
        });
        return { ok: false as const, message: "unavailable" };
      }),
      getActiveAttempt(userId).catch((e: unknown) => {
        logger.warn("[profile] active mock interview unavailable", {
          message: e instanceof Error ? e.message : String(e),
        });
        return { ok: false as const, message: "unavailable" };
      }),
    ]);

  const mockInterviews = mockInterviewHistory.ok ? mockInterviewHistory.data : [];
  const activeAttempt = activeMockInterview.ok ? activeMockInterview.data : null;
  const isCurrentlyInterviewing = Boolean(activeAttempt);
  const hasTakenInterviews = mockInterviews.length > 0;

  const completeness = computeCompleteness(detail, { hasAny: evidence.hasAny });
  const status = new Map(completeness.sections.map((x) => [x.key, x]));
  const sectionOf = (key: string) => status.get(key as never);

  const host = headersList.get("host") ?? "abtalks.in";
  const protocol = host.includes("localhost") ? "http" : "https";
  const referralLink = `${protocol}://${host}/?ref=${detail.referralCode}`;

  const claimedSkills = detail.skills.filter((x) => x.claimedByCandidate);

  return (
    <DashboardShell
      user={{ ...shellUser, name: detail.fullName || shellUser.name }}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <main className="mx-auto w-full min-w-0 max-w-4xl flex-1 space-y-5 px-4 py-5 sm:space-y-6 sm:py-8">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <Card className="min-w-0">
          <CardContent className="flex flex-row items-start gap-4 p-4 sm:p-6">
            <Avatar size="lg" className="size-14 text-base sm:size-20 sm:text-lg">
              {user.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback>{initials(detail.fullName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {detail.fullName}
              </h1>
              {detail.headline ? (
                <p className="text-sm text-foreground/80">{detail.headline}</p>
              ) : null}
              <p className="break-words text-xs text-muted-foreground sm:text-sm">
                {user.email}
                {detail.locationCity ? ` · ${detail.locationCity}` : null}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="outline">
                  {PERSONA_LABELS[detail.primaryPersona] ??
                    detail.primaryPersona}
                </Badge>
                {detail.isReadyForInterview ? (
                  <Badge className="bg-green-600 text-white hover:bg-green-600/90">
                    Ready for interview
                  </Badge>
                ) : null}
                {evidence.verifiedSkills.length > 0 ? (
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90">
                    {evidence.verifiedSkills.length} verified skill
                    {evidence.verifiedSkills.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <ProfileStrength data={completeness} />

        {/* ── Editable sections ──────────────────────────────────────── */}
        <div className="space-y-3">
          <ProfileSection
            title="Basic information"
            description="How you are introduced across the platform."
            complete={sectionOf("basic")?.complete ?? false}
            hint={sectionOf("basic")?.hint}
            defaultOpen={!(sectionOf("basic")?.complete ?? false)}
            summary={detail.headline}
          >
            <BasicInfoSection
              phoneVerified={detail.phoneVerified}
              initial={{
                fullName: detail.fullName,
                phone: s(detail.phone),
                headline: s(detail.headline),
                summary: s(detail.summary),
                locationCity: s(detail.locationCity),
                locationRegion: s(detail.locationRegion),
                countryCode: s(detail.countryCode),
                primaryPersona: detail.primaryPersona ?? CandidatePersona.STUDENT,
              }}
            />
          </ProfileSection>

          <ProfileSection
            title="Experience"
            description="Roles, internships, and freelance work."
            complete={sectionOf("experience")?.complete ?? false}
            hint={sectionOf("experience")?.hint}
            summary={
              detail.experience.length > 0
                ? `${detail.experience.length} role${detail.experience.length === 1 ? "" : "s"}`
                : null
            }
          >
            <ExperienceSection
              initial={detail.experience.map((e) => ({
                companyName: e.companyName,
                title: e.title,
                employmentType: s(e.employmentType),
                locationCity: s(e.locationCity),
                startMonth: e.startMonth,
                startYear: e.startYear,
                endMonth: e.endMonth,
                endYear: e.endYear,
                isCurrent: e.isCurrent,
                description: s(e.description),
              }))}
            />
          </ProfileSection>

          <ProfileSection
            title="Education"
            description="College, school, and any additional qualifications."
            complete={sectionOf("education")?.complete ?? false}
            hint={sectionOf("education")?.hint}
            summary={
              detail.education.length > 0
                ? `${detail.education.length} entr${detail.education.length === 1 ? "y" : "ies"}`
                : null
            }
          >
            <EducationSection
              initial={detail.education.map((e) => ({
                institutionName: e.institutionName,
                collegeId: s(e.collegeId),
                degree: s(e.degree),
                fieldOfStudy: s(e.fieldOfStudy),
                startMonth: e.startMonth,
                startYear: e.startYear,
                endMonth: e.endMonth,
                graduationYear: e.graduationYear,
                isCurrent: e.isCurrent,
                gradeType: e.gradeType ?? "",
                grade: s(e.grade),
                description: s(e.description),
              }))}
            />
          </ProfileSection>

          <ProfileSection
            title="Projects"
            description="Things you have built, with links a recruiter can open."
            complete={sectionOf("projects")?.complete ?? false}
            hint={sectionOf("projects")?.hint}
            summary={
              detail.projects.length > 0
                ? `${detail.projects.length} project${detail.projects.length === 1 ? "" : "s"}`
                : null
            }
          >
            <ProjectsSection
              initial={detail.projects.map((p) => ({
                title: p.title,
                description: s(p.description),
                techStack: p.techStack,
                repoUrl: s(p.repoUrl),
                liveUrl: s(p.liveUrl),
              }))}
            />
          </ProfileSection>

          <ProfileSection
            title="Mock interviews"
            description="Live AI interviews you have taken. Earned, not entered."
            complete={null}
            icon={
              isCurrentlyInterviewing ? (
                <span
                  className="relative flex size-5 shrink-0 items-center justify-center"
                  aria-hidden
                >
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <Mic className="relative size-5 shrink-0 text-emerald-500 animate-pulse" />
                </span>
              ) : hasTakenInterviews ? (
                <Mic
                  className="size-5 shrink-0 text-emerald-500"
                  aria-hidden
                />
              ) : (
                <Mic
                  className="size-5 shrink-0 text-muted-foreground/50"
                  aria-hidden
                />
              )
            }
            summary={
              isCurrentlyInterviewing
                ? `${mockInterviews.length > 0 ? `${mockInterviews.length} interview${mockInterviews.length === 1 ? "" : "s"} · ` : ""}In progress`
                : mockInterviews.length > 0
                  ? `${mockInterviews.length} interview${mockInterviews.length === 1 ? "" : "s"}`
                  : "None taken yet"
            }
          >
            <MockInterviewsSection
              attempts={mockInterviews}
              activeAttempt={activeAttempt}
            />
          </ProfileSection>

          <ProfileSection
            title="Skills"
            description="What you claim, kept separate from what the platform can verify."
            complete={sectionOf("skills")?.complete ?? false}
            hint={sectionOf("skills")?.hint}
            summary={
              claimedSkills.length > 0
                ? `${claimedSkills.length} skill${claimedSkills.length === 1 ? "" : "s"}`
                : null
            }
          >
            <SkillsSection
              popular={popularSkills}
              initial={claimedSkills.map((sk) => ({
                skillId: sk.skillId,
                name: sk.name,
                categoryName: sk.categoryName,
                selfRated: sk.selfRated,
                verified: sk.verified,
                evidenceCount: sk.evidenceCount,
              }))}
            />
          </ProfileSection>

          <ProfileSection
            title="Certifications"
            description="External certifications you hold."
            complete={sectionOf("certifications")?.complete ?? false}
            hint={sectionOf("certifications")?.hint}
            summary={
              detail.certifications.length > 0
                ? `${detail.certifications.length} certification${detail.certifications.length === 1 ? "" : "s"}`
                : null
            }
          >
            <CertificationsSection
              initial={detail.certifications.map((c) => ({
                name: c.name,
                issuer: c.issuer,
                issuedMonth: c.issuedMonth,
                issuedYear: c.issuedYear,
                expiresMonth: c.expiresMonth,
                expiresYear: c.expiresYear,
                credentialUrl: s(c.credentialUrl),
              }))}
            />
          </ProfileSection>

          <ProfileSection
            title="Links"
            description="Where your work lives."
            complete={sectionOf("links")?.complete ?? false}
            hint={sectionOf("links")?.hint}
            summary={
              detail.githubUsername ? `github.com/${detail.githubUsername}` : null
            }
          >
            <LinksSection
              initial={{
                linkedinUrl: s(detail.linkedinUrl),
                githubUsername: s(detail.githubUsername),
                portfolioUrl: s(detail.portfolioUrl),
                resumeUrl: s(detail.resumeUrl),
                extra: detail.links.map((l) => ({
                  type: l.type,
                  label: s(l.label),
                  url: l.url,
                })),
              }}
            />
          </ProfileSection>

          <ProfileSection
            title="Career preferences"
            description="What you are looking for. Separate from recruiter visibility."
            complete={sectionOf("preferences")?.complete ?? false}
            hint={sectionOf("preferences")?.hint}
            summary={
              detail.preference?.openToWork ? "Open to work" : null
            }
          >
            <PreferencesSection
              initial={{
                openToWork: detail.preference?.openToWork ?? false,
                preferredRoles: detail.preference?.preferredRoles ?? [],
                preferredLocations: detail.preference?.preferredLocations ?? [],
                opportunityTypes: detail.preference?.opportunityTypes ?? [],
                remotePreference: s(detail.preference?.remotePreference),
                willingToRelocate:
                  detail.preference?.willingToRelocate ?? false,
                noticePeriodDays:
                  detail.preference?.noticePeriodDays === null ||
                  detail.preference?.noticePeriodDays === undefined
                    ? ""
                    : String(detail.preference.noticePeriodDays),
                availableFromMonth:
                  detail.preference?.availableFromMonth ?? null,
                availableFromYear: detail.preference?.availableFromYear ?? null,
              }}
            />
          </ProfileSection>

          <ProfileSection
            title="Evidence & achievements"
            description="What the platform can attest to. Earned, not entered."
            complete={sectionOf("evidence")?.complete ?? false}
            defaultOpen={evidence.hasAny}
            summary={
              evidence.hasAny
                ? `${evidence.verifiedSkills.length} verified · ${evidence.credentials.length} credential${evidence.credentials.length === 1 ? "" : "s"}`
                : "Nothing recorded yet"
            }
          >
            <EvidenceSection evidence={evidence} />
          </ProfileSection>
        </div>

        {/* ── Account ────────────────────────────────────────────────── */}
        <div className="space-y-4 pt-2 sm:space-y-6">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Account
          </h2>

          <SoundPreferences />

          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle>Refer &amp; earn</CardTitle>
              <CardDescription>
                Share your link. When someone signs up with it, they show up
                here.
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
                  {detail.referralCode}
                </code>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Users className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <div>
                  <div className="font-display text-xl font-bold">
                    {referralCount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {referralCount === 1 ? "person" : "people"} signed up using
                    your link
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle>My redemptions</CardTitle>
              <CardDescription>
                Items you have redeemed with synergy points.
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
              <CardTitle>Your achievements</CardTitle>
              <CardDescription>
                Certificates and milestones you have earned.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <Link
                href="/achievements"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                View achievements
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </DashboardShell>
  );
}
