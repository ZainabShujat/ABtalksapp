/**
 * 078 Phase 2h — Organization, TalentList, RecruiterReview split.
 * Does not auto-merge near-duplicate company strings.
 */
import { config } from "dotenv";
import {
  AssessmentReportStatus,
  OrgMemberRole,
  OrgMemberStatus,
  PipelineStage,
  Prisma,
  PrismaClient,
  RecommendationLevelV2,
} from "@prisma/client";
import {
  certificationsListSchema,
  codingChallengesSchema,
  compensationSchema,
  educationListSchema,
  experienceListSchema,
  logisticsSchema,
  projectsSchema,
  skillGroupsSchema,
} from "../../src/lib/validations/recruiter";
import { assertChildBranch, resolveSampleUserIds, runStep, slugify, whereUserId } from "./migrate-078-shared";

const prisma = new PrismaClient();

function alnumKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2h-recruiting", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const uw = whereUserId(sample);
    const recruiters = await ctx.prisma.recruiterProfile.findMany({ where: uw });
    const recruiterCompanies = [
      ...new Set(recruiters.map((r) => r.company.trim()).filter(Boolean)),
    ];
    const jobs = await ctx.prisma.job.findMany({
      where:
        sample && recruiterCompanies.length > 0
          ? { company: { in: recruiterCompanies } }
          : sample
            ? { id: "__none__" }
            : undefined,
      select: { company: true },
    });
    const companies = [
      ...new Set(
        [...recruiters.map((r) => r.company.trim()), ...jobs.map((j) => j.company.trim())].filter(
          Boolean,
        ),
      ),
    ];

    const byAlnum = new Map<string, string[]>();
    for (const name of companies) {
      const k = alnumKey(name);
      const list = byAlnum.get(k) ?? [];
      list.push(name);
      byAlnum.set(k, list);
    }
    for (const [key, names] of byAlnum) {
      const uniq = [...new Set(names)];
      if (uniq.length > 1) {
        ctx.conflicts.push({
          userId: recruiters[0]?.userId ?? "system",
          field: "organization.nearDuplicate",
          chosenValue: uniq[0]!,
          rejectedValue: uniq.slice(1).join(" | "),
          source: `alnum:${key}`,
        });
      }
    }

    const orgByName = new Map<string, { id: string; slug: string }>();
    let orgs = 0;
    for (const name of companies) {
      let slug = slugify(name) || `org-${orgs + 1}`;
      let n = 2;
      while (true) {
        const clash = await ctx.prisma.organization.findUnique({ where: { slug } });
        if (!clash || clash.name === name) break;
        slug = `${slugify(name)}-${n++}`;
      }
      const org = await ctx.prisma.organization.upsert({
        where: { slug },
        create: { slug, name, isVerified: false },
        update: { name },
      });
      orgByName.set(name, { id: org.id, slug: org.slug });
      orgs += 1;
    }

    let membersCreated = 0;
    const firstInOrg = new Set<string>();
    for (const r of recruiters) {
      const org = orgByName.get(r.company.trim());
      if (!org) continue;
      const role = firstInOrg.has(org.id) ? OrgMemberRole.RECRUITER : OrgMemberRole.OWNER;
      firstInOrg.add(org.id);
      await ctx.prisma.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: org.id, userId: r.userId },
        },
        create: {
          organizationId: org.id,
          userId: r.userId,
          role,
          status: OrgMemberStatus.ACTIVE,
          joinedAt: r.createdAt,
        },
        update: { status: OrgMemberStatus.ACTIVE },
      });
      membersCreated += 1;
    }

    let lists = 0;
    let items = 0;
    const shortlists = await ctx.prisma.recruiterShortlistItem.findMany({
      where: sample ? { recruiterUserId: { in: sample } } : undefined,
      include: { member: { select: { userId: true, fullName: true } } },
    });
    const grouped = new Map<string, typeof shortlists>();
    for (const row of shortlists) {
      const list = grouped.get(row.recruiterUserId) ?? [];
      list.push(row);
      grouped.set(row.recruiterUserId, list);
    }

    for (const r of recruiters) {
      const org = orgByName.get(r.company.trim());
      if (!org) continue;
      const listName = "My shortlist";
      let talentList = await ctx.prisma.talentList.findUnique({
        where: { organizationId_name: { organizationId: org.id, name: listName } },
      });
      if (talentList && talentList.ownerRecruiterId && talentList.ownerRecruiterId !== r.id) {
        talentList = await ctx.prisma.talentList.upsert({
          where: {
            organizationId_name: {
              organizationId: org.id,
              name: `My shortlist (${r.fullName})`,
            },
          },
          create: {
            organizationId: org.id,
            ownerRecruiterId: r.id,
            name: `My shortlist (${r.fullName})`,
            isSharedWithOrg: false,
          },
          update: { ownerRecruiterId: r.id },
        });
      } else if (!talentList) {
        talentList = await ctx.prisma.talentList.create({
          data: {
            organizationId: org.id,
            ownerRecruiterId: r.id,
            name: listName,
            isSharedWithOrg: false,
          },
        });
      }
      lists += 1;

      const rows = grouped.get(r.userId) ?? [];
      const byCandidate = new Map<string, typeof rows>();
      for (const row of rows) {
        const uid = row.member.userId;
        const list = byCandidate.get(uid) ?? [];
        list.push(row);
        byCandidate.set(uid, list);
      }
      for (const [candidateUserId, recs] of byCandidate) {
        recs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const earliest = recs[0]!;
        const notes = recs
          .map((x) => x.note)
          .filter((n): n is string => Boolean(n))
          .join("\n---\n");
        await ctx.prisma.talentListItem.upsert({
          where: {
            talentListId_candidateUserId: {
              talentListId: talentList.id,
              candidateUserId,
            },
          },
          create: {
            talentListId: talentList.id,
            candidateUserId,
            candidateLabel: earliest.member.fullName,
            stage: PipelineStage.SHORTLISTED,
            addedAt: earliest.createdAt,
          },
          update: { candidateLabel: earliest.member.fullName },
        });
        items += 1;
        if (recs.length > 1) {
          ctx.conflicts.push({
            userId: candidateUserId,
            field: "shortlist.deduped",
            chosenValue: earliest.id,
            rejectedValue: recs
              .slice(1)
              .map((x) => x.id)
              .join(","),
            source: `recruiter:${r.userId}${notes ? ` notes:${notes.slice(0, 200)}` : ""}`,
          });
        }
      }
    }

    const reviews = await ctx.prisma.recruiterReview.findMany({ where: uw });
    let reports = 0;
    let shares = 0;

    for (const rev of reviews) {
      const profile = await ctx.prisma.candidateProfile.findUnique({
        where: { userId: rev.userId },
      });
      if (profile) {
        await ctx.prisma.candidateProfile.update({
          where: { userId: rev.userId },
          data: {
            headline: profile.headline ?? rev.headline,
            summary: profile.summary ?? rev.summary,
          },
        });
      }

      const quarantineIfBad = (
        field: string,
        value: Prisma.JsonValue | null,
        parsedOk: boolean,
      ) => {
        if (value == null) return;
        if (parsedOk) return;
        ctx.quarantine.push({
          sourceTable: "RecruiterReview",
          sourceId: rev.id,
          field,
          payload: value as Prisma.InputJsonValue,
          reason: "unparseable JSON",
        });
      };

      const edu = educationListSchema.safeParse(rev.education ?? []);
      quarantineIfBad("education", rev.education, edu.success || rev.education == null);
      if (edu.success) {
        let i = 0;
        for (const row of edu.data) {
          const year = Number.parseInt(row.year, 10);
          await ctx.prisma.candidateEducation.upsert({
            where: { id: `edu_rr_${rev.id}_${i}` },
            create: {
              id: `edu_rr_${rev.id}_${i}`,
              userId: rev.userId,
              institutionName: row.institution,
              degree: row.degree,
              graduationYear: Number.isFinite(year) ? year : null,
              grade: row.score || null,
              sortOrder: 10 + i,
            },
            update: {
              institutionName: row.institution,
              degree: row.degree,
              graduationYear: Number.isFinite(year) ? year : null,
            },
          });
          i += 1;
        }
      }

      const exp = experienceListSchema.safeParse(rev.experience ?? []);
      quarantineIfBad("experience", rev.experience, exp.success || rev.experience == null);
      if (exp.success) {
        let i = 0;
        for (const row of exp.data) {
          await ctx.prisma.candidateExperience.upsert({
            where: { id: `exp_rr_${rev.id}_${i}` },
            create: {
              id: `exp_rr_${rev.id}_${i}`,
              userId: rev.userId,
              companyName: row.company || "Not specified",
              title: row.title,
              locationCity: row.location || null,
              startedOn: new Date("2020-01-01"),
              isCurrent: i === 0,
              totalMonths: 0,
              description: row.bullets.join("\n") || null,
            },
            update: {
              companyName: row.company || "Not specified",
              title: row.title,
            },
          });
          i += 1;
        }
      }

      const projects = projectsSchema.safeParse(rev.projects ?? []);
      quarantineIfBad("projects", rev.projects, projects.success || rev.projects == null);
      if (projects.success) {
        let i = 0;
        for (const row of projects.data) {
          await ctx.prisma.candidateProjectEntry.upsert({
            where: { id: `proj_rr_${rev.id}_${i}` },
            create: {
              id: `proj_rr_${rev.id}_${i}`,
              userId: rev.userId,
              title: row.title,
              description: row.description || row.tech || null,
              sortOrder: i,
            },
            update: { title: row.title, description: row.description || row.tech || null },
          });
          i += 1;
        }
      }

      const certs = certificationsListSchema.safeParse(rev.certifications ?? []);
      quarantineIfBad(
        "certifications",
        rev.certifications,
        certs.success || rev.certifications == null,
      );
      if (certs.success) {
        let i = 0;
        for (const row of certs.data) {
          await ctx.prisma.candidateCertification.upsert({
            where: { id: `cert_rr_${rev.id}_${i}` },
            create: {
              id: `cert_rr_${rev.id}_${i}`,
              userId: rev.userId,
              name: row.name,
              issuer: row.issuer || "Unknown",
            },
            update: { name: row.name, issuer: row.issuer || "Unknown" },
          });
          i += 1;
        }
      }

      const skills = skillGroupsSchema.safeParse(rev.skillGroups ?? []);
      quarantineIfBad("skillGroups", rev.skillGroups, skills.success || rev.skillGroups == null);

      const logistics = logisticsSchema.safeParse(rev.logistics ?? {});
      const compensation = compensationSchema.safeParse(rev.compensation ?? {});
      if (logistics.success || compensation.success) {
        const loc = logistics.success ? logistics.data : null;
        const comp = compensation.success ? compensation.data : null;
        await ctx.prisma.candidatePreference.upsert({
          where: { userId: rev.userId },
          create: {
            userId: rev.userId,
            openToWork: false,
            preferredLocations: loc?.preferredLocations
              ? loc.preferredLocations.split(",").map((s) => s.trim()).filter(Boolean)
              : [],
            willingToRelocate: loc?.openToRelocation?.toLowerCase() === "yes",
            remotePreference: loc?.preferredWorkMode || null,
            salaryCurrency: comp?.currencyPreference?.slice(0, 3).toUpperCase() || null,
          },
          update: {},
        });
      }

      const rec =
        rev.recommendation &&
        ["STRONGLY_RECOMMEND", "RECOMMEND", "NEUTRAL", "DO_NOT_RECOMMEND"].includes(
          rev.recommendation,
        )
          ? (rev.recommendation as RecommendationLevelV2)
          : null;

      const report = await ctx.prisma.assessmentReport.upsert({
        where: { id: `ar_rr_${rev.id}` },
        create: {
          id: `ar_rr_${rev.id}`,
          candidateUserId: rev.userId,
          title: rev.headline || "Recruiter review",
          status: rev.isPublished
            ? AssessmentReportStatus.PUBLISHED
            : AssessmentReportStatus.DRAFT,
          recommendation: rec,
          summary: rev.summary,
          strengths: rev.strengths,
          areasForGrowth: rev.areasForGrowth,
          assessorName: rev.interviewerName,
          assessedAt: rev.assessmentDate ?? rev.reviewedAt,
        },
        update: {
          status: rev.isPublished
            ? AssessmentReportStatus.PUBLISHED
            : AssessmentReportStatus.DRAFT,
          recommendation: rec,
          summary: rev.summary,
        },
      });
      reports += 1;

      const scoreDims: Array<[string, number | null, string | null]> = [
        ["communication", rev.communicationScore, rev.communicationFeedback],
        ["programming", rev.programmingScore, rev.programmingFeedback],
        ["behavior", rev.behaviorScore, rev.behaviorFeedback],
      ];
      for (const [dim, score, feedback] of scoreDims) {
        if (score == null) continue;
        await ctx.prisma.assessmentScore.upsert({
          where: { reportId_dimension: { reportId: report.id, dimension: dim } },
          create: {
            reportId: report.id,
            dimension: dim,
            score,
            maxScore: 100,
            feedback,
          },
          update: { score, feedback },
        });
      }

      const coding = codingChallengesSchema.safeParse(rev.codingChallenges ?? []);
      quarantineIfBad(
        "codingChallenges",
        rev.codingChallenges,
        coding.success || rev.codingChallenges == null,
      );
      if (coding.success) {
        let i = 0;
        for (const ch of coding.data) {
          const n = Number.parseInt(ch.score, 10);
          if (!Number.isFinite(n)) continue;
          const dim = `coding:${ch.name}`.slice(0, 80);
          await ctx.prisma.assessmentScore.upsert({
            where: { reportId_dimension: { reportId: report.id, dimension: dim } },
            create: {
              reportId: report.id,
              dimension: dim,
              score: n,
              maxScore: 100,
            },
            update: { score: n },
          });
          i += 1;
        }
      }

      if (rev.shareToken) {
        await ctx.prisma.assessmentReportShare.upsert({
          where: { token: rev.shareToken },
          create: {
            reportId: report.id,
            token: rev.shareToken,
          },
          update: { reportId: report.id },
        });
        shares += 1;
      }
    }

    return { organizations: orgs, orgMembers: membersCreated, talentLists: lists, listItems: items, reports, shares };
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
