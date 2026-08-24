import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isProgramEnabled } from "@/lib/feature-flags";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { getRecruiterAccountSnapshot } from "@/features/hire/recruiter-account";
import { HireAuthProvider } from "@/components/hire/hire-auth-provider";
import { MergeGuestCart } from "@/components/hire/merge-guest-cart";
import { TalentShell } from "@/components/talent/talent-shell";

export default async function TalentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isProgramEnabled()) notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const state = userId ? await getRecruiterState(userId) : { status: "none" as const };
  const approved = state.status === "approved";
  const pending = state.status === "pending";
  const account = userId && approved ? await getRecruiterAccountSnapshot(userId) : null;

  return (
    <HireAuthProvider
      approved={approved}
      signedIn={Boolean(userId)}
      pending={pending}
    >
      {/* Same reason as the /hire layout: a pending recruiter's ask has to be
          recorded before the browser session that holds it goes away. */}
      {(approved || pending) && <MergeGuestCart />}
      <TalentShell account={account}>{children}</TalentShell>
    </HireAuthProvider>
  );
}
