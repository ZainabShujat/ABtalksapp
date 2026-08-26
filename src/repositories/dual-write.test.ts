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
  UserType,
} from "@prisma/client";
import {
  educationIdForStudentProfile,
  experienceIdForStudentProfile,
  mapCertificateToCredential,
  personaFromUserType,
} from "@/repositories/dual-write";
import { peIdForEnrollment } from "@/repositories/ids";

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

suite("candidate new branch prefers StudentProfile-owned child ids", () => {
  const src = source("src/repositories/candidate.ts");
  assert(src.includes("educationIdForStudentProfile"), "edu_sp_");
  assert(src.includes("experienceIdForStudentProfile"), "exp_sp_");
  assert(src.includes("isNewCandidateRepoEnabled"), "flag");
  assert(src.includes("legacy?.skills"), "skills stay on StudentProfile while CandidateSkill is empty");
});

suite("talent search is not switched in this phase", () => {
  const talent = source("src/repositories/talent.ts");
  const hire = source("src/repositories/hire.ts");
  assert(!talent.includes("isNewCandidateRepoEnabled"), "talent flag-free");
  assert(!hire.includes("isNewCandidateRepoEnabled"), "hire flag-free");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
