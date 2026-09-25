import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Challenge / cohort dual-write default. Distinct from the profile path. */
export const ENROLLMENT_DEFAULT_CONSENT_SOURCE = "platform_default";
/** Usable CandidateProfile with no prior visibility row (plan 117). */
export const PROFILE_DEFAULT_CONSENT_SOURCE = "platform_default_profile";
/** Historical ProgramMember.recruiterVisibilityConsentAt copied as a label. */
export const PROGRAM_APPLY_CONSENT_SOURCE = "program_apply_migrated";

/**
 * Plan 154: an admin registered this student from an imported résumé, and
 * attested that the student agreed to recruiter visibility. The student has
 * not acted yet — `claim_consent` re-stamps the row when they sign in.
 */
export const ADMIN_IMPORT_CONSENT_SOURCE = "admin_resume_import";
/** Plan 154: the imported student signed in with Google and took the account over. */
export const OAUTH_CLAIM_CONSENT_SOURCE = "oauth_claim";

export const PLATFORM_DEFAULT_CONSENT_SOURCES = [
  ENROLLMENT_DEFAULT_CONSENT_SOURCE,
  PROFILE_DEFAULT_CONSENT_SOURCE,
] as const;

export type VisibilityKind =
  | "challenge_enroll"
  | "program_member"
  | "usable_profile"
  | "admin_import"
  | "claim_consent"
  | "admin_withdraw"
  | "probe_restore";

export type ApplyVisibilityResult = {
  ok: true;
  searchableByRecruiters: boolean;
  withdrawnAt: Date | null;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason?:
    | "withdrawn"
    | "already_exists"
    | "already_searchable"
    | "missing_row";
  mirrorFailed: boolean;
};

function shouldInjectLegacyMirrorFailure(): boolean {
  return process.env.VISIBILITY_FAIL_LEGACY_MIRROR === "true";
}

/**
 * Historical `ProgramMember.recruiterVisibilityConsentAt` is evidence, not a
 * gate. Plan 133 stopped stamping it on apply (that would invent consent).
 * Enable does not write a new timestamp. Withdraw does not clear an old one.
 */
async function mirrorLegacyConsent(
  _tx: Tx,
  input: { userId: string; kind: VisibilityKind },
): Promise<void> {
  void _tx;
  void input;
}

async function flushMirror(
  tx: Tx,
  input: { userId: string; kind: VisibilityKind },
): Promise<boolean> {
  try {
    await mirrorLegacyConsent(tx, input);
    return false;
  } catch (err) {
    logger.error("[visibility] legacy consent mirror failed; CandidateVisibility kept", {
      userId: input.userId,
      kind: input.kind,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    return true;
  }
}

/**
 * Sole CandidateVisibility writer. Recruiter discovery is not a candidate
 * preference (plan 133 / D-02). Callers are enrolment dual-write, the usable-
 * profile default, admin anonymize, and the W2 probe.
 *
 * Challenge enrol: create-only; never reopen a closed or withdrawn row.
 * Program member: create, or flip a closed (not withdrawn) historical row on.
 * Usable profile: create-only; any existing row is left as-is.
 * Admin withdraw: searchable=false, withdrawnAt=now. Does not delete the row.
 * Probe restore: test/probe only. Not a product path.
 *
 * CandidatePreference looking-for-work is never read or written here.
 */
export async function applyVisibilityChange(
  tx: Tx,
  input: {
    userId: string;
    kind: VisibilityKind;
    consentedAt?: Date | null;
    at?: Date;
  },
): Promise<ApplyVisibilityResult> {
  const now = input.at ?? new Date();
  const existing = await tx.candidateVisibility.findUnique({
    where: { userId: input.userId },
    select: {
      withdrawnAt: true,
      searchableByRecruiters: true,
      consentSource: true,
      consentedAt: true,
    },
  });

  if (input.kind === "admin_withdraw") {
    if (!existing) {
      return {
        ok: true,
        searchableByRecruiters: false,
        withdrawnAt: now,
        created: false,
        updated: false,
        skipped: true,
        skipReason: "missing_row",
        mirrorFailed: false,
      };
    }
    await tx.candidateVisibility.update({
      where: { userId: input.userId },
      data: {
        searchableByRecruiters: false,
        withdrawnAt: now,
      },
    });
    const mirrorFailed = await flushMirror(tx, input);
    return {
      ok: true,
      searchableByRecruiters: false,
      withdrawnAt: now,
      created: false,
      updated: true,
      skipped: false,
      mirrorFailed,
    };
  }

  if (input.kind === "probe_restore") {
    if (existing) {
      await tx.candidateVisibility.update({
        where: { userId: input.userId },
        data: {
          searchableByRecruiters: true,
          withdrawnAt: null,
        },
      });
    } else {
      await tx.candidateVisibility.create({
        data: {
          userId: input.userId,
          searchableByRecruiters: true,
          withdrawnAt: null,
          consentSource: ENROLLMENT_DEFAULT_CONSENT_SOURCE,
          consentedAt: now,
        },
      });
    }
    const mirrorFailed = await flushMirror(tx, input);
    return {
      ok: true,
      searchableByRecruiters: true,
      withdrawnAt: null,
      created: !existing,
      updated: Boolean(existing),
      skipped: false,
      mirrorFailed,
    };
  }

  if (existing?.withdrawnAt) {
    return {
      ok: true,
      searchableByRecruiters: existing.searchableByRecruiters,
      withdrawnAt: existing.withdrawnAt,
      created: false,
      updated: false,
      skipped: true,
      skipReason: "withdrawn",
      mirrorFailed: false,
    };
  }

  if (input.kind === "claim_consent") {
    // Only an import-sourced row is re-stamped: any other row records a
    // decision made some other way, and the claim must not rewrite it.
    if (!existing || existing.consentSource !== ADMIN_IMPORT_CONSENT_SOURCE) {
      return {
        ok: true,
        searchableByRecruiters: existing?.searchableByRecruiters ?? false,
        withdrawnAt: existing?.withdrawnAt ?? null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: existing ? "already_exists" : "missing_row",
        mirrorFailed: false,
      };
    }
    await tx.candidateVisibility.update({
      where: { userId: input.userId },
      data: { consentSource: OAUTH_CLAIM_CONSENT_SOURCE, consentedAt: now },
    });
    return {
      ok: true,
      searchableByRecruiters: existing.searchableByRecruiters,
      withdrawnAt: existing.withdrawnAt,
      created: false,
      updated: true,
      skipped: false,
      mirrorFailed: false,
    };
  }

  if (
    input.kind === "challenge_enroll" ||
    input.kind === "usable_profile" ||
    input.kind === "admin_import"
  ) {
    if (existing) {
      return {
        ok: true,
        searchableByRecruiters: existing.searchableByRecruiters,
        withdrawnAt: existing.withdrawnAt,
        created: false,
        updated: false,
        skipped: true,
        skipReason: "already_exists",
        mirrorFailed: false,
      };
    }
    const consentSource =
      input.kind === "usable_profile"
        ? PROFILE_DEFAULT_CONSENT_SOURCE
        : input.kind === "admin_import"
          ? ADMIN_IMPORT_CONSENT_SOURCE
          : ENROLLMENT_DEFAULT_CONSENT_SOURCE;
    await tx.candidateVisibility.create({
      data: {
        userId: input.userId,
        searchableByRecruiters: true,
        consentSource,
        consentedAt: now,
      },
    });
    const mirrorFailed = await flushMirror(tx, input);
    return {
      ok: true,
      searchableByRecruiters: true,
      withdrawnAt: null,
      created: true,
      updated: false,
      skipped: false,
      mirrorFailed,
    };
  }

  // program_member
  const useLegacyLabel = Boolean(input.consentedAt);
  const source = useLegacyLabel
    ? PROGRAM_APPLY_CONSENT_SOURCE
    : ENROLLMENT_DEFAULT_CONSENT_SOURCE;
  if (!existing) {
    await tx.candidateVisibility.create({
      data: {
        userId: input.userId,
        searchableByRecruiters: true,
        consentSource: source,
        consentedAt: input.consentedAt ?? now,
      },
    });
    const mirrorFailed = await flushMirror(tx, input);
    return {
      ok: true,
      searchableByRecruiters: true,
      withdrawnAt: null,
      created: true,
      updated: false,
      skipped: false,
      mirrorFailed,
    };
  }
  if (existing.searchableByRecruiters) {
    return {
      ok: true,
      searchableByRecruiters: true,
      withdrawnAt: null,
      created: false,
      updated: false,
      skipped: true,
      skipReason: "already_searchable",
      mirrorFailed: false,
    };
  }
  await tx.candidateVisibility.update({
    where: { userId: input.userId },
    data: {
      searchableByRecruiters: true,
      consentSource: existing.consentSource ?? source,
      consentedAt: existing.consentedAt ?? input.consentedAt ?? now,
      withdrawnAt: null,
    },
  });
  const mirrorFailed = await flushMirror(tx, input);
  return {
    ok: true,
    searchableByRecruiters: true,
    withdrawnAt: null,
    created: false,
    updated: true,
    skipped: false,
    mirrorFailed,
  };
}
