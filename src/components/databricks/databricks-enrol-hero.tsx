import Image from "next/image";
import Link from "next/link";

const ABOUT = [
  "31-day self-serve Data Engineering track on Databricks Free Edition.",
  "Build a healthcare-claims Lakehouse from raw files to governed Gold tables.",
  "Your enrolment date is Day 1 in IST; each mission verifies against your GitHub repo.",
  "Bring a laptop and a Databricks account — no join code, no waitlist.",
];

const LEARN = [
  "Workspace, Unity Catalog, and PySpark on Free Edition",
  "Medallion layers: Bronze ingestion, Silver quality, Gold star schema",
  "Lakeflow Declarative Pipelines, Jobs, and Asset Bundles",
  "Governance (grants, lineage, row filters) plus SQL, AI/BI Dashboards, and Genie",
  "A Day-31 capstone you can demo end to end",
];

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2 text-[17px] leading-7 text-[#4B4B4B]">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="text-[#E05226]" aria-hidden>
            -
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function DatabricksEnrolHero() {
  return (
    <section className="-mx-4 -mt-6 bg-[#e9e3dd] px-5 py-8 font-content text-[#111111] sm:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-8">
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
              Databricks
            </li>
          </ol>
        </nav>

        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="min-w-0 space-y-8">
            <div>
              <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
                About the cohort
              </p>
              <BulletList items={ABOUT} />
            </div>
            <div>
              <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
                What you will learn
              </p>
              <BulletList items={LEARN} />
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            <Image
              src="/databricks-cohort/DATABRICKS-COHORT-HERO.png"
              alt="Databricks Cohort"
              width={640}
              height={640}
              priority
              className="h-auto w-full max-w-[520px] object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
