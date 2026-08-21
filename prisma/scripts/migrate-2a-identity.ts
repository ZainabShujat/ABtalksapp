/**
 * 078 Phase 2a — CandidateProfile + education/experience/skills.
 * Precedence: StudentProfile > ProgramMember > HackathonParticipant > WorkshopRegistration.
 */
import { config } from "dotenv";
import {
  CandidatePersona,
  PrismaClient,
  UserType,
} from "@prisma/client";
import {
  assertChildBranch,
  chunked,
  logPick,
  pickNonNull,
  isSampleMode,
  resolveSampleUserIds,
  runStep,
  slugify,
  whereUserId,
  type StepContext,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

function personaFromUserType(t: UserType | null | undefined): CandidatePersona {
  if (t === UserType.PROFESSIONAL) return CandidatePersona.PROFESSIONAL;
  if (t === UserType.STUDENT) return CandidatePersona.STUDENT;
  return CandidatePersona.STUDENT;
}

function personaFromWorkshopRole(role: string | null | undefined): CandidatePersona | null {
  if (!role) return null;
  const r = role.trim().toLowerCase();
  if (r === "professional") return CandidatePersona.PROFESSIONAL;
  if (r === "student") return CandidatePersona.STUDENT;
  return CandidatePersona.OTHER;
}

function randomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]!;
  return out;
}

async function migrate2a(ctx: StepContext) {
  const sample = await resolveSampleUserIds(ctx.prisma);
  const uw = whereUserId(sample);
  const [profiles, members, hackathons, workshops, users] = await Promise.all([
    ctx.prisma.studentProfile.findMany({ where: uw }),
    ctx.prisma.programMember.findMany({
      where: uw,
      select: {
        id: true,
        userId: true,
        fullName: true,
        phone: true,
        linkedinUrl: true,
        resumeUrl: true,
        githubUsername: true,
        skills: true,
        education: true,
        university: true,
        graduationYear: true,
        company: true,
        jobRole: true,
        yearsExperience: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    ctx.prisma.hackathonParticipant.findMany({
      where: uw,
      select: {
        id: true,
        userId: true,
        fullName: true,
        phone: true,
        college: true,
        graduationYear: true,
        createdAt: true,
      },
    }),
    ctx.prisma.workshopRegistration.findMany({
      where: uw,
      select: {
        id: true,
        userId: true,
        name: true,
        phone: true,
        organization: true,
        graduationYear: true,
        role: true,
        createdAt: true,
      },
    }),
    ctx.prisma.user.findMany({
      where: sample ? { id: { in: sample } } : undefined,
      select: { id: true, name: true, email: true },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const profilesByUser = new Map(profiles.map((p) => [p.userId, p]));
  const membersByUser = new Map<string, typeof members>();
  for (const m of members) {
    const list = membersByUser.get(m.userId) ?? [];
    list.push(m);
    membersByUser.set(m.userId, list);
  }
  const hackByUser = new Map<string, typeof hackathons>();
  for (const h of hackathons) {
    const list = hackByUser.get(h.userId) ?? [];
    list.push(h);
    hackByUser.set(h.userId, list);
  }
  const wsByUser = new Map<string, typeof workshops>();
  for (const w of workshops) {
    const list = wsByUser.get(w.userId) ?? [];
    list.push(w);
    wsByUser.set(w.userId, list);
  }

  const userIds = new Set<string>([
    ...profilesByUser.keys(),
    ...membersByUser.keys(),
    ...hackByUser.keys(),
    ...wsByUser.keys(),
  ]);
  if (isSampleMode() && userIds.size > 80) {
    throw new Error(`Sample mode expected ≤80 users, got ${userIds.size}`);
  }
  console.log(`2a identity: ${userIds.size} users`);

  const existingProfiles = await ctx.prisma.candidateProfile.findMany({
    select: { userId: true, referralCode: true },
  });
  const existingByUser = new Map(existingProfiles.map((e) => [e.userId, e.referralCode]));
  const existingCodes = new Set(profiles.map((p) => p.referralCode));
  const takenCodes = new Set(existingProfiles.map((r) => r.referralCode));

  function nextCode(preferred: string | null): string {
    if (preferred && !takenCodes.has(preferred)) {
      takenCodes.add(preferred);
      existingCodes.add(preferred);
      return preferred;
    }
    for (let i = 0; i < 80; i++) {
      const code = randomCode();
      if (!takenCodes.has(code) && !existingCodes.has(code)) {
        takenCodes.add(code);
        return code;
      }
    }
    throw new Error("Could not allocate referralCode");
  }

  type ProfileRow = {
    userId: string;
    fullName: string;
    primaryPersona: CandidatePersona;
    phone: string | null;
    phoneVerified: boolean;
    phoneVerifiedAt: Date | null;
    linkedinUrl: string | null;
    githubUsername: string | null;
    resumeUrl: string | null;
    referralCode: string;
    isReadyForInterview: boolean;
    isCampusAmbassadorCandidate: boolean;
    ambassadorAppliedAt: Date | null;
    ambassadorDismissedAt: Date | null;
  };

  const toUpsert: ProfileRow[] = [];

  for (const userId of userIds) {
    const sp = profilesByUser.get(userId);
    const pms = membersByUser.get(userId) ?? [];
    const hps = hackByUser.get(userId) ?? [];
    const wss = wsByUser.get(userId) ?? [];
    const user = userById.get(userId);

    const namePick = pickNonNull([
      { value: sp?.fullName, source: "StudentProfile", at: sp?.updatedAt ?? new Date(0) },
      ...pms.map((m) => ({
        value: m.fullName,
        source: "ProgramMember",
        at: m.updatedAt,
      })),
      ...hps.map((h) => ({
        value: h.fullName,
        source: "HackathonParticipant",
        at: h.createdAt,
      })),
      ...wss.map((w) => ({
        value: w.name,
        source: "WorkshopRegistration",
        at: w.createdAt,
      })),
    ]);
    logPick(ctx, userId, "fullName", namePick);

    const phonePick = pickNonNull([
      { value: sp?.phone, source: "StudentProfile", at: sp?.updatedAt ?? new Date(0) },
      ...pms.map((m) => ({ value: m.phone, source: "ProgramMember", at: m.updatedAt })),
      ...hps.map((h) => ({
        value: h.phone,
        source: "HackathonParticipant",
        at: h.createdAt,
      })),
      ...wss.map((w) => ({
        value: w.phone,
        source: "WorkshopRegistration",
        at: w.createdAt,
      })),
    ]);
    logPick(ctx, userId, "phone", phonePick);

    const linkedinPick = pickNonNull([
      { value: sp?.linkedinUrl, source: "StudentProfile", at: sp?.updatedAt ?? new Date(0) },
      ...pms.map((m) => ({
        value: m.linkedinUrl,
        source: "ProgramMember",
        at: m.updatedAt,
      })),
    ]);
    logPick(ctx, userId, "linkedinUrl", linkedinPick);

    const githubPick = pickNonNull([
      {
        value: sp?.githubUsername,
        source: "StudentProfile",
        at: sp?.updatedAt ?? new Date(0),
      },
      ...pms.map((m) => ({
        value: m.githubUsername,
        source: "ProgramMember",
        at: m.updatedAt,
      })),
    ]);
    logPick(ctx, userId, "githubUsername", githubPick);

    const resumePick = pickNonNull([
      { value: sp?.resumeUrl, source: "StudentProfile", at: sp?.updatedAt ?? new Date(0) },
      ...pms.map((m) => ({
        value: m.resumeUrl,
        source: "ProgramMember",
        at: m.updatedAt,
      })),
    ]);
    logPick(ctx, userId, "resumeUrl", resumePick);

    const fullName =
      namePick.value?.trim() ||
      user?.name?.trim() ||
      user?.email?.split("@")[0] ||
      "Unknown";

    const workshopPersona = wss
      .map((w) => personaFromWorkshopRole(w.role))
      .find((p) => p != null);

    toUpsert.push({
      userId,
      fullName,
      primaryPersona: sp
        ? personaFromUserType(sp.userType)
        : (workshopPersona ?? CandidatePersona.STUDENT),
      phone: phonePick.value,
      phoneVerified: sp?.phoneVerified ?? false,
      phoneVerifiedAt: sp?.phoneVerifiedAt ?? null,
      linkedinUrl: linkedinPick.value,
      githubUsername: githubPick.value,
      resumeUrl: resumePick.value,
      referralCode: existingByUser.get(userId) ?? nextCode(sp?.referralCode ?? null),
      isReadyForInterview: sp?.isReadyForInterview ?? false,
      isCampusAmbassadorCandidate: sp?.isCampusAmbassadorCandidate ?? false,
      ambassadorAppliedAt: sp?.ambassadorAppliedAt ?? null,
      ambassadorDismissedAt: sp?.ambassadorDismissedAt ?? null,
    });
  }

  let created = 0;
  let updated = 0;
  await chunked(toUpsert, 50, async (chunk) => {
    await ctx.prisma.$transaction(
      chunk.map((row) => {
        const isNew = !existingByUser.has(row.userId);
        if (isNew) created += 1;
        else updated += 1;
        return ctx.prisma.candidateProfile.upsert({
          where: { userId: row.userId },
          create: row,
          update: {
            fullName: row.fullName,
            primaryPersona: row.primaryPersona,
            phone: row.phone,
            phoneVerified: row.phoneVerified,
            phoneVerifiedAt: row.phoneVerifiedAt,
            linkedinUrl: row.linkedinUrl,
            githubUsername: row.githubUsername,
            resumeUrl: row.resumeUrl,
            isReadyForInterview: row.isReadyForInterview,
            isCampusAmbassadorCandidate: row.isCampusAmbassadorCandidate,
            ambassadorAppliedAt: row.ambassadorAppliedAt,
            ambassadorDismissedAt: row.ambassadorDismissedAt,
          },
        });
      }),
    );
  });

  const skills = await ctx.prisma.skill.findMany({
    select: { id: true, slug: true, aliases: true, name: true },
  });
  const skillBySlug = new Map(skills.map((s) => [s.slug, s.id]));
  const skillByAlias = new Map<string, string>();
  for (const s of skills) {
    skillByAlias.set(s.name.trim().toLowerCase(), s.id);
    for (const a of s.aliases) skillByAlias.set(a.trim().toLowerCase(), s.id);
  }

  function resolveSkill(raw: string): string | null {
    const slug = slugify(raw);
    if (slug && skillBySlug.has(slug)) return skillBySlug.get(slug)!;
    const key = raw.trim().toLowerCase();
    return skillByAlias.get(key) ?? null;
  }

  const educationRows: Array<{
    id: string;
    userId: string;
    institutionName: string;
    collegeId: string | null;
    degree: string | null;
    graduationYear: number | null;
    sortOrder: number;
  }> = [];
  const experienceRows: Array<{
    id: string;
    userId: string;
    companyName: string;
    title: string;
    startedOn: Date;
    isCurrent: boolean;
    totalMonths: number;
  }> = [];
  const skillLinks = new Map<string, Set<string>>();

  const addSkill = (userId: string, raw: string) => {
    const id = resolveSkill(raw);
    if (!id) return;
    const set = skillLinks.get(userId) ?? new Set();
    set.add(id);
    skillLinks.set(userId, set);
  };

  for (const sp of profiles) {
    if (sp.college || sp.collegeId || sp.graduationYear) {
      educationRows.push({
        id: `edu_sp_${sp.userId}`,
        userId: sp.userId,
        institutionName: sp.college?.trim() || "Not specified",
        collegeId: sp.collegeId,
        degree: null,
        graduationYear: sp.graduationYear,
        sortOrder: 0,
      });
    }
    if (sp.organization || sp.role || sp.yearsExperience != null) {
      const years = sp.yearsExperience ?? 0;
      experienceRows.push({
        id: `exp_sp_${sp.userId}`,
        userId: sp.userId,
        companyName: sp.organization?.trim() || "Not specified",
        title: sp.role?.trim() || "Not specified",
        startedOn: new Date(Date.UTC(new Date().getUTCFullYear() - Math.max(years, 0), 0, 1)),
        isCurrent: true,
        totalMonths: Math.max(0, years) * 12,
      });
    }
    for (const s of sp.skills) addSkill(sp.userId, s);
  }

  for (const m of members) {
    if (m.university || m.education || m.graduationYear) {
      educationRows.push({
        id: `edu_pm_${m.id}`,
        userId: m.userId,
        institutionName: m.university?.trim() || m.education?.trim() || "Not specified",
        collegeId: null,
        degree: m.education?.trim() || null,
        graduationYear: m.graduationYear,
        sortOrder: 1,
      });
    }
    if (m.company || m.jobRole || m.yearsExperience != null) {
      const years = m.yearsExperience ?? 0;
      experienceRows.push({
        id: `exp_pm_${m.id}`,
        userId: m.userId,
        companyName: m.company.trim() || "Not specified",
        title: m.jobRole.trim() || "Not specified",
        startedOn: new Date(Date.UTC(new Date().getUTCFullYear() - Math.max(years, 0), 0, 1)),
        isCurrent: true,
        totalMonths: Math.max(0, years) * 12,
      });
    }
    for (const s of m.skills) addSkill(m.userId, s);
  }

  for (const h of hackathons) {
    educationRows.push({
      id: `edu_hk_${h.id}`,
      userId: h.userId,
      institutionName: h.college.trim() || "Not specified",
      collegeId: null,
      degree: null,
      graduationYear: h.graduationYear,
      sortOrder: 2,
    });
  }

  for (const w of workshops) {
    if (w.organization || w.graduationYear) {
      educationRows.push({
        id: `edu_ws_${w.id}`,
        userId: w.userId,
        institutionName: w.organization?.trim() || "Not specified",
        collegeId: null,
        degree: null,
        graduationYear: w.graduationYear,
        sortOrder: 3,
      });
    }
  }

  let eduCreated = 0;
  await chunked(educationRows, 100, async (chunk) => {
    const result = await ctx.prisma.candidateEducation.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    eduCreated += result.count;
  });

  let expCreated = 0;
  await chunked(experienceRows, 100, async (chunk) => {
    const result = await ctx.prisma.candidateExperience.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    expCreated += result.count;
  });

  const skillRows: Array<{ userId: string; skillId: string }> = [];
  for (const [userId, ids] of skillLinks) {
    for (const skillId of ids) skillRows.push({ userId, skillId });
  }
  let skillCreated = 0;
  await chunked(skillRows, 200, async (chunk) => {
    const result = await ctx.prisma.candidateSkill.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    skillCreated += result.count;
  });

  return {
    usersConsidered: userIds.size,
    profilesCreated: created,
    profilesUpdated: updated,
    educationCreated: eduCreated,
    experienceCreated: expCreated,
    skillsLinked: skillCreated,
  };
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2a-identity", migrate2a);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
