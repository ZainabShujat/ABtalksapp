import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  GENDER_LABELS,
  LINK_TYPE_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  PERSONA_LABELS,
  monthShort,
} from "@/lib/candidate-vocab";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import {
  APPLICATION_STATUS_LABEL,
  JOB_TYPE_LABEL,
  WORK_MODE_LABEL,
} from "@/components/jobs/job-ui";
import type { AdminCandidateDetail } from "@/features/admin/get-admin-candidate-detail";
import {
  SOURCE_KIND_LABEL,
  tracedCount,
  type ProvenanceItem,
} from "@/features/admin/evidence-provenance";
import type { DeliveryRow } from "@/features/notification/delivery-diagnosis";

/**
 * T-264 — read-only career record for Platform Admin.
 *
 * Server Component. No `"use client"`, no `@/app/actions/*`. The candidate's
 * own writers and the recruiter inspector stay off this surface.
 */

const ASSESSMENT_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Not started",
  STARTED: "In progress",
  SUBMITTED: "Submitted",
};

const MOCK_STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  ABANDONED: "Left early",
  INVALID: "Not scored",
};

const ACCOUNT_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  DISABLED: "Disabled",
  DELETED: "Deleted",
};

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  return s.length > 0 ? s : "—";
}

function monthYear(
  month: number | null | undefined,
  year: number | null | undefined,
): string {
  const m = monthShort(month ?? null);
  if (m && year) return `${m} ${year}`;
  if (year) return String(year);
  return "—";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#E9E9E9] bg-white p-5">
      <h2 className="font-display text-base font-semibold text-[#353535]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#787878]">{children}</p>;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="text-sm text-[#353535]">
      <span className="text-[#787878]">{label}:</span> {children}
    </p>
  );
}

/**
 * One evidence badge and where it came from. A traced row names the real source
 * activity and its date; an untraced row says so and why, and never borrows the
 * badge's own label as if it were the source.
 */
function ProvenanceRow({
  item,
  prefix,
}: {
  item: ProvenanceItem;
  prefix?: string;
}) {
  if (!item.traced) {
    return (
      <li className="rounded-lg border border-[#FFE2B8] bg-[#FFF7EB] px-3 py-2 text-sm">
        <p className="flex flex-wrap items-center gap-2 text-[#353535]">
          <span className="rounded-full bg-[#B54708] px-1.5 py-0.5 text-xs font-medium text-white">
            Not traced
          </span>
          {prefix ? <span className="text-[#787878]">{prefix}</span> : null}
          <span>{item.storedLabel}</span>
        </p>
        <p className="mt-1 text-xs text-[#5C5C5C]">{item.reason}</p>
        <p className="mt-0.5 text-xs text-[#8F8F8F]">Points at: {item.record}</p>
      </li>
    );
  }
  const { source } = item;
  return (
    <li className="rounded-lg border border-[#E9E9E9] px-3 py-2 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-[#353535]">
        <span className="rounded-full bg-[#F6F6F6] px-1.5 py-0.5 text-xs text-[#5C5C5C]">
          {SOURCE_KIND_LABEL[source.kind]}
        </span>
        {prefix ? <span className="text-[#787878]">{prefix}</span> : null}
        <span className="font-medium">{source.name}</span>
      </p>
      <p className="mt-1 text-xs text-[#5C5C5C]">
        {source.dateBasis} {formatDateIST(source.earnedAt)}
        {source.detail ? ` · ${source.detail}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-[#8F8F8F]">
        Source record: {source.record}
        {item.storedLabel && item.storedLabel !== source.name
          ? ` · recorded on the badge as “${item.storedLabel}”`
          : ""}
      </p>
    </li>
  );
}

function TableWrap({
  columns,
  children,
  empty,
}: {
  columns: string[];
  children: ReactNode;
  empty: boolean;
}) {
  if (empty) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="border-b border-[#E9E9E9] text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 font-medium first:pl-0 last:pr-0">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function CandidateCareerSections({
  detail,
}: {
  detail: AdminCandidateDetail;
}) {
  const { account, profile } = detail;
  const provenance = detail.evidenceProvenance;
  const evidenceBySkill = new Map(
    provenance.skills.map((skill) => [skill.skillId, skill.items]),
  );
  const claimedSkills = (profile?.skills ?? []).filter((s) => s.claimedByCandidate);
  const deliveryHref = `/admin/deliveries?recipient=${encodeURIComponent(account.email)}`;

  return (
    <div className="space-y-4">
      <Section title="Account state">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              account.status === "ACTIVE"
                ? "rounded-full bg-[#D6F7EC] px-2 py-0.5 text-xs font-medium text-[#197E23]"
                : "rounded-full bg-[#FFF2F0] px-2 py-0.5 text-xs font-medium text-[#D92D20]"
            }
          >
            {ACCOUNT_LABEL[account.status]}
          </span>
          {account.anonymizedAt ? (
            <span className="rounded-full border border-[#E9E9E9] px-2 py-0.5 text-xs text-[#787878]">
              Anonymized
            </span>
          ) : null}
        </div>
        <div className="mt-3 space-y-1">
          <Fact label="Email">{account.email}</Fact>
          <Fact label="Joined">{formatDateIST(account.joinedAt)}</Fact>
          {account.disabledAt ? (
            <Fact label="Disabled">
              {formatDateTimeIST(account.disabledAt)}
              {account.disabledReason ? ` — ${account.disabledReason}` : ""}
            </Fact>
          ) : null}
          {account.deletedAt ? (
            <Fact label="Deleted">{formatDateTimeIST(account.deletedAt)}</Fact>
          ) : null}
          {account.sessionInvalidatedAt ? (
            <Fact label="Sessions invalidated">
              {formatDateTimeIST(account.sessionInvalidatedAt)}
            </Fact>
          ) : null}
        </div>
      </Section>

      <Section title="Profile">
        {profile ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Fact label="Name">{dash(profile.fullName)}</Fact>
              <Fact label="Persona">
                {PERSONA_LABELS[profile.primaryPersona] ?? profile.primaryPersona}
              </Fact>
              <Fact label="Headline">{dash(profile.headline)}</Fact>
              <Fact label="Gender">
                {profile.gender ? (GENDER_LABELS[profile.gender] ?? profile.gender) : "—"}
              </Fact>
              <Fact label="Location">
                {[profile.locationCity, profile.locationRegion, profile.countryCode]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </Fact>
              <Fact label="Phone">
                {profile.phone ? (
                  <>
                    <a
                      className="text-[#03535F] underline"
                      href={`tel:${encodeURIComponent(profile.phone)}`}
                    >
                      {profile.phone}
                    </a>
                    {profile.phoneVerified ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#D6F7EC] px-2 py-0.5 text-xs font-medium text-[#197E23]">
                        <CheckCircle2 className="size-3" aria-hidden />
                        Verified
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-[#787878]">Not verified</span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </Fact>
            </div>
            {profile.summary ? (
              <Fact label="Summary">{profile.summary}</Fact>
            ) : null}

            <h3 className="text-sm font-semibold text-[#353535]">Education</h3>
            {profile.education.length === 0 ? (
              <Empty>No education recorded.</Empty>
            ) : (
              <ul className="space-y-2 text-sm text-[#353535]">
                {profile.education.map((row) => (
                  <li key={row.id}>
                    <p className="font-medium">{row.institutionName}</p>
                    <p className="text-[#787878]">
                      {[row.degree, row.fieldOfStudy].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {row.isCurrent
                        ? `${monthYear(row.startMonth, row.startYear)} – Present`
                        : monthYear(row.endMonth, row.graduationYear)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Experience</h3>
            {profile.hasNoWorkExperience ? (
              <Empty>Candidate marked as having no work experience.</Empty>
            ) : profile.experience.length === 0 ? (
              <Empty>No experience recorded.</Empty>
            ) : (
              <ul className="space-y-2 text-sm text-[#353535]">
                {profile.experience.map((row) => (
                  <li key={row.id}>
                    <p className="font-medium">
                      {row.title} · {row.companyName}
                    </p>
                    <p className="text-[#787878]">
                      {monthYear(row.startMonth, row.startYear)} –{" "}
                      {row.isCurrent
                        ? "Present"
                        : monthYear(row.endMonth, row.endYear)}
                      {row.locationCity ? ` · ${row.locationCity}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Projects</h3>
            {profile.projects.length === 0 ? (
              <Empty>No projects recorded.</Empty>
            ) : (
              <ul className="space-y-2 text-sm text-[#353535]">
                {profile.projects.map((row) => (
                  <li key={row.id}>
                    <p className="font-medium">{row.title}</p>
                    {row.description ? (
                      <p className="text-[#787878]">{row.description}</p>
                    ) : null}
                    {row.techStack.length > 0 ? (
                      <p className="text-xs text-[#787878]">{row.techStack.join(", ")}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Links</h3>
            {profile.linkedinUrl ||
            profile.githubUsername ||
            profile.portfolioUrl ||
            profile.links.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {profile.linkedinUrl ? (
                  <li>
                    <a
                      className="inline-flex items-center gap-1 text-[#03535F] underline"
                      href={profile.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      LinkedIn <ExternalLink className="size-3" />
                    </a>
                  </li>
                ) : null}
                {profile.githubUsername ? (
                  <li className="text-[#353535]">GitHub: @{profile.githubUsername}</li>
                ) : null}
                {profile.portfolioUrl ? (
                  <li>
                    <a
                      className="inline-flex items-center gap-1 text-[#03535F] underline"
                      href={profile.portfolioUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Portfolio <ExternalLink className="size-3" />
                    </a>
                  </li>
                ) : null}
                {profile.links.map((link) => (
                  <li key={link.id}>
                    <a
                      className="inline-flex items-center gap-1 text-[#03535F] underline"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label || LINK_TYPE_LABELS[link.type] || link.type}{" "}
                      <ExternalLink className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No links recorded.</Empty>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Resume</h3>
            {detail.resume ? (
              <div className="space-y-1 text-sm">
                <Fact label="Status">{detail.resume.status}</Fact>
                {detail.resume.fileName || detail.resumeDownloadHref ? (
                  <Fact label="File">
                    {detail.resumeDownloadHref ? (
                      <a
                        className="inline-flex items-center gap-1 text-[#03535F] underline"
                        href={detail.resumeDownloadHref}
                      >
                        {detail.resume.fileName || "Download résumé"}{" "}
                        <Download className="size-3" />
                      </a>
                    ) : (
                      detail.resume.fileName
                    )}
                  </Fact>
                ) : null}
                {detail.resume.sourceUrl ? (
                  <Fact label="Source">
                    <a
                      className="text-[#03535F] underline"
                      href={detail.resume.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {detail.resume.sourceUrl}
                    </a>
                  </Fact>
                ) : null}
                {profile.resumeUrl ? (
                  <Fact label="Profile URL">
                    <a
                      className="inline-flex items-center gap-1 text-[#03535F] underline"
                      href={profile.resumeUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View resume <ExternalLink className="size-3" />
                    </a>
                  </Fact>
                ) : null}
              </div>
            ) : profile.resumeUrl ? (
              <a
                className="inline-flex items-center gap-1 text-sm text-[#03535F] underline"
                href={profile.resumeUrl}
                target="_blank"
                rel="noreferrer"
              >
                View resume <ExternalLink className="size-3" />
              </a>
            ) : (
              <Empty>No resume on file.</Empty>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Career preferences</h3>
            {profile.preference ? (
              <div className="space-y-1">
                <Fact label="Open to work">
                  {profile.preference.openToWork ? "Yes" : "No"}
                </Fact>
                <Fact label="Roles">
                  {profile.preference.preferredRoles.join(", ") || "—"}
                </Fact>
                <Fact label="Locations">
                  {profile.preference.preferredLocations.join(", ") || "—"}
                </Fact>
                <Fact label="Opportunity types">
                  {profile.preference.opportunityTypes
                    .map((t) => OPPORTUNITY_TYPE_LABELS[t] ?? t)
                    .join(", ") || "—"}
                </Fact>
                <Fact label="Remote">
                  {dash(profile.preference.remotePreference)}
                </Fact>
                <Fact label="Willing to relocate">
                  {profile.preference.willingToRelocate ? "Yes" : "No"}
                </Fact>
                <Fact label="Notice period">
                  {profile.preference.noticePeriodDays != null
                    ? `${profile.preference.noticePeriodDays} days`
                    : "—"}
                </Fact>
                <Fact label="Available from">
                  {monthYear(
                    profile.preference.availableFromMonth,
                    profile.preference.availableFromYear,
                  )}
                </Fact>
              </div>
            ) : (
              <Empty>No career preferences recorded.</Empty>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Accomplishments</h3>
            {detail.accomplishments.length === 0 &&
            profile.certifications.length === 0 &&
            !profile.awards ? (
              <Empty>No accomplishments recorded.</Empty>
            ) : (
              <ul className="space-y-2 text-sm text-[#353535]">
                {detail.accomplishments.map((row) => (
                  <li key={row.key}>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-[#787878]">
                      {row.outcomeLabel}
                      {row.detail ? ` · ${row.detail}` : ""}
                    </p>
                  </li>
                ))}
                {profile.certifications.map((row) => (
                  <li key={row.id}>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-[#787878]">
                      {row.issuer}
                      {row.issuedYear ? ` · ${monthYear(row.issuedMonth, row.issuedYear)}` : ""}
                    </p>
                  </li>
                ))}
                {profile.awards ? (
                  <li>
                    <p className="font-medium">Awards</p>
                    <p className="text-[#787878]">{profile.awards}</p>
                  </li>
                ) : null}
              </ul>
            )}

            <h3 className="text-sm font-semibold text-[#353535]">Mock interviews</h3>
            {detail.mockInterviews.length === 0 ? (
              <Empty>No mock interviews taken.</Empty>
            ) : (
              <TableWrap
                columns={["Domain", "Status", "Taken"]}
                empty={false}
              >
                {detail.mockInterviews.map((row) => (
                  <tr key={row.id} className="border-b border-[#E9E9E9] last:border-0">
                    <td className="px-3 py-2 first:pl-0">{row.domainLabel}</td>
                    <td className="px-3 py-2 text-[#787878]">
                      {MOCK_STATUS_LABEL[row.status] ?? row.status}
                    </td>
                    <td className="px-3 py-2 text-[#787878] last:pr-0">
                      {formatDateIST(row.evaluatedAt ?? row.createdAt)}
                    </td>
                  </tr>
                ))}
              </TableWrap>
            )}
          </div>
        ) : (
          <Empty>No candidate profile has been created for this account.</Empty>
        )}
      </Section>

      <Section title="Skills">
        {claimedSkills.length === 0 && provenance.programmeSkills.length === 0 ? (
          <Empty>No skills claimed or programme-verified.</Empty>
        ) : (
          <div className="space-y-4">
            {claimedSkills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {claimedSkills.map((skill) => {
                  const sources = evidenceBySkill.get(skill.skillId) ?? [];
                  const traced = tracedCount(sources);
                  const untracedOnly = traced === 0 && sources.length > 0;
                  return (
                    <span
                      key={skill.skillId}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#E9E9E9] px-2.5 py-1 text-xs text-[#353535]"
                    >
                      {skill.name}
                      {traced > 0 ? (
                        <a
                          href={`#evidence-${skill.skillId}`}
                          className="rounded-full bg-[#D6F7EC] px-1.5 py-0.5 font-medium text-[#197E23] underline-offset-2 hover:underline"
                        >
                          Evidence-backed · {traced} {traced === 1 ? "source" : "sources"}
                        </a>
                      ) : (
                        <span className="rounded-full border border-[#D2D2D2] px-1.5 py-0.5 text-[#787878]">
                          Self-declared
                        </span>
                      )}
                      {untracedOnly ? (
                        <a
                          href={`#evidence-${skill.skillId}`}
                          className="rounded-full bg-[#FFF7EB] px-1.5 py-0.5 text-[#B54708] underline-offset-2 hover:underline"
                        >
                          evidence on file, not traceable
                        </a>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ) : null}
            {provenance.programmeSkills.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-[#353535]">
                  Programme-verified
                </h3>
                <ul className="mt-2 space-y-3">
                  {provenance.programmeSkills.map((skill) => (
                    <li key={skill.skillId}>
                      <p className="text-sm font-medium text-[#353535]">{skill.name}</p>
                      <ul className="mt-1 space-y-2">
                        {skill.items.map((item) => (
                          <ProvenanceRow key={item.key} item={item} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Evidence">
        {provenance.skills.length === 0 &&
        provenance.credentials.length === 0 &&
        provenance.achievements.length === 0 ? (
          <Empty>No evidence records for this candidate.</Empty>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-[#8F8F8F]">
              Every badge below is followed back to the record that earned it. Names and
              dates come from that record; a badge whose record cannot be found, or no
              longer counts, is marked Not traced and says why.
            </p>
            {provenance.skills.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-[#353535]">
                  Evidence-backed skills
                </h3>
                <ul className="mt-2 space-y-3">
                  {provenance.skills.map((skill) => (
                    <li key={skill.skillId} id={`evidence-${skill.skillId}`}>
                      <p className="text-sm font-medium text-[#353535]">
                        {skill.name}
                        <span className="ml-2 text-xs font-normal text-[#787878]">
                          {tracedCount(skill.items)} of {skill.items.length} traced
                        </span>
                      </p>
                      <ul className="mt-1 space-y-2">
                        {skill.items.map((item) => (
                          <ProvenanceRow key={item.key} item={item} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {provenance.credentials.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-[#353535]">Credentials</h3>
                <ul className="mt-2 space-y-2">
                  {provenance.credentials.map((row) => (
                    <ProvenanceRow
                      key={row.credentialId}
                      item={row.item}
                      prefix={`${row.credentialId} · ${row.typeLabel}`}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            {provenance.achievements.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-[#353535]">Achievements</h3>
                <ul className="mt-2 space-y-2">
                  {provenance.achievements.map((item) => (
                    <ProvenanceRow key={item.key} item={item} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Applications">
        {detail.applications.length === 0 ? (
          <Empty>No job applications.</Empty>
        ) : (
          <TableWrap
            columns={["Role", "Company", "Status", "Applied"]}
            empty={false}
          >
            {detail.applications.map((row) => (
              <tr key={row.id} className="border-b border-[#E9E9E9] last:border-0">
                <td className="px-3 py-2 first:pl-0">
                  {row.job.title}
                  <span className="block text-xs text-[#787878]">
                    {JOB_TYPE_LABEL[row.job.type] ?? row.job.type}
                    {row.job.workMode
                      ? ` · ${WORK_MODE_LABEL[row.job.workMode] ?? row.job.workMode}`
                      : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-[#787878]">{row.job.company}</td>
                <td className="px-3 py-2">
                  {APPLICATION_STATUS_LABEL[row.status] ?? row.status}
                </td>
                <td className="px-3 py-2 text-[#787878] last:pr-0">
                  {formatDateIST(row.createdAt)}
                </td>
              </tr>
            ))}
          </TableWrap>
        )}
      </Section>

      <Section title="Assessments">
        {detail.assessments.length === 0 ? (
          <Empty>No recruiter assessments assigned.</Empty>
        ) : (
          <TableWrap
            columns={["Assessment", "Status", "Assigned", "Submitted", ""]}
            empty={false}
          >
            {detail.assessments.map((row) => (
              <tr
                key={row.assignmentId}
                className="border-b border-[#E9E9E9] last:border-0"
              >
                <td className="px-3 py-2 first:pl-0">
                  {row.title}
                  {row.durationMinutes != null ? (
                    <span className="block text-xs text-[#787878]">
                      {row.durationMinutes} min
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {ASSESSMENT_STATUS_LABEL[row.status] ?? row.status}
                </td>
                <td className="px-3 py-2 text-[#787878]">
                  {formatDateIST(row.assignedAt)}
                </td>
                <td className="px-3 py-2 text-[#787878]">
                  {row.submittedAt ? formatDateIST(row.submittedAt) : "—"}
                </td>
                <td className="px-3 py-2 text-right last:pr-0">
                  <Link
                    href={`/admin/students/${account.userId}/assessments/${row.assignmentId}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "whitespace-nowrap",
                    )}
                  >
                    View details
                  </Link>
                </td>
              </tr>
            ))}
          </TableWrap>
        )}
      </Section>

      <Section title="Programmes">
        {detail.programmes.length === 0 ? (
          <Empty>No challenge or programme enrolments.</Empty>
        ) : (
          <TableWrap
            columns={["Programme", "Kind", "Status", "Enrolled"]}
            empty={false}
          >
            {detail.programmes.map((row) => (
              <tr key={`${row.kind}-${row.id}`} className="border-b border-[#E9E9E9] last:border-0">
                <td className="px-3 py-2 first:pl-0">
                  {row.memberId ? (
                    <Link
                      href={`/admin/program/members/${row.memberId}`}
                      className="text-[#03535F] underline"
                    >
                      {row.title}
                    </Link>
                  ) : (
                    row.title
                  )}
                </td>
                <td className="px-3 py-2 text-[#787878]">
                  {row.kind === "challenge" ? "Challenge" : "Programme"}
                </td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2 text-[#787878] last:pr-0">
                  {row.enrolledAt ? formatDateIST(row.enrolledAt) : "—"}
                </td>
              </tr>
            ))}
          </TableWrap>
        )}
      </Section>

      <Section title="Notification activity">
        <p className="mb-3">
          <Link href={deliveryHref} className="text-sm text-[#03535F] underline">
            Open in Delivery Log
          </Link>
        </p>
        {detail.deliveries.length === 0 ? (
          <Empty>No notification or outbound delivery attempts.</Empty>
        ) : (
          <TableWrap
            columns={["When", "Event", "Channel", "State", "Failure"]}
            empty={false}
          >
            {detail.deliveries.map((row) => (
              <tr key={`${row.source}-${row.id}`} className="border-b border-[#E9E9E9] last:border-0">
                <td className="px-3 py-2 first:pl-0 text-[#787878]">
                  {formatDateTimeIST(new Date(row.updatedAt))}
                </td>
                <td className="px-3 py-2">{deliveryEvent(row)}</td>
                <td className="px-3 py-2 text-[#787878]">{row.channel}</td>
                <td className="px-3 py-2">{row.state}</td>
                <td className="px-3 py-2 text-[#787878] last:pr-0">
                  {row.failureReason ?? "—"}
                </td>
              </tr>
            ))}
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function deliveryEvent(row: DeliveryRow): string {
  if (row.source === "notification") return row.eventType || row.title;
  return row.kind;
}
