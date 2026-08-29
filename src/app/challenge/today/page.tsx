import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentDayNumber } from "@/lib/date-utils";
import { resolveChallengeEnrollment } from "@/features/enrollment/resolve-dashboard-enrollment";
import { TRACK_CONFIG, dayHref } from "@/components/challenge/track-config";

type PageProps = {
  searchParams: Promise<{ challenge?: string | string[] }>;
};

function readChallengeParam(
  sp: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = sp.challenge;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = typeof v === "string" ? v.trim() : "";
  return t || undefined;
}

export default async function ChallengeTodayPage({
  searchParams,
}: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const sp = await searchParams;
  const challengeEnrollmentId = readChallengeParam(sp);

  const enrollment = await resolveChallengeEnrollment(
    session.user.id,
    challengeEnrollmentId,
  );

  if (!enrollment) {
    redirect("/dashboard");
  }

  const currentDayNumber = getCurrentDayNumber(
    enrollment,
    enrollment.challenge,
  );
  redirect(
    dayHref(TRACK_CONFIG[enrollment.domain], currentDayNumber, enrollment.id),
  );
}
