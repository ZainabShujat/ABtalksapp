import Link from "next/link";

const LEARN = [
  "Snowflake architecture, RBAC, Horizon governance, Time Travel and cloning",
  "COPY INTO, Snowpipe, Streams & Tasks, Dynamic Tables and Snowpark",
  "dbt Projects, CI/CD with the Snowflake CLI, performance and cost control",
  "Snowpark ML, Feature Store, Model Registry, Cortex Search and Cortex Agents",
];

const REGISTER_CLASS =
  "mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#03535F] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#076573] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#03535F]";

export function SnowflakeEnrolHero({
  registerHref = "#snowflake-register",
}: {
  registerHref?: string;
}) {
  return (
    <div className="space-y-8 font-content text-[#000000]">
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

      <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div>
            <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#000000] md:text-[40px] md:leading-[48px]">
              Snowflake Data &amp; AI Engineering
            </h1>
            <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              Build a governed Data + AI lakehouse on Snowflake in 15 days
            </p>
            <div className="ml-3 mt-6">
              <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#03535F]">
                What you will learn
              </p>
              <ul className="mt-3 space-y-2 text-[17px] leading-7 text-[#4B4B4B]">
                {LEARN.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-[#03535F]" aria-hidden>
                      -
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {registerHref.startsWith("/") ? (
                <Link href={registerHref} className={REGISTER_CLASS}>
                  Register now
                </Link>
              ) : (
                <a href={registerHref} className={REGISTER_CLASS}>
                  Register now
                </a>
              )}
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/snowflake-cohort/snowflake-hero.svg"
            alt="Snowflake Data & AI Engineering Cohort"
            width={670}
            height={502}
            className="h-auto w-full max-w-[520px] justify-self-center rounded-[12px] object-contain md:justify-self-end"
          />
        </div>
      </section>
    </div>
  );
}
