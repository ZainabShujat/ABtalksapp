import "server-only";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { prisma } from "@/lib/db";
import {
  findActiveMembership,
  getCohortByJoinCode as getCohortByJoinCodeFromRepo,
  getOpenEnrollmentCohort as getOpenEnrollmentCohortFromRepo,
} from "@/repositories/learning";

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 8-char uppercase join code (no 0/O/1/I). */
export function generateProgramJoinCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length]!;
  }
  return out;
}

export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function getCohortByJoinCode(code: string) {
  const joinCode = normalizeJoinCode(code);
  if (joinCode.length < 4) return null;
  return getCohortByJoinCodeFromRepo(joinCode);
}

/**
 * Newest ENROLLING cohort that does not require a join code.
 * When several open cohorts are ENROLLING, the most recently created one wins.
 */
export async function getOpenEnrollmentCohort() {
  return getOpenEnrollmentCohortFromRepo();
}

/**
 * Resolve the caller's program membership without redirecting.
 * Prefers ENROLLED over COMPLETED; among ties, newest enrolledAt, then id.
 */
export async function resolveProgramMemberForUser(userId: string) {
  return findActiveMembership(userId);
}

/**
 * Require an enrolled/completed program member for their cohort.
 * DB-checked (the JWT can be stale). Redirects to the public landing otherwise.
 */
export async function requireProgramMember() {
  const session = await auth();
  if (!session?.user?.id) redirect(PROGRAM_AI_COHORT_BASE);

  const resolved = await resolveProgramMemberForUser(session.user.id);
  if (!resolved) redirect(PROGRAM_AI_COHORT_BASE);

  return {
    member: resolved.member,
    cohort: resolved.cohort,
    userId: session.user.id,
  };
}

/**
 * Require an approved recruiter. DB-checked (approval flips aren't in the JWT).
 * Redirects to the pending page otherwise.
 */
export async function requireRecruiter() {
  const session = await auth();
  if (!session?.user?.id) redirect("/talent/pending");

  const profile = await prisma.recruiterProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, approved: true, company: true, fullName: true },
  });

  if (!profile || !profile.approved) redirect("/talent/pending");

  return { profile, userId: session.user.id };
}
