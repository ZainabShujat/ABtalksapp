import Link from "next/link";

const LEARN = [
  "Architect mindset, C4 model, and NFRs-first thinking",
  "Data architecture: Kimball, lakehouse, Iceberg vs Delta vs Hudi",
  "AWS data platform: Redshift, Glue, Lake Formation, Athena",
  "Walking-skeleton capstone and a mock CTO/CDO defense",
];

export function DsArchitectEnrolHero() {
  return (
    <div className="space-y-8 font-content text-[#111111]">
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
            Data Solutions Architect
          </li>
        </ol>
      </nav>

      <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div>
            <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
              Data Solutions Architect
            </h1>
            <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              Design AWS-first data and AI platforms in 10 days
            </p>
            <div className="ml-3 mt-6">
              <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
                What you will learn
              </p>
              <ul className="mt-3 space-y-2 text-[17px] leading-7 text-[#4B4B4B]">
                {LEARN.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-[#E05226]" aria-hidden>
                      -
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#ds-architect-register"
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#C9411C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E05226]"
              >
                Register now
              </a>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ds-architect/data-sol-arch.webp"
            alt="Data Solutions Architect Cohort"
            width={577}
            height={298}
            className="h-auto w-full max-w-[520px] justify-self-center rounded-[12px] object-contain md:justify-self-end"
          />
        </div>
      </section>
    </div>
  );
}
