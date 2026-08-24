import "server-only";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import { recomputeMemberScore } from "@/features/program/missions";
import { programMember } from "@/repositories/legacy/program-member";
import {
  encodeRepoContentsPath,
  parseRepo,
} from "@/features/program/verify-mission";

const RUBRICS_PATH = path.join(
  process.cwd(),
  "prisma",
  "content",
  "program",
  "rubrics.json",
);

type RubricCriterion = {
  name: string;
  weight: number;
  description: string;
};

type ModuleRubric = {
  moduleNumber: number;
  title: string;
  criteria: RubricCriterion[];
};

type GradeAiResponse = {
  score: number;
  criteria: { name: string; score: number; note: string }[];
  feedback: string;
};

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

function loadRubric(moduleNumber: number): ModuleRubric | null {
  if (!fs.existsSync(RUBRICS_PATH)) return null;
  try {
    const rubrics = JSON.parse(
      fs.readFileSync(RUBRICS_PATH, "utf-8"),
    ) as ModuleRubric[];
    return rubrics.find((r) => r.moduleNumber === moduleNumber) ?? null;
  } catch (e) {
    logger.error("[projects] rubric load failed", { error: String(e) });
    return null;
  }
}

async function githubFetch<T>(url: string): Promise<T | null> {
  const token = process.env.GITHUB_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "abtalks-program",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchRepoFileRaw(
  owner: string,
  repo: string,
  filePath: string,
): Promise<{ ok: true; content: string; bytes: number } | { ok: false }> {
  const token = process.env.GITHUB_API_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "abtalks-program",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoContentsPath(filePath)}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return { ok: false };
    const content = await res.text();
    return { ok: true, content, bytes: Buffer.byteLength(content, "utf-8") };
  } catch {
    return { ok: false };
  }
}

const NOTEBOOK_MAX_BYTES = 150 * 1024;
const NOTEBOOK_MAX_FILES = 2;

type NotebookCell = { cell_type?: string; source?: unknown };

function stripNotebookForPrompt(raw: string): string {
  const parsed = JSON.parse(raw) as { cells?: NotebookCell[] };
  const cells = Array.isArray(parsed.cells)
    ? parsed.cells.map((cell) => ({
        cell_type: cell.cell_type,
        source: cell.source,
      }))
    : [];
  return JSON.stringify({ cells }, null, 2);
}

async function fetchNotebookGradingLines(
  owner: string,
  repo: string,
  paths: string[],
): Promise<string[]> {
  const ipynbPaths = paths.filter((p) => p.endsWith(".ipynb"));
  const lines: string[] = [];
  let included = 0;

  for (const filePath of ipynbPaths) {
    if (included >= NOTEBOOK_MAX_FILES) break;
    const fetched = await fetchRepoFileRaw(owner, repo, filePath);
    if (!fetched.ok) continue;

    if (fetched.bytes > NOTEBOOK_MAX_BYTES) {
      lines.push(
        `Notebook ${filePath}: (${Math.round(fetched.bytes / 1024)} KB — too large for prompt; listed in tree only)`,
      );
      continue;
    }

    try {
      const stripped = stripNotebookForPrompt(fetched.content);
      lines.push(`Notebook ${filePath}:\n${stripped.slice(0, 12000)}`);
      included += 1;
    } catch {
      lines.push(`Notebook ${filePath}: (invalid JSON — tree entry only)`);
    }
  }

  return lines;
}

async function fetchRepoContext(repoUrl: string): Promise<{
  readme: string;
  paths: string[];
  languages: Record<string, number>;
  notebookLines: string[];
}> {
  const parsed = parseRepo(repoUrl);
  if (!parsed) {
    return { readme: "", paths: [], languages: {}, notebookLines: [] };
  }

  const { owner, repo } = parsed;
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const meta = await githubFetch<{ default_branch?: string }>(base);
  const branch = meta?.default_branch ?? "main";

  let readme = "";
  const readmeJson = await githubFetch<{ content?: string; encoding?: string }>(
    `${base}/readme`,
  );
  if (readmeJson?.content && readmeJson.encoding === "base64") {
    readme = Buffer.from(readmeJson.content, "base64")
      .toString("utf-8")
      .slice(0, 8000);
  }

  const treeJson = await githubFetch<{
    tree?: { path?: string; type?: string }[];
  }>(`${base}/git/trees/${branch}?recursive=1`);
  const paths =
    treeJson?.tree
      ?.filter((n) => n.type === "blob" && n.path)
      .map((n) => n.path!)
      .slice(0, 200) ?? [];

  const languages =
    (await githubFetch<Record<string, number>>(`${base}/languages`)) ?? {};

  const notebookLines = await fetchNotebookGradingLines(owner, repo, paths);

  return { readme, paths, languages, notebookLines };
}

export async function recomputeProjectPointsForMember(
  memberId: string,
): Promise<void> {
  const projects = await prisma.programProject.findMany({
    where: { memberId, status: "GRADED" },
    select: { adminScore: true, aiScore: true },
  });

  const projectPoints = projects.reduce((sum, p) => {
    const effective = p.adminScore ?? p.aiScore ?? 0;
    return sum + effective;
  }, 0);

  await prisma.$transaction(async (tx) => {
    await tx.programMember.update({
      where: { id: memberId },
      data: { projectPoints },
    });
    await recomputeMemberScore(tx, memberId);
  });
}

export async function gradeProject(
  projectId: string,
): Promise<
  | { ok: true; score: number; feedback: string }
  | { ok: false; message: string }
> {
  const project = await prisma.programProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      memberId: true,
      moduleNumber: true,
      repoUrl: true,
      writeup: true,
      status: true,
    },
  });

  if (!project) return { ok: false, message: "Project not found." };

  const rubric = loadRubric(project.moduleNumber);
  if (!rubric) {
    return { ok: false, message: "Rubric not configured for this module." };
  }

  const repoContext = await fetchRepoContext(project.repoUrl);

  const ai = await askClaudeJson<GradeAiResponse>({
    system:
      "You grade B2B program Boss Build projects. Reply with JSON only: {\"score\":0-100,\"criteria\":[{\"name\":\"...\",\"score\":0-100,\"note\":\"...\"}],\"feedback\":\"...\"}. Score holistically against the rubric.",
    user: [
      `Module: ${rubric.title}`,
      `Rubric: ${JSON.stringify(rubric.criteria)}`,
      `Member write-up:\n${project.writeup.slice(0, 4000)}`,
      `README:\n${repoContext.readme || "(none)"}`,
      `File tree (first 200 paths):\n${repoContext.paths.join("\n") || "(empty)"}`,
      repoContext.notebookLines.length > 0
        ? `Notebooks (outputs stripped):\n${repoContext.notebookLines.join("\n\n")}`
        : "Notebooks: (none found in tree)",
      `Languages: ${JSON.stringify(repoContext.languages)}`,
    ].join("\n\n"),
    maxTokens: 2048,
  });

  if (!ai.ok) return { ok: false, message: ai.message };

  const score = clampScore(Number(ai.data.score));
  if (!Number.isFinite(score)) {
    return { ok: false, message: "AI returned an invalid score." };
  }

  const criteria = Array.isArray(ai.data.criteria) ? ai.data.criteria : [];
  const feedback =
    typeof ai.data.feedback === "string" ? ai.data.feedback : "";

  await prisma.programProject.update({
    where: { id: project.id },
    data: {
      aiScore: score,
      aiFeedback: feedback,
      aiRubricJson: { criteria, rubric: rubric.title } as Prisma.InputJsonValue,
      status: "GRADED",
      gradedAt: new Date(),
    },
  });

  await recomputeProjectPointsForMember(project.memberId);

  return { ok: true, score, feedback };
}

export async function overrideProjectScore(
  adminId: string,
  projectId: string,
  score: number,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const clamped = clampScore(score);

  const project = await prisma.programProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      memberId: true,
      adminScore: true,
      aiScore: true,
      member: { select: { userId: true } },
    },
  });

  if (!project) return { ok: false, message: "Project not found." };

  await prisma.$transaction(async (tx) => {
    await tx.programProject.update({
      where: { id: projectId },
      data: {
        adminScore: clamped,
        status: "GRADED",
        gradedAt: new Date(),
      },
    });

    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        targetUserId: project.member.userId,
        actionType: "PROGRAM_OVERRIDE_PROJECT_SCORE",
        reason,
        metadata: {
          projectId,
          score: clamped,
          previousAdminScore: project.adminScore,
          previousAiScore: project.aiScore,
        },
      },
    });
  });

  await recomputeProjectPointsForMember(project.memberId);
  return { ok: true };
}

export async function listProjectsForAdmin(cohortId: string) {
  const members = await programMember.findMany({
    where: {
      cohortId,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      projects: {
        select: {
          id: true,
          moduleNumber: true,
          repoUrl: true,
          writeup: true,
          status: true,
          aiScore: true,
          adminScore: true,
          aiFeedback: true,
          aiRubricJson: true,
          submittedAt: true,
          gradedAt: true,
        },
        orderBy: { moduleNumber: "asc" },
      },
    },
    orderBy: { fullName: "asc" },
  });

  const ungraded = members.flatMap((m) =>
    m.projects
      .filter((p) => p.status === "SUBMITTED")
      .map((p) => ({
        projectId: p.id,
        memberName: m.fullName,
        company: m.company,
        moduleNumber: p.moduleNumber,
        repoUrl: p.repoUrl,
        submittedAt: p.submittedAt.toISOString(),
      })),
  );

  const graded = members.flatMap((m) =>
    m.projects
      .filter((p) => p.status === "GRADED")
      .map((p) => ({
        projectId: p.id,
        memberName: m.fullName,
        company: m.company,
        moduleNumber: p.moduleNumber,
        repoUrl: p.repoUrl,
        aiScore: p.aiScore,
        adminScore: p.adminScore,
        effectiveScore: p.adminScore ?? p.aiScore ?? 0,
        aiFeedback: p.aiFeedback,
        aiRubricJson: p.aiRubricJson,
        gradedAt: p.gradedAt?.toISOString() ?? null,
      })),
  );

  return { ungraded, graded };
}

export async function getMemberProjectsSummary(memberId: string) {
  return prisma.programProject.findMany({
    where: { memberId },
    select: {
      moduleNumber: true,
      status: true,
      aiScore: true,
      adminScore: true,
      aiFeedback: true,
      repoUrl: true,
      gradedAt: true,
    },
    orderBy: { moduleNumber: "asc" },
  });
}
