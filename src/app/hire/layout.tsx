import type { ReactNode } from "react";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { getRecruiterAccountSnapshot } from "@/features/hire/recruiter-account";
import { existingEngagements } from "@/features/hire/contact-access";
import { getShortlist } from "@/features/talent-pool/pool";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { HireAuthProvider } from "@/components/hire/hire-auth-provider";
import { HireDeskProvider } from "@/components/hire/hire-desk-context";
import { HireChrome } from "@/components/hire/hire-chrome";
import { MergeGuestCart } from "@/components/hire/merge-guest-cart";
import type { CartRow } from "@/components/hire/shortlist-cart";
import "./hire-scout.css";

export default async function HireLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const state = userId ? await getRecruiterState(userId) : { status: "none" as const };
  const approved = state.status === "approved";
  const pending = state.status === "pending";
  const account = userId && approved ? await getRecruiterAccountSnapshot(userId) : null;

  let podRows: CartRow[] = [];
  if (userId && approved) {
    const list = await getShortlist(userId);
    if (list.ok) {
      const engagements = await existingEngagements(
        userId,
        list.data.map((r) => r.userId),
      );
      podRows = list.data.map((r) => ({
        candidateRef: encodeCandidateRef("PROGRAM", r.memberId),
        memberId: r.memberId,
        jobRole: r.jobRole,
        totalScore: r.totalScore,
        note: r.note,
        displayName: r.displayName,
        skills: r.skills,
        yearsExperience: r.yearsExperience,
        source: "PROGRAM" as const,
        revealedName: r.revealedName,
        engagementStatus: engagements.get(r.userId)?.status ?? null,
      }));
    }
  }

  return (
    <HireAuthProvider
      approved={approved}
      signedIn={Boolean(userId)}
      pending={pending}
    >
      {/* Also for a recruiter still awaiting approval: they registered
          *because* they wanted specific candidates, and that ask lives in
          sessionStorage until it is recorded. Approval arrives hours later in
          another session, by which time it is gone. */}
      {(approved || pending) && <MergeGuestCart />}
      <HireDeskProvider>
        <HireChrome
          account={account}
          serverCartCount={account?.cartCount ?? 0}
          pendingName={pending && state.status === "pending" ? state.fullName : null}
          podRows={podRows}
        >
          {children}
        </HireChrome>
      </HireDeskProvider>
    </HireAuthProvider>
  );
}
