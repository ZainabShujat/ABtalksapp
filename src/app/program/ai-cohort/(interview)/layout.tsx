import { requireProgramMember } from "@/lib/program-auth";

/**
 * Shell for the cohort interview screens.
 *
 * These routes sit OUTSIDE the `(app)` group so the interview runs without the
 * program's sticky nav — during a timed assessment, "Leaderboard" and "Videos"
 * are exits, not navigation. The background matches `(app)` exactly, so the
 * only difference the candidate sees is the missing chrome.
 *
 * This shell used to force `bg-[#040A12] text-white`, back when the interview
 * had its own dark palette. It now follows the cream design system like the
 * rest of the site, and forcing a dark page here left a white report card
 * floating on a black screen.
 *
 * The route group is parenthesised, so the URLs are unchanged —
 * `/program/ai-cohort/cohort-interview/[blueprint]` and `.../report` still resolve here.
 *
 * The membership guard is repeated because a layout in one group does not run
 * for another. `requireProgramMember()` stays the single gate, exactly as in
 * `(app)/layout.tsx`.
 */
export default async function ProgramInterviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProgramMember();

  return (
    <div className="min-h-svh bg-[#FBF9F7] font-content text-[#111111]">
      <main className="mx-auto w-full min-w-0 max-w-[1536px] px-4 py-6">
        {children}
      </main>
    </div>
  );
}
