import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApplyForm } from "@/components/program/apply-form";
import { JoinCodeGate } from "@/components/program/join-code-gate";
import { getEntryState } from "@/features/program/entry";
import { cn } from "@/lib/utils";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 md:py-16">
      {children}
    </main>
  );
}

type Props = {
  searchParams: Promise<{ code?: string; gate?: string }>;
};

export default async function ProgramApplyPage({ searchParams }: Props) {
  const session = await auth();
  const params = await searchParams;
  const code = params.code ?? null;
  const forceGate = params.gate === "1";

  if (!session?.user?.id) {
    const from = code
      ? `/program/apply?code=${encodeURIComponent(code)}`
      : "/program/apply";
    redirect(`/login?from=${encodeURIComponent(from)}`);
  }

  const state = await getEntryState(session.user.id, code);

  const showGate =
    state.screen === "need_code" ||
    state.screen === "invalid_code" ||
    (forceGate && !code && state.screen === "form");

  if (showGate) {
    return (
      <Shell>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Enter your cohort join code</CardTitle>
            <CardDescription>
              You need a join code from your program organizer to apply to a
              specific cohort.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JoinCodeGate
              initialCode={code ?? ""}
              invalid={state.screen === "invalid_code"}
            />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (state.screen === "closed") {
    return (
      <Shell>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Applications closed</CardTitle>
            <CardDescription>
              {state.cohortName} is no longer accepting new applications.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  if (state.screen === "enrolled") {
    return (
      <Shell>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>You&apos;re enrolled</CardTitle>
            <CardDescription>
              Welcome to AI Cohort. Head to your dashboard to begin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/program/dashboard"
              className={cn(buttonVariants(), "w-full sm:w-auto")}
            >
              Go to dashboard
            </Link>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (state.screen === "waitlisted") {
    return (
      <Shell>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>You&apos;re on the waitlist</CardTitle>
            <CardDescription>
              This cohort is full. We&apos;ll reach out if a spot opens up.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // Assessment quiz removed. `in_progress` / `intro` / `cooldown` / `failed` are
  // unreachable while the entry bypass is on; render a terminal status card rather
  // than redirecting to this same route (that would be an infinite loop).
  if (
    state.screen === "in_progress" ||
    state.screen === "intro" ||
    state.screen === "cooldown" ||
    state.screen === "failed"
  ) {
    return (
      <Shell>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Application status</CardTitle>
            <CardDescription>
              Please contact your program organizer if you need help joining
              this cohort.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // state.screen === "form"
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Apply to {state.cohortName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about your professional background to join the program.
        </p>
        {!code && (
          <p className="mt-2 text-sm text-muted-foreground">
            Applying to a different cohort?{" "}
            <Link
              href="/program/apply?gate=1"
              className="underline underline-offset-4"
            >
              Enter a join code
            </Link>
          </p>
        )}
      </div>
      <ApplyForm joinCode={state.joinCode} />
    </Shell>
  );
}
