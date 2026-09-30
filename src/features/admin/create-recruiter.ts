import "server-only";

import { prisma } from "@/lib/db";
import { writeAudit } from "@/features/admin/audit";
import { provisionRecruiterIdentity } from "@/features/hire/provision-recruiter";
import type { CreateRecruiterInput } from "@/lib/validations/admin-recruiter";

/**
 * Create a recruiter account on an admin's authority (plan 159).
 *
 * Before this, the only path that produced a working recruiter was
 * `registerRecruiterWithOtpAction` — driven by the person themselves, behind an
 * emailed code an admin cannot complete for somebody else. A
 * `VerifiedRecruiterSeat` looks like the admin equivalent but is explicitly not
 * one: it is a pre-verified company name for a self-registration that still has
 * to happen.
 *
 * This writes the same rows that path writes, in the same order, in one commit.
 * The two differences are deliberate:
 *
 * 1. `grantedByUserId` is the admin, so `OrganizationMember.invitedByUserId`
 *    and `UserRoleAssignment.grantedByUserId` record who granted the access.
 * 2. The company details the admin typed are written onto the `Organization`,
 *    which `provisionRecruiterIdentity` creates with a name and nothing else.
 *
 * The password is **not** this function's business: it takes an already-computed
 * hash. scrypt costs ~32 MiB and hundreds of milliseconds, and the OTP path
 * documents why that must not run inside the commit window.
 */

export type CreateRecruiterAccountInput = CreateRecruiterInput & {
  /** From `requireAdmin()`. Never from the client. */
  adminUserId: string;
  /** Already hashed by the caller, outside the transaction. */
  passwordHash: string;
};

export type CreateRecruiterAccountResult =
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; message: string };

export async function createRecruiterAccount(
  input: CreateRecruiterAccountInput,
): Promise<CreateRecruiterAccountResult> {
  // The login lookup matches exactly, so the address is lowercased here, at the
  // boundary that creates the row — same as addRecruiterSeatAction.
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      recruiterProfile: { select: { id: true } },
      candidateProfile: { select: { userId: true } },
    },
  });

  if (existing?.recruiterProfile) {
    return { ok: false, message: "This email already has a recruiter account." };
  }
  // The same rule registerRecruiter enforces for self-service: a student
  // challenge account and a recruiter account are different people, and one
  // row cannot be both.
  if (existing?.candidateProfile) {
    return {
      ok: false,
      message:
        "This email belongs to a student challenge account. Use a separate work email for the recruiter.",
    };
  }

  const now = new Date();
  const company = input.companyName;

  const { userId, organizationId } = await prisma.$transaction(
    async (tx) => {
      // An existing row with neither profile is reused rather than refused —
      // it may be a bare account from a newsletter or a guest flow. Same as
      // the OTP path.
      const id =
        existing?.id ??
        (
          await tx.user.create({
            data: {
              email,
              name: input.fullName,
              role: "RECRUITER",
              password: input.passwordHash,
              // Nothing proved this address: the admin is vouching for it. The
              // audit row below records that, so the column does not later read
              // as a verification that happened.
              emailVerified: now,
            },
            select: { id: true },
          })
        ).id;

      if (existing) {
        await tx.user.update({
          where: { id },
          data: {
            name: input.fullName,
            role: "RECRUITER",
            password: input.passwordHash,
            emailVerified: now,
          },
          select: { id: true },
        });
      }

      const profile = await tx.recruiterProfile.create({
        data: {
          userId: id,
          fullName: input.fullName,
          company,
          phone: input.phone,
          // Written, never read as a gate. See ensureRecruiterWorkspace.
          approved: true,
          approvedAt: now,
          setupStep: "COMPLETE",
          setupCompletedAt: now,
        },
        select: { id: true },
      });

      // Organization + OrganizationMember + the RECRUITER role assignment +
      // the onboarding credit grant. Called, never reimplemented: the grant is
      // exactly-once on its own idempotency key, and a second copy of these
      // rules is how a workspace ends up unfunded or double-funded.
      const { organizationId: orgId } = await provisionRecruiterIdentity(tx, {
        userId: id,
        company,
        grantedByUserId: input.adminUserId,
      });

      // Provisioning sets the name only, so without this the workspace an
      // admin filled in a form for would start blank.
      await tx.organization.update({
        where: { id: orgId },
        data: {
          websiteUrl: input.website,
          industry: input.industry,
          sizeBucket: input.companySize,
          location: input.location,
        },
        select: { id: true },
      });

      await writeAudit(tx, {
        actorUserId: input.adminUserId,
        adminUserId: input.adminUserId,
        targetUserId: id,
        entityType: "RecruiterProfile",
        entityId: profile.id,
        organizationId: orgId,
        actionType: "RECRUITER_CREATED_BY_ADMIN",
        reason: `Recruiter account created from admin for ${company}`,
        // No password, hashed or otherwise, ever lands here.
        metadata: {
          email,
          company,
          passwordMode: input.passwordMode,
          emailVerifiedBy: "admin",
          reusedExistingUser: Boolean(existing),
        },
      });

      return { userId: id, organizationId: orgId };
    },
    // The window every recruiter-provisioning path uses. Prisma's 5s default is
    // not enough for this many sequential writes over Neon — the OTP path timed
    // out at ~5.3s and rolled everything back.
    { maxWait: 20_000, timeout: 20_000 },
  );

  return { ok: true, userId, organizationId };
}
