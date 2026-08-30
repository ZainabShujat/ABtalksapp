import type { RecommendationLevel } from "@prisma/client";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { RecruiterProfileView } from "@/features/recruiter/get-recruiter-profile";
import { FONT_BODY, FONT_HEADING } from "@/features/recruiter/pdf-fonts";

// Plan-015 navy + gold palette (react-pdf StyleSheet — not Tailwind)
const NAVY = "#1e3a5f";
const NAVY_DARK = "#16293f";
const GOLD = "#d99c2c";
const GOLD_DARK = "#b9831f";
const SIDEBAR_BG = "#f3f4f6";
const SIDEBAR_BORDER = "#e5e7eb";
const SYNERGY_BG = "#fbf6e9";
const MUTED = "#6b7280";
const SCORE_COMM = "#2f6fb0";
const SCORE_PROG = "#e05226";
const SCORE_BEHAV = "#1a9e8f";
const PASSED_TEXT = "#8a6310";

const CAP_SUMMARY = 600;
const CAP_FEEDBACK = 480;
const CAP_BULLET = 160;

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT_BODY,
    fontSize: 9,
    color: "#111827",
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 28,
    flexDirection: "column",
  },
  brandBar: {
    backgroundColor: NAVY_DARK,
    paddingVertical: 6,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  brandGold: {
    fontFamily: FONT_HEADING,
    color: GOLD,
    fontSize: 8,
  },
  brandMuted: {
    color: "#ffffff",
    opacity: 0.7,
    fontSize: 8,
  },
  hero: {
    backgroundColor: NAVY,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  heroName: {
    fontFamily: FONT_HEADING,
    fontSize: 20,
    color: "#ffffff",
  },
  heroRole: {
    fontFamily: FONT_HEADING,
    fontSize: 11,
    color: GOLD,
    marginTop: 3,
  },
  heroContact: {
    fontSize: 7.5,
    color: "#ffffff",
    opacity: 0.85,
    marginTop: 5,
    lineHeight: 1.35,
  },
  resumeRow: {
    flexDirection: "row",
    flexGrow: 1,
  },
  sidebar: {
    width: "32%",
    backgroundColor: SIDEBAR_BG,
    borderRightWidth: 1,
    borderRightColor: SIDEBAR_BORDER,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  mainCol: {
    width: "68%",
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 4,
    marginBottom: 8,
  },
  photoFallback: {
    width: 72,
    height: 72,
    borderRadius: 4,
    backgroundColor: "#e8edf3",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  photoInitials: {
    fontFamily: FONT_HEADING,
    fontSize: 18,
    color: NAVY,
  },
  sidebarHeading: {
    fontFamily: FONT_HEADING,
    fontSize: 7.5,
    color: GOLD_DARK,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    borderBottomWidth: 1,
    borderBottomColor: "#d99c2c66",
    paddingBottom: 2,
    marginBottom: 4,
    marginTop: 6,
  },
  sidebarCategory: {
    fontFamily: FONT_HEADING,
    fontSize: 8,
    color: NAVY,
    marginTop: 3,
  },
  sidebarMuted: {
    fontSize: 7.5,
    color: MUTED,
    lineHeight: 1.3,
  },
  sectionHeading: {
    fontFamily: FONT_HEADING,
    fontSize: 9,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottomWidth: 1,
    borderBottomColor: "#1e3a5f26",
    paddingBottom: 2,
    marginBottom: 4,
    marginTop: 4,
  },
  bodyText: {
    fontSize: 9,
    lineHeight: 1.35,
  },
  expTitle: {
    fontFamily: FONT_HEADING,
    fontSize: 9,
    color: NAVY,
  },
  expGold: {
    fontSize: 8,
    color: GOLD_DARK,
  },
  bullet: {
    fontSize: 8.5,
    lineHeight: 1.3,
    marginLeft: 8,
    marginTop: 1,
  },
  projectTech: {
    fontSize: 7.5,
    color: GOLD_DARK,
    marginTop: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: SIDEBAR_BORDER,
    paddingTop: 6,
    marginTop: "auto",
  },
  footerText: {
    fontSize: 7,
    color: MUTED,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  assessBand: {
    backgroundColor: NAVY,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginHorizontal: -28,
    marginTop: -24,
  },
  assessLabel: {
    fontSize: 7.5,
    fontFamily: FONT_HEADING,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  assessName: {
    fontFamily: FONT_HEADING,
    fontSize: 16,
    color: "#ffffff",
    marginTop: 4,
  },
  assessMeta: {
    fontSize: 7.5,
    color: "#ffffff",
    opacity: 0.75,
    marginTop: 4,
  },
  synergyBox: {
    backgroundColor: SYNERGY_BG,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  scoreRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    marginBottom: 6,
  },
  scoreCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: SIDEBAR_BORDER,
    borderRadius: 4,
    padding: 6,
    backgroundColor: "#ffffff",
  },
  scoreLabel: {
    fontSize: 7,
    fontFamily: FONT_HEADING,
    color: MUTED,
    textTransform: "uppercase",
  },
  scoreNumber: {
    fontFamily: FONT_HEADING,
    fontSize: 16,
    marginTop: 2,
  },
  scoreBarTrack: {
    height: 4,
    backgroundColor: "#e5e7eb",
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: 4,
    borderRadius: 2,
  },
  scoreCaption: {
    fontSize: 7,
    color: MUTED,
    fontStyle: "italic",
    marginTop: 3,
  },
  assessGrid: {
    flexDirection: "row",
    flexGrow: 1,
    gap: 10,
    marginTop: 4,
  },
  assessLeft: {
    flex: 1,
    minWidth: 0,
  },
  assessRight: {
    width: "34%",
    minWidth: 0,
  },
  feedbackHeading: {
    fontFamily: FONT_HEADING,
    fontSize: 8.5,
    marginTop: 4,
  },
  feedbackBody: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.3,
    marginTop: 2,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  tableHeaderCell: {
    fontFamily: FONT_HEADING,
    fontSize: 7.5,
    color: "#ffffff",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: SIDEBAR_BORDER,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  tableCell: {
    fontSize: 8,
  },
  passedBadge: {
    fontSize: 7,
    color: PASSED_TEXT,
    backgroundColor: SYNERGY_BG,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "#d99c2c80",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb66",
    paddingBottom: 3,
    marginBottom: 3,
    gap: 4,
  },
  metaLabel: {
    fontSize: 8,
    color: MUTED,
    flexShrink: 0,
  },
  metaValue: {
    fontSize: 8,
    fontFamily: FONT_HEADING,
    textAlign: "right",
    flex: 1,
  },
  recBox: {
    backgroundColor: NAVY,
    borderRadius: 4,
    padding: 8,
    marginTop: 6,
  },
  recLabel: {
    fontSize: 7,
    fontFamily: FONT_HEADING,
    color: GOLD,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  recValue: {
    fontFamily: FONT_HEADING,
    fontSize: 12,
    color: "#ffffff",
    marginTop: 3,
  },
  listItem: {
    fontSize: 8,
    lineHeight: 1.3,
    marginLeft: 8,
    marginTop: 1,
  },
});

function truncate(text: string | null | undefined, max: number): string {
  if (!text?.trim()) return "";
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function recommendationLabel(level: RecommendationLevel): string {
  switch (level) {
    case "STRONGLY_RECOMMEND":
      return "Strongly Recommend";
    case "RECOMMEND":
      return "Recommend";
    case "NEUTRAL":
      return "Neutral";
    case "DO_NOT_RECOMMEND":
      return "Do Not Recommend";
  }
}

function toRows(
  pairs: readonly (readonly [string, string])[],
): { label: string; value: string }[] {
  return pairs
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => ({ label, value }));
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        ABTalks Coding Challenge · AI Conversations That Matter · CONFIDENTIAL —
        For Hiring Organizations Only
      </Text>
    </View>
  );
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <View style={styles.scoreBarTrack}>
      <View style={[styles.scoreBarFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function MetaList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View>
      {rows.map((row) => (
        <View key={row.label} style={styles.metaRow}>
          <Text style={styles.metaLabel}>{row.label}</Text>
          <Text style={styles.metaValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function ResumePage({ profile }: { profile: RecruiterProfileView }) {
  const contactParts = [
    profile.email,
    profile.phone,
    profile.linkedinUrl
      ? profile.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")
      : null,
    profile.githubUsername ? `github.com/${profile.githubUsername}` : null,
    profile.logistics.currentLocation || null,
  ].filter((part): part is string => !!part && part.trim().length > 0);

  const hasResumeContent =
    profile.skillGroups.length > 0 ||
    profile.education.length > 0 ||
    profile.certifications.length > 0 ||
    profile.languagesSpoken.length > 0 ||
    profile.achievements.length > 0 ||
    !!profile.summary?.trim() ||
    profile.experience.length > 0 ||
    profile.projects.length > 0;

  const eduMeta = (year: string, score: string) =>
    [year, score].filter((s) => s.trim().length > 0).join(" · ");

  return (
    <Page size="A4" style={styles.page} wrap={false}>
      <View style={styles.brandBar}>
        <Text>
          <Text style={styles.brandGold}>AB TALKS</Text>
          <Text style={styles.brandMuted}> | AI Conversations That Matter</Text>
        </Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroName}>{profile.fullName}</Text>
        {profile.targetRole ? (
          <Text style={styles.heroRole}>{profile.targetRole}</Text>
        ) : null}
        {contactParts.length > 0 ? (
          <Text style={styles.heroContact}>{contactParts.join("  |  ")}</Text>
        ) : null}
      </View>

      <View style={styles.resumeRow}>
        <View style={styles.sidebar}>
          {profile.image ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
            <Image src={profile.image} style={styles.photo} />
          ) : (
            <View style={styles.photoFallback}>
              <Text style={styles.photoInitials}>{initials(profile.fullName)}</Text>
            </View>
          )}

          {profile.skillGroups.length > 0 ? (
            <View>
              <Text style={styles.sidebarHeading}>Technical Skills</Text>
              {profile.skillGroups.map((group) => (
                <View key={group.category}>
                  <Text style={styles.sidebarCategory}>{group.category}</Text>
                  {group.skills.length > 0 ? (
                    <Text style={styles.sidebarMuted}>
                      {group.skills.join(", ")}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {profile.education.length > 0 ? (
            <View>
              <Text style={styles.sidebarHeading}>Education</Text>
              {profile.education.map((row) => (
                <View key={`${row.degree}-${row.institution}`}>
                  <Text style={styles.sidebarCategory}>{row.degree}</Text>
                  <Text style={styles.sidebarMuted}>{row.institution}</Text>
                  {eduMeta(row.year, row.score) ? (
                    <Text style={styles.sidebarMuted}>
                      {eduMeta(row.year, row.score)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {profile.certifications.length > 0 ? (
            <View>
              <Text style={styles.sidebarHeading}>Certifications</Text>
              {profile.certifications.map((cert) => (
                <View key={`${cert.name}-${cert.issuer}`}>
                  <Text style={styles.sidebarCategory}>{cert.name}</Text>
                  {[cert.issuer, cert.year].filter(Boolean).length > 0 ? (
                    <Text style={styles.sidebarMuted}>
                      {[cert.issuer, cert.year].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {profile.languagesSpoken.length > 0 ? (
            <View>
              <Text style={styles.sidebarHeading}>Languages Spoken</Text>
              {profile.languagesSpoken.map((lang) => (
                <Text key={lang} style={styles.sidebarMuted}>
                  {lang}
                </Text>
              ))}
            </View>
          ) : null}

          {profile.achievements.length > 0 ? (
            <View>
              <Text style={styles.sidebarHeading}>Achievements</Text>
              {profile.achievements.map((item) => (
                <Text key={item} style={styles.listItem}>
                  • {truncate(item, 160)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.mainCol}>
          {!hasResumeContent ? (
            <Text style={styles.bodyText}>Profile coming soon</Text>
          ) : null}

          {profile.summary ? (
            <View>
              <Text style={styles.sectionHeading}>Professional Summary</Text>
              <Text style={styles.bodyText}>
                {truncate(profile.summary, CAP_SUMMARY)}
              </Text>
            </View>
          ) : null}

          {profile.experience.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Professional Experience</Text>
              {profile.experience.map((exp) => (
                <View key={`${exp.title}-${exp.company}-${exp.period}`}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <Text style={styles.expTitle}>{exp.title}</Text>
                    {exp.period ? (
                      <Text style={styles.expGold}>{exp.period}</Text>
                    ) : null}
                  </View>
                  {(exp.company || exp.location) && (
                    <Text style={styles.expGold}>
                      {[exp.company, exp.location].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                  {exp.bullets.map((bullet, bi) => (
                    <Text
                      key={`${exp.title}-${exp.company}-${exp.period}-b-${bi}`}
                      style={styles.bullet}
                    >
                      • {truncate(bullet, CAP_BULLET)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {profile.projects.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Key Projects</Text>
              {profile.projects.map((project) => (
                <View key={project.title}>
                  <Text style={styles.expTitle}>{project.title}</Text>
                  {project.tech ? (
                    <Text style={styles.projectTech}>{project.tech}</Text>
                  ) : null}
                  {project.description ? (
                    <Text style={[styles.sidebarMuted, { marginTop: 2 }]}>
                      {truncate(project.description, CAP_BULLET)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <Footer />
    </Page>
  );
}

function AssessmentPage({ profile }: { profile: RecruiterProfileView }) {
  const hasFullScores =
    profile.communicationScore != null &&
    profile.programmingScore != null &&
    profile.behaviorScore != null;

  const logisticsRows = toRows([
    ["Open to Relocation", profile.logistics.openToRelocation],
    ["Preferred Locations", profile.logistics.preferredLocations],
    ["Current Location", profile.logistics.currentLocation],
    ["Available From", profile.logistics.availableFrom],
    ["Notice Period", profile.logistics.noticePeriod],
    ["Work Authorization", profile.logistics.workAuthorization],
    ["Preferred Work Mode", profile.logistics.preferredWorkMode],
  ]);

  const compensationRows = toRows([
    ["Current CTC", profile.compensation.currentCtc],
    ["Expected CTC", profile.compensation.expectedCtc],
    ["Negotiated Offer", profile.compensation.negotiatedOffer],
    ["Equity / ESOPs", profile.compensation.equity],
    ["Benefits Required", profile.compensation.benefitsRequired],
    ["Currency Preference", profile.compensation.currencyPreference],
  ]);

  const assessmentMeta = [
    profile.assessmentDate ? `Assessment Date: ${profile.assessmentDate}` : null,
    profile.interviewerName ? `Interviewer: ${profile.interviewerName}` : null,
    profile.challengeRound ? `Challenge Round: ${profile.challengeRound}` : null,
    `ABTalks ID: ${profile.abtalksId}`,
  ].filter((part): part is string => !!part);

  const scoreCards = hasFullScores
    ? [
        {
          label: "Communication",
          score: profile.communicationScore!,
          caption: "Verbal clarity & articulation",
          color: SCORE_COMM,
        },
        {
          label: "Programming",
          score: profile.programmingScore!,
          caption: "Algorithms & code quality",
          color: SCORE_PROG,
        },
        {
          label: "Behavior",
          score: profile.behaviorScore!,
          caption: "Culture fit & collaboration",
          color: SCORE_BEHAV,
        },
      ]
    : [];

  const rec = profile.recommendation
    ? recommendationLabel(profile.recommendation)
    : null;

  return (
    <Page size="A4" style={styles.page} wrap={false}>
      <View style={styles.assessBand}>
        <Text style={styles.assessLabel}>
          <Text style={{ color: GOLD }}>AB TALKS </Text>
          <Text style={{ color: "#ffffff" }}>CANDIDATE ASSESSMENT REPORT</Text>
        </Text>
        <Text style={styles.assessName}>{profile.fullName}</Text>
        {assessmentMeta.length > 0 ? (
          <Text style={styles.assessMeta}>{assessmentMeta.join(" · ")}</Text>
        ) : null}
      </View>

      {hasFullScores && profile.assessmentComposite != null ? (
        <View style={styles.synergyBox}>
          <Text style={{ fontSize: 8.5 }}>
            <Text style={{ fontFamily: FONT_HEADING, color: NAVY }}>
              ABTalks Synergy Score:{" "}
            </Text>
            <Text style={{ fontFamily: FONT_HEADING, color: GOLD_DARK }}>
              {profile.assessmentComposite}
            </Text>
            <Text style={{ fontFamily: FONT_HEADING, color: NAVY }}>
              {" "}
              / {profile.assessmentMax} Points
            </Text>
          </Text>
          <Text style={[styles.sidebarMuted, { marginTop: 2 }]}>
            Composite across Communication, Programming, and Behavior. A score
            above 240 indicates strong readiness.
          </Text>
        </View>
      ) : null}

      {scoreCards.length > 0 ? (
        <View style={styles.scoreRow}>
          {scoreCards.map((card) => (
            <View key={card.label} style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>{card.label}</Text>
              <Text style={styles.scoreNumber}>
                <Text style={{ color: card.color }}>{card.score}</Text>
                <Text style={{ fontSize: 9, color: MUTED }}>/100</Text>
              </Text>
              <ScoreBar score={card.score} color={card.color} />
              <Text style={styles.scoreCaption}>{card.caption}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.assessGrid}>
        <View style={styles.assessLeft}>
          {(profile.communicationFeedback ||
            profile.programmingFeedback ||
            profile.behaviorFeedback) && (
            <View>
              <Text style={styles.sectionHeading}>
                Detailed Assessment Feedback
              </Text>
              {profile.communicationFeedback ? (
                <View>
                  <Text style={[styles.feedbackHeading, { color: SCORE_COMM }]}>
                    Communication
                  </Text>
                  <Text style={styles.feedbackBody}>
                    {truncate(profile.communicationFeedback, CAP_FEEDBACK)}
                  </Text>
                </View>
              ) : null}
              {profile.programmingFeedback ? (
                <View>
                  <Text style={[styles.feedbackHeading, { color: SCORE_PROG }]}>
                    Programming & Technical Skills
                  </Text>
                  <Text style={styles.feedbackBody}>
                    {truncate(profile.programmingFeedback, CAP_FEEDBACK)}
                  </Text>
                </View>
              ) : null}
              {profile.behaviorFeedback ? (
                <View>
                  <Text style={[styles.feedbackHeading, { color: SCORE_BEHAV }]}>
                    Behavior & Culture Fit
                  </Text>
                  <Text style={styles.feedbackBody}>
                    {truncate(profile.behaviorFeedback, CAP_FEEDBACK)}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {profile.codingChallenges.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Coding Challenge Results</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { width: "45%" }]}>
                  Challenge
                </Text>
                <Text style={[styles.tableHeaderCell, { width: "30%" }]}>
                  Status
                </Text>
                <Text style={[styles.tableHeaderCell, { width: "25%" }]}>
                  Score
                </Text>
              </View>
              {profile.codingChallenges.map((row) => (
                <View key={row.name} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { width: "45%" }]}>
                    {row.name}
                  </Text>
                  <View style={{ width: "30%" }}>
                    {row.status ? (
                      row.status.toLowerCase().includes("passed") ? (
                        <Text style={styles.passedBadge}>{row.status}</Text>
                      ) : (
                        <Text style={styles.tableCell}>{row.status}</Text>
                      )
                    ) : (
                      <Text style={styles.tableCell}>—</Text>
                    )}
                  </View>
                  <Text style={[styles.tableCell, { width: "25%" }]}>
                    {row.score || "—"}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {profile.strengths.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Key Strengths</Text>
              {profile.strengths.map((item) => (
                <Text key={item} style={styles.listItem}>
                  • {truncate(item, CAP_BULLET)}
                </Text>
              ))}
            </View>
          ) : null}

          {profile.areasForGrowth.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Areas for Growth</Text>
              {profile.areasForGrowth.map((item) => (
                <Text key={item} style={styles.listItem}>
                  • {truncate(item, CAP_BULLET)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.assessRight}>
          {logisticsRows.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Candidate Logistics</Text>
              <MetaList rows={logisticsRows} />
            </View>
          ) : null}

          {compensationRows.length > 0 ? (
            <View>
              <Text style={styles.sectionHeading}>Compensation Details</Text>
              <MetaList rows={compensationRows} />
            </View>
          ) : null}

          {rec ? (
            <View style={styles.recBox}>
              <Text style={styles.recLabel}>ABTalks Recommendation</Text>
              <Text style={styles.recValue}>{rec}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Footer />
    </Page>
  );
}

export function RecruiterPdf({ profile }: { profile: RecruiterProfileView }) {
  return (
    <Document title={`${profile.fullName} | ABTalks`}>
      <ResumePage profile={profile} />
      <AssessmentPage profile={profile} />
    </Document>
  );
}
