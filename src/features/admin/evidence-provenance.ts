import type { WorkshopEvent } from "@/components/workshop/events-data";
import {
  CERTIFICATE_TYPES,
  HACKATHON_VARIANT_LABELS,
  certificateTypeFromCredentialTitle,
  parseHackathonVariant,
} from "@/features/certificate/constants";

/**
 * T-266 — where every evidence badge on the admin candidate page came from.
 *
 * Pure: the rows `get-evidence-provenance.ts` loads go in, one traced-or-not
 * item per badge comes out. No Prisma, no `server-only`, so the test drives
 * this directly.
 *
 * Every pointer the badge tables carry is followed into its own table:
 *
 *   SkillEvidence.sourceId        ASSESSMENT_SCORE      → AssessmentScore → AssessmentReport
 *                                 ACTIVITY_EVALUATION   → ActivityEvaluation → ActivityAttempt → Activity / ProgramEnrollment
 *                                 CREDENTIAL            → Credential
 *                                 HACKATHON             → HackathonParticipant, else HackathonTeam
 *   Credential.sourceKey          PROGRAM_ENROLLMENT    → ProgramEnrollment
 *                                 HACKATHON_TEAM        → W3 "{event}:{teamId}:{userId}:…"
 *                                                         or historical "{teamId}:{certId}"
 *                                                         → HackathonTeam
 *                                 COHORT / WORKSHOP     → historical Certificate.id (frozen)
 *                                 ASSESSMENT_REPORT     → AssessmentReport
 *   CandidateAchievement.sourceId PROGRAM_ENROLLMENT    → ProgramEnrollment
 *                                 HACKATHON_TEAM        → HackathonParticipant
 *                                 WORKSHOP_REGISTRATION → WorkshopRegistration
 *                                 ASSESSMENT_REPORT     → AssessmentReport
 *                                 CREDENTIAL            → Credential
 *
 * (Mappings from the writers: `prisma/scripts/migrate-2i-achievements.ts` and
 * `mapCertificateToCredential` in `repositories/dual-write.ts`.)
 *
 * A badge is TRACED only when the row it points at was read back from its own
 * table, belongs to this candidate, still meets the bar its writer required,
 * and carries a date of its own. The stored label (`SkillEvidence.sourceLabel`,
 * `Credential.title`, `CandidateAchievement.title`) is a snapshot written by
 * whatever issued the badge; it is shown for comparison and never used as the
 * source's name. Anything else comes back untraced with the reason — nothing on
 * this surface is filled in to look complete.
 */

export type SourceKind =
  | "ASSESSMENT"
  | "COHORT_ACTIVITY"
  | "CHALLENGE_DAY"
  | "COHORT"
  | "CHALLENGE"
  | "HACKATHON"
  | "WORKSHOP";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  ASSESSMENT: "Assessment",
  COHORT_ACTIVITY: "Cohort activity",
  CHALLENGE_DAY: "Challenge day",
  COHORT: "Cohort",
  CHALLENGE: "Challenge",
  HACKATHON: "Hackathon",
  WORKSHOP: "Workshop",
};

export type TracedSource = {
  kind: SourceKind;
  /** Read from the source row — never the stored snapshot label. */
  name: string;
  /** Outcome on that source, e.g. "Score 8/10", "2nd place". */
  detail: string | null;
  /** The source's own date for the thing that earned the badge. */
  earnedAt: Date;
  /** What `earnedAt` is, in words: "Completed", "Submitted", "Registered"… */
  dateBasis: string;
  /** Table and primary key, so an admin can find the row. */
  record: string;
};

export type ProvenanceItem =
  | { traced: true; key: string; storedLabel: string; source: TracedSource }
  | {
      traced: false;
      key: string;
      storedLabel: string;
      /** Why this could not be tied to a real, dated activity. */
      reason: string;
      /** Where the pointer points, even though nothing usable is there. */
      record: string;
    };

export type SkillProvenance = { skillId: string; name: string; items: ProvenanceItem[] };

export type CredentialProvenance = {
  credentialId: string;
  typeLabel: string;
  item: ProvenanceItem;
};

export type EvidenceProvenance = {
  /** `SkillEvidence`-backed skills. */
  skills: SkillProvenance[];
  /** Skills verified by finishing a challenge or cohort. */
  programmeSkills: SkillProvenance[];
  credentials: CredentialProvenance[];
  achievements: ProvenanceItem[];
};

export const CREDENTIAL_TYPE_LABEL: Record<string, string> = {
  COMPLETION: "Completion",
  DISTINCTION: "Distinction",
  PARTICIPATION: "Participation",
  PLACEMENT: "Placement",
  ASSESSMENT: "Assessment",
};

/** A skill badge may read "Evidence-backed" only with at least one traced source. */
export function tracedCount(items: ProvenanceItem[]): number {
  return items.filter((i) => i.traced).length;
}

export function allItems(p: EvidenceProvenance): ProvenanceItem[] {
  return [
    ...p.skills.flatMap((s) => s.items),
    ...p.programmeSkills.flatMap((s) => s.items),
    ...p.credentials.map((c) => c.item),
    ...p.achievements,
  ];
}

/* ── loader contract ─────────────────────────────────────────────────────── */

type Json = unknown;
type Submission = { createdAt: Date; problem: { title: string } | null } | null;

export type EvidenceSourceRows = {
  evidence: {
    id: string;
    sourceType: string;
    sourceId: string;
    sourceLabel: string;
    skillId: string;
    skillName: string;
  }[];
  credentials: {
    id: string;
    credentialId: string;
    type: string;
    sourceType: string;
    sourceKey: string;
    title: string;
    metadata: Json;
    issuedAt: Date;
  }[];
  achievements: {
    id: string;
    sourceType: string;
    sourceId: string;
    title: string;
    outcomeLabel: string | null;
  }[];
  programmeSkills: {
    skillId: string;
    name: string;
    origins: {
      kind: "CHALLENGE" | "COHORT";
      programTitle: string;
      enrollmentId: string;
      earnedAt: Date | null;
    }[];
  }[];
  scores: {
    id: string;
    dimension: string;
    score: number;
    maxScore: number;
    createdAt: Date;
    report: { title: string; candidateUserId: string; assessedAt: Date | null };
  }[];
  evaluations: {
    id: string;
    passed: boolean;
    isAuthoritative: boolean;
    score: number | null;
    maxScore: number | null;
    createdAt: Date;
    attempt: {
      submittedAt: Date | null;
      enrollment: { userId: string; cohort: { slug: string; name: string } };
      activity: { title: string; dayNumber: number | null; programTitle: string };
    };
  }[];
  /** Credentials referenced by evidence/achievements, any status, any owner. */
  linkedCredentials: { id: string; credentialId: string; userId: string; status: string }[];
  enrollments: {
    id: string;
    userId: string;
    status: string;
    completedAt: Date | null;
    cohort: { slug: string; name: string; programTitle: string };
  }[];
  participants: {
    id: string;
    userId: string;
    createdAt: Date;
    team: { eventId: string; teamName: string | null; submission: Submission };
  }[];
  /** `candidateJoinedAt` is null when this candidate is not on the team. */
  teams: {
    id: string;
    eventId: string;
    teamName: string | null;
    candidateJoinedAt: Date | null;
    submission: Submission;
  }[];
  workshops: { id: string; userId: string; eventId: string; createdAt: Date }[];
  /**
   * The workshop catalogue, for turning a registration's `eventId` into a
   * title. Optional: absent, a row falls back to `Workshop <eventId>`, which
   * is what this builder already did for an unknown id. Plan 163 moved the
   * schedule into the database, so it can no longer be read from a module
   * constant here.
   */
  workshopEvents?: readonly WorkshopEvent[];
  certificates: {
    id: string;
    userId: string;
    type: string;
    status: string;
    issuedAt: Date;
    metadata: Json;
  }[];
  reports: {
    id: string;
    candidateUserId: string;
    title: string;
    recommendation: string | null;
    assessedAt: Date | null;
    createdAt: Date;
  }[];
};

/** Which ids to load, per table, for a set of badge rows. */
export function collectSourceIds(rows: Pick<EvidenceSourceRows, "evidence" | "credentials" | "achievements">) {
  const ids = {
    score: new Set<string>(),
    evaluation: new Set<string>(),
    credential: new Set<string>(),
    enrollment: new Set<string>(),
    participant: new Set<string>(),
    team: new Set<string>(),
    workshop: new Set<string>(),
    certificate: new Set<string>(),
    report: new Set<string>(),
  };
  for (const e of rows.evidence) {
    if (e.sourceType === "ASSESSMENT_SCORE") ids.score.add(e.sourceId);
    else if (e.sourceType === "ACTIVITY_EVALUATION") ids.evaluation.add(e.sourceId);
    else if (e.sourceType === "CREDENTIAL") ids.credential.add(e.sourceId);
    else if (e.sourceType === "HACKATHON") {
      ids.participant.add(e.sourceId);
      ids.team.add(e.sourceId);
    }
  }
  for (const c of rows.credentials) {
    if (c.sourceType === "PROGRAM_ENROLLMENT") ids.enrollment.add(c.sourceKey);
    else if (c.sourceType === "HACKATHON_TEAM") {
      const parsed = parseHackathonCredentialSourceKey(c.sourceKey);
      if (parsed.teamId) ids.team.add(parsed.teamId);
      if (parsed.historicalCertId) ids.certificate.add(parsed.historicalCertId);
    } else if (c.sourceType === "COHORT" || c.sourceType === "WORKSHOP_REGISTRATION") {
      ids.certificate.add(c.sourceKey);
    } else if (c.sourceType === "ASSESSMENT_REPORT") {
      ids.report.add(c.sourceKey);
    }
  }
  for (const a of rows.achievements) {
    if (a.sourceType === "PROGRAM_ENROLLMENT") ids.enrollment.add(a.sourceId);
    else if (a.sourceType === "HACKATHON_TEAM") ids.participant.add(a.sourceId);
    else if (a.sourceType === "WORKSHOP_REGISTRATION") ids.workshop.add(a.sourceId);
    else if (a.sourceType === "ASSESSMENT_REPORT") ids.report.add(a.sourceId);
    else if (a.sourceType === "CREDENTIAL") ids.credential.add(a.sourceId);
  }
  return ids;
}

/* ── builder ─────────────────────────────────────────────────────────────── */

type Resolved = TracedSource | { reason: string };

const W3_HACKATHON_TAIL = /^(participation|winner|second|third|top5)$/;

/**
 * W3 stable key: `{event}:{teamId}:{userId}:participation|variant`
 * Phase 2g: `{teamId}:{certificateId}` or a bare Certificate.id.
 */
export function parseHackathonCredentialSourceKey(key: string): {
  teamId: string | null;
  historicalCertId: string | null;
} {
  const parts = key.split(":");
  if (parts.length === 4 && W3_HACKATHON_TAIL.test(parts[3] ?? "")) {
    return { teamId: parts[1] ?? null, historicalCertId: null };
  }
  if (parts.length === 1) {
    return { teamId: null, historicalCertId: key };
  }
  return {
    teamId: parts[0] ?? null,
    historicalCertId: parts.slice(1).join(":") || null,
  };
}

function meta(value: Json): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scoreText(score: number | null, maxScore: number | null): string | null {
  if (score == null) return null;
  return maxScore != null ? `Score ${score}/${maxScore}` : `Score ${score}`;
}

/** `legacy-se` etc. are the 60-day challenge mirrored into cohorts; `legacy-program-*` is a real cohort. */
function isChallengeMirror(slug: string): boolean {
  return /^legacy-(se|ds|ai|claude)$/.test(slug);
}

function hackathonEventName(eventId: string): string {
  return eventId === "legacy"
    ? CERTIFICATE_TYPES.HACKATHON.title
    : `Hackathon event ${eventId}`;
}

function missing(table: string): Resolved {
  return { reason: `No ${table} row with this id exists any more.` };
}

function foreign(table: string): Resolved {
  return { reason: `The ${table} row belongs to a different account.` };
}

function settle(key: string, storedLabel: string, record: string, r: Resolved): ProvenanceItem {
  return "reason" in r
    ? { traced: false, key, storedLabel, record, reason: r.reason }
    : { traced: true, key, storedLabel, source: r };
}

export function buildEvidenceProvenance(
  userId: string,
  rows: EvidenceSourceRows,
): EvidenceProvenance {
  const index = <T extends { id: string }>(list: T[]) => new Map(list.map((r) => [r.id, r]));
  const scoreById = index(rows.scores);
  const evaluationById = index(rows.evaluations);
  const linkedById = index(rows.linkedCredentials);
  const enrollmentById = index(rows.enrollments);
  const participantById = index(rows.participants);
  const teamById = index(rows.teams);
  const workshopById = index(rows.workshops);
  const certificateById = index(rows.certificates);
  const reportById = index(rows.reports);
  const ownCredentialById = index(rows.credentials);

  function fromScore(id: string): Resolved {
    const s = scoreById.get(id);
    if (!s) return missing("AssessmentScore");
    if (s.report.candidateUserId !== userId) return foreign("AssessmentReport");
    return {
      kind: "ASSESSMENT",
      name: `${s.report.title} · ${s.dimension}`,
      detail: scoreText(s.score, s.maxScore),
      earnedAt: s.report.assessedAt ?? s.createdAt,
      dateBasis: s.report.assessedAt ? "Assessed" : "Scored",
      record: `AssessmentScore · ${s.id}`,
    };
  }

  function fromEvaluation(id: string): Resolved {
    const ev = evaluationById.get(id);
    if (!ev) return missing("ActivityEvaluation");
    if (ev.attempt.enrollment.userId !== userId) return foreign("ProgramEnrollment");
    if (!ev.isAuthoritative) {
      return {
        reason:
          "This evaluation was superseded — it is no longer the authoritative result for the attempt.",
      };
    }
    if (!ev.passed) {
      return { reason: "The authoritative evaluation for this attempt is not a pass." };
    }
    const a = ev.attempt.activity;
    const challenge = isChallengeMirror(ev.attempt.enrollment.cohort.slug);
    return {
      kind: challenge ? "CHALLENGE_DAY" : "COHORT_ACTIVITY",
      name: `${a.programTitle} · ${a.dayNumber != null ? `Day ${a.dayNumber}: ` : ""}${a.title}`,
      detail: [
        challenge ? null : ev.attempt.enrollment.cohort.name,
        scoreText(ev.score, ev.maxScore),
        "Passed",
      ]
        .filter(Boolean)
        .join(" · "),
      earnedAt: ev.attempt.submittedAt ?? ev.createdAt,
      dateBasis: ev.attempt.submittedAt ? "Submitted" : "Evaluated",
      record: `ActivityEvaluation · ${ev.id}`,
    };
  }

  function fromEnrollment(id: string, issuedAt: Date | null): Resolved {
    const pe = enrollmentById.get(id);
    if (!pe) return missing("ProgramEnrollment");
    if (pe.userId !== userId) return foreign("ProgramEnrollment");
    const challenge = isChallengeMirror(pe.cohort.slug);
    const kind: SourceKind = challenge ? "CHALLENGE" : "COHORT";
    const name = challenge
      ? pe.cohort.programTitle
      : `${pe.cohort.programTitle} · ${pe.cohort.name}`;
    const record = `ProgramEnrollment · ${pe.id}`;
    const status = pe.status.toLowerCase();
    if (pe.completedAt) {
      return {
        kind,
        name,
        detail: `Enrolment ${status}`,
        earnedAt: pe.completedAt,
        dateBasis: "Completed",
        record,
      };
    }
    if (issuedAt) {
      return {
        kind,
        name,
        detail: `Enrolment ${status} · no completion date on the enrolment`,
        earnedAt: issuedAt,
        dateBasis: "Credential issued",
        record,
      };
    }
    return {
      reason: `The enrolment exists (${status}) but records no completion date, so there is no date this was earned.`,
    };
  }

  function hackathonSource(
    team: { eventId: string; teamName: string | null; submission: Submission },
    joinedAt: Date,
    record: string,
    outcome: string | null,
  ): TracedSource {
    const detail = [outcome, team.submission?.problem?.title ?? null].filter(Boolean).join(" · ");
    return {
      kind: "HACKATHON",
      name: `${hackathonEventName(team.eventId)} · ${team.teamName ? `Team ${team.teamName}` : "Solo entry"}`,
      detail: detail || null,
      earnedAt: team.submission?.createdAt ?? joinedAt,
      dateBasis: team.submission ? "Submitted" : "Registered",
      record,
    };
  }

  function fromParticipant(id: string, outcome: string | null): Resolved {
    const p = participantById.get(id);
    if (!p) return missing("HackathonParticipant");
    if (p.userId !== userId) return foreign("HackathonParticipant");
    return hackathonSource(p.team, p.createdAt, `HackathonParticipant · ${p.id}`, outcome);
  }

  function fromTeam(id: string, outcome: string | null): Resolved {
    const t = teamById.get(id);
    if (!t) return missing("HackathonTeam");
    if (!t.candidateJoinedAt) {
      return { reason: "This candidate is not a participant on that hackathon team." };
    }
    return hackathonSource(t, t.candidateJoinedAt, `HackathonTeam · ${t.id}`, outcome);
  }

  function fromWorkshop(id: string): Resolved {
    const w = workshopById.get(id);
    if (!w) return missing("WorkshopRegistration");
    if (w.userId !== userId) return foreign("WorkshopRegistration");
    const event = (rows.workshopEvents ?? []).find((e) => e.id === w.eventId);
    return {
      kind: "WORKSHOP",
      name: event?.title ?? `Workshop ${w.eventId}`,
      detail: event ? `Held ${event.date}` : null,
      earnedAt: w.createdAt,
      dateBasis: "Registered",
      record: `WorkshopRegistration · ${w.id}`,
    };
  }

  function fromReport(id: string): Resolved {
    const r = reportById.get(id);
    if (!r) return missing("AssessmentReport");
    if (r.candidateUserId !== userId) return foreign("AssessmentReport");
    return {
      kind: "ASSESSMENT",
      name: r.title,
      detail: r.recommendation,
      earnedAt: r.assessedAt ?? r.createdAt,
      dateBasis: r.assessedAt ? "Assessed" : "Report created",
      record: `AssessmentReport · ${r.id}`,
    };
  }

  function fromCertificate(id: string): Resolved {
    const c = certificateById.get(id);
    if (!c) return missing("Certificate");
    if (c.userId !== userId) return foreign("Certificate");
    if (c.status !== "ISSUED") return { reason: "The underlying certificate was revoked." };
    const type = certificateTypeFromCredentialTitle(c.type);
    return {
      kind: c.type === "WORKSHOP" ? "WORKSHOP" : c.type === "HACKATHON" ? "HACKATHON" : "COHORT",
      name: type ? CERTIFICATE_TYPES[type].title : c.type,
      detail: null,
      earnedAt: c.issuedAt,
      dateBasis: "Certificate issued",
      record: `Certificate · ${c.id}`,
    };
  }

  function credentialOutcome(type: string, metadata: Json): string {
    const variant = parseHackathonVariant(meta(metadata).hackathonVariant);
    return variant ? HACKATHON_VARIANT_LABELS[variant] : (CREDENTIAL_TYPE_LABEL[type] ?? type);
  }

  function fromOwnCredential(c: EvidenceSourceRows["credentials"][number]): Resolved {
    const outcome = credentialOutcome(c.type, c.metadata);
    switch (c.sourceType) {
      case "PROGRAM_ENROLLMENT":
        return fromEnrollment(c.sourceKey, c.issuedAt);
      case "HACKATHON_TEAM": {
        const parsed = parseHackathonCredentialSourceKey(c.sourceKey);
        if (parsed.teamId) return fromTeam(parsed.teamId, outcome);
        const snapshotTeam = meta(
          certificateById.get(parsed.historicalCertId ?? "")?.metadata ?? null,
        ).teamId;
        return typeof snapshotTeam === "string"
          ? fromTeam(snapshotTeam, outcome)
          : { reason: "The credential does not record which hackathon team earned it." };
      }
      case "COHORT":
      case "WORKSHOP_REGISTRATION":
        return fromCertificate(c.sourceKey);
      case "ASSESSMENT_REPORT":
        return fromReport(c.sourceKey);
      default:
        return { reason: "Issued manually — no source activity is recorded for it." };
    }
  }

  function fromLinkedCredential(id: string): Resolved {
    const own = ownCredentialById.get(id);
    if (own) {
      const inner = fromOwnCredential(own);
      if ("reason" in inner) return { reason: `Credential ${own.credentialId}: ${inner.reason}` };
      return {
        ...inner,
        detail: [`Credential ${own.credentialId}`, inner.detail].filter(Boolean).join(" · "),
      };
    }
    const c = linkedById.get(id);
    if (!c) return missing("Credential");
    if (c.userId !== userId) return foreign("Credential");
    return {
      reason: `Credential ${c.credentialId} is ${c.status.toLowerCase()}, so it no longer counts.`,
    };
  }

  const skillsById = new Map<string, SkillProvenance>();
  for (const e of rows.evidence) {
    let skill = skillsById.get(e.skillId);
    if (!skill) {
      skill = { skillId: e.skillId, name: e.skillName, items: [] };
      skillsById.set(e.skillId, skill);
    }
    let r: Resolved;
    switch (e.sourceType) {
      case "ASSESSMENT_SCORE":
        r = fromScore(e.sourceId);
        break;
      case "ACTIVITY_EVALUATION":
        r = fromEvaluation(e.sourceId);
        break;
      case "CREDENTIAL":
        r = fromLinkedCredential(e.sourceId);
        break;
      case "HACKATHON":
        r = participantById.has(e.sourceId)
          ? fromParticipant(e.sourceId, null)
          : teamById.has(e.sourceId)
            ? fromTeam(e.sourceId, null)
            : { reason: "No hackathon participant or team row with this id exists." };
        break;
      default:
        r = { reason: "External evidence — there is no platform record to trace it to." };
    }
    skill.items.push(
      settle(e.id, e.sourceLabel, `SkillEvidence ${e.sourceType} → ${e.sourceId}`, r),
    );
  }

  const programmeSkills: SkillProvenance[] = rows.programmeSkills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    items: s.origins.map((o) => {
      const record = `${o.kind === "CHALLENGE" ? "Enrollment" : "ProgramEnrollment"} · ${o.enrollmentId}`;
      const r: Resolved = o.earnedAt
        ? {
            kind: o.kind,
            name: o.programTitle,
            detail: o.kind === "CHALLENGE" ? "50+ days completed" : "Cohort completed",
            earnedAt: o.earnedAt,
            dateBasis: o.kind === "CHALLENGE" ? "50th day submitted" : "Completed",
            record,
          }
        : {
            reason:
              o.kind === "CHALLENGE"
                ? "The enrolment counts 50+ completed days, but no dated record of the 50th day was found."
                : "The cohort run is marked completed but records no completion date.",
          };
      return settle(`${o.kind}:${o.enrollmentId}:${s.skillId}`, o.programTitle, record, r);
    }),
  }));

  const credentials: CredentialProvenance[] = rows.credentials.map((c) => {
    const certType = certificateTypeFromCredentialTitle(c.title);
    return {
      credentialId: c.credentialId,
      typeLabel: credentialOutcome(c.type, c.metadata),
      item: settle(
        c.id,
        certType ? CERTIFICATE_TYPES[certType].title : c.title,
        `Credential ${c.sourceType} → ${c.sourceKey}`,
        fromOwnCredential(c),
      ),
    };
  });

  const achievements: ProvenanceItem[] = rows.achievements.map((a) => {
    let r: Resolved;
    switch (a.sourceType) {
      case "PROGRAM_ENROLLMENT":
        r = fromEnrollment(a.sourceId, null);
        break;
      case "HACKATHON_TEAM":
        r = fromParticipant(a.sourceId, null);
        break;
      case "WORKSHOP_REGISTRATION":
        r = fromWorkshop(a.sourceId);
        break;
      case "ASSESSMENT_REPORT":
        r = fromReport(a.sourceId);
        break;
      case "CREDENTIAL":
        r = fromLinkedCredential(a.sourceId);
        break;
      default:
        r = { reason: "External achievement — there is no platform record to trace it to." };
    }
    return settle(
      a.id,
      [a.title, a.outcomeLabel].filter(Boolean).join(" · "),
      `CandidateAchievement ${a.sourceType} → ${a.sourceId}`,
      r,
    );
  });

  return {
    skills: [...skillsById.values()],
    programmeSkills,
    credentials,
    achievements,
  };
}
