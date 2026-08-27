/**
 * Mapper + call-site checks for 078 dual-write of CandidateProfile and Credential.
 * Run: npm run test:078-dual-write
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CertificateStatus,
  CertificateType,
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  EnrollmentStatus,
  EnrollmentStatusV2,
  ProgramMemberStatus,
  UserType,
} from "@prisma/client";
import {
  educationIdForStudentProfile,
  experienceIdForStudentProfile,
  mapCertificateToCredential,
  mapChallengeStatus,
  mapMemberStatus,
  personaFromUserType,
} from "@/repositories/dual-write";
import { peIdForEnrollment } from "@/repositories/ids";
import {
  compareMembershipRows,
  mapPeToEnrollmentStatus,
  mapPeToMemberStatus,
} from "@/repositories/learning";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

const root = process.cwd();

function source(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

suite("student persona maps from UserType, not domain", () => {
  assert(personaFromUserType(UserType.STUDENT) === "STUDENT", "student");
  assert(personaFromUserType(UserType.PROFESSIONAL) === "PROFESSIONAL", "pro");
});

suite("registration-owned child ids are deterministic (no duplicates on rerun)", () => {
  assert(
    educationIdForStudentProfile("u1") === "edu_sp_u1",
    "edu id",
  );
  assert(
    experienceIdForStudentProfile("u1") === "exp_sp_u1",
    "exp id",
  );
});

suite("Claude certificate mapping matches Phase 2g", () => {
  const row = mapCertificateToCredential({
    id: "cert_internal",
    certificateId: "ABT-CC-H8FR4",
    userId: "user1",
    type: CertificateType.CLAUDE_CHALLENGE,
    status: CertificateStatus.ISSUED,
    recipientName: "Aradhya",
    enrollmentId: "enr_1",
    issuedAt: new Date("2026-08-24T17:48:15.389Z"),
    revokedAt: null,
    revokedReason: null,
    metadata: { daysCompleted: 56 },
  });
  assert(row.id === "cred_cert_internal", "id");
  assert(row.credentialId === "ABT-CC-H8FR4", "public id reused");
  assert(row.type === CredentialType.COMPLETION, "completion");
  assert(row.sourceType === CredentialSourceType.PROGRAM_ENROLLMENT, "source");
  assert(row.sourceKey === peIdForEnrollment("enr_1"), "pe_enr_");
  assert(row.status === CredentialStatus.ISSUED, "issued");
  assert(row.title === CertificateType.CLAUDE_CHALLENGE, "title is cert type");
  assert(row.recipientName === "Aradhya", "snapshot name");
});

suite("hackathon participation vs placement", () => {
  const participation = mapCertificateToCredential({
    id: "c1",
    certificateId: "ABT-HK-1",
    userId: "u",
    type: CertificateType.HACKATHON,
    status: CertificateStatus.ISSUED,
    recipientName: "A",
    enrollmentId: null,
    issuedAt: new Date(),
    revokedAt: null,
    revokedReason: null,
    metadata: { teamId: "team_9" },
  });
  assert(participation.type === CredentialType.PARTICIPATION, "participation");
  assert(
    participation.sourceType === CredentialSourceType.HACKATHON_TEAM,
    "hack source",
  );
  assert(participation.sourceKey === "team_9:c1", "team:cert id");

  const placement = mapCertificateToCredential({
    id: "c2",
    certificateId: "ABT-HK-2",
    userId: "u",
    type: CertificateType.HACKATHON,
    status: CertificateStatus.ISSUED,
    recipientName: "A",
    enrollmentId: null,
    issuedAt: new Date(),
    revokedAt: null,
    revokedReason: null,
    metadata: { teamId: "team_9", hackathonVariant: "winner" },
  });
  assert(placement.type === CredentialType.PLACEMENT, "placement");
  assert(placement.sourceKey === "team_9:c2", "distinct sourceKey");
});

suite("revoked certificate maps to REVOKED credential", () => {
  const row = mapCertificateToCredential({
    id: "c3",
    certificateId: "ABT-CC-X",
    userId: "u",
    type: CertificateType.CLAUDE_CHALLENGE,
    status: CertificateStatus.REVOKED,
    recipientName: "A",
    enrollmentId: "e",
    issuedAt: new Date(),
    revokedAt: new Date("2026-08-01T00:00:00Z"),
    revokedReason: "test",
    metadata: null,
  });
  assert(row.status === CredentialStatus.REVOKED, "revoked");
  assert(row.revokedReason === "test", "reason");
});

suite("registration dual-writes CandidateProfile", () => {
  const src = source("src/features/registration/complete-registration.ts");
  assert(src.includes("dualWriteCandidateIdentity"), "helper called");
  assert(src.includes("studentProfile.create"), "legacy still written");
  assert(!src.includes("domain: input.domain"), "does not copy domain into identity write");
});

suite("profile update dual-writes CandidateProfile", () => {
  const src = source("src/features/profile/update-profile.ts");
  assert(src.includes("dualWriteCandidateIdentity"), "helper called");
  assert(src.includes("writeClient()"), "direct client for SAVEPOINT");
});

suite("Claude issuance dual-writes Credential, including alreadyIssued", () => {
  const src = source("src/features/certificate/issue-certificate.ts");
  const count = src.split("dualWriteCredential").length - 1;
  assert(count >= 3, `expected ≥3 call sites, got ${count}`);
});

suite("hackathon issuance dual-writes Credential", () => {
  const src = source("src/features/certificate/issue-hackathon-certificate.ts");
  const count = src.split("dualWriteCredential").length - 1;
  assert(count >= 4, `expected ≥4 call sites, got ${count}`);
});

suite("lazy achievements path still goes through ensureClaudeCertificate", () => {
  const src = source("src/features/certificate/get-achievements.ts");
  assert(src.includes("ensureClaudeCertificate"), "lazy issue");
});

suite("verify lookup goes through getByPublicId", () => {
  const src = source("src/features/certificate/get-certificate.ts");
  assert(src.includes("getByPublicId"), "repo lookup");
  assert(!src.includes("prisma.certificate"), "no direct certificate query");
});

suite("achievements listing goes through listForUser", () => {
  const src = source("src/features/certificate/get-achievements.ts");
  assert(src.includes("listForUser"), "repo list");
  assert(src.includes("ensureClaudeCertificate"), "lazy issue unchanged");
  assert(!src.includes("prisma.certificate"), "no direct certificate query");
});

suite("download lookup stays on getPublicCertificate", () => {
  const src = source("src/app/verify/[certificateId]/download/route.ts");
  assert(src.includes("getPublicCertificate"), "same lookup as verify");
  assert(src.includes("renderCertificatePdf"), "pdf render unchanged");
});

suite("listForUser orders issuedAt desc then public id", () => {
  const src = source("src/repositories/credentials.ts");
  assert(src.includes('{ issuedAt: "desc" }'), "issuedAt desc");
  assert(src.includes('{ credentialId: "asc" }'), "new-side stable key");
  assert(src.includes('{ certificateId: "asc" }'), "legacy stable key");
});

suite("admin student detail reads synergy through getBalance", () => {
  const src = source("src/features/admin/get-student-detail.ts");
  assert(src.includes("getBalance"), "repo");
  assert(!src.includes("user.synergyPoints"), "no legacy field on the view");
});

suite("marketplace page and synergy action read through getMySynergy", () => {
  const market = source("src/app/marketplace/page.tsx");
  const action = source("src/app/actions/synergy-actions.ts");
  const mine = source("src/features/synergy/get-my-synergy.ts");
  assert(market.includes("getMySynergy"), "marketplace");
  assert(action.includes("getMySynergy"), "action");
  assert(mine.includes("getBalance"), "wrapper");
});

suite("redeem display balance uses getBalance after dual-write", () => {
  const src = source("src/features/marketplace/redeem-item.ts");
  assert(src.includes("getBalance"), "repo");
  assert(src.includes("dualWritePoints"), "writes still dual-written");
  assert(src.includes("synergyPoints: { gte: item.costSP }"), "legacy write guard");
});

suite("ENABLE_NEW_* are not flipped in dual-write helpers", () => {
  const src = source("src/repositories/dual-write.ts");
  assert(src.includes("isDualWriteEnabled"), "gated on dual-write");
  assert(!src.includes("ENABLE_NEW_"), "no new-read flags");
});

suite("profile page identity reads through getCandidateProfile", () => {
  const src = source("src/features/profile/get-profile.ts");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(src.includes("studentProfile: { select: { domain: true } }"), "domain stays learning");
});

suite("dashboard identity reads through getCandidateProfile", () => {
  const src = source("src/features/dashboard/get-dashboard-data.ts");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(!src.includes("getUserWithProfile"), "old helper dropped");
});

suite("public profile identity reads through getCandidateProfile", () => {
  const src = source("src/features/profile/get-public-profile.ts");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(src.includes("resolvePublicProfileEnrollment"), "progress stays enrollment");
});

suite("admin student detail overlays candidate identity", () => {
  const src = source("src/features/admin/get-student-detail.ts");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(src.includes("getBalance"), "points unchanged");
});

suite("profile action userType comes from getCandidateProfile", () => {
  const src = source("src/app/actions/profile-actions.ts");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(!src.includes("studentProfile.findUnique"), "no legacy lookup");
});

suite("workshop prefill reads getCandidateProfile", () => {
  const src = source("src/features/workshop/get-prefill.ts");
  assert(src.includes("getCandidateProfile"), "repo");
});

suite("marketplace phone reads getCandidateProfile", () => {
  const src = source("src/app/marketplace/page.tsx");
  assert(src.includes("getCandidateProfile"), "repo");
  assert(src.includes("hackathonParticipant"), "hackathon fallback stays");
});

suite("job applicants overlay listCandidateProfiles", () => {
  const src = source("src/features/jobs/get-job-applicants.ts");
  assert(src.includes("listCandidateProfiles"), "batch repo");
  assert(src.includes("domain: true"), "domain stays on SP");
});

suite("referral stats identity through candidate repo", () => {
  const src = source("src/features/profile/get-referral-stats.ts");
  assert(src.includes("getCandidateProfile"), "own code");
  assert(src.includes("listCandidateProfiles"), "referred names");
});

suite("program apply prefill through getCandidateProfile", () => {
  const apply = source("src/app/program/apply/page.tsx");
  const entry = source("src/features/program/entry.ts");
  assert(apply.includes("getCandidateProfile"), "apply prefill");
  assert(apply.includes("studentProfile.findUnique"), "registration gate stays SP");
  assert(entry.includes("getCandidateProfile"), "apply copy");
  assert(entry.includes('select: { id: true }'), "existence still SP");
});

suite("candidate flag ON reads only new candidate tables", () => {
  const src = source("src/repositories/candidate.ts");
  assert(src.includes("educationIdForStudentProfile"), "edu_sp_");
  assert(src.includes("experienceIdForStudentProfile"), "exp_sp_");
  assert(src.includes('startsWith: "edu_sp_"'), "profile-owned education only");
  assert(src.includes('startsWith: "exp_sp_"'), "profile-owned experience only");
  assert(src.includes("isNewCandidateRepoEnabled"), "flag");
  assert(src.includes("return viewFromNew(row)"), "genuine new view");
  assert(!src.includes("function liveView"), "no SP overlay");
  assert(src.includes("findUserIdByReferralCode"), "referral lookup helper");
  assert(
    src.includes("prisma.candidateProfile.findUnique"),
    "ON lookup is CandidateProfile",
  );
});

suite("registration lookup uses findUserIdByReferralCode not CandidateProfile", () => {
  const src = source("src/features/registration/complete-registration.ts");
  assert(src.includes("findUserIdByReferralCode"), "repo lookup");
  assert(!src.includes("candidateProfile.findUnique"), "no CP lookup");
});

suite("new referral codes are unique on StudentProfile and CandidateProfile", () => {
  const src = source("src/features/registration/generate-referral-code.ts");
  assert(src.includes("studentProfile.findUnique"), "SP unique");
  assert(src.includes("candidateProfile.findUnique"), "CP unique");
});

suite("dual-write copies live StudentProfile.referralCode and submitted fields only", () => {
  const src = source("src/repositories/dual-write.ts");
  assert(src.includes("referralCode: sp.referralCode"), "copy live SP code");
  assert(!src.includes("shadowReferralCode"), "no 8-char placeholder");
  assert(src.includes("submitted ?? submittedAll()"), "field-level merge");
  assert(src.includes("syncCandidateSkillsFromLegacy"), "skills catch-up path");
  assert(src.includes("syncProfileOwnedEducation"), "edu_sp_");
  assert(src.includes("syncProfileOwnedExperience"), "exp_sp_");
});

suite("profile save dual-writes only form identity fields", () => {
  const src = source("src/features/profile/update-profile.ts");
  assert(src.includes("education: true"), "student education");
  assert(src.includes("experience: true"), "professional experience");
  assert(src.includes("phone: true"), "phone is submitted");
  assert(!src.includes("ambassador: true"), "ambassador untouched");
});

suite("OTP dual-write submits phone only", () => {
  const src = source("src/app/actions/otp-actions.ts");
  assert(src.includes("{ phone: true }"), "phone-only submitted map");
});

suite("admin interview toggle dual-writes isReadyForInterview", () => {
  const src = source("src/app/actions/admin-actions.ts");
  assert(src.includes("dualWriteCandidateIdentity"), "identity dual-write");
  assert(src.includes("isReadyForInterview: true"), "submitted flag");
});

suite("talent search is not switched in this phase", () => {
  const talent = source("src/repositories/talent.ts");
  const hire = source("src/repositories/hire.ts");
  assert(!talent.includes("isNewCandidateRepoEnabled"), "talent flag-free");
  assert(!hire.includes("isNewCandidateRepoEnabled"), "hire flag-free");
});

suite("Enrollment status maps onto ProgramEnrollment", () => {
  assert(
    mapChallengeStatus(EnrollmentStatus.ACTIVE) === EnrollmentStatusV2.ACTIVE,
    "ACTIVE",
  );
  assert(
    mapChallengeStatus(EnrollmentStatus.COMPLETED) ===
      EnrollmentStatusV2.COMPLETED,
    "COMPLETED",
  );
  assert(
    mapChallengeStatus(EnrollmentStatus.ABANDONED) ===
      EnrollmentStatusV2.DROPPED,
    "ABANDONED",
  );
});

suite("ProgramMember status maps including APPLIED and WAITLISTED", () => {
  assert(
    mapMemberStatus(ProgramMemberStatus.APPLIED) === EnrollmentStatusV2.APPLIED,
    "APPLIED",
  );
  assert(
    mapMemberStatus(ProgramMemberStatus.WAITLISTED) ===
      EnrollmentStatusV2.WAITLISTED,
    "WAITLISTED",
  );
  assert(
    mapMemberStatus(ProgramMemberStatus.ENROLLED) === EnrollmentStatusV2.ACTIVE,
    "ENROLLED",
  );
  assert(
    mapMemberStatus(ProgramMemberStatus.COMPLETED) ===
      EnrollmentStatusV2.COMPLETED,
    "COMPLETED",
  );
  assert(
    mapMemberStatus(ProgramMemberStatus.DROPPED) === EnrollmentStatusV2.DROPPED,
    "DROPPED",
  );
});

suite("PE status reverse maps preserve legacy names", () => {
  assert(
    mapPeToEnrollmentStatus(EnrollmentStatusV2.COMPLETED) ===
      EnrollmentStatus.COMPLETED,
    "enr COMPLETED",
  );
  assert(
    mapPeToEnrollmentStatus(EnrollmentStatusV2.DROPPED) ===
      EnrollmentStatus.ABANDONED,
    "enr ABANDONED",
  );
  assert(
    mapPeToEnrollmentStatus(EnrollmentStatusV2.ACTIVE) ===
      EnrollmentStatus.ACTIVE,
    "enr ACTIVE",
  );
  assert(
    mapPeToMemberStatus(EnrollmentStatusV2.APPLIED) ===
      ProgramMemberStatus.APPLIED,
    "APPLIED",
  );
  assert(
    mapPeToMemberStatus(EnrollmentStatusV2.WAITLISTED) ===
      ProgramMemberStatus.WAITLISTED,
    "WAITLISTED",
  );
  assert(
    mapPeToMemberStatus(EnrollmentStatusV2.ACTIVE) ===
      ProgramMemberStatus.ENROLLED,
    "ENROLLED",
  );
});

suite("membership sort prefers ACTIVE/ENROLLED over COMPLETED, then enrolledAt, then id", () => {
  const completedNewer = {
    id: "a",
    status: "COMPLETED",
    enrolledAt: new Date("2026-08-20"),
  };
  const activeOlder = {
    id: "b",
    status: "ENROLLED",
    enrolledAt: new Date("2026-08-01"),
  };
  const rows = [completedNewer, activeOlder].sort(compareMembershipRows);
  assert(rows[0]?.id === "b", "ENROLLED wins over newer COMPLETED");

  const activeNew = {
    id: "c",
    status: "ACTIVE",
    enrolledAt: new Date("2026-08-10"),
  };
  const activeOld = {
    id: "d",
    status: "ACTIVE",
    enrolledAt: new Date("2026-08-01"),
  };
  const sameStatus = [activeOld, activeNew].sort(compareMembershipRows);
  assert(sameStatus[0]?.id === "c", "newer enrolledAt among ACTIVE");

  const tieA = { id: "m1", status: "ENROLLED", enrolledAt: new Date("2026-08-01") };
  const tieB = { id: "m2", status: "ENROLLED", enrolledAt: new Date("2026-08-01") };
  const tied = [tieB, tieA].sort(compareMembershipRows);
  assert(tied[0]?.id === "m1", "id asc when enrolledAt ties");
});

suite("submit-day dual-writes enrollment on COMPLETED", () => {
  const src = source("src/features/submission/submit-day.ts");
  assert(src.includes("EnrollmentStatus.COMPLETED"), "sets COMPLETED");
  assert(src.includes("dualWriteChallengeEnrollmentById"), "continuous dual-write");
});

suite("admin enrollment status writers dual-write", () => {
  const src = source("src/app/actions/admin-actions.ts");
  const count = src.split("dualWriteChallengeEnrollmentById").length - 1;
  assert(count >= 3, `reset/remove/reject expected ≥3, got ${count}`);
  assert(src.includes('status: "ABANDONED"'), "ABANDONED path");
  assert(src.includes('status: "ACTIVE"'), "reset ACTIVE");
});

suite("program member APPLIED/WAITLISTED/ENROLLED/DROPPED dual-write", () => {
  const entry = source("src/features/program/entry.ts");
  const admin = source("src/features/program/admin.ts");
  assert(entry.includes('status: "APPLIED"'), "APPLIED write");
  assert(entry.includes("dualWriteProgramMember"), "apply dual-write");
  assert(entry.includes('status: "WAITLISTED"'), "WAITLISTED write");
  assert(entry.includes('status: "ENROLLED"'), "ENROLLED write");
  assert(admin.includes("dualWriteProgramMember"), "admin dual-write");
  assert(admin.includes('status: "ENROLLED"'), "promote ENROLLED");
  assert(admin.includes('status: "DROPPED"'), "drop DROPPED");
});

suite("learning repo is the flag-gated compatibility boundary", () => {
  const src = source("src/repositories/learning.ts");
  assert(src.includes("isNewLearningRepoEnabled"), "flag");
  assert(src.includes("getQuizDefinition"), "quiz definition");
  assert(src.includes("findAppliedMembership"), "APPLIED");
  assert(src.includes("findWaitlistedMembership"), "WAITLISTED");
  assert(src.includes("listDailyTasks"), "DailyTask-shaped");
  assert(src.includes("getProgramDayShell"), "ProgramDay-shaped");
  assert(src.includes("listProgramModules"), "ProgramModule-shaped");
  assert(src.includes("getCohortByJoinCode"), "join code");
  assert(src.includes("getOpenEnrollmentCohort"), "open enrollment");
  assert(!src.includes("activityAttempt"), "no ActivityAttempt");
  assert(!src.includes("enrollmentProgress"), "no EnrollmentProgress");
});

suite("ON membership path does not select only by newest enrolledAt", () => {
  const src = source("src/repositories/learning.ts");
  assert(src.includes("compareMembershipRows"), "deterministic sort helper");
  assert(
    !src.includes('orderBy: { enrolledAt: "desc" }'),
    "no enrolledAt-only findFirst",
  );
});

suite("ENABLE_NEW_LEARNING is not flipped in app code", () => {
  const flags = source("src/lib/feature-flags.ts");
  assert(flags.includes('process.env.ENABLE_NEW_LEARNING === "true"'), "still env-gated");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
