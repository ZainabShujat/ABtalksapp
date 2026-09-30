import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SnowflakeDashboardView } from "@/components/snowflake/snowflake-dashboard-view";
import { SnowflakeEnrolHero } from "@/components/snowflake/snowflake-enrol-hero";
import { SnowflakeEnrollForm } from "@/components/snowflake/snowflake-enroll-form";
import { ProgramModuleList } from "@/components/program/program-module-list";
import {
  SNOWFLAKE_BASE,
  SNOWFLAKE_PROGRAM_SLUG,
} from "@/features/snowflake/constants";
import { getSnowflakeDashboard } from "@/features/snowflake/dashboard";
import { getSnowflakeEntryState } from "@/features/snowflake/enroll";
import { registerHref, withAdsClickIds } from "@/features/registration/registration-gate";
import { findSnowflakeEnrollment } from "@/repositories/snowflake";
import { listCurriculumForProgramSlug } from "@/repositories/learning";

export const metadata = {
  title: "Snowflake Data & AI Engineering | ABTalks",
  description: "Build a governed Data + AI lakehouse on Snowflake in 15 days.",
};

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#F4F4F4] px-5 py-8 font-content text-[#000000] md:px-[50px]">
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
              className="text-[#8F8F8F] hover:text-[#03535F]"
            >
              Dashboard
            </Link>
          </li>
          <li aria-hidden className="text-[#8F8F8F]">
            &gt;
          </li>
          <li aria-current="page" className="font-semibold text-[#000000]">
            Snowflake Data &amp; AI Engineering
          </li>
        </ol>
      </nav>
      <header>
        <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#000000] md:text-[40px] md:leading-[48px]">
          Snowflake Data &amp; AI Engineering
        </h1>
        <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
          Build a governed Data + AI lakehouse on Snowflake in 15 days
        </p>
      </header>
    </>
  );
}

export default async function SnowflakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clickIds = await searchParams;
  const returnTo = withAdsClickIds(SNOWFLAKE_BASE, clickIds);
  const session = await auth();
  if (!session?.user?.id) {
    const catalog = await listCurriculumForProgramSlug(SNOWFLAKE_PROGRAM_SLUG);
    const days = catalog.days.map((d) => ({ ...d, state: "LOCKED" as const }));
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#F4F4F4] px-5 py-8 font-content text-[#000000] md:px-[50px]">
        <div className="mx-auto w-full max-w-[1500px] space-y-8">
          <SnowflakeEnrolHero
            registerHref={`/login?from=${encodeURIComponent(returnTo)}`}
          />
          <section>
            <ProgramModuleList
              modules={catalog.modules}
              days={days}
              lockAllDays
              basePath="/program/snowflake"
            />
          </section>
        </div>
      </div>
    );
  }

  const state = await getSnowflakeEntryState(session.user.id);

  if (state.screen === "needs_profile") {
    redirect(registerHref(returnTo));
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
    const catalog = await listCurriculumForProgramSlug(SNOWFLAKE_PROGRAM_SLUG);
    const days = catalog.days.map((d) => ({ ...d, state: "LOCKED" as const }));
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#F4F4F4] px-5 py-8 font-content text-[#000000] md:px-[50px]">
        <div className="mx-auto w-full max-w-[1500px] space-y-8">
          <SnowflakeEnrolHero />
          <section>
            <ProgramModuleList
              modules={catalog.modules}
              days={days}
              lockAllDays
              basePath="/program/snowflake"
            />
          </section>
          <section id="snowflake-register" className="scroll-mt-24">
            <h2 className="mb-4 font-heading text-2xl leading-[30px] font-semibold text-[#000000]">
              Register
            </h2>
            <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
              <SnowflakeEnrollForm />
            </div>
          </section>
        </div>
      </div>
    );
  }

  const enrollment = await findSnowflakeEnrollment(session.user.id);
  if (!enrollment) redirect(SNOWFLAKE_BASE);
  const data = await getSnowflakeDashboard(enrollment);
  return <SnowflakeDashboardView data={data} />;
}
