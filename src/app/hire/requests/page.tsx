import type { Metadata } from "next";
import Link from "next/link";
import { requireRecruiter } from "@/lib/program-auth";
import { prisma } from "@/lib/db";
import { CheckoutFlash } from "@/components/hire/checkout-flash";
import { EngagementThread } from "@/components/hire/engagement-thread";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Your requests | ABTalks Hire",
};

const STATUS_COPY: Record<string, { label: string; hint: string }> = {
  SUBMITTED: {
    label: "Sent",
    hint: "Our team has it and will come back to you here.",
  },
  IN_REVIEW: {
    label: "In review",
    hint: "We're checking availability with the candidate.",
  },
  CONTACT_SHARED: {
    label: "Contact shared",
    hint: "Details below — please reach out directly.",
  },
  DECLINED: {
    label: "Declined",
    hint: "This one isn't available. The thread explains why.",
  },
  CLOSED: { label: "Closed", hint: "" },
};

export default async function HireRequestsPage() {
  const { userId } = await requireRecruiter();

  const engagements = await prisma.talentEngagementRequest.findMany({
    where: { recruiterUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      candidatePublicId: true,
      status: true,
      note: true,
      createdAt: true,
      request: { select: { id: true, title: true } },
      programMember: {
        select: {
          jobRole: true,
          yearsExperience: true,
          // Identity is selected only to be shown when the status says it may
          // be. The gate is the query below, not this select — see the filter
          // applied when building `identity`.
          fullName: true,
          user: { select: { email: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, authorRole: true, body: true, createdAt: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <Link href="/hire" className="hire-back">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 19 8 12l7-7" />
        </svg>
        Back to Scout
      </Link>
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          Step 4 · Track your requests
        </p>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          Your requests
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Everything with our team happens here. We confirm availability with
          the candidate first, then share their details.
        </p>
      </div>

      <CheckoutFlash />

      {engagements.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No requests yet. Run a search and ask for an introduction to a
            candidate you like.
          </p>
          <Link
            href="/hire"
            className={cn(buttonVariants({ size: "sm" }), "mt-4")}
          >
            Start a search
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {engagements.map((e) => {
            const copy = STATUS_COPY[e.status] ?? {
              label: e.status,
              hint: "",
            };
            // Identity is released by the decision, never by this page. Anything
            // other than CONTACT_SHARED renders the anonymous view.
            const identity =
              e.status === "CONTACT_SHARED" && e.programMember
                ? {
                    fullName: e.programMember.fullName,
                    email: e.programMember.user?.email ?? null,
                  }
                : null;

            return (
              <li key={e.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      {identity?.fullName ?? e.candidatePublicId}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {e.programMember?.jobRole ?? "Candidate"}
                      {e.request?.title ? ` · for ${e.request.title}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      e.status === "CONTACT_SHARED"
                        ? "bg-primary/10 text-primary"
                        : e.status === "DECLINED"
                          ? "bg-muted text-muted-foreground"
                          : "bg-amber-500/10 text-amber-900 dark:text-amber-100",
                    )}
                  >
                    {copy.label}
                  </span>
                </div>

                {copy.hint && (
                  <p className="text-xs text-muted-foreground">{copy.hint}</p>
                )}

                {identity?.email && (
                  <p className="rounded-lg bg-primary/5 px-3 py-2 text-sm">
                    <a
                      href={`mailto:${identity.email}`}
                      className="text-primary hover:underline"
                    >
                      {identity.email}
                    </a>
                  </p>
                )}

                <EngagementThread
                  engagementId={e.id}
                  canPost={e.status !== "CLOSED"}
                  messages={e.messages.map((m) => ({
                    id: m.id,
                    authorRole: m.authorRole,
                    body: m.body,
                    createdAt: m.createdAt.toISOString(),
                  }))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
