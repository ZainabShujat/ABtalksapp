import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Give a verified recruiter their 078 identity.
 *
 * `RecruiterProfile` + `User.role` is how the legacy `/talent` portal decides
 * recruiter access, and it stays authoritative — `ENABLE_NEW_*` is off and
 * legacy still serves every read. But 078 models recruiters as
 * `UserRoleAssignment(RECRUITER)` + `Organization` + `OrganizationMember`, and
 * the recruiter product is being built against that. Writing both now means the
 * rows are already correct when authorization moves, instead of needing a
 * backfill for a population that is still small enough to get right for free.
 *
 * `VerifiedRecruiterSeat` stays, narrowed to what 078 genuinely cannot express:
 * an invite for an email address that has **no `User` row yet**.
 * `OrganizationMember` already models invitations — it has `status: INVITED` and
 * `invitedByUserId` — but its `userId` is a required FK, so it can only invite
 * somebody who has already signed up. The seat covers the step before that, and
 * is spent here.
 *
 * Called inside the caller's transaction. Idempotent: re-provisioning an
 * existing recruiter updates rather than duplicating.
 */
export async function provisionRecruiterIdentity(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    company: string;
    grantedByUserId?: string | null;
  },
): Promise<{ organizationId: string }> {
  const company = input.company.trim();
  const slug = orgSlug(company);

  // Find-or-create by slug. Two recruiters from the same company must land in
  // the same Organization — that is the whole point of the model: it is what
  // lets teammates share talent lists and jobs.
  const organization = await tx.organization.upsert({
    where: { slug },
    create: { slug, name: company },
    update: {},
    select: { id: true },
  });

  await tx.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: input.userId,
      },
    },
    create: {
      organizationId: organization.id,
      userId: input.userId,
      role: "RECRUITER",
      status: "ACTIVE",
      invitedByUserId: input.grantedByUserId ?? null,
      joinedAt: new Date(),
    },
    update: { status: "ACTIVE", joinedAt: new Date() },
  });

  // The partial unique index on this table is `(userId, role, scopeType,
  // COALESCE(scopeId,'')) WHERE revokedAt IS NULL`, which Prisma cannot express,
  // so this checks for a live grant rather than upserting on it.
  const live = await tx.userRoleAssignment.findFirst({
    where: {
      userId: input.userId,
      role: "RECRUITER",
      scopeType: "ORGANIZATION",
      scopeId: organization.id,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!live) {
    await tx.userRoleAssignment.create({
      data: {
        userId: input.userId,
        role: "RECRUITER",
        scopeType: "ORGANIZATION",
        scopeId: organization.id,
        grantedByUserId: input.grantedByUserId ?? null,
      },
    });
  }

  return { organizationId: organization.id };
}

/** Stable, collision-tolerant slug. Same company name always resolves the same. */
function orgSlug(company: string): string {
  const base = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "org";
}
