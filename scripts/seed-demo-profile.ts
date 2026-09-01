/**
 * Seeds a rich candidate profile for a demo or test user.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-profile.ts
 *   npx tsx scripts/seed-demo-profile.ts --email=ishaan@abtalks.dev
 *
 * Populates:
 *   - CandidateProfile & StudentProfile (mirror)
 *   - CandidateEducation (Degree, Institution, CGPA)
 *   - CandidateExperience (Work/Internship experience & bullets)
 *   - CandidateProjectEntry (Featured projects & tech stacks)
 *   - CandidateCertification (AWS / Meta certs)
 *   - CandidateSkill (Taxonomy linked skills)
 *   - CandidateLink (LeetCode, GitHub, Portfolio)
 *   - CandidatePreference (Open to work, preferred roles)
 *   - CandidateVisibility (Recruiter searchable)
 *   - RecruiterReview (Public share link & report)
 */
import { PrismaClient, CandidatePersona, Domain, GradeType, OpportunityType, SkillProficiency } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

// Target DATABASE_SAMPLE_URL if present, otherwise DATABASE_URL
const targetUrl = process.env.DATABASE_SAMPLE_URL || process.env.DATABASE_URL;
if (!targetUrl) {
  console.error("\n  [seed-demo-profile] No DATABASE_URL or DATABASE_SAMPLE_URL found in environment.\n");
  process.exit(1);
}
process.env.DATABASE_URL = targetUrl;
process.env.DIRECT_URL = targetUrl.replace("-pooler", "");

const MAX_USERS = 500;
const prisma = new PrismaClient();

// Parse command line args
const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];

const EMAIL = (emailArg || "demo-day31@abtalks.dev").toLowerCase().trim();
const NAME = "Ishaan Kapoor";
const PASSWORD = "demo-day31";

async function main() {
  console.log(`\n--- Seeding Demo Candidate Profile ---`);
  console.log(`Target: ${new URL(targetUrl!).host}`);
  console.log(`Candidate: ${NAME} (${EMAIL})`);

  // 1. Safety guard
  const userCount = await prisma.user.count();
  if (userCount > MAX_USERS) {
    console.error(`\n  REFUSING TO WRITE — target looks like production (${userCount} users > limit ${MAX_USERS}).\n`);
    process.exit(1);
  }

  // 2. Ensure User exists
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: NAME },
    create: { email: EMAIL, password: PASSWORD, name: NAME },
    select: { id: true, email: true },
  });

  const referralCode = `DEMO-${user.id.slice(-6).toUpperCase()}`;

  // 3. CandidateProfile & StudentProfile (Legacy Mirror)
  console.log(`Updating CandidateProfile & StudentProfile...`);
  await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    update: {
      fullName: NAME,
      headline: "AI & Full-Stack Engineer | Building RAG Systems & Scalable Microservices",
      summary:
        "Motivated AI engineer with hands-on experience building production-grade RAG pipelines, FastAPI services, and Next.js applications. Strong fundamentals in distributed systems, vector search optimization, and prompt engineering.",
      primaryPersona: CandidatePersona.STUDENT,
      locationCity: "Bengaluru",
      locationRegion: "Karnataka",
      countryCode: "IN",
      phone: "+919876543210",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      linkedinUrl: "https://linkedin.com/in/ishaankapoor-demo",
      githubUsername: "ishaan-demo",
      portfolioUrl: "https://ishaan-kapoor.dev",
      resumeUrl: "https://storage.googleapis.com/abtalks-resumes/demo-resume.pdf",
      isReadyForInterview: true,
    },
    create: {
      userId: user.id,
      fullName: NAME,
      headline: "AI & Full-Stack Engineer | Building RAG Systems & Scalable Microservices",
      summary:
        "Motivated AI engineer with hands-on experience building production-grade RAG pipelines, FastAPI services, and Next.js applications. Strong fundamentals in distributed systems, vector search optimization, and prompt engineering.",
      primaryPersona: CandidatePersona.STUDENT,
      locationCity: "Bengaluru",
      locationRegion: "Karnataka",
      countryCode: "IN",
      phone: "+919876543210",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      linkedinUrl: "https://linkedin.com/in/ishaankapoor-demo",
      githubUsername: "ishaan-demo",
      portfolioUrl: "https://ishaan-kapoor.dev",
      resumeUrl: "https://storage.googleapis.com/abtalks-resumes/demo-resume.pdf",
      referralCode,
      isReadyForInterview: true,
    },
  });

  await prisma.studentProfile.upsert({
    where: { userId: user.id },
    update: {
      fullName: NAME,
      college: "Delhi Technological University",
      graduationYear: 2025,
      organization: "Meridian Health",
      role: "Platform Engineer",
      yearsExperience: 2,
      domain: Domain.AI,
      skills: ["TypeScript", "Next.js", "Python", "FastAPI", "PostgreSQL", "RAG", "LangChain", "Docker"],
      phone: "+919876543210",
      phoneVerified: true,
      linkedinUrl: "https://linkedin.com/in/ishaankapoor-demo",
      githubUsername: "ishaan-demo",
      resumeUrl: "https://storage.googleapis.com/abtalks-resumes/demo-resume.pdf",
      isReadyForInterview: true,
    },
    create: {
      userId: user.id,
      fullName: NAME,
      college: "Delhi Technological University",
      graduationYear: 2025,
      organization: "Meridian Health",
      role: "Platform Engineer",
      yearsExperience: 2,
      domain: Domain.AI,
      skills: ["TypeScript", "Next.js", "Python", "FastAPI", "PostgreSQL", "RAG", "LangChain", "Docker"],
      phone: "+919876543210",
      phoneVerified: true,
      linkedinUrl: "https://linkedin.com/in/ishaankapoor-demo",
      githubUsername: "ishaan-demo",
      resumeUrl: "https://storage.googleapis.com/abtalks-resumes/demo-resume.pdf",
      referralCode,
      isReadyForInterview: true,
    },
  });

  // 4. CandidateEducation
  console.log(`Seeding Education...`);
  await prisma.candidateEducation.deleteMany({ where: { userId: user.id } });
  await prisma.candidateEducation.createMany({
    data: [
      {
        userId: user.id,
        institutionName: "Delhi Technological University (DTU)",
        degree: "Bachelor of Technology",
        fieldOfStudy: "Computer Science & Engineering",
        startYear: 2021,
        startMonth: 8,
        graduationYear: 2025,
        endMonth: 6,
        isCurrent: false,
        gradeType: GradeType.CGPA_10,
        grade: "8.8",
        description: "Specialized in Artificial Intelligence, Database Systems, and Distributed Computing.",
        sortOrder: 0,
      },
    ],
  });

  // 5. CandidateExperience
  console.log(`Seeding Work Experience...`);
  await prisma.candidateExperience.deleteMany({ where: { userId: user.id } });
  await prisma.candidateExperience.createMany({
    data: [
      {
        userId: user.id,
        companyName: "Meridian Health AI Labs",
        title: "Platform Engineer (AI & Data Systems)",
        employmentType: "Full-time",
        locationCity: "Bengaluru, India",
        startedOn: new Date("2024-06-01"),
        isCurrent: true,
        totalMonths: 15,
        description:
          "• Architected and deployed an internal clinical guideline RAG system indexing 50,000+ medical records using Qdrant and LangChain.\n• Reduced query p99 latency from 1.8s to 420ms by implementing hybrid BM25 + dense vector reranking with Cross-Encoders.\n• Designed and maintained asynchronous Celery ETL pipelines in FastAPI processing medical lab transcripts daily.",
      },
      {
        userId: user.id,
        companyName: "TechNova Software",
        title: "Software Engineering Intern",
        employmentType: "Internship",
        locationCity: "Remote",
        startedOn: new Date("2023-05-01"),
        endedOn: new Date("2023-11-30"),
        isCurrent: false,
        totalMonths: 6,
        description:
          "• Built responsive dashboard interfaces in React 18, Next.js, and Tailwind CSS for multi-tenant analytics portals.\n• Migrated legacy monolithic REST endpoints to structured tRPC and Prisma queries, cutting client boilerplate by 40%.",
      },
    ],
  });

  // 6. CandidateProjectEntry
  console.log(`Seeding Projects...`);
  await prisma.candidateProjectEntry.deleteMany({ where: { userId: user.id } });
  await prisma.candidateProjectEntry.createMany({
    data: [
      {
        userId: user.id,
        title: "Healthcare Coverage Intelligence Agent",
        description:
          "Full-stack autonomous multi-agent assistant built during the AI Cohort. Features conversational turn-taking, hybrid chunk retrieval, policy clause grounding, and automated evaluation metrics.",
        repoUrl: "https://github.com/ishaan-demo/healthcare-coverage-ai",
        liveUrl: "https://healthcare-coverage-demo.vercel.app",
        techStack: ["Next.js", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Prisma", "pgvector", "OpenAI"],
        sortOrder: 0,
      },
      {
        userId: user.id,
        title: "DocuQuery — High-Throughput RAG Search",
        description:
          "A document search engine supporting PDF/Markdown parsing, hierarchical chunking, vector embedding indexing, and source citation highlighting with sub-500ms latency.",
        repoUrl: "https://github.com/ishaan-demo/docuquery-rag",
        liveUrl: "https://docuquery.dev",
        techStack: ["Python", "FastAPI", "Qdrant", "Docker", "Tailwind CSS", "React"],
        sortOrder: 1,
      },
    ],
  });

  // 7. CandidateCertification
  console.log(`Seeding Certifications...`);
  await prisma.candidateCertification.deleteMany({ where: { userId: user.id } });
  await prisma.candidateCertification.createMany({
    data: [
      {
        userId: user.id,
        name: "AWS Certified Solutions Architect – Associate",
        issuer: "Amazon Web Services",
        issuedOn: new Date("2024-03-15"),
        credentialUrl: "https://aws.amazon.com/verification",
      },
      {
        userId: user.id,
        name: "DeepLearning.AI LangChain for LLM Application Development",
        issuer: "DeepLearning.AI / Coursera",
        issuedOn: new Date("2023-12-10"),
        credentialUrl: "https://coursera.org/verify",
      },
    ],
  });

  // 8. CandidateLinks
  console.log(`Seeding Links...`);
  await prisma.candidateLink.deleteMany({ where: { userId: user.id } });
  await prisma.candidateLink.createMany({
    data: [
      {
        userId: user.id,
        label: "LeetCode Profile",
        url: "https://leetcode.com/u/ishaan_dev",
        sortOrder: 0,
      },
      {
        userId: user.id,
        label: "Technical Blog (Hashnode)",
        url: "https://ishaan.hashnode.dev",
        sortOrder: 1,
      },
    ],
  });

  // 9. CandidatePreference & Visibility
  console.log(`Setting Job Preferences & Recruiter Visibility...`);
  await prisma.candidatePreference.upsert({
    where: { userId: user.id },
    update: {
      openToWork: true,
      availableFrom: new Date(),
      noticePeriodDays: 15,
      preferredRoles: ["AI Engineer", "Full Stack Engineer", "Backend Platform Engineer"],
      preferredLocations: ["Bengaluru", "Hyderabad", "Remote"],
      opportunityTypes: [OpportunityType.FULL_TIME, OpportunityType.CONTRACT],
      willingToRelocate: true,
      remotePreference: "Hybrid or Remote",
    },
    create: {
      userId: user.id,
      openToWork: true,
      availableFrom: new Date(),
      noticePeriodDays: 15,
      preferredRoles: ["AI Engineer", "Full Stack Engineer", "Backend Platform Engineer"],
      preferredLocations: ["Bengaluru", "Hyderabad", "Remote"],
      opportunityTypes: [OpportunityType.FULL_TIME, OpportunityType.CONTRACT],
      willingToRelocate: true,
      remotePreference: "Hybrid or Remote",
    },
  });

  await prisma.candidateVisibility.upsert({
    where: { userId: user.id },
    update: {
      searchableByRecruiters: true,
      showLinkedin: true,
      showGithub: true,
      showCurrentEmployer: true,
      showResume: true,
    },
    create: {
      userId: user.id,
      searchableByRecruiters: true,
      showLinkedin: true,
      showGithub: true,
      showCurrentEmployer: true,
      showResume: true,
    },
  });

  // 10. CandidateSkills with Taxonomy
  console.log(`Seeding Skills Taxonomy & Claims...`);
  const skillsToSeed = [
    { name: "TypeScript", slug: "typescript", prof: SkillProficiency.ADVANCED, score: 90 },
    { name: "React", slug: "react", prof: SkillProficiency.ADVANCED, score: 88 },
    { name: "Next.js", slug: "nextjs", prof: SkillProficiency.ADVANCED, score: 85 },
    { name: "Python", slug: "python", prof: SkillProficiency.ADVANCED, score: 92 },
    { name: "PostgreSQL", slug: "postgresql", prof: SkillProficiency.INTERMEDIATE, score: 82 },
    { name: "FastAPI", slug: "fastapi", prof: SkillProficiency.ADVANCED, score: 88 },
    { name: "LangChain", slug: "langchain", prof: SkillProficiency.ADVANCED, score: 86 },
    { name: "OpenAI API", slug: "openai-api", prof: SkillProficiency.ADVANCED, score: 90 },
    { name: "Docker", slug: "docker", prof: SkillProficiency.INTERMEDIATE, score: 75 },
    { name: "Prisma ORM", slug: "prisma", prof: SkillProficiency.ADVANCED, score: 84 },
  ];

  for (const s of skillsToSeed) {
    const skill = await prisma.skill.upsert({
      where: { slug: s.slug },
      update: { name: s.name },
      create: { slug: s.slug, name: s.name },
    });

    await prisma.candidateSkill.upsert({
      where: { userId_skillId: { userId: user.id, skillId: skill.id } },
      update: {
        selfRated: s.prof,
        claimedByCandidate: true,
        evidenceScore: s.score,
        verified: true,
        evidenceCount: 3,
      },
      create: {
        userId: user.id,
        skillId: skill.id,
        selfRated: s.prof,
        claimedByCandidate: true,
        evidenceScore: s.score,
        verified: true,
        evidenceCount: 3,
      },
    });
  }

  // 11. RecruiterReview
  console.log(`Seeding Recruiter Review...`);
  const shareToken = `demo_${user.id.slice(-8)}`;
  await prisma.recruiterReview.upsert({
    where: { userId: user.id },
    update: {
      targetRole: "AI Platform Engineer",
      headline: "High-performing AI Cohort graduate with strong full-stack & RAG engineering skills",
      summary: `${NAME} demonstrated exceptional engineering discipline throughout the AI Cohort, shipping a full healthcare coverage RAG agent and excelling in the Day 31 Final Technical Interview.`,
      communicationScore: 90,
      programmingScore: 92,
      behaviorScore: 88,
      shareToken,
      isPublished: true,
    },
    create: {
      userId: user.id,
      targetRole: "AI Platform Engineer",
      headline: "High-performing AI Cohort graduate with strong full-stack & RAG engineering skills",
      summary: `${NAME} demonstrated exceptional engineering discipline throughout the AI Cohort, shipping a full healthcare coverage RAG agent and excelling in the Day 31 Final Technical Interview.`,
      communicationScore: 90,
      programmingScore: 92,
      behaviorScore: 88,
      shareToken,
      isPublished: true,
    },
  });

  console.log(`\n Profile seeded successfully!`);
  console.log(`• Login email : ${EMAIL}`);
  console.log(`• Password    : ${PASSWORD}`);
  console.log(`• View Profile: http://localhost:3000/profile`);
  console.log(`• Recruiter URL: http://localhost:3000/r/${shareToken}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
