/**
 * Plan 154 A21 — the whole journey against a real database:
 *   Admin upload → Parse → Register → Recruiter sees them → Google claim.
 *
 * DB-backed. Refuses to run unless `RESUME_IMPORT_E2E=1` AND
 * `RESUME_IMPORT_E2E_DB_HOST` equals the host in DATABASE_URL — a deliberate,
 * typed confirmation that this is a throwaway Neon branch with plan 154's
 * migrations applied. Never point it at production.
 *
 * The model is replaced by the recorded fixture (no API key, no spend) and the
 * Blob read by the fixture PDF; everything else is the real code path: the
 * worker, the repository, registration, visibility, the recruiter pool query,
 * and the claim. Everything it creates is deleted at the end.
 *
 * Run: npm run test:resume-import:e2e
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    throw err; // a journey: later steps depend on earlier ones
  }
}

function dbHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  return url.split("@")[1]?.split("/")[0]?.split("?")[0] ?? "";
}

async function main() {
  if (process.env.RESUME_IMPORT_E2E !== "1" || process.env.RESUME_IMPORT_E2E_DB_HOST !== dbHost()) {
    console.log(
      "Skipped. Set RESUME_IMPORT_E2E=1 and RESUME_IMPORT_E2E_DB_HOST=<host of DATABASE_URL> " +
        "to run against a throwaway, migrated Neon branch.",
    );
    process.exit(0);
  }

  const { prisma } = await import("@/lib/db");
  const { normalizeParsedResume } = await import("@/features/resume/normalize");
  const { defaultWorkerDeps, drainResumeImports } = await import("@/features/resume/import/worker");
  const repo = await import("@/repositories/resume-import");
  const { applyParsedResumeToProfile } = await import("@/features/resume/service");
  const { resolveProfileRefs } = await import("@/repositories/hire");
  const { candidatePublicId } = await import("@/features/hire/public-id");
  const claim = await import("@/features/resume/import/claim");

  const stamp = randomUUID().slice(0, 8);
  const studentEmail = `e2e-import-${stamp}@abtalks.dev`;
  const pdf = new Uint8Array(readFileSync(join(process.cwd(), "src/features/resume/fixtures/sample-resume.pdf")));
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "src/features/resume/fixtures/sample-resume.raw.json"), "utf8"),
  ) as Record<string, unknown>;

  /** Which emails the fake model "finds" in each file. */
  const emailsByFile: Record<string, string[]> = {
    [`single-${stamp}.pdf`]: [studentEmail],
    [`double-${stamp}.pdf`]: [`a-${stamp}@abtalks.dev`, `b-${stamp}@abtalks.dev`],
  };

  const importIds: string[] = [];
  const userIds: string[] = [];

  const deps = {
    ...defaultWorkerDeps(),
    readBytes: async () => pdf,
    parse: async (job: { originalFilename: string }) => {
      const emails = emailsByFile[job.originalFilename] ?? [];
      const data = normalizeParsedResume({ ...raw, email: emails[0] ?? null });
      return {
        ok: true as const,
        data,
        emails,
        model: "fixture",
        usage: { prompt: 1376, completion: 947 },
        costMicroUsd: 0,
        rate: null,
      };
    },
  };

  async function drainUntilIdle() {
    for (let i = 0; i < 20 && (await repo.hasPendingImportWork()); i++) {
      await drainResumeImports({ budgetMs: 120_000 }, deps);
    }
  }

  console.log(`plan 154 e2e on ${dbHost()} (stamp ${stamp})`);

  try {
    await step("admin upload: two PDFs become imports; the same bytes again is a duplicate", async () => {
      for (const name of Object.keys(emailsByFile)) {
        const created = await repo.createOrGetImport({
          contentHash: `e2e-${stamp}-${name}`,
          originalFilename: name,
          fileSizeBytes: pdf.length,
          blobPathname: `resume-imports/e2e-${stamp}-${name}`,
          uploadedByUserId: `e2e-admin-${stamp}`,
        });
        assert(!created.duplicate, "new");
        importIds.push(created.id);
      }
      const again = await repo.createOrGetImport({
        contentHash: `e2e-${stamp}-${Object.keys(emailsByFile)[0]}`,
        originalFilename: "renamed.pdf",
        fileSizeBytes: pdf.length,
        blobPathname: "resume-imports/whatever",
        uploadedByUserId: `e2e-admin-${stamp}`,
      });
      assert(again.duplicate && again.id === importIds[0], "deduplicated by content hash");
    });

    await step("parse: server-side worker → PARSED and NEEDS_REVIEW (two emails)", async () => {
      await repo.queueImports({ ids: importIds }, false, `e2e-admin-${stamp}`);
      await drainUntilIdle();
      const rows = await prisma.resumeImport.findMany({
        where: { id: { in: importIds } },
        select: { id: true, status: true, normalizedEmail: true, emailCandidates: true, promptTokens: true },
      });
      const single = rows.find((r) => r.id === importIds[0])!;
      const double = rows.find((r) => r.id === importIds[1])!;
      assert(single.status === "PARSED" && single.normalizedEmail === studentEmail, `single: ${single.status}`);
      assert(single.promptTokens === 1376, "usage recorded on the import");
      assert(double.status === "NEEDS_REVIEW" && double.emailCandidates.length === 2, `double: ${double.status}`);
    });

    await step("review: the admin picks an email → PARSED", async () => {
      const res = await repo.resolveImportEmail(importIds[1]!, `b-${stamp}@abtalks.dev`);
      assert(res.ok, JSON.stringify(res));
    });

    let userId = "";
    let publicIdBefore = "";
    await step("register: User without login + profile + READY résumé + visibility", async () => {
      await repo.requestRegistration({ ids: [importIds[0]!] }, `e2e-admin-${stamp}`);
      await drainUntilIdle();
      const imp = await prisma.resumeImport.findUnique({
        where: { id: importIds[0]! },
        select: { status: true, registeredUserId: true, parsedData: true },
      });
      assert(imp?.status === "REGISTERED" && imp.registeredUserId !== null, `status ${imp?.status}`);
      assert(imp.parsedData === null, "document moved to CandidateResume, not duplicated");
      userId = imp.registeredUserId;
      userIds.push(userId);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          password: true,
          _count: { select: { accounts: true } },
          candidateProfile: { select: { fullName: true } },
          resume: { select: { status: true } },
          visibility: { select: { searchableByRecruiters: true, consentSource: true } },
        },
      });
      assert(user?.email === studentEmail, "email");
      assert(user._count.accounts === 0 && user.password === null, "nobody can sign in as it yet");
      assert(Boolean(user.candidateProfile?.fullName), "profile");
      assert(user.resume?.status === "READY", "résumé");
      assert(user.visibility?.searchableByRecruiters === true, "searchable");
      assert(user.visibility.consentSource === "admin_resume_import", `consent ${user.visibility.consentSource}`);
      const skills = await prisma.candidateSkill.count({ where: { userId, claimedByCandidate: true } });
      assert(skills > 0, "merge filled skills");
    });

    await step("recruiter: in the PROFILE pool, flagged unclaimed, contact locked", async () => {
      const refs = await resolveProfileRefs([userId]);
      assert(refs.length === 1, "recruiter-visible");
      publicIdBefore = candidatePublicId(refs[0]!.userId);
      const unclaimed = await repo.listUnclaimedImportUserIds([userId]);
      assert(unclaimed.has(userId), "badge flag");
      assert(await repo.hasUnclaimedImportForUser(userId), "unlock gate closed");
    });

    await step("existing data is never overwritten by a re-merge", async () => {
      await prisma.candidateProfile.update({ where: { userId }, data: { headline: "Set by the student" } });
      const skillsBefore = await prisma.candidateSkill.count({ where: { userId } });
      await applyParsedResumeToProfile(userId, normalizeParsedResume(raw));
      const after = await prisma.candidateProfile.findUnique({ where: { userId }, select: { headline: true } });
      assert(after?.headline === "Set by the student", `headline ${after?.headline}`);
      assert((await prisma.candidateSkill.count({ where: { userId } })) === skillsBefore, "no duplicate skills");
    });

    const googleSub = `e2e-google-${stamp}`;
    await step("Google claim: verified matching email is allowed; wrong/unverified are not", async () => {
      assert(
        (await claim.evaluateGoogleLink({ providerAccountId: googleSub, email: studentEmail, emailVerified: false })) === "deny",
        "unverified denied",
      );
      assert(
        (await claim.evaluateGoogleLink({ providerAccountId: googleSub, email: studentEmail.toUpperCase(), emailVerified: true })) === "allow",
        "verified allowed (case-insensitive)",
      );
      assert(
        (await claim.evaluateGoogleLink({ providerAccountId: `${googleSub}-x`, email: `someone-else-${stamp}@abtalks.dev`, emailVerified: true })) === "allow",
        "unrelated email is an ordinary signup",
      );
    });

    await step("Google claim: link (as the adapter does) → CLAIMED, same user, one candidate", async () => {
      await prisma.account.create({
        data: { userId, type: "oidc", provider: "google", providerAccountId: googleSub },
        select: { id: true },
      });
      assert(await claim.onGoogleAccountLinked(userId), "claimed");
      const imp = await prisma.resumeImport.findUnique({ where: { id: importIds[0]! }, select: { status: true } });
      assert(imp?.status === "CLAIMED", `status ${imp?.status}`);
      const vis = await prisma.candidateVisibility.findUnique({ where: { userId }, select: { consentSource: true } });
      assert(vis?.consentSource === "oauth_claim", `consent ${vis?.consentSource}`);
      const users = await prisma.user.count({ where: { email: { equals: studentEmail, mode: "insensitive" } } });
      assert(users === 1, `users with that email: ${users}`);
      // The recruiter-facing id is derived from the user id, and the Google
      // login was linked to that same user — so it is the same candidate.
      const linked = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: "google", providerAccountId: googleSub } },
        select: { userId: true },
      });
      assert(linked?.userId === userId, "Google login linked to the imported user");
      const refs = await resolveProfileRefs([userId]);
      assert(refs.length === 1 && candidatePublicId(refs[0]!.userId) === publicIdBefore, "same recruiter candidate");
      assert(!(await repo.hasUnclaimedImportForUser(userId)), "contact unlock now possible by policy");
    });

    await step("Google claim: a second Google account can never link to the same user", async () => {
      assert(
        (await claim.evaluateGoogleLink({ providerAccountId: `${googleSub}-2`, email: studentEmail, emailVerified: true })) === "deny",
        "policy denies",
      );
      let refused = false;
      try {
        await prisma.account.create({
          data: { userId, type: "oidc", provider: "google", providerAccountId: `${googleSub}-2` },
          select: { id: true },
        });
      } catch {
        refused = true;
      }
      assert(refused, "the one-Google-account-per-user index refused the insert");
      assert(!(await claim.onGoogleAccountLinked(userId)), "claiming again changes nothing");
    });
  } finally {
    // Clean up everything this run created. User delete cascades to Account,
    // CandidateProfile (and its children), CandidateResume, CandidateVisibility.
    await prisma.resumeImport.deleteMany({ where: { id: { in: importIds } } }).catch(() => undefined);
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
