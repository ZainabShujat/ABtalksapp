import Link from "next/link";
import { redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { auth } from "@/auth";
import { getAchievements } from "@/features/certificate/get-achievements";
import { AchievementCard } from "@/components/certificate/achievement-card";
import { AppHeader } from "@/components/shared/app-header";
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
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AchievementsPage() {
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
  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  const achievements = await getAchievements(userId);

  const headersList = await headers();
  const host = headersList.get("host") ?? "abtalks.in";
  const protocol = host.includes("localhost") ? "http" : "https";
  const verifyBaseUrl = `${protocol}://${host}`;

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} />
      <main className="mx-auto w-full min-w-0 max-w-3xl flex-1 space-y-5 px-4 py-5 pb-24 sm:space-y-8 sm:py-8">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Your Achievements
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Certificates and milestones you&apos;ve earned on ABTalks.
          </p>
        </div>

        {achievements.length === 0 ? (
          <Card className="min-w-0">
            <CardHeader className="items-center pb-3 text-center sm:pb-4">
              <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Trophy className="size-6 text-primary" aria-hidden />
              </div>
              <CardTitle>No achievements yet</CardTitle>
              <CardDescription>
                Finish a challenge, hackathon or cohort and your certificate will
                show up here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center p-4 sm:p-6">
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ variant: "default" }))}
              >
                Back to dashboard
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {achievements.map((achievement) => (
              <AchievementCard
                key={achievement.key}
                achievement={achievement}
                verifyBaseUrl={verifyBaseUrl}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
