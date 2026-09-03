/**
 * Résumé upload, parsing and Résumé Strength — plan 106.
 *
 * Pure-function checks over the parts that must not be wrong: the normaliser
 * (whatever the model returns, a valid `ParsedResume` comes out), the scorer
 * (bounded, weighted, deterministic, JD-free, and unbothered by missing
 * sections), the ingest guards (magic bytes, size, SSRF, Drive conversion) and
 * the view (no internals cross to the client).
 *
 * Plus the merge layer: semantic term identity, bullet de-duplication, entity
 * matching, and the plan itself — including idempotence, which is the property
 * that stops a re-upload duplicating everything.
 *
 * Plus source assertions on the invariants that are expensive to get wrong and
 * invisible in a unit test: extraction never runs on a page read, no résumé
 * path is reachable without the session's own user id, and the merge applier
 * contains no destructive operation.
 *
 * Run: npm run test:resume
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertPublicHttpUrl,
  hasPdfMagic,
  toDirectDocumentUrl,
  validateResumeBytes,
} from "@/features/resume/ingest";
import {
  allSkills,
  isGenuineCertification,
  isLikelyAchievement,
  isLikelyOpenSource,
  looksLikeResume,
  normalizeGithubUrl,
  normalizeLinkedinUrl,
  normalizeParsedResume,
  normalizeUrl,
} from "@/features/resume/normalize";
import { analyseResumeStrength, scoreBand } from "@/features/resume/strength";
import { toResumeView } from "@/features/resume/view";
import {
  resumeUrlAction,
  resumeUrlActionOnRemove,
} from "@/features/resume/service";
import {
  RESUME_DOCUMENT_VERSION,
  readResumeAnalysis,
  readResumeDocument,
  resumeAnalysisSchema,
  resumeDocumentSchema,
} from "@/features/resume/document";
import {
  inferCertificationIssuer,
  matchEducation,
  matchExperience,
  matchProject,
  planResumeMerge,
  readDuration,
  type MergeSection,
} from "@/features/resume/merge/plan";
import { mergeTermLists, sameTerm } from "@/features/resume/merge/terms";
import { mergeBullets, splitBullets } from "@/features/resume/merge/text";
import type {
  CandidateDetail,
  EducationView,
  ExperienceView,
  ProjectView,
} from "@/repositories/candidate-detail";
import {
  MAX_RESUME_BYTES,
  STRENGTH_CATEGORIES,
  type ParsedResume,
} from "@/features/resume/types";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

async function suite(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

const root = process.cwd();
const source = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Source with comments stripped, so prose cannot satisfy a code assertion. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ─── Fixtures ───────────────────────────────────────────────────────────── */

/** The agent's own snake_case output shape, as the model returns it. */
const RAW_COMPLETE = {
  candidate_name: "Asha Menon",
  headline: "Backend Engineer",
  email: "asha@example.com",
  phone: "+91 90000 00000",
  location: "Bengaluru, KA",
  linkedin: "https://linkedin.com/in/asha",
  github: "https://github.com/asha",
  portfolio: "https://asha.dev",
  summary:
    "Backend engineer focused on Python services and data pipelines, looking for platform work.",
  career_level: "Mid",
  primary_domain: "Backend",
  estimated_experience_years: 3,
  skills: ["Python", "FastAPI", "PostgreSQL", "Docker", "Redis", "AWS"],
  programming_languages: ["Python", "SQL"],
  frameworks: ["FastAPI"],
  databases: ["PostgreSQL", "Redis"],
  cloud_platforms: ["AWS"],
  tools: ["Docker"],
  certifications: ["AWS Certified Developer"],
  experience: [
    {
      title: "Backend Engineer",
      company: "Nimbus",
      employment_type: "Full-time",
      duration: "2023 - Present",
      responsibilities: [
        "Built a FastAPI ingestion service in Python handling 40000 events per day",
        "Reduced PostgreSQL query latency by 45% by adding partial indexes",
      ],
      achievements: [
        "Cut Docker image size by 60% and shortened deploys from 9 to 3 minutes",
      ],
      technologies: ["Python", "FastAPI", "PostgreSQL", "Docker"],
    },
    {
      title: "Junior Engineer",
      company: "Bytecraft",
      duration: "2022 - 2023",
      responsibilities: [
        "Shipped an internal Redis caching layer that removed 30% of database reads",
        "Migrated 12 services to AWS and documented the rollback path for each",
      ],
      technologies: ["Redis", "AWS"],
    },
  ],
  education: [
    {
      degree: "B.Tech Computer Science",
      branch: "Computer Science",
      institution: "PES University",
      year: "2022",
      cgpa: "8.7",
    },
  ],
  projects: [
    {
      title: "Ledgerly",
      description: "Double-entry ledger with a SQL query console",
      technologies: ["Python", "PostgreSQL"],
      github: "https://github.com/asha/ledgerly",
      contributions: [
        "Designed the append-only schema and wrote 120 property tests over it",
      ],
    },
  ],
  internships: [],
  achievements: [],
  languages: ["English"],
};

const EMPTY_RAW = {};

/** The canonical résumé under test. Module scope, above every suite — see below. */
const complete = normalizeParsedResume(RAW_COMPLETE);

/* ─── Profile fixtures ───────────────────────────────────────────────────── */

/**
 * Declared at module scope, ABOVE every suite that reads them.
 *
 * They used to sit part-way down `run()`, which put every earlier suite inside
 * their temporal dead zone: a test that referenced `emptyDetail` threw
 * "Cannot access 'emptyDetail' before initialization" and was reported as a
 * failure of the code under test rather than of its own placement. Fixtures do
 * not depend on anything in `run()`, so module scope is where they belong and
 * the ordering trap cannot come back.
 */
const emptyDetail = {
  userId: "u1",
  fullName: "Asha Menon",
  headline: null,
  summary: null,
  primaryPersona: "STUDENT",
  phone: null,
  phoneVerified: false,
  locationCity: null,
  locationRegion: null,
  countryCode: null,
  linkedinUrl: null,
  githubUsername: null,
  portfolioUrl: null,
  resumeUrl: null,
  referralCode: "ABC123",
  isReadyForInterview: false,
  education: [],
  experience: [],
  projects: [],
  certifications: [],
  skills: [],
  links: [],
  preference: null,
} as unknown as CandidateDetail;

const existingExperience = [
  {
    id: "exp-1",
    companyName: "Nimbus Technologies Pvt. Ltd.",
    title: "Backend Engineer",
    employmentType: null,
    locationCity: null,
    startMonth: 1,
    startYear: 2023,
    endMonth: null,
    endYear: null,
    isCurrent: true,
    totalMonths: 20,
    description: "• Built the ingestion service",
  },
  {
    id: "exp-2",
    companyName: "Nimbus Technologies Pvt. Ltd.",
    title: "Support Engineer",
    employmentType: null,
    locationCity: null,
    startMonth: 1,
    startYear: 2020,
    endMonth: null,
    endYear: 2021,
    isCurrent: false,
    totalMonths: 12,
    description: null,
  },
] as unknown as ExperienceView[];

const existingEducation = [
  {
    id: "edu-1",
    institutionName: "PES University",
    collegeId: null,
    degree: "B.Tech Computer Science",
    fieldOfStudy: null,
    startMonth: null,
    startYear: null,
    endMonth: null,
    graduationYear: 2022,
    isCurrent: false,
    gradeType: null,
    grade: null,
    description: null,
  },
] as unknown as EducationView[];

const existingProjects = [
  {
    id: "proj-1",
    title: "Ledgerly",
    description: null,
    techStack: ["Python"],
    repoUrl: null,
    liveUrl: null,
  },
] as unknown as ProjectView[];


/* ─── Normaliser ─────────────────────────────────────────────────────────── */

async function run() {
  console.log("\nnormalise");

  await suite("snake_case agent output becomes the canonical camelCase shape", () => {
    const p = normalizeParsedResume(RAW_COMPLETE);
    assert(p.candidateName === "Asha Menon", "name");
    assert(p.estimatedExperienceYears === 3, "years");
    assert(p.programmingLanguages.includes("Python"), "languages");
    assert(p.experience.length === 2, "experience count");
    assert(p.experience[0]?.employmentType === "Full-time", "employment type");
    assert(p.education[0]?.branch === "Computer Science", "education branch");
    assert(p.projects[0]?.github?.includes("ledgerly") === true, "project link");
  });

  await suite("junk input still yields a fully populated ParsedResume", () => {
    for (const input of [EMPTY_RAW, null, "nonsense", 42, [], { skills: 7 }]) {
      const p = normalizeParsedResume(input);
      assert(Array.isArray(p.skills), "skills is an array");
      assert(Array.isArray(p.experience), "experience is an array");
      assert(p.estimatedExperienceYears === 0, "years defaults to 0");
      assert(p.candidateName === null, "absent name is null, never invented");
    }
  });

  await suite("a comma-separated skills string is not dropped", () => {
    const p = normalizeParsedResume({ skills: "Python, React , Go" });
    assert(p.skills.length === 3, `expected 3, got ${p.skills.length}`);
  });

  await suite("nulls inside arrays are filtered, duplicates collapsed", () => {
    const p = normalizeParsedResume({ skills: ["Go", null, "go", "", "Rust"] });
    assert(p.skills.length === 2, `expected 2, got ${JSON.stringify(p.skills)}`);
  });

  await suite("a non-résumé document is recognised as such", () => {
    assert(looksLikeResume(normalizeParsedResume(RAW_COMPLETE)), "real résumé");
    assert(!looksLikeResume(normalizeParsedResume(EMPTY_RAW)), "empty doc");
    assert(
      !looksLikeResume(normalizeParsedResume({ summary: "Certificate of completion" })),
      "certificate",
    );
  });

  await suite("link normalization and URL cleaning handles noisy extracted text", () => {
    // LinkedIn
    assert(
      normalizeLinkedinUrl("linkedin.com/in/johndoe") === "https://www.linkedin.com/in/johndoe",
      "bare linkedin domain",
    );
    assert(
      normalizeLinkedinUrl("https://www.linkedin.com/in/johndoe/") ===
        "https://www.linkedin.com/in/johndoe",
      "trailing slash",
    );
    assert(
      normalizeLinkedinUrl("in/johndoe") === "https://www.linkedin.com/in/johndoe",
      "in/ prefix",
    );
    assert(
      normalizeLinkedinUrl("@johndoe") === "https://www.linkedin.com/in/johndoe",
      "@ prefix",
    );
    assert(normalizeLinkedinUrl("none") === null, "placeholder none");
    assert(normalizeLinkedinUrl("LinkedIn") === null, "label LinkedIn");

    // GitHub
    assert(
      normalizeGithubUrl("github.com/johndoe") === "https://github.com/johndoe",
      "bare github domain",
    );
    assert(
      normalizeGithubUrl("https://github.com/johndoe/repo") ===
        "https://github.com/johndoe/repo",
      "full repo url",
    );
    assert(
      normalizeGithubUrl("@johndoe") === "https://github.com/johndoe",
      "github handle",
    );
    assert(normalizeGithubUrl("GitHub") === null, "label GitHub");

    // General URLs
    assert(
      normalizeUrl("johndoe.dev") === "https://johndoe.dev",
      "bare dev domain",
    );
    assert(
      normalizeUrl("http://mysite.com/portfolio") === "https://mysite.com/portfolio",
      "http upgrade to https",
    );
    assert(
      normalizeUrl("(https://myapp.vercel.app),") === "https://myapp.vercel.app",
      "strip surrounding punctuation",
    );
    assert(normalizeUrl("Live Demo") === null, "placeholder Live Demo");
    assert(normalizeUrl("N/A") === null, "placeholder N/A");
  });

  await suite("URLs survive brackets, parentheses, commas and periods", () => {
    // Regression: bracket-stripping anchored at the end of the string, so a
    // link written inline as "(https://x.app)," kept its ")" once the comma
    // was removed. Peeling now loops until the string stops changing.
    const cases: [string, string | null][] = [
      ["(https://myapp.vercel.app),", "https://myapp.vercel.app"],
      ["[https://myapp.vercel.app].", "https://myapp.vercel.app"],
      ["(https://myapp.vercel.app);", "https://myapp.vercel.app"],
      ["<https://myapp.vercel.app>,", "https://myapp.vercel.app"],
      ['"https://myapp.vercel.app",', "https://myapp.vercel.app"],
      ["  https://myapp.vercel.app  .", "https://myapp.vercel.app"],
      ["((https://myapp.vercel.app)).", "https://myapp.vercel.app"],
      ["{https://myapp.vercel.app},", "https://myapp.vercel.app"],
      ["(myapp.vercel.app),", "https://myapp.vercel.app"],
      // A URL whose own brackets are BALANCED keeps them — stripping these
      // would break a link that works.
      [
        "https://en.wikipedia.org/wiki/Ruby_(programming_language)",
        "https://en.wikipedia.org/wiki/Ruby_(programming_language)",
      ],
      [
        "(https://en.wikipedia.org/wiki/Ruby_(programming_language)),",
        "https://en.wikipedia.org/wiki/Ruby_(programming_language)",
      ],
    ];
    for (const [input, expected] of cases) {
      const got = normalizeUrl(input);
      assert(got === expected, `${JSON.stringify(input)} → ${got}`);
    }
  });

  await suite("profile handles survive the same punctuation", () => {
    assert(
      normalizeGithubUrl("(github.com/ashamenon),") === "https://github.com/ashamenon",
      `github: ${normalizeGithubUrl("(github.com/ashamenon),")}`,
    );
    assert(
      normalizeGithubUrl("[https://github.com/asha/ledgerly].") ===
        "https://github.com/asha/ledgerly",
      "github repo in brackets",
    );
    assert(
      normalizeLinkedinUrl("(linkedin.com/in/asha-menon),") ===
        "https://www.linkedin.com/in/asha-menon",
      `linkedin: ${normalizeLinkedinUrl("(linkedin.com/in/asha-menon),")}`,
    );
  });

  await suite("a skill row missing its slug does not take down the merge", () => {
    // Regression: `detail.skills.flatMap(s => [s.name, s.slug])` fed undefined
    // into canonicalTerm, which threw. planResumeMerge runs AFTER the résumé
    // row is already READY, so the candidate saw an error for work that had
    // actually succeeded.
    const detail = {
      ...emptyDetail,
      skills: [{ skillId: "sk1", name: "Python" }],
    } as unknown as CandidateDetail;
    const plan = planResumeMerge(complete, detail);
    assert(
      !plan.skillNames.some((n) => n.toLowerCase() === "python"),
      "re-proposed a skill that was already claimed",
    );
    assert(plan.skillNames.length > 0, "dropped every skill");
  });

  await suite("project links are recovered from description when not in dedicated fields", () => {
    const raw = {
      projects: [
        {
          title: "AI Chatbot (github.com/user/ai-bot)",
          description: "Live at https://ai-bot.vercel.app with automated streaming",
          contributions: ["Built full-stack UI"],
        },
      ],
    };
    const parsed = normalizeParsedResume(raw);
    assert(
      parsed.projects[0]?.github === "https://github.com/user/ai-bot",
      `github url not recovered: ${parsed.projects[0]?.github}`,
    );
    assert(
      parsed.projects[0]?.demo === "https://ai-bot.vercel.app",
      `demo url not recovered: ${parsed.projects[0]?.demo}`,
    );
  });

  await suite("open source contributions and non-certifications are sanitized from certifications", () => {
    const raw = {
      certifications: [
        "AWS Certified Solutions Architect",
        "Contributed to facebook/react open source repository (github.com/facebook/react)",
        "Smart India Hackathon 2023 1st Runner Up",
        "LeetCode Top 5% (Rating 1950, 600+ problems solved)",
        "Relevant Coursework: Data Structures and Operating Systems",
        "GDSC Club Lead & Student Coordinator",
        "Published research paper in IEEE Conference on AI",
        "Google Cloud Professional Data Engineer",
      ],
      achievements: ["Dean's List 2022"],
      projects: [],
    };

    const parsed = normalizeParsedResume(raw);

    // Only genuine certifications survive in certifications
    assert(
      parsed.certifications.length === 2,
      `expected 2 genuine certifications, got ${parsed.certifications.length}: ${JSON.stringify(parsed.certifications)}`,
    );
    assert(
      parsed.certifications.includes("AWS Certified Solutions Architect"),
      "missing AWS cert",
    );
    assert(
      parsed.certifications.includes("Google Cloud Professional Data Engineer"),
      "missing GCP cert",
    );

    // Open source was rescued into projects
    const osProj = parsed.projects.find((p) => p.github?.includes("facebook/react") || p.title?.includes("react") || p.title?.includes("Open Source"));
    assert(Boolean(osProj), "open source contribution was not rescued into projects");
    assert(osProj?.github === "https://github.com/facebook/react", `repo url: ${osProj?.github}`);

    // Hackathon, LeetCode, GDSC, Paper, OS are saved as info in achievements
    assert(
      parsed.achievements.some((a) => a.toLowerCase().includes("smart india hackathon")),
      "hackathon lost from achievements",
    );
    assert(
      parsed.achievements.some((a) => a.toLowerCase().includes("leetcode")),
      "leetcode lost from achievements",
    );
    assert(
      parsed.achievements.some((a) => a.toLowerCase().includes("facebook/react")),
      "open source lost from achievements info",
    );
  });

  await suite("achievements are never merged into candidate profile certifications", () => {
    const parsedWithAchievements = normalizeParsedResume({
      candidate_name: "Test Candidate",
      certifications: ["AWS Certified Developer"],
      achievements: [
        "Smart India Hackathon 2023 Winner",
        "Contributed to Next.js open-source repository",
        "LeetCode Knight rating 1950",
      ],
    });

    const plan = planResumeMerge(parsedWithAchievements, emptyDetail);

    // Only the 1 genuine certification must be created
    assert(
      plan.certifications.create.length === 1,
      `expected 1 certification created, got ${plan.certifications.create.length}: ${JSON.stringify(plan.certifications.create)}`,
    );
    assert(
      plan.certifications.create[0]?.name === "AWS Certified Developer",
      "wrong certification created",
    );
    assert(
      plan.certifications.create[0]?.issuer === "Amazon Web Services",
      `inferred issuer was ${plan.certifications.create[0]?.issuer}`,
    );
    assert(
      !plan.certifications.create.some((c) => c.name.toLowerCase().includes("hackathon")),
      "hackathon leaked into profile certifications",
    );
    assert(
      !plan.certifications.create.some((c) => c.name.toLowerCase().includes("next.js")),
      "open source leaked into profile certifications",
    );
    assert(
      !plan.certifications.create.some((c) => c.name.toLowerCase().includes("leetcode")),
      "leetcode leaked into profile certifications",
    );
  });

  await suite("certification issuer inference accurately recognizes major providers", () => {
    assert(inferCertificationIssuer("AWS Certified Solutions Architect") === "Amazon Web Services", "AWS");
    assert(inferCertificationIssuer("Google Cloud Associate Cloud Engineer") === "Google", "GCP");
    assert(inferCertificationIssuer("Microsoft Certified: Azure Developer") === "Microsoft", "Azure");
    assert(inferCertificationIssuer("Meta Front-End Developer Specialization") === "Meta", "Meta");
    assert(inferCertificationIssuer("CompTIA Security+ (SY0-601)") === "CompTIA", "CompTIA");
    assert(inferCertificationIssuer("Databricks Certified Data Engineer Associate") === "Databricks", "Databricks");
    assert(inferCertificationIssuer("Deep Learning Specialization by Coursera") === "Coursera", "Coursera");
    assert(inferCertificationIssuer("Custom Certification by Acme Academy") === "Acme Academy", "Delimited issuer");
    assert(inferCertificationIssuer("Generic Internal Certificate") === "", "Unknown returns empty");
  });

  /* ─── Scoring ──────────────────────────────────────────────────────────── */

  console.log("\nrésumé strength");


  await suite("category weights sum to exactly 100", () => {
    const total = STRENGTH_CATEGORIES.reduce((n, c) => n + c.weight, 0);
    assert(total === 100, `weights sum to ${total}`);
  });

  await suite("overall and every category stay within 0-100", () => {
    const inputs: ParsedResume[] = [
      complete,
      normalizeParsedResume(EMPTY_RAW),
      normalizeParsedResume({ ...RAW_COMPLETE, experience: [], projects: [] }),
      normalizeParsedResume({ ...RAW_COMPLETE, education: [], skills: [] }),
      normalizeParsedResume({ skills: Array.from({ length: 400 }, (_, i) => `s${i}`) }),
    ];
    for (const p of inputs) {
      const a = analyseResumeStrength(p);
      assert(
        Number.isInteger(a.overallScore) && a.overallScore >= 0 && a.overallScore <= 100,
        `overall out of range: ${a.overallScore}`,
      );
      for (const c of STRENGTH_CATEGORIES) {
        const v = a.categories[c.key];
        assert(
          Number.isInteger(v) && v >= 0 && v <= 100,
          `${c.key} out of range: ${v}`,
        );
      }
    }
  });

  await suite("overall follows the documented weighting", () => {
    const a = analyseResumeStrength(complete);
    const expected = Math.round(
      STRENGTH_CATEGORIES.reduce((n, c) => n + a.categories[c.key] * c.weight, 0) / 100,
    );
    assert(
      a.overallScore === expected,
      `overall ${a.overallScore} !== weighted ${expected}`,
    );
  });

  await suite("scoring is deterministic", () => {
    const a = JSON.stringify(analyseResumeStrength(complete));
    const b = JSON.stringify(analyseResumeStrength(normalizeParsedResume(RAW_COMPLETE)));
    assert(a === b, "two runs over the same résumé disagreed");
  });

  await suite(
    "resume strength is computed strictly from parsed resume data and independent of profile state",
    () => {
      const resumeWithoutProjects = normalizeParsedResume({
        ...RAW_COMPLETE,
        projects: [],
      });
      const initialScore = analyseResumeStrength(resumeWithoutProjects);
      assert(
        initialScore.weaknesses.some((w) => w.toLowerCase().includes("no projects")),
        "resume without projects was not penalized",
      );

      const richProfile = {
        ...emptyDetail,
        projects: existingProjects,
        experience: existingExperience,
        education: existingEducation,
        skills: [
          {
            skillId: "sk1",
            name: "Python",
            categoryName: "Languages",
            claimedByCandidate: true,
            verified: true,
            evidenceCount: 5,
            selfRated: 5,
          },
        ],
      } as unknown as CandidateDetail;

      const mergePlan = planResumeMerge(resumeWithoutProjects, richProfile);
      assert(mergePlan !== null, "planResumeMerge executed");

      // Re-running evaluation on the same resume after profile enrichment must be identical
      const scoreAfterProfileEnrichment = analyseResumeStrength(resumeWithoutProjects);
      assert(
        JSON.stringify(initialScore) === JSON.stringify(scoreAfterProfileEnrichment),
        "profile enrichment mutated or inflated the resume strength score",
      );
    },
  );

  await suite("missing sections do not crash the analysis", () => {
    const bare = analyseResumeStrength(normalizeParsedResume(EMPTY_RAW));
    assert(bare.overallScore === 0, `empty résumé scored ${bare.overallScore}`);
    assert(bare.recommendations.length > 0, "an empty résumé got no advice");
  });

  await suite("quantified bullets score higher on impact than vague ones", () => {
    const vague = analyseResumeStrength(
      normalizeParsedResume({
        ...RAW_COMPLETE,
        experience: [
          {
            title: "Backend Engineer",
            company: "Nimbus",
            duration: "2023 - Present",
            responsibilities: [
              "Responsible for working on the backend services and helping the team",
              "Worked on various tasks involving the database and the deployment setup",
            ],
          },
        ],
        projects: [],
      }),
    );
    const strong = analyseResumeStrength(complete);
    assert(
      strong.categories.impact > vague.categories.impact,
      `impact did not separate: ${strong.categories.impact} vs ${vague.categories.impact}`,
    );
    assert(
      strong.categories.contentQuality > vague.categories.contentQuality,
      "content quality did not separate",
    );
  });

  await suite("a four-digit year alone is not counted as an achievement metric", () => {
    const yearsOnly = analyseResumeStrength(
      normalizeParsedResume({
        experience: [
          {
            title: "Engineer",
            company: "Acme",
            duration: "2021 - 2024",
            responsibilities: [
              "Maintained the reporting service between 2021 and 2024 across teams",
            ],
          },
        ],
        education: [{ degree: "B.Tech", institution: "X", year: "2021" }],
      }),
    );
    assert(
      yearsOnly.categories.impact === 0,
      `a date scored as impact: ${yearsOnly.categories.impact}`,
    );
  });

  await suite("recommendations describe the actual résumé", () => {
    const noProjects = analyseResumeStrength(
      normalizeParsedResume({ ...RAW_COMPLETE, projects: [] }),
    );
    assert(
      noProjects.recommendations.some((r) => r.toLowerCase().includes("project")),
      "no project advice for a résumé with no projects",
    );
    assert(
      !analyseResumeStrength(complete).weaknesses.some((w) =>
        w.toLowerCase().includes("no projects listed"),
      ),
      "projects flagged as missing on a résumé that has one",
    );
  });

  await suite("bands are ordered and cover the whole range", () => {
    const bands = [0, 39, 40, 54, 55, 69, 70, 84, 85, 100].map(scoreBand);
    assert(bands.every((b) => typeof b === "string" && b.length > 0), "empty band");
    assert(scoreBand(100) !== scoreBand(0), "top and bottom share a band");
  });

  await suite("no job description is accepted anywhere in the scorer", () => {
    const src = code("src/features/resume/strength.ts").toLowerCase();
    for (const banned of ["jobdescription", "job_description", "atsscore", "ats_score"]) {
      assert(!src.includes(banned), `strength.ts references ${banned}`);
    }
    assert(
      analyseResumeStrength.length === 1,
      "the scorer takes more than the résumé",
    );
  });

  await suite("allSkills merges every categorised list without duplicates", () => {
    const skills = allSkills(complete);
    assert(skills.includes("Python"), "missing a language");
    assert(skills.includes("Docker"), "missing a tool");
    assert(
      new Set(skills.map((s) => s.toLowerCase())).size === skills.length,
      "duplicates survived",
    );
  });

  /* ─── Ingest ───────────────────────────────────────────────────────────── */

  console.log("\ningest");

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

  await suite("a valid PDF is accepted", () => {
    assert(hasPdfMagic(pdf), "magic bytes");
    assert(validateResumeBytes(pdf, "asha.pdf").ok, "validation");
  });

  await suite("an unsupported file is rejected on content, not on its name", () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    // Named .pdf, but the bytes are a zip. The browser-supplied name loses.
    const r = validateResumeBytes(docx, "resume.pdf");
    assert(!r.ok, "a zip named .pdf was accepted");
    const r2 = validateResumeBytes(docx, "resume.docx");
    assert(!r2.ok && r2.message.includes("PDF"), "docx message");
  });

  await suite("an oversized file is rejected", () => {
    const big = new Uint8Array(MAX_RESUME_BYTES + 1);
    big.set(pdf, 0);
    const r = validateResumeBytes(big, "big.pdf");
    assert(!r.ok && r.message.includes("too large"), "oversize not caught");
  });

  await suite("an empty and a malformed PDF are both rejected", () => {
    assert(!validateResumeBytes(new Uint8Array(0), "x.pdf").ok, "empty");
    const truncated = new Uint8Array([0x25, 0x50]);
    assert(!validateResumeBytes(truncated, "x.pdf").ok, "truncated");
    const html = new TextEncoder().encode("<!DOCTYPE html><html>Sign in</html>");
    assert(!validateResumeBytes(html, "x.pdf").ok, "html body");
  });

  await suite("supported Google Drive share URLs convert to a file request", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
    const converted = toDirectDocumentUrl(
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    );
    assert(converted.includes("uc?export=download"), `got ${converted}`);
    assert(converted.includes(id), "file id lost");

    const doc = toDirectDocumentUrl(`https://docs.google.com/document/d/${id}/edit`);
    assert(doc.includes("export?format=pdf"), `got ${doc}`);
  });

  await suite("a direct PDF URL is passed through unchanged", () => {
    const url = "https://example.com/files/asha-resume.pdf";
    assert(toDirectDocumentUrl(url) === url, "a plain PDF URL was rewritten");
  });

  await suite("an unsupported host is not scraped, just fetched as-is", () => {
    const url = "https://notion.so/my-resume-page";
    assert(toDirectDocumentUrl(url) === url, "an arbitrary page was rewritten");
  });

  await suite("private and non-http targets are refused (SSRF)", async () => {
    const blocked = [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:3000/x.pdf",
      "http://localhost/x.pdf",
      "https://10.0.0.5/x.pdf",
      "https://192.168.1.10/x.pdf",
      "https://172.16.4.4/x.pdf",
      "http://[::1]/x.pdf",
      "file:///etc/passwd",
      "gopher://example.com/",
      "https://user:pass@example.com/x.pdf",
      "https://db.internal/x.pdf",
      "not a url at all",
    ];
    for (const url of blocked) {
      const r = await assertPublicHttpUrl(url);
      assert(!r.ok, `allowed ${url}`);
    }
  });

  await suite("every link failure returns the same opaque message", async () => {
    const a = await assertPublicHttpUrl("http://127.0.0.1/x.pdf");
    const b = await assertPublicHttpUrl("file:///etc/passwd");
    assert(!a.ok && !b.ok, "expected both to fail");
    assert(
      !a.ok && !b.ok && a.message === b.message,
      "failure messages differ, which leaks which check fired",
    );
    assert(!a.ok && a.message.includes("upload the PDF directly"), "no guidance");
  });

  /* ─── View ─────────────────────────────────────────────────────────────── */

  console.log("\nview");

  const analysis = analyseResumeStrength(complete);
  const readyRow = {
    sourceType: "UPLOAD" as const,
    sourceUrl: null,
    blobPathname: "resumes/u1/abc.pdf",
    fileName: "asha.pdf",
    status: "READY" as const,
    failureReason: null,
    parsedData: complete,
    analysis,
    appliedSections: ["education", "projects", "skills"] as MergeSection[],
    updatedAt: new Date("2026-09-01T10:00:00Z"),
  };

  await suite("the view carries the score and no copy of the profile", () => {
    const v = toResumeView(readyRow);
    const serialised = JSON.stringify(v);
    for (const leaked of [
      "candidate_name",
      "estimated_experience_years",
      "primaryDomain",
      "careerLevel",
      "gemini",
      "blobPathname",
      "resumes/u1",
      // The résumé's own copies of profile data must not travel to the client —
      // that information belongs in the profile's editable sections.
      "Asha Menon",
      "Nimbus",
      "PES University",
      "Ledgerly",
      "FastAPI",
    ]) {
      assert(!serialised.includes(leaked), `view leaked ${leaked}`);
    }
    assert(v.downloadPath === "/api/profile/resume/file", "download path");
    assert(v.strength?.overallScore === analysis.overallScore, "score");
    assert((v.strength?.band.length ?? 0) > 0, "band");
  });

  await suite("the view reports which profile sections were filled in", () => {
    const v = toResumeView(readyRow);
    assert(
      v.addedToProfile.join("|") === "Education|Projects|Skills",
      `got ${v.addedToProfile.join("|")}`,
    );
    const none = toResumeView({ ...readyRow, appliedSections: [] });
    assert(none.addedToProfile.length === 0, "reported additions it never made");
  });

  await suite("a failed row shows its message and no score", () => {
    const v = toResumeView({
      ...readyRow,
      status: "FAILED",
      failureReason: "We could not retrieve a résumé from this link.",
      parsedData: null,
      analysis: null,
    });
    assert(v.status === "FAILED", "status");
    assert(v.strength === null, "a failed row rendered a score");
    assert(v.failureReason !== null, "message dropped");
    assert(v.addedToProfile.length === 0, "a failed row claimed to fill sections");
  });

  await suite("PENDING reads as processing to the candidate", () => {
    const v = toResumeView({
      ...readyRow,
      status: "PENDING",
      parsedData: null,
      analysis: null,
    });
    assert(v.status === "PROCESSING", `got ${v.status}`);
  });

  await suite("a READY row with an unreadable document degrades, not half-renders", () => {
    const v = toResumeView({ ...readyRow, parsedData: null, analysis: null });
    assert(v.status === "FAILED", `got ${v.status}`);
    assert(v.strength === null, "scored a document it could not read");
    assert(v.failureReason !== null, "degraded silently, with no message");
  });

  /* ─── Stored document contract ─────────────────────────────────────────── */

  console.log("\ndocument contract");

  await suite("a normalised résumé round-trips through the stored schema", () => {
    const written = resumeDocumentSchema.parse(complete);
    const read = readResumeDocument(written, RESUME_DOCUMENT_VERSION);
    assert(read !== null, "a valid document failed to read back");
    assert(JSON.stringify(read) === JSON.stringify(complete), "round-trip changed it");
    assert(
      readResumeAnalysis(resumeAnalysisSchema.parse(analysis)) !== null,
      "analysis failed to round-trip",
    );
  });

  await suite("an older document version is unreadable rather than mis-read", () => {
    assert(
      readResumeDocument(complete, RESUME_DOCUMENT_VERSION - 1) === null,
      "an old version was read as current",
    );
  });

  await suite("a malformed stored document is refused on read", () => {
    for (const bad of [
      null,
      {},
      { ...complete, experience: "not a list" },
      { ...complete, estimatedExperienceYears: -3 },
      { ...complete, unexpectedKey: 1 },
    ]) {
      assert(
        readResumeDocument(bad, RESUME_DOCUMENT_VERSION) === null,
        `accepted ${JSON.stringify(bad).slice(0, 40)}`,
      );
    }
  });

  await suite("an out-of-range analysis is refused on read", () => {
    assert(readResumeAnalysis({ ...analysis, overallScore: 140 }) === null, "score 140");
    assert(
      readResumeAnalysis({
        ...analysis,
        categories: { ...analysis.categories, impact: -1 },
      }) === null,
      "category -1",
    );
  });

  /* ─── Term normalisation ───────────────────────────────────────────────── */

  console.log("\nsemantic terms");

  await suite("spelling variants of one technology collapse", () => {
    const pairs: [string, string][] = [
      ["React", "React.js"],
      ["React", "reactjs"],
      ["Node", "Node.js"],
      ["Mongo", "MongoDB"],
      ["Java Script", "JavaScript"],
      ["JS", "JavaScript"],
      ["Postgres", "PostgreSQL"],
      ["Go", "Golang"],
      ["K8s", "Kubernetes"],
      ["Tailwind", "Tailwind CSS"],
      ["C++", "cpp"],
      ["Next", "Next.js"],
    ];
    for (const [a, b] of pairs) {
      assert(sameTerm(a, b), `"${a}" and "${b}" should be the same skill`);
    }
  });

  await suite("genuinely different technologies stay apart", () => {
    const pairs: [string, string][] = [
      ["Java", "JavaScript"],
      ["React", "React Native"],
      ["C", "C++"],
      ["C#", "C++"],
      ["Node", "Nuxt"],
      ["MySQL", "PostgreSQL"],
      ["Vue", "Vuex"],
      ["Python", "Pytorch"],
      ["Go", "Godot"],
    ];
    for (const [a, b] of pairs) {
      assert(!sameTerm(a, b), `"${a}" and "${b}" must not be merged`);
    }
  });

  await suite("the candidate's own spelling survives a merge", () => {
    const merged = mergeTermLists(
      ["React", "Python", "SQL"],
      ["React.js", "Python", "MongoDB", "Node.js"],
    );
    assert(
      merged.join(", ") === "React, Python, SQL, MongoDB, Node.js",
      `got: ${merged.join(", ")}`,
    );
    assert(!merged.includes("React.js"), "duplicated React as React.js");
  });

  /* ─── Bullet de-duplication ────────────────────────────────────────────── */

  console.log("\nbullet merging");

  await suite("bullets the candidate already wrote are not repeated", () => {
    const existing = ["Built the ingestion service in Python"];
    const { merged, added } = mergeBullets(existing, [
      "built the ingestion service in python",
      "Reduced query latency by 45%",
    ]);
    assert(added === 1, `expected 1 new bullet, got ${added}`);
    assert(merged.length === 2, "wrong bullet count");
    assert(merged[0] === existing[0], "rewrote the candidate's own wording");
  });

  await suite("existing bullets are never dropped", () => {
    const existing = ["A", "B", "C"].map((x) => `Did the ${x} thing carefully`);
    const { merged } = mergeBullets(existing, ["Something entirely different"]);
    for (const e of existing) {
      assert(merged.includes(e), `dropped an existing bullet: ${e}`);
    }
  });

  await suite("bullets typed with -, * or numbers are recognised", () => {
    const parsedBack = splitBullets("- First thing\n* Second thing\n1. Third thing");
    assert(parsedBack.length === 3, `got ${parsedBack.length}`);
    assert(parsedBack[0] === "First thing", `got ${parsedBack[0]}`);
    const { added } = mergeBullets(parsedBack, ["First thing"]);
    assert(added === 0, "re-added a bullet the candidate had typed with a dash");
  });

  /* ─── Entity matching ──────────────────────────────────────────────────── */

  console.log("\nentity matching");


  await suite("the same position is matched through a corporate suffix", () => {
    const match = matchExperience(existingExperience, {
      company: "Nimbus",
      title: "Backend Engineer",
      startedOn: new Date(Date.UTC(2023, 0, 1)),
    });
    assert(match?.id === "exp-1", `matched ${match?.id}`);
  });

  await suite("two roles at one company are not merged into each other", () => {
    // Same employer, different role, different years — a promotion or a move,
    // and merging them would erase one of them.
    const match = matchExperience(existingExperience, {
      company: "Nimbus Technologies",
      title: "Engineering Manager",
      startedOn: new Date(Date.UTC(2025, 0, 1)),
    });
    assert(match === null, `wrongly matched ${match?.id}`);
  });

  await suite("a different company never matches", () => {
    const match = matchExperience(existingExperience, {
      company: "Bytecraft",
      title: "Backend Engineer",
      startedOn: new Date(Date.UTC(2023, 0, 1)),
    });
    assert(match === null, "matched across employers");
  });


  await suite("the same degree at the same institution is matched", () => {
    const match = matchEducation(existingEducation, {
      institution: "PES University, Bengaluru",
      degree: "B.Tech in Computer Science",
      year: 2022,
    });
    assert(match?.id === "edu-1", "did not match the same degree");
  });

  await suite("a second degree at the same institution is a new entry", () => {
    const match = matchEducation(existingEducation, {
      institution: "PES University",
      degree: "M.Tech Data Science",
      year: 2024,
    });
    assert(match === null, "merged a masters into a bachelors");
  });


  await suite("a project is matched by name or by repository", () => {
    assert(
      matchProject(existingProjects, {
        title: "Ledgerly",
        repoUrl: null,
        tech: [],
      })?.id === "proj-1",
      "name match failed",
    );
    assert(
      matchProject(
        [{ ...existingProjects[0]!, repoUrl: "https://github.com/asha/ledgerly/" }],
        { title: "Completely Different Name", repoUrl: "https://github.com/asha/ledgerly", tech: [] },
      )?.id === "proj-1",
      "repository match failed",
    );
    assert(
      matchProject(existingProjects, {
        title: "Weather Dashboard",
        repoUrl: null,
        tech: ["React"],
      }) === null,
      "matched an unrelated project",
    );
  });

  /* ─── The merge plan ───────────────────────────────────────────────────── */

  console.log("\nmerge plan");


  await suite("an empty profile is filled from the résumé", () => {
    const plan = planResumeMerge(complete, emptyDetail);
    assert(plan.basic.headline === "Backend Engineer", "headline");
    assert(plan.basic.locationCity === "Bengaluru", "city");
    assert(plan.links.githubUsername === "asha", `github: ${plan.links.githubUsername}`);
    assert(plan.education.create.length === 1, "education");
    assert(plan.experience.create.length === 2, `experience: ${plan.experience.create.length}`);
    assert(plan.projects.create.length === 1, "projects");
    assert(plan.skillNames.length > 0, "skills");
  });

  await suite("a graduation year RANGE resolves to the year they finished", () => {
    // Regression: "2018 - 2022" used to store 2018 — the year they STARTED —
    // as the graduation year on every profile with a dated degree range.
    const cases: [string, number | null][] = [
      ["2018 - 2022", 2022],
      ["2018-2022", 2022],
      ["2018 – 2022", 2022],
      ["Aug 2019 to May 2023", 2023],
      ["2022", 2022],
      ["Expected 2026", 2026],
      ["2019 - Present", 2019],
      ["no year at all", null],
      ["1899", null],
    ];
    for (const [input, expected] of cases) {
      const plan = planResumeMerge(
        normalizeParsedResume({
          education: [{ institution: "PES University", degree: "B.Tech", year: input }],
        }),
        emptyDetail,
      );
      const got = plan.education.create[0]?.graduationYear ?? null;
      assert(got === expected, `"${input}" → ${got}, expected ${expected}`);
    }
  });

  await suite("a year range does not disturb role start and end dates", () => {
    // `readDuration` must keep reading the FIRST year as the start; only the
    // education graduation year takes the last.
    const d = readDuration("2018 - 2022");
    assert(d?.startedOn.getUTCFullYear() === 2018, `start: ${d?.startedOn.getUTCFullYear()}`);
    assert(d?.endedOn?.getUTCFullYear() === 2022, `end: ${d?.endedOn?.getUTCFullYear()}`);
  });

  await suite("an existing entry is enriched, not duplicated", () => {
    const detail = {
      ...emptyDetail,
      education: existingEducation,
      experience: [existingExperience[0]],
      projects: existingProjects,
    } as unknown as CandidateDetail;

    const plan = planResumeMerge(complete, detail);

    // Education: same degree, same institution → merged, not appended.
    assert(plan.education.create.length === 0, "duplicated an education entry");
    assert(plan.education.update.length === 1, "did not enrich the existing entry");
    assert(plan.education.update[0]?.grade === "8.7", "did not fill the empty grade");
    assert(plan.education.update[0]?.degree === undefined, "overwrote the degree");

    // Experience: Nimbus/Backend Engineer merged; Bytecraft is a new row.
    assert(plan.experience.update.length === 1, "did not merge the matching role");
    assert(
      plan.experience.create.length === 1 &&
        plan.experience.create[0]?.companyName === "Bytecraft",
      "did not append the genuinely different role",
    );
    const desc = plan.experience.update[0]?.description ?? "";
    assert(desc.includes("Built the ingestion service"), "dropped the existing bullet");
    assert(desc.includes("45%"), "did not append the new bullet");

    // Projects: same name → enriched.
    assert(plan.projects.create.length === 0, "duplicated a project");
    assert(plan.projects.update.length === 1, "did not enrich the project");
    const stack = plan.projects.update[0]?.techStack ?? [];
    assert(stack[0] === "Python", "reordered or rewrote the existing stack");
    assert(stack.includes("PostgreSQL"), "did not add the new technology");
    assert(
      plan.projects.update[0]?.repoUrl?.includes("ledgerly") === true,
      "did not fill the empty repository link",
    );
  });

  await suite("skills merge semantically, without duplicates", () => {
    const detail = {
      ...emptyDetail,
      skills: [
        { name: "React", slug: "react" },
        { name: "Python", slug: "python" },
        { name: "SQL", slug: "sql" },
      ],
    } as unknown as CandidateDetail;

    const resume = normalizeParsedResume({
      skills: ["React.js", "Python", "MongoDB", "Node.js"],
    });
    const names = planResumeMerge(resume, detail).skillNames;
    const canonical = names.map((n) => n.toLowerCase());
    assert(!canonical.includes("react.js"), "re-proposed React as React.js");
    assert(!canonical.includes("python"), "re-proposed Python");
    assert(names.length === 2, `expected MongoDB and Node.js, got ${names.join(", ")}`);
  });

  await suite("an existing link is never replaced by a résumé link", () => {
    const detail = {
      ...emptyDetail,
      linkedinUrl: "https://linkedin.com/in/my-own-profile",
      githubUsername: "my-own-handle",
      portfolioUrl: "https://mine.dev",
    } as unknown as CandidateDetail;
    const plan = planResumeMerge(complete, detail);
    assert(plan.links.linkedinUrl === undefined, "replaced a LinkedIn URL");
    assert(plan.links.githubUsername === undefined, "replaced a GitHub handle");
    assert(plan.links.portfolioUrl === undefined, "replaced a portfolio URL");
    assert(
      plan.decisions.some((d) => d.action === "kept-existing" && d.subject === "linkedin"),
      "did not record that it kept the existing link",
    );
  });

  await suite("a filled scalar is preserved, an empty one beside it is filled", () => {
    const detail = { ...emptyDetail, headline: "Mine" } as unknown as CandidateDetail;
    const plan = planResumeMerge(complete, detail);
    assert(plan.basic.headline === undefined, "overwrote the filled field");
    assert(plan.basic.summary !== undefined, "skipped the empty field beside it");
  });

  await suite("phone and email are never written from a document", () => {
    const plan = planResumeMerge(complete, emptyDetail);
    const keys = Object.keys(plan.basic);
    assert(!keys.includes("phone"), "wrote a phone number, desynchronising phoneVerified");
    assert(!keys.includes("email"), "wrote an email over the account identity");
  });

  await suite("certifications de-duplicate semantically", () => {
    const detail = {
      ...emptyDetail,
      certifications: [{ id: "c1", name: "AWS Certified Developer", issuer: "AWS" }],
    } as unknown as CandidateDetail;
    const plan = planResumeMerge(complete, detail);
    assert(plan.certifications.create.length === 0, "duplicated a certification");
  });

  await suite("re-running the same merge changes nothing the second time", () => {
    // Idempotence: after a merge, the same résumé against the resulting profile
    // must find nothing left to add. A merge that keeps appending on every
    // re-upload is the duplication bug this whole layer exists to prevent.
    const afterFirst = {
      ...emptyDetail,
      headline: "Backend Engineer",
      summary: complete.summary,
      locationCity: "Bengaluru",
      linkedinUrl: complete.linkedin,
      githubUsername: "asha",
      portfolioUrl: complete.portfolio,
      education: [
        {
          id: "e1",
          institutionName: "PES University",
          degree: "B.Tech Computer Science",
          fieldOfStudy: "Computer Science",
          graduationYear: 2022,
          grade: "8.7",
        },
      ],
      experience: complete.experience.map((e, i) => {
        const d = readDuration(e.duration)!;
        return {
          id: `x${i}`,
          companyName: e.company,
          title: e.title,
          employmentType: e.employmentType,
          startYear: d.startedOn.getUTCFullYear(),
          startMonth: 1,
          endYear: d.endedOn?.getUTCFullYear() ?? null,
          endMonth: null,
          isCurrent: d.isCurrent,
          totalMonths: 0,
          locationCity: null,
          description: [...e.achievements, ...e.responsibilities]
            .map((b) => `• ${b}`)
            .join("\n"),
        };
      }),
      projects: complete.projects.map((p, i) => ({
        id: `p${i}`,
        title: p.title,
        description: p.description,
        techStack: p.technologies,
        repoUrl: p.github,
        liveUrl: p.demo,
      })),
      certifications: complete.certifications.map((c, i) => ({
        id: `c${i}`,
        name: c,
        issuer: "",
      })),
    } as unknown as CandidateDetail;

    const plan = planResumeMerge(complete, afterFirst);
    assert(plan.education.create.length === 0, "would duplicate education");
    assert(plan.education.update.length === 0, "would rewrite education");
    assert(plan.experience.create.length === 0, "would duplicate experience");
    assert(plan.experience.update.length === 0, "would rewrite experience");
    assert(plan.projects.create.length === 0, "would duplicate a project");
    assert(plan.projects.update.length === 0, "would rewrite a project");
    assert(plan.certifications.create.length === 0, "would duplicate a certification");
    assert(Object.keys(plan.basic).length === 0, "would rewrite a scalar");
    assert(Object.keys(plan.links).length === 0, "would rewrite a link");
  });

  await suite("a role with no readable dates is skipped, not invented", () => {
    const undated = normalizeParsedResume({
      experience: [
        { title: "Engineer", company: "Acme", duration: "a while", responsibilities: ["x"] },
        { title: "Engineer", company: "Beta", duration: "2022 - 2023", responsibilities: ["y"] },
      ],
    });
    const plan = planResumeMerge(undated, emptyDetail);
    assert(plan.experience.create.length === 1, `got ${plan.experience.create.length}`);
    assert(plan.experience.create[0]?.companyName === "Beta", "kept the wrong one");
  });

  await suite("durations are read, including ongoing roles", () => {
    const now = readDuration("2023 - Present");
    assert(now?.isCurrent === true && now.endedOn === null, "present not detected");
    const ranged = readDuration("Jun 2022 – Aug 2023");
    assert(ranged?.startedOn.getUTCMonth() === 5, "June is month index 5");
    assert(ranged?.endedOn?.getUTCFullYear() === 2023, "end year");
    assert(readDuration("no dates here") === null, "invented dates");
    assert(readDuration("2024 - 2021")?.endedOn === null, "kept a backwards range");
  });

  await suite("every decision is recorded for later debugging", () => {
    const detail = {
      ...emptyDetail,
      experience: [existingExperience[0]],
    } as unknown as CandidateDetail;
    const plan = planResumeMerge(complete, detail);
    assert(plan.decisions.length > 0, "no decisions recorded");
    assert(
      plan.decisions.some((d) => d.action === "merged"),
      "a merge happened but was not recorded",
    );
    assert(
      plan.decisions.every((d) => d.reason.length > 0 && d.subject.length > 0),
      "a decision was recorded without a subject or a reason",
    );
  });

  await suite("the merge layer touches nothing but merging", () => {
    // Separate responsibilities: the merge service must not reach into
    // ingestion, extraction or scoring.
    const planner = code("src/features/resume/merge/plan.ts");
    for (const forbidden of ["resume/ingest", "resume/parse", "resume/strength", "resume/storage"]) {
      assert(!planner.includes(forbidden), `the merge planner imports ${forbidden}`);
    }
  });

  await suite("the scoring layer touches nothing but parsed resume data", () => {
    // Resume evaluation must remain purely functional over ParsedResume
    // without reading profile tables, merge state, or database repositories.
    const scorer = code("src/features/resume/strength.ts");
    for (const forbidden of [
      "candidate-detail",
      "candidate-profile",
      "candidate-merge",
      "prisma",
      "getProfile",
    ]) {
      assert(!scorer.includes(forbidden), `strength.ts references ${forbidden}`);
    }
  });

  await suite("the merge applier cannot destroy candidate data", () => {
    const applier = code("src/repositories/candidate-merge.ts");
    for (const banned of ["deleteMany", "\\.delete\\(", "\\.upsert\\("]) {
      assert(!new RegExp(banned).test(applier), `the merge applier calls ${banned}`);
    }
    assert(applier.includes("emptyWhere("), "a scalar is written without a guard");
    assert(applier.includes("skipDuplicates: true"), "skill claims lack skipDuplicates");
    // Every row update is scoped by userId as well as id.
    const updates = applier.match(/where:\s*\{\s*id:[^}]*\}/g) ?? [];
    for (const u of updates) {
      assert(u.includes("userId"), `an update is not scoped by userId: ${u}`);
    }
  });

  /* ─── Invariants that only source can prove ────────────────────────────── */

  console.log("\ninvariants");

  await suite("the read path never parses", () => {
    const service = code("src/features/resume/service.ts");
    const getView = service.slice(
      service.indexOf("export async function getResumeView"),
      service.indexOf("type Source"),
    );
    assert(getView.length > 0, "getResumeView not found");
    assert(!getView.includes("parseResumeDocument"), "getResumeView calls the parser");
    assert(!getView.includes("fetchResumeFromUrl"), "getResumeView fetches a URL");

    const page = code("src/app/profile/page.tsx");
    assert(!page.includes("parseResumeDocument"), "the profile page parses");
    assert(page.includes("getResumeView"), "the profile page does not read the row");
  });

  await suite("an unchanged document reuses the stored parse", () => {
    const service = code("src/features/resume/service.ts");
    assert(service.includes("contentHash"), "no content hash");
    assert(
      service.includes("existing.contentHash === contentHash"),
      "no hash comparison before parsing",
    );
  });

  await suite("the reuse branch still stores a file that is missing", () => {
    // Regression: the unchanged-document branch carried the stored
    // blobPathname straight through, null included. A row written while blob
    // storage was unconfigured could
    // therefore never be repaired by re-uploading the same PDF — the hash
    // matches, so this is the only branch that runs.
    const service = code("src/features/resume/service.ts");
    const reuse = service.slice(
      service.indexOf("existing.contentHash === contentHash"),
      service.indexOf("upsertResume(userId, {", service.indexOf("existing.contentHash === contentHash")),
    );
    assert(
      reuse.includes("storeResumeFile"),
      "the reuse branch cannot backfill a missing file",
    );
    assert(
      reuse.includes("existing.blobPathname ??"),
      "the reuse branch overwrites an existing blob instead of keeping it",
    );
  });

  await suite("a public blob store is reported as the misconfiguration it is", () => {
    const storage = code("src/features/resume/storage.ts");
    assert(
      storage.includes("private access on a public store"),
      "a public store fails with a generic message an operator cannot act on",
    );
    assert(
      !storage.includes('access: "public"'),
      "résumé files are being written to a publicly readable store",
    );
  });

  await suite("no résumé path takes a user id or a file path from the caller", () => {
    const actions = code("src/app/actions/resume-actions.ts");
    assert(actions.includes("session.user.id"), "actions do not use the session id");
    assert(!/userId:\s*(raw|formData|input)/.test(actions), "a caller-supplied user id");

    const route = code("src/app/api/profile/resume/file/route.ts");
    assert(route.includes("auth()"), "the download route does not authenticate");
    assert(
      route.includes("getOwnResumeFilePath(session.user.id)"),
      "the download route does not scope to the session",
    );
    assert(
      !route.includes("searchParams") && !route.includes("params"),
      "the download route reads a caller-supplied parameter",
    );
  });

  await suite("stored files are private, never public", () => {
    const storage = code("src/features/resume/storage.ts");
    assert(storage.includes('access: "private"'), "blobs are not private");
    assert(!storage.includes('access: "public"'), "a public blob path exists");
  });

  await suite("nothing in the résumé feature is named ATS or JD-matching", () => {
    const files = [
      "src/features/resume/strength.ts",
      "src/features/resume/view.ts",
      "src/features/resume/types.ts",
      "src/components/profile/resume-strength.tsx",
      "src/components/profile/resume-section.tsx",
    ];
    for (const f of files) {
      const src = source(f);
      const rendered = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .toLowerCase();
      for (const banned of ["ats score", "ats compatibility", "job match", "match score"]) {
        assert(!rendered.includes(banned), `${f} says "${banned}"`);
      }
    }
  });

  await suite("no extraction machinery is named in anything the user reads", () => {
    // Product rule: a candidate attaches a résumé and their profile fills in.
    // They are never shown that a parser ran, what it is, or what it returned.
    const banned = [
      "parser",
      "parsing",
      "parsed",
      "gemini",
      "json",
      "prompt",
      "agent",
      "llm",
      "extraction",
      "pipeline",
    ];
    for (const file of [
      "src/components/profile/resume-section.tsx",
      "src/components/profile/resume-strength.tsx",
    ]) {
      const src = source(file);
      // Rendered strings only: JSX text nodes and quoted copy. Comments and
      // identifiers are implementation and may say whatever is clearest.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const copy = [
        ...stripped.matchAll(/>([^<>{}]*[a-zA-Z]{3}[^<>{}]*)</g),
        ...stripped.matchAll(/"([^"]*\s[^"]*)"/g),
        ...stripped.matchAll(/`([^`$]*\s[^`$]*)`/g),
      ]
        .map((m) => (m[1] ?? "").toLowerCase())
        .join(" | ");
      for (const word of banned) {
        assert(!copy.includes(word), `${file} shows the user the word "${word}"`);
      }
    }
  });

  await suite("the score UI shows a number, a band and a few tips — nothing more", () => {
    const analysis2 = analyseResumeStrength(complete);
    const view = toResumeView({
      sourceType: "UPLOAD",
      sourceUrl: null,
      blobPathname: null,
      fileName: "r.pdf",
      status: "READY",
      failureReason: null,
      parsedData: complete,
      analysis: analysis2,
      appliedSections: [],
      updatedAt: new Date(),
    });

    const strength = view.strength;
    assert(strength !== null, "no score at all");
    assert(Object.keys(strength!).sort().join(",") === "band,overallScore,tips", 
      `view.strength exposes ${Object.keys(strength!).sort().join(",")}`);
    assert(strength!.tips.length <= 3, `${strength!.tips.length} tips`);

    // The full analysis is still computed and still persisted — only the view
    // is narrow. If this ever stops being true the scoring engine has been
    // simplified, which is not what was asked for.
    assert(Object.keys(analysis2.categories).length === 7, "categories lost");
    assert(Array.isArray(analysis2.strengths), "strengths lost");
    assert(Array.isArray(analysis2.weaknesses), "weaknesses lost");
  });

  await suite("the score panel renders no category breakdown", () => {
    const ui = code("src/components/profile/resume-strength.tsx");
    for (const banned of [
      "STRENGTH_CATEGORIES",
      "categories",
      "strengths",
      "weaknesses",
      "blurb",
    ]) {
      assert(!ui.includes(banned), `the score panel still renders ${banned}`);
    }
    const copy = source("src/components/profile/resume-strength.tsx");
    assert(!copy.includes("What is working"), "the strengths list is still rendered");
  });

  await suite("the résumé section does not re-render the profile", () => {
    const ui = code("src/components/profile/resume-section.tsx");
    // The view carries no experience/education/projects/skills to render, and
    // the component must not have grown its own copy back.
    for (const banned of ["\\.experience", "\\.education", "\\.projects", "skillGroups"]) {
      assert(
        !new RegExp(banned).test(ui),
        `the résumé card renders ${banned} instead of leaving it to the profile`,
      );
    }
    const view = code("src/features/resume/view.ts");
    assert(
      !view.includes("skillGroups"),
      "the view still builds a second copy of the candidate's skills",
    );
  });

  await suite("uploading a PDF does not wipe an existing résumé link", () => {
    // Regression. `CandidateProfile.resumeUrl` is a candidate-entered link that
    // predates this feature and is read by /hire, admin and the interview
    // résumé context. An upload used to pass null into syncResumeUrl and
    // silently erase it — the candidate attached a file and lost a link they
    // had typed, which is precisely what the merge rules promise never to do.
    const onUpload = resumeUrlAction({ kind: "UPLOAD" });
    assert("keep" in onUpload, "an upload still writes to resumeUrl");
    assert(!("write" in onUpload), "an upload writes a URL it was never given");

    const onLink = resumeUrlAction({
      kind: "URL",
      url: "https://drive.google.com/file/d/abc/view",
    });
    assert(
      "write" in onLink && onLink.write === "https://drive.google.com/file/d/abc/view",
      "a link save did not store the link",
    );

    // A URL source with nothing usable must not clear the field either.
    assert("keep" in resumeUrlAction({ kind: "URL", url: null }), "empty URL cleared the field");
    assert("keep" in resumeUrlAction({ kind: "URL", url: "" }), "blank URL cleared the field");
  });

  await suite("removing a résumé only clears the link when the link WAS the résumé", () => {
    assert(
      "clear" in resumeUrlActionOnRemove("URL"),
      "removing a linked résumé left the link behind",
    );
    // The candidate may have typed a link AND uploaded a PDF. Removing the PDF
    // must not take the link with it.
    assert(
      "keep" in resumeUrlActionOnRemove("UPLOAD"),
      "removing an uploaded PDF also erased a separately-entered link",
    );
    assert("keep" in resumeUrlActionOnRemove(null), "removing nothing cleared the link");
  });

  await suite("no save path can write a null résumé URL", () => {
    const service = code("src/features/resume/service.ts");
    // Only the removal path may pass null, and it is guarded by
    // resumeUrlActionOnRemove. Any other `syncResumeUrl(userId, null)` is the
    // bug coming back.
    const nullWrites = [...service.matchAll(/syncResumeUrl\(\s*userId\s*,\s*null\s*\)/g)];
    assert(
      nullWrites.length === 1,
      `${nullWrites.length} call sites write a null résumé URL; only the removal may`,
    );
    assert(
      service.includes('if ("clear" in action) await syncResumeUrl(userId, null)'),
      "the one null write is not guarded by the removal rule",
    );
    // The save paths must go through the helper, not call syncResumeUrl directly.
    assert(
      service.includes("syncResumeUrlForSave(userId, source)"),
      "a save path bypasses the resumeUrl rule",
    );
  });

  await suite("a created certification is recorded in the audit log", () => {
    // The log used to record skipped-duplicate for certifications but not
    // created, so appliedSections said "certifications" with nothing in the
    // log to explain what had been added.
    const plan = planResumeMerge(complete, emptyDetail);
    const certDecisions = plan.decisions.filter((d) => d.section === "certifications");
    assert(
      certDecisions.length === plan.certifications.create.length,
      `${plan.certifications.create.length} certifications created but ${certDecisions.length} logged`,
    );
    assert(
      certDecisions.every((d) => d.action === "created"),
      "a certification create was logged as something else",
    );
    assert(
      certDecisions.every((d) => d.subject.length > 0 && d.reason.length > 0),
      "a certification decision has no subject or reason",
    );

    // Every section the merge claims to have touched must be explainable from
    // the log — that is the whole point of keeping one.
    const logged = new Set(plan.decisions.filter((d) => d.action === "created" || d.action === "merged").map((d) => d.section));
    for (const section of plan.sections) {
      if (section === "basic" || section === "links" || section === "skills") continue;
      assert(logged.has(section), `${section} was changed but nothing was logged for it`);
    }
  });

  await suite("the existing résumé link keeps working", () => {
    const repo = code("src/repositories/candidate-detail.ts");
    assert(
      repo.includes("input.resumeUrl === undefined ? {} : { resumeUrl: input.resumeUrl }"),
      "a Links save can still clobber the résumé URL",
    );
    const resumeRepo = code("src/repositories/candidate-resume.ts");
    assert(
      resumeRepo.includes("candidateProfile.updateMany") &&
        resumeRepo.includes("studentProfile.updateMany"),
      "the legacy resumeUrl mirror is not maintained",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
