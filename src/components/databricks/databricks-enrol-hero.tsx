import Link from "next/link";

const LEARN = [
  "Workspace, Unity Catalog, and PySpark",
  "Medallion layers: Bronze ingestion, Silver quality, Gold star schema",
  "Lakeflow Declarative Pipelines, Jobs, and Asset Bundles",
  "Governance (grants, lineage, row filters) plus SQL, AI/BI Dashboards, and Genie",
  
];

const REGISTER_CLASS =
  "mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#03535F] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#076573] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#03535F]";

export function DatabricksEnrolHero({
  registerHref = "#databricks-register",
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
            Databricks
          </li>
        </ol>
      </nav>

      <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div>
            <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#000000] md:text-[40px] md:leading-[48px]">
              Databricks Cohort
            </h1>
            <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              Build a healthcare-claims Lakehouse on Databricks in
              31 days
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
            src="/databricks-cohort/databricks-hero.svg"
            alt="Databricks Cohort"
            width={577}
            height={298}
            className="h-auto w-full max-w-[520px] justify-self-center object-contain md:justify-self-end"
          />
        </div>
      </section>
    </div>
  );
}
