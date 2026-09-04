import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PowerBiDashboardView } from "@/components/powerbi/powerbi-dashboard-view";
import { PowerBiEnrolHero } from "@/components/powerbi/powerbi-enrol-hero";
import { PowerBiEnrollForm } from "@/components/powerbi/powerbi-enroll-form";
import { ProgramModuleList } from "@/components/program/program-module-list";
import {
  POWERBI_BASE,
  POWERBI_PROGRAM_SLUG,
} from "@/features/powerbi/constants";
import { getPowerBiDashboard } from "@/features/powerbi/dashboard";
import { getPowerBiEntryState } from "@/features/powerbi/enroll";
import { findPowerBiEnrollment } from "@/repositories/powerbi";
import { listCurriculumForProgramSlug } from "@/repositories/learning";

export const metadata = {
  title: "Power BI & Analytics | ABTalks",
  description: "Ship recruiter-grade Power BI dashboards in 7 days.",
};

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] md:px-[50px]">
      <div className="mx-auto w-full max-w-[1500px] space-y-8">{children}</div>
    </div>
  );
}

function BreadcrumbHeader() {
  return (
    <>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          <li>
            <Link
              href="/dashboard"
              className="text-[#8F8F8F] hover:text-[#E05226]"
            >
              Dashboard
            </Link>
          </li>
          <li aria-hidden className="text-[#8F8F8F]">
            &gt;
          </li>
          <li aria-current="page" className="font-semibold text-[#111111]">
            Power BI &amp; Analytics
          </li>
        </ol>
      </nav>
      <header>
        <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
          Power BI &amp; Analytics
        </h1>
        <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
          Ship recruiter-grade Power BI dashboards in 7 days
        </p>
      </header>
    </>
  );
}

export default async function PowerBiPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?from=${POWERBI_BASE}`);
  }

  const state = await getPowerBiEntryState(session.user.id);

  if (state.screen === "needs_profile") {
    redirect("/register");
  }

  if (state.screen === "closed") {
    return (
      <PageFrame>
        <BreadcrumbHeader />
        <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <p className="text-[17px] leading-7 text-[#4B4B4B]">
            This cohort is not open for enrolment right now.
          </p>
        </div>
      </PageFrame>
    );
  }

  if (state.screen === "form") {
    const catalog = await listCurriculumForProgramSlug(POWERBI_PROGRAM_SLUG);
    const days = catalog.days.map((d) => ({ ...d, state: "LOCKED" as const }));
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] md:px-[50px]">
        <div className="mx-auto w-full max-w-[1500px] space-y-8">
          <PowerBiEnrolHero />
          <section>
            <ProgramModuleList
              modules={catalog.modules}
              days={days}
              lockAllDays
              basePath="/program/powerbi"
            />
          </section>
          <section id="powerbi-register" className="scroll-mt-24">
            <h2 className="mb-4 font-heading text-2xl leading-[30px] font-semibold text-[#111111]">
              Register
            </h2>
            <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
              <PowerBiEnrollForm />
            </div>
          </section>
        </div>
      </div>
    );
  }

  const enrollment = await findPowerBiEnrollment(session.user.id);
  if (!enrollment) redirect(POWERBI_BASE);
  const data = await getPowerBiDashboard(enrollment);
  return <PowerBiDashboardView data={data} />;
}
