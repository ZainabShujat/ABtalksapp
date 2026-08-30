import "server-only";
import { prisma } from "@/lib/db";

/**
 * The single resolver for "this member's interview result".
 *
 * A member can now hold up to two new results plus one legacy one, so the
 * "which result counts" rule lives here and nowhere else. Resolution order:
 *
 *   completed DAY_31  →  completed DAY_15  →  legacy ProgramInterview  →  null
 *
 * The legacy fallback is what makes repointing non-breaking: with no
 * GeneralInterview rows yet, every consumer returns exactly today's values.
 * When the DAY_31 replacement is verified, deleting the fallback branch is the
 * whole cleanup.
 */

export type InterviewSignal = {
  source: "DAY_31" | "DAY_15" | "LEGACY";
  status: string;
  overallScore: number | null;
  /** Legacy `commScore`. */
  communicationScore: number | null;
  /** Legacy `techScore`. */
  technicalDepthScore: number | null;
  /** Legacy `problemScore`. */
  problemSolvingScore: number | null;
  /** No legacy equivalent — null for LEGACY. */
  conceptualScore: number | null;
  /** No legacy equivalent — null for LEGACY. */
  practicalScore: number | null;
  summary: string | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
};

const GENERAL_SELECT = {
  memberId: true,
  blueprint: true,
  status: true,
  overallScore: true,
  conceptualScore: true,
  practicalScore: true,
  problemSolvingScore: true,
  technicalDepthScore: true,
  communicationScore: true,
  summary: true,
  durationSec: true,
  evaluatedAt: true,
} as const;

const LEGACY_SELECT = {
  memberId: true,
  status: true,
  overallScore: true,
  commScore: true,
  techScore: true,
  problemScore: true,
  summary: true,
  durationSec: true,
  evaluatedAt: true,
} as const;

type GeneralRow = {
  blueprint: string;
  status: string;
  overallScore: number | null;
  conceptualScore: number | null;
  practicalScore: number | null;
  problemSolvingScore: number | null;
  technicalDepthScore: number | null;
  communicationScore: number | null;
  summary: string | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
};

type LegacyRow = {
  status: string;
  overallScore: number | null;
  commScore: number | null;
  techScore: number | null;
  problemScore: number | null;
  summary: string | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
};

function fromGeneral(row: GeneralRow): InterviewSignal {
  return {
    source: row.blueprint === "DAY_31" ? "DAY_31" : "DAY_15",
    status: row.status,
    overallScore: row.overallScore,
    communicationScore: row.communicationScore,
    technicalDepthScore: row.technicalDepthScore,
    problemSolvingScore: row.problemSolvingScore,
    conceptualScore: row.conceptualScore,
    practicalScore: row.practicalScore,
    summary: row.summary,
    durationSec: row.durationSec,
    evaluatedAt: row.evaluatedAt,
  };
}

function fromLegacy(row: LegacyRow): InterviewSignal {
  return {
    source: "LEGACY",
    status: row.status,
    overallScore: row.overallScore,
    communicationScore: row.commScore,
    technicalDepthScore: row.techScore,
    problemSolvingScore: row.problemScore,
    conceptualScore: null,
    practicalScore: null,
    summary: row.summary,
    durationSec: row.durationSec,
    evaluatedAt: row.evaluatedAt,
  };
}

/** Applies the resolution order to one member's rows. */
function resolve(
  general: GeneralRow[],
  legacy: LegacyRow | undefined,
): InterviewSignal | null {
  const day31 = general.find(
    (r) => r.blueprint === "DAY_31" && r.status === "COMPLETED",
  );
  if (day31) return fromGeneral(day31);

  const day15 = general.find(
    (r) => r.blueprint === "DAY_15" && r.status === "COMPLETED",
  );
  if (day15) return fromGeneral(day15);

  if (legacy && legacy.status === "COMPLETED") return fromLegacy(legacy);
  return null;
}

/** Single member — admin/recruiter detail views. */
export async function getInterviewSignal(
  memberId: string,
): Promise<InterviewSignal | null> {
  const [general, legacy] = await Promise.all([
    prisma.generalInterview.findMany({
      where: { memberId, status: "COMPLETED" },
      select: GENERAL_SELECT,
    }),
    prisma.programInterview.findUnique({
      where: { memberId },
      select: LEGACY_SELECT,
    }),
  ]);

  return resolve(general, legacy ?? undefined);
}

/**
 * Batched — list views over a whole cohort. Two queries total regardless of
 * member count; calling `getInterviewSignal` per row would be an N+1.
 */
export async function getInterviewSignals(
  memberIds: string[],
): Promise<Map<string, InterviewSignal>> {
  const out = new Map<string, InterviewSignal>();
  if (memberIds.length === 0) return out;

  const [general, legacy] = await Promise.all([
    prisma.generalInterview.findMany({
      where: { memberId: { in: memberIds }, status: "COMPLETED" },
      select: GENERAL_SELECT,
    }),
    prisma.programInterview.findMany({
      where: { memberId: { in: memberIds } },
      select: LEGACY_SELECT,
    }),
  ]);

  const generalByMember = new Map<string, GeneralRow[]>();
  for (const row of general) {
    const list = generalByMember.get(row.memberId) ?? [];
    list.push(row);
    generalByMember.set(row.memberId, list);
  }

  const legacyByMember = new Map<string, LegacyRow>();
  for (const row of legacy) legacyByMember.set(row.memberId, row);

  for (const memberId of memberIds) {
    const signal = resolve(
      generalByMember.get(memberId) ?? [],
      legacyByMember.get(memberId),
    );
    if (signal) out.set(memberId, signal);
  }

  return out;
}
