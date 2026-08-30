import { Domain } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { getChallengeByDomain, findChallengeEnrollment } from "@/repositories/learning";

/**
 * CLAUDE cohort start is immutable content — cache it indefinitely (tag
 * `challenge:CLAUDE`, bust on reseed). Stored as epoch ms to survive cache
 * serialization, reconstructed to a Date by the caller.
 */
const getClaudeChallengeStartsAtMs = unstable_cache(
  async (): Promise<number | null> => {
    const challenge = await getChallengeByDomain(Domain.CLAUDE);
    return challenge?.startsAt ? challenge.startsAt.getTime() : null;
  },
  ["claude-challenge-starts-at"],
  { tags: ["challenge:CLAUDE"], revalidate: false },
);

export async function shouldShowClaudeBanner(
  userId: string,
  hasClaudeEnrollment?: boolean,
): Promise<{
  show: boolean;
  startsAt: Date | null;
}> {
  const startsAtMs = await getClaudeChallengeStartsAtMs();

  if (startsAtMs === null) {
    return { show: false, startsAt: null };
  }

  let enrolled: boolean;
  if (typeof hasClaudeEnrollment === "boolean") {
    enrolled = hasClaudeEnrollment;
  } else {
    const enrollment = await findChallengeEnrollment(userId, {
      domain: Domain.CLAUDE,
    });
    enrolled = enrollment !== null;
  }

  if (enrolled) {
    return { show: false, startsAt: null };
  }

  return { show: true, startsAt: new Date(startsAtMs) };
}
