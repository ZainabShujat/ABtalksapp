import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRecruiter } from "@/lib/program-auth";
import { ScoutChat } from "@/components/hire/scout-chat";
import { loadRequestMatches } from "@/features/hire/load-request-matches";
import { jobSpecSchema, type JobSpec } from "@/lib/validations/hire";

type Props = { params: Promise<{ requestId: string }> };

export const metadata: Metadata = {
  title: "Scout search | ABTalks Hire",
};

export default async function HireRequestPage({ params }: Props) {
  const { userId } = await requireRecruiter();
  const { requestId } = await params;

  let request;
  try {
    request = await prisma.talentRequest.findFirst({
      where: { id: requestId, recruiterUserId: userId },
      select: {
        id: true,
        title: true,
        status: true,
        alertWhenAvailable: true,
        seniority: true,
        openings: true,
        mustHaveStack: true,
        niceToHaveStack: true,
        evidencePriority: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        salaryPeriod: true,
        workMode: true,
        locationCity: true,
        employmentType: true,
        noticePeriodDays: true,
        minExperience: true,
        maxExperience: true,
        requiresDegree: true,
        extra: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            options: true,
          },
          take: 50,
        },
      },
    });
  } catch {
    notFound();
  }

  if (!request) notFound();

  // Prisma stores "" on a draft that has no role yet. jobSpecSchema treats
  // title as optional, but rejects empty string (min 1). Same for currency.
  const blank = (s: string | null | undefined) => {
    const t = s?.trim();
    return t ? t : undefined;
  };

  const parsed = jobSpecSchema.safeParse({
    title: blank(request.title),
    seniority: request.seniority,
    openings: request.openings,
    mustHaveStack: request.mustHaveStack,
    niceToHaveStack: request.niceToHaveStack,
    evidencePriority: request.evidencePriority,
    salaryMin: request.salaryMin,
    salaryMax: request.salaryMax,
    salaryCurrency: blank(request.salaryCurrency),
    salaryPeriod: request.salaryPeriod === "MONTHLY" ? "MONTHLY" : "ANNUAL",
    workMode: request.workMode,
    locationCity: request.locationCity,
    employmentType: request.employmentType,
    noticePeriodDays: request.noticePeriodDays,
    minExperience: request.minExperience,
    maxExperience: request.maxExperience,
    requiresDegree: request.requiresDegree,
    extra:
      request.extra && typeof request.extra === "object"
        ? (request.extra as Record<string, unknown>)
        : undefined,
  });
  const spec: JobSpec = parsed.success ? parsed.data : {};

  const matchData = await loadRequestMatches(requestId, userId);
  const matches = matchData?.matches ?? [];

  const messages = request.messages.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: m.content,
    options: Array.isArray(m.options)
      ? (m.options as { label: string; value: string }[])
      : null,
  }));

  const summary = [
    request.title,
    request.mustHaveStack.join(", "),
    request.seniority,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScoutChat
      persist
      initialRequestId={request.id}
      initialMessages={messages}
      initialSpec={spec}
      initialSummary={summary || request.title}
      results={matches}
      resultsCartCount={matchData?.cartCount ?? 0}
      alertWhenAvailable={request.alertWhenAvailable}
      initialSearched={request.status !== "DRAFT" || matches.length > 0}
    />
  );
}
