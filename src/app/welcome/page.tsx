import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { WelcomeContinue } from "@/components/candidate-welcome/welcome-continue";
import { WelcomeScreen } from "@/components/candidate-welcome/welcome-screen";
import { getProfileSummary } from "@/repositories/candidate";

export const metadata: Metadata = {
  title: "Welcome back | ABTalks",
};

// Only same-origin dashboard paths: this screen exists to lead into the
// dashboard, and accepting anything else would turn ?next= into an open redirect.
const nextSchema = z.string().regex(/^\/dashboard(?:[/?#]|$)/);

type Props = {
  searchParams: Promise<{ next?: string | string[] }>;
};

function firstName(
  fullName: string | null | undefined,
  sessionName: string | null | undefined,
): string {
  const source = fullName?.trim() || sessionName?.trim() || "";
  return source.split(/\s+/).find((part) => part.length > 0) ?? "";
}

// Candidate sign-in lands here (see app/login/login-client.tsx), then continues
// to the dashboard once it has been preloaded.
export default async function WelcomePage({ searchParams }: Props) {
  const { next: rawNext } = await searchParams;
  const parsed = nextSchema.safeParse(rawNext);
  const next = parsed.success ? parsed.data : "/dashboard";

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?from=${encodeURIComponent(next)}`);
  }

  if (session.user.isAdmin || (session.user as { role?: string }).role === "ADMIN") {
    redirect("/admin");
  }

  const profile = await getProfileSummary(session.user.id);
  const name = firstName(profile?.fullName, session.user.name);

  return (
    <>
      <WelcomeScreen name={name} />
      <WelcomeContinue href={next} />
    </>
  );
}
