import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LangchainDashboardView } from "@/components/langchain/langchain-dashboard-view";
import { LangchainEnrolHero } from "@/components/langchain/langchain-enrol-hero";
import { LangchainEnrollForm } from "@/components/langchain/langchain-enroll-form";
import { ProgramModuleList } from "@/components/program/program-module-list";
import { LANGCHAIN_BASE, LANGCHAIN_PROGRAM_SLUG } from "@/features/langchain/constants";
import { getLangchainDashboard } from "@/features/langchain/dashboard";
import { getLangchainEntryState } from "@/features/langchain/enroll";
import { registerHref } from "@/features/registration/registration-gate";
import { findLangchainEnrollment } from "@/repositories/langchain";
import { listCurriculumForProgramSlug } from "@/repositories/learning";

export const metadata = {
  title: "LangChain & LangGraph Cohort | ABTalks",
  description:
    "Go from your first LLM call to a deployed LangGraph agent in 31 days.",
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
            LangChain &amp; LangGraph
          </li>
        </ol>
      </nav>
      <header>
        <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#000000] md:text-[40px] md:leading-[48px]">
          LangChain &amp; LangGraph Cohort
        </h1>
        <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
          Go from your first LLM call to a deployed LangGraph agent in 31
          days
        </p>
      </header>
    </>
  );
}

export default async function LangchainPage() {
  const session = await auth();
  if (!session?.user?.id) {
    const catalog = await listCurriculumForProgramSlug(LANGCHAIN_PROGRAM_SLUG);
    const days = catalog.days.map((d) => ({ ...d, state: "LOCKED" as const }));
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#F4F4F4] px-5 py-8 font-content text-[#000000] md:px-[50px]">
        <div className="mx-auto w-full max-w-[1500px] space-y-8">
          <LangchainEnrolHero
            registerHref={`/login?from=${encodeURIComponent(LANGCHAIN_BASE)}`}
          />
          <section>
            <ProgramModuleList
              modules={catalog.modules}
              days={days}
              lockAllDays
              basePath="/program/langchain"
            />
          </section>
        </div>
      </div>
    );
  }

  const state = await getLangchainEntryState(session.user.id);

  if (state.screen === "needs_profile") {
    redirect(registerHref(LANGCHAIN_BASE));
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
    const catalog = await listCurriculumForProgramSlug(LANGCHAIN_PROGRAM_SLUG);
    const days = catalog.days.map((d) => ({ ...d, state: "LOCKED" as const }));
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#F4F4F4] px-5 py-8 font-content text-[#000000] md:px-[50px]">
        <div className="mx-auto w-full max-w-[1500px] space-y-8">
          <LangchainEnrolHero />
          <section>
            <ProgramModuleList
              modules={catalog.modules}
              days={days}
              lockAllDays
              basePath="/program/langchain"
            />
          </section>
          <section id="langchain-register" className="scroll-mt-24">
            <h2 className="mb-4 font-heading text-2xl leading-[30px] font-semibold text-[#000000]">
              Register
            </h2>
            <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
              <LangchainEnrollForm />
            </div>
          </section>
        </div>
      </div>
    );
  }

  const enrollment = await findLangchainEnrollment(session.user.id);
  if (!enrollment) redirect(LANGCHAIN_BASE);
  const data = await getLangchainDashboard(enrollment);
  return <LangchainDashboardView data={data} />;
}
