/**
 * What an admin-registered student's `CandidateProfile` is created with
 * (plan 154). Pure.
 *
 * Deliberately thin. `createCandidateIdentity` writes an education row from
 * `college` and an experience row from `organization`; passing those here AND
 * merging the résumé would create each twice. So only what the profile row
 * itself needs goes in, and education / experience / projects / skills / links
 * all arrive through the additive résumé merge — the same merge a self-upload
 * uses. Nothing is invented: phone, location and country stay empty.
 *
 * Capitalisation is not done here: the person-name trigger (plan 154 Part B)
 * formats `fullName` on write, as for every other writer.
 */
import { UserType } from "@prisma/client";
import type { ParsedResume } from "@/features/resume/types";

export type ImportedIdentity = {
  fullName: string;
  userType: UserType;
  headline: string | null;
};

export function identityFromParsedResume(
  parsed: ParsedResume,
): { ok: true; identity: ImportedIdentity } | { ok: false; reason: "no_name" } {
  const fullName = (parsed.candidateName ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!/\p{L}/u.test(fullName)) return { ok: false, reason: "no_name" };

  const professional =
    parsed.estimatedExperienceYears >= 1 && parsed.experience.length > 0;
  const headline = parsed.headline?.trim().slice(0, 200) || null;

  return {
    ok: true,
    identity: {
      fullName,
      userType: professional ? UserType.PROFESSIONAL : UserType.STUDENT,
      headline,
    },
  };
}
