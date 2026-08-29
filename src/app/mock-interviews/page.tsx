import type { Metadata } from "next";
import Link from "next/link";
import { Mic, ShieldCheck, Repeat } from "lucide-react";
import { auth } from "@/auth";
import {
  listDomains,
  toDomainSummary,
} from "@/features/interview/platform/domains";
import { getCatalogue } from "@/features/interview/platform/service";
import { resolvePlatformUserId } from "@/features/interview/platform/provider";
import { MockInterviewCatalog } from "@/components/mock-interview/catalog";
import type { CatalogueEntry } from "@/features/interview/platform/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Mock Interviews | ABTalks",
  description:
    "Practise real technical interviews out loud. An AI interviewer asks about your work, follows up on your answers, and gives you an evidence-backed report.",
};

/**
 * The mock interview catalogue.
 *
 * Server Component. Deliberately readable SIGNED OUT — the catalogue doubles as
 * a marketing surface, and hiding it behind a login would mean nobody discovers
 * the product. Signing in only adds each domain's attempt count; nothing that
 * matters is exposed either way, because `CatalogueEntry` carries no rubric,
 * pack or eligibility data.
 *
 * Only plain data crosses to the client component.
 */
export default async function MockInterviewsPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);

  let entries: CatalogueEntry[];

  if (signedIn) {
    const userId = await resolvePlatformUserId();
    const result = userId ? await getCatalogue(userId) : null;
    entries =
      result?.ok === true
        ? result.data
        : listDomains().map((d) => ({
            ...toDomainSummary(d),
            completedAttempts: 0,
          }));
  } else {
    entries = listDomains().map((d) => ({
      ...toDomainSummary(d),
      completedAttempts: 0,
    }));
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      {/* ------------------------------------------------------------ hero */}
      <header className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F8F8F]">
          ABTalks Practice
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#111111] md:text-4xl">
          AI mock interviews
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#4B4B4B] md:text-base">
          Practise a real interview out loud. The interviewer asks about what you
          know, follows up on what you actually say, and gives you a report that
          cites your own answers rather than a generic score.
        </p>

        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-[#4B4B4B]">
          <li className="flex items-center gap-2">
            <Mic className="size-4 text-[#E05226]" strokeWidth={2} />
            Spoken, not typed
          </li>
          <li className="flex items-center gap-2">
            <Repeat className="size-4 text-[#E05226]" strokeWidth={2} />
            Retake as often as you like
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#E05226]" strokeWidth={2} />
            Scored from evidence, not vibes
          </li>
        </ul>

        {!signedIn ? (
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#C9411C]"
            >
              Sign in to practise
            </Link>
            <span className="text-[13px] text-[#8F8F8F]">
              Free with any ABTalks account.
            </span>
          </div>
        ) : null}
      </header>

      {/* ------------------------------------------------------- catalogue */}
      <section className="mt-10" aria-labelledby="catalogue-heading">
        <h2
          id="catalogue-heading"
          className="mb-4 text-lg font-semibold text-[#111111]"
        >
          Choose an interview
        </h2>
        <MockInterviewCatalog entries={entries} signedIn={signedIn} />
      </section>

      {/* ---------------------------------------------------------- how it works */}
      <section className="mt-14" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-lg font-semibold text-[#111111]">
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              n: "1",
              t: "Talk it through",
              d: "Answer out loud. The interviewer follows up when an answer is thin and goes deeper when it is strong.",
            },
            {
              n: "2",
              t: "Get judged on evidence",
              d: "Every question has a checklist of what a complete answer contains. Your score comes from what you covered, computed in code.",
            },
            {
              n: "3",
              t: "Read the report",
              d: "Strengths and gaps, each one citing the question it came from. Nothing in it is invented.",
            },
          ].map((s) => (
            <li
              key={s.n}
              className="rounded-[16px] border border-[#E0E0E0] bg-white p-5"
            >
              <span className="flex size-7 items-center justify-center rounded-[6px] bg-[#FFECE3] text-[13px] font-bold text-[#E05226]">
                {s.n}
              </span>
              <h3 className="mt-3 text-[15px] font-semibold text-[#111111]">
                {s.t}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#4B4B4B]">
                {s.d}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
