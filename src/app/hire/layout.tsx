import type { ReactNode } from "react";
import { auth } from "@/auth";
import { isRecruiterAuthEnabled } from "@/lib/feature-flags";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { getRecruiterAccountSnapshot } from "@/features/hire/recruiter-account";
import { getWorkspaceCredits } from "@/features/hire/credits";
import { existingEngagements } from "@/features/hire/contact-access";
import { listProjectShortlistByProject } from "@/features/hire/project-shortlist";
import { prisma } from "@/lib/db";
import { countUnreadForRecruiter } from "@/features/hire/outreach";
import { logger } from "@/lib/logger";
import { getShortlist } from "@/features/talent-pool/pool";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { HireAuthProvider } from "@/components/hire/hire-auth-provider";
import { HireDeskProvider } from "@/components/hire/hire-desk-context";
import { HireChrome } from "@/components/hire/hire-chrome";
import { MergeGuestCart } from "@/components/hire/merge-guest-cart";
import type { CartRow } from "@/components/hire/shortlist-cart";
import { HireZoomScript } from "@/components/hire/hire-zoom-script";
import "./hire-scout.css";

export default async function HireLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const state = userId ? await getRecruiterState(userId) : { status: "none" as const };
  const active = state.status === "active";
  const account = userId && active ? await getRecruiterAccountSnapshot(userId) : null;

  // The header balance, shown only once the recruiter is approved.
  //
  // The $200 exists earlier than this — it is granted when setup completes,
  // before an admin sees the application — but a balance is only worth showing
  // to someone allowed to spend it, and `unlockContact` refuses an unapproved
  // recruiter. Displaying credits beside a "Pending" badge would advertise
  // spending power the product does not yet grant. So the backend holds it and
  // the UI waits, which is why this goes through `getWorkspaceCredits` and its
  // existing workspace boundary rather than a looser read.
  //
  // Resolved server-side because this layout already resolves the recruiter,
  // so the figure needs no client fetch and therefore no loading state.
  const credits = account ? await getWorkspaceCredits() : null;

  // T-232: the desk has no notification bell, so an outreach reply shows here
  // as a count on Messages. The recruiter is also emailed (outreach.reply_received).
  const unreadMessages = userId && active ? await countUnreadForRecruiter(userId) : 0;

  // Plan 133: the recruiter's projects, for switching between them in the nav
  // card. Their own only; archived ones stay put away.
  const projects =
    userId && active
      ? (
          await prisma.talentRequest.findMany({
            where: { recruiterUserId: userId, archivedAt: null },
            orderBy: { updatedAt: "desc" },
            take: 8,
            select: { id: true, name: true, title: true, updatedAt: true },
          })
        ).map((p) => ({
          id: p.id,
          label: p.name?.trim() || p.title.trim() || "Untitled project",
          // The nav card's "Updated 2d ago". Already the orderBy of this query,
          // so selecting it costs nothing. ISO because it crosses to a Client
          // Component, and a Date instance does not survive that boundary.
          updatedAt: p.updatedAt.toISOString(),
        }))
      : [];

  // The header shortlist is the union of TWO stores, and it has to be, because
  // neither can name every candidate:
  //
  //   - RecruiterShortlistItem (legacy, T-027) is a hard FK to ProgramMember,
  //     so it only ever holds AI-cohort members.
  //   - TalentRequestMatch.decision (T-149) is keyed on candidateUserId and
  //     covers every track, but only exists inside a talent project.
  //
  // Reading only the first is why a candidate shortlisted inside a project was
  // written to the database correctly and then appeared nowhere. Both are
  // loaded here ONCE; HireChrome then scopes them (plan 133) — the open
  // project's rows inside a project, the legacy rows only off-project — and
  // derives the count from that same scoped array, so the header can never
  // show a number the panel cannot list.
  let podRows: CartRow[] = [];
  if (userId && active) {
    // NO try/catch around listProjectShortlist on purpose. If the project
    // shortlist query fails — a missing column, a migration that never reached
    // this environment — this surface must fail LOUDLY. A caught error here
    // renders a plausible header with a silently short shortlist, which is
    // exactly how a schema drift stayed hidden until it cost a day to find.
    // Plan 133: one row per PROJECT × candidate. HireChrome shows only the
    // open project's rows, and legacy rows only off-project — the two stores
    // are never merged into one project's list.
    const [legacy, project] = await Promise.all([
      getShortlist(userId),
      listProjectShortlistByProject(userId),
    ]);

    const legacyRows = legacy.ok ? legacy.data : [];
    const engagements = await existingEngagements(userId, [
      ...legacyRows.map((r) => r.userId),
      ...project.map((r) => r.candidateUserId),
    ]);

    podRows = legacyRows.map((r) => ({
      candidateRef: encodeCandidateRef("PROGRAM", r.memberId),
      memberId: r.memberId,
      jobRole: r.jobRole ?? "Candidate",
      totalScore: r.totalScore,
      note: r.note,
      displayName: r.displayName,
      skills: r.skills,
      yearsExperience: r.yearsExperience ?? undefined,
      source: "PROGRAM" as const,
      openToWork: r.openToWork,
      revealedName: r.revealedName,
      engagementStatus: engagements.get(r.userId)?.status ?? null,
    }));

    // Dedupe within ONE project: the same person shortlisted in Project A and
    // Project B is a row in each. Legacy and project rows are never shown
    // together (HireChrome scopes them), so they are not deduped against each
    // other any more — doing so hid a project's row behind a legacy one.
    const seen = new Set<string>();
    for (const r of project) {
      const key = `${r.requestId}:${r.candidateRef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      podRows.push({
        candidateRef: r.candidateRef,
        memberId: r.memberId,
        jobRole: r.jobRole,
        totalScore: r.totalScore,
        note: null,
        displayName: r.displayName,
        skills: r.skills,
        source: r.source,
        revealedName: null,
        engagementStatus: engagements.get(r.candidateUserId)?.status ?? null,
        yearsExperience: r.yearsExperience,
        missionsPassed: r.missionsPassed,
        certificateIssued: r.certificateIssued,
        rationale: r.rationale,
        // Coordinates the pod needs to remove this row through T-149.
        projectRequestId: r.requestId,
        candidateUserId: r.candidateUserId,
      });
    }
  }

  return (
    <>
      {/* Screen 2's scale, set while the HTML is still parsing — before the
          dashboard can paint at full size. HireZoomScript safely handles SSR
          and avoids React 19 client <script> warnings. */}
      <HireZoomScript />
      <HireAuthProvider
        approved={active}
        signedIn={Boolean(userId)}
        authEnabled={isRecruiterAuthEnabled()}
      >
        {/* A recruiter who registered *because* they wanted specific candidates
            keeps that ask in sessionStorage until it is recorded, and the
            session that recorded it may not be the one that placed it. */}
        {active && <MergeGuestCart />}
        <HireDeskProvider>
          <HireChrome
            account={account}
            credits={
              credits?.ok
                ? {
                  balanceMinor: credits.data.balanceMinor,
                  currency: credits.data.currency,
                  level: credits.data.level,
                }
                : null
            }
            // HireChrome scopes these to the open project and counts the scoped
            // array, so the badge and the list can never disagree.
            // `account.cartCount` counts the legacy table only.
            podRows={podRows}
            unreadMessages={unreadMessages}
            projects={projects}
          >
            {children}
          </HireChrome>
        </HireDeskProvider>
      </HireAuthProvider>
    </>
  );
}
