import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { searchCandidates } from "@/features/hire/search-candidates";
import { jobSpecSchema, type JobSpec } from "@/lib/validations/hire";

export type HireAlertsResult = {
  checked: number;
  alerted: number;
  failures: string[];
};

/**
 * For ACTIVE requests with alertWhenAvailable, re-run search and email recruiter
 * when at least one STRONG/PARTIAL match exists.
 */
export async function runHireAlertsCron(): Promise<HireAlertsResult> {
  const failures: string[] = [];
  let alerted = 0;

  const requests = await prisma.talentRequest.findMany({
    where: {
      alertWhenAvailable: true,
      status: { in: ["ACTIVE", "MATCHED"] },
    },
    select: {
      id: true,
      title: true,
      mustHaveStack: true,
      niceToHaveStack: true,
      evidencePriority: true,
      seniority: true,
      openings: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      workMode: true,
      locationCity: true,
      employmentType: true,
      noticePeriodDays: true,
      minExperience: true,
      maxExperience: true,
      requiresDegree: true,
      recruiter: { select: { email: true, name: true } },
    },
    take: 50,
    orderBy: { updatedAt: "asc" },
  });

  for (const req of requests) {
    try {
      const spec: JobSpec = jobSpecSchema.parse({
        title: req.title,
        seniority: req.seniority,
        openings: req.openings,
        mustHaveStack: req.mustHaveStack,
        niceToHaveStack: req.niceToHaveStack,
        evidencePriority: req.evidencePriority,
        salaryMin: req.salaryMin,
        salaryMax: req.salaryMax,
        salaryCurrency: req.salaryCurrency,
        salaryPeriod: req.salaryPeriod === "MONTHLY" ? "MONTHLY" : "ANNUAL",
        workMode: req.workMode,
        locationCity: req.locationCity,
        employmentType: req.employmentType,
        noticePeriodDays: req.noticePeriodDays,
        minExperience: req.minExperience,
        maxExperience: req.maxExperience,
        requiresDegree: req.requiresDegree,
      });

      const search = await searchCandidates(spec, { limit: 5 });
      if (!search.ok) {
        failures.push(`${req.id}: ${search.message}`);
        continue;
      }
      if (search.data.matches.length === 0) continue;

      const to = req.recruiter.email;
      if (!to) {
        failures.push(`${req.id}: no recruiter email`);
        continue;
      }

      const names = search.data.matches
        .slice(0, 3)
        .map((m) => `${m.fullName} (${m.score})`)
        .join(", ");
      const subject = `Scout found ${search.data.matches.length} match(es) for ${req.title}`;
      const text = `Hi${req.recruiter.name ? ` ${req.recruiter.name}` : ""},

Scout found verified candidates for your requirement "${req.title}".

Top matches: ${names}

Open: ${process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "https://abtalksapp.vercel.app"}/hire/${req.id}

— ABTalks Scout
`;
      const html = `<p>Hi${req.recruiter.name ? ` ${escapeHtml(req.recruiter.name)}` : ""},</p>
<p>Scout found <strong>${search.data.matches.length}</strong> verified candidate(s) for <strong>${escapeHtml(req.title)}</strong>.</p>
<p>Top matches: ${escapeHtml(names)}</p>
<p><a href="${process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "https://abtalksapp.vercel.app"}/hire/${req.id}">Open your Scout search</a></p>
<p>— ABTalks Scout</p>`;

      const sent = await sendEmail({ to, subject, html, text });
      if (sent.ok || sent.skipped) {
        // Clear alert flag so we don't spam every night
        await prisma.talentRequest.update({
          where: { id: req.id },
          data: {
            status: "MATCHED",
            alertWhenAvailable: false,
          },
        });
        alerted += 1;
      } else {
        failures.push(`${req.id}: email failed`);
      }
    } catch (e) {
      failures.push(`${req.id}: ${String(e)}`);
      logger.error("[hire-alerts] request failed", {
        requestId: req.id,
        error: String(e),
      });
    }
  }

  return { checked: requests.length, alerted, failures };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
