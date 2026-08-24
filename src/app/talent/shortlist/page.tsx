import type { Metadata } from "next";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { getShortlist } from "@/features/talent-pool/pool";
import { existingEngagements } from "@/features/hire/contact-access";
import { type CartRow } from "@/components/hire/shortlist-cart";
import {
  ApprovedCart,
  GuestCartView,
} from "@/components/hire/guest-cart-view";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";

export const metadata: Metadata = {
  title: "Your cart | ABTalks Hire",
};

export default async function TalentShortlistPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const state = userId ? await getRecruiterState(userId) : { status: "none" as const };

  if (state.status !== "approved" || !userId) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            Step 3 · Review &amp; request
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Your cart
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Saved on this device until you sign in. Checkout asks you to
            register or sign in — you stay on this page.
          </p>
        </header>
        <GuestCartView />
      </div>
    );
  }

  const result = await getShortlist(userId);
  if (!result.ok) {
    return <p className="text-sm text-muted-foreground">{result.message}</p>;
  }

  const engagements = await existingEngagements(
    userId,
    result.data.map((r) => r.userId),
  );

  const rows: CartRow[] = result.data.map((r) => ({
    candidateRef: encodeCandidateRef("PROGRAM", r.memberId),
    memberId: r.memberId,
    jobRole: r.jobRole,
    totalScore: r.totalScore,
    note: r.note,
    displayName: r.displayName,
    revealedName: r.revealedName,
    engagementStatus: engagements.get(r.userId)?.status ?? null,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          Step 3 · Review &amp; request
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Your cart
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          {rows.length === 0
            ? "Add candidates as you search, then request them together."
            : `${rows.length} candidate${rows.length === 1 ? "" : "s"} saved. Pick who you want introduced, add a note, and send it as one request.`}
        </p>
      </header>

      <ApprovedCart rows={rows} />
    </div>
  );
}
