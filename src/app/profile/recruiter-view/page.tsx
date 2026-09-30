import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { getCandidateRecruiterView } from "@/features/profile/recruiter-view";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { RecruiterViewScreen } from "@/components/profile/recruiter-view/recruiter-view-screen";
import { buttonVariants } from "@/components/ui/button";
import "@/components/profile/recruiter-view/recruiter-view.css";

/**
 * `/profile/recruiter-view` — the candidate's own profile as a recruiter sees it
 * (plan 155).
 *
 * PUBLIC-TO-CANDIDATES, NOT TO RECRUITERS. This is the candidate's own record, so
 * the gate is `auth()` and nothing more: `requireRecruiter` / `requireAdmin` here
 * would lock a candidate out of their own page. `/profile` is already in
 * `middleware.ts`'s protected list and this route inherits that prefix.
 *
 * Reads only. Nothing on this page records a view event — a candidate looking at
 * their own preview must not inflate their own "recruiters opened your details"
 * counter.
 */
export default async function RecruiterViewPage() {
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

  const view = await getCandidateRecruiterView(userId);

  if (!view) {
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={session.user.isAdmin ?? false}
        showSectionNav={false}
      >
        <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <h1 className="font-display text-lg font-semibold">
            Build your profile first
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            There is nothing for a recruiter to see yet. Fill in your profile and
            this page will show you exactly how it reads to them.
          </p>
          <Link
            href="/profile"
            className={cn(buttonVariants({ variant: "default" }), "mt-6")}
          >
            Go to your profile
          </Link>
        </main>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <RecruiterViewScreen view={view} />
    </DashboardShell>
  );
}
