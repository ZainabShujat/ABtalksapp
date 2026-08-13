import Link from "next/link";
import { redirect } from "next/navigation";
import { InterviewJourney } from "@/components/interview/interview-journey";
import {
  getInterviewProvider,
  isDemoMode,
  resolveCandidateId,
} from "@/features/interview/provider";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "General AI Interview — ABTalks",
  description:
    "A standardised interview built from the challenge work you have actually completed.",
};

/**
 * Entry point for the General AB Talks AI Interview.
 *
 * Server Component: it resolves the candidate and reads eligibility, then hands
 * plain data to the client journey. No functions or class instances cross the
 * boundary.
 */
export default async function InterviewPage() {
  const candidateId = await resolveCandidateId();
  if (!candidateId) redirect("/login");

  const provider = await getInterviewProvider();
  const overview = await provider.getOverview(candidateId);

  return (
    <>
      <header className="border-b-2 border-[hsl(var(--divider)/0.4)]">
        <div className="shell flex items-center justify-between py-4">
          <Link
            href="/dashboard"
            className="focus-spark text-[15px] font-extrabold leading-6"
          >
            ABTalks
          </Link>
          <Link
            href="/dashboard"
            className="focus-spark text-[15px] leading-6 text-foreground/70 underline underline-offset-4"
          >
            Back to dashboard
          </Link>
        </div>
      </header>
      <main className="shell py-10">
        {isDemoMode() && (
          <div className="mb-8 border-2 border-[hsl(var(--divider)/0.4)] bg-[hsl(var(--muted))] px-5 py-4">
            <span className="kicker">Demo mode</span>
            <p className="mt-2 text-[15.5px] leading-7 text-foreground/78">
              Interview logic, question selection, follow-ups and scoring are
              real. Only storage is in-memory — nothing is saved, and restarting
              the server clears this session.
            </p>
          </div>
        )}

        {overview.ok ? (
          <InterviewJourney overview={overview.data} />
        ) : (
          <div className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
            <span className="kicker">Not available</span>
            <h1 className="mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.015em]">
              We could not load your interview
            </h1>
            <p className="mt-3 max-w-[62ch] text-[15.5px] leading-7 text-foreground/78">
              {overview.message}
            </p>
          </div>
        )}
      </main>
    </>
  );
}
