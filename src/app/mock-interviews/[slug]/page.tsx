import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Code2, Mic } from "lucide-react";
import { auth } from "@/auth";
import { getDomain, getStartableDomain } from "@/features/interview/platform/domains";
import { getPack } from "@/features/interview/platform/packs";
import { getRubric } from "@/features/interview/platform/rubrics";
import { MIN_ANSWERED_TO_SCORE } from "@/features/interview/platform/service";
import { MockInterviewSession } from "@/components/mock-interview/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const domain = getDomain(slug);
  return {
    title: domain ? `${domain.label} Mock Interview | ABTalks` : "Mock Interview",
    description: domain?.blurb,
  };
}

/**
 * One interview's detail page.
 *
 * Server Component. Everything shown is read from the code registry — the
 * domain, its pack sections and its rubric — so this page cannot show a
 * candidate anything the server would not actually ask them.
 *
 * WHAT IS DELIBERATELY NOT SHOWN: the questions themselves, their expected
 * evidence, and `minEvidence`. Sections and rubric competencies are safe to
 * publish (they tell someone what is being assessed, which is fair); the
 * checklist is not, because a candidate who reads it can recite it back.
 */
export default async function MockInterviewDomainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const domain = getDomain(slug);
  if (!domain) notFound();

  const session = await auth();
  const signedIn = Boolean(session?.user?.id);

  const startable = getStartableDomain(slug) !== null;
  const pack = domain.packRef ? getPack(domain.packRef) : null;
  const rubric = domain.rubricId ? getRubric(domain.rubricId) : null;
  const minutes = Math.round(domain.durationSec / 60);
  // Derived from declared capabilities, so the label cannot claim a workspace
  // the interview does not actually offer.
  const usesEditor = domain.capabilities.includes("CODE_SANDBOX");
  const usesBoard = domain.capabilities.includes("WHITEBOARD");
  const format = usesEditor
    ? "Spoken, with code typed in the editor"
    : usesBoard
      ? "Spoken, with a whiteboard"
      : "Spoken";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <Link
        href="/mock-interviews"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#4B4B4B] transition-colors hover:text-[#111111]"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2} />
        All mock interviews
      </Link>

      <header className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F8F8F]">
          {domain.family}
          {" · "}
          Practice
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#111111]">
          {domain.label}
        </h1>
        {/*
          `domain.blurb` is deliberately NOT rendered here. It is the catalogue
          card's one-line teaser, and the "What this interview is for" panel
          below says the same thing at more length — showing both made the page
          state its premise twice within a screen.
        */}

        <dl className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#4B4B4B]">
          <div className="flex items-center gap-1.5">
            <Clock className="size-4 text-[#8F8F8F]" strokeWidth={2} />
            <dd>{minutes} minutes</dd>
          </div>
          {pack ? (
            <div className="flex items-center gap-1.5">
              <dd>{pack.questions.length} questions, plus follow-ups</dd>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            {usesEditor ? (
              <Code2 className="size-4 text-[#8F8F8F]" strokeWidth={2} />
            ) : (
              <Mic className="size-4 text-[#8F8F8F]" strokeWidth={2} />
            )}
            <dd>{format}</dd>
          </div>
        </dl>
      </header>

      {startable ? (
        <section className="mt-7" aria-labelledby="start">
          <h2 id="start" className="sr-only">
            Start this interview
          </h2>
          {signedIn ? (
            <MockInterviewSession
              domainSlug={domain.slug}
              domainLabel={domain.label}
              minAnsweredToScore={MIN_ANSWERED_TO_SCORE}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#C9411C]"
              >
                Sign in to practise
              </Link>
              <span className="text-[13px] text-[#8F8F8F]">
                Free with any ABTalks account.
              </span>
            </div>
          )}
        </section>
      ) : null}

      {domain.purpose ? (
        <section
          className="mt-7 rounded-[16px] border border-[#E0E0E0] bg-[#FFF5F0] p-5"
          aria-labelledby="purpose"
        >
          <h2
            id="purpose"
            className="text-[15px] font-semibold text-[#111111]"
          >
            What this interview is for
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#4B4B4B]">
            {domain.purpose}
          </p>
        </section>
      ) : null}

      {!startable ? (
        <div className="mt-8 rounded-[16px] border border-[#E0E0E0] bg-[#F5F5F5] p-5">

          <h2 className="text-[15px] font-semibold text-[#111111]">
            Not available yet
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4B4B4B]">
            This interview is on the roadmap. Its question pack has not been
            written yet, so it cannot be started.
          </p>
        </div>
      ) : (
        <>
          {pack ? (
            <section className="mt-9" aria-labelledby="covers">
              <h2 id="covers" className="text-lg font-semibold text-[#111111]">
                What it covers
              </h2>
              <ul className="mt-3 space-y-2">
                {pack.sections.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start gap-2.5 text-sm text-[#4B4B4B]"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#E05226]" />
                    {s.label}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {rubric ? (
            <section className="mt-9" aria-labelledby="assessed">
              <h2 id="assessed" className="text-lg font-semibold text-[#111111]">
                What you&rsquo;re assessed on
              </h2>
              <div className="mt-3 space-y-3">
                {rubric.competencies.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-[12px] border border-[#E0E0E0] bg-[#FFF5F0] p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-[14px] font-semibold text-[#111111]">
                        {c.label}
                      </h3>
                      <span className="shrink-0 text-[12px] font-semibold text-[#E05226]">
                        {c.weight}%
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[#4B4B4B]">
                      {c.expectations}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-9 rounded-[16px] border border-[#E0E0E0] bg-white p-5">
            <h2 className="text-[15px] font-semibold text-[#111111]">
              Before you start
            </h2>
            <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-[#4B4B4B]">
              <li>
                &bull; You&rsquo;ll need a working microphone
                {usesEditor
                  ? ", and you type your code in the editor as you talk."
                  : "."}
              </li>
              <li>
                &bull; Answer at least {MIN_ANSWERED_TO_SCORE} questions to get a
                report. Leave earlier and nothing is scored or counted.
              </li>
              <li>
                &bull; Practice only. Nothing here affects your cohort or
                challenge progress.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
