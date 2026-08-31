import Link from "next/link";

export function DatabricksEnrolHero() {
  return (
    <div className="font-content text-[#111111]">
      <div className="-mx-4 -mt-6 px-5 pt-8 sm:px-8">
        <nav className="mx-auto w-full max-w-[1500px]" aria-label="Breadcrumb">
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
              Databricks
            </li>
          </ol>
        </nav>
      </div>

      <section className="-mx-4 mt-6 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto grid w-full max-w-[1500px] items-center gap-8 md:grid-cols-2 md:gap-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/databricks-cohort/databricks-hero.svg"
            alt="Databricks Cohort"
            width={577}
            height={298}
            className="h-auto w-full max-w-[520px] justify-self-center object-contain md:justify-self-start"
          />
          <header>
            <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
              Databricks Cohort
            </h1>
            <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              Build a healthcare-claims Lakehouse on Databricks Free Edition in
              31 days
            </p>
          </header>
        </div>
      </section>
    </div>
  );
}
