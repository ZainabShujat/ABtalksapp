import Link from "next/link";

const LEARN = [
  "LLM foundations: prompts, structured output and LCEL chains",
  "RAG: loaders, chunking, embeddings, hybrid search and reranking",
  "Tools and agents: tool calling, create_agent, agentic RAG and MCP",
  "LangGraph: state, reducers, routing, persistence, human-in-the-loop and multi-agent",
  "Production: LangSmith evaluation, guardrails, FastAPI and deployment",
  "Capstone: an AI Interview & Career Agent, shipped and demoed",
];

const PREREQUISITES = [
  "Comfortable with Python: functions, classes, dicts and list comprehensions",
  "Basic type hints, decorators and pip / virtual environments",
  "A GitHub account and Git basics (clone, commit, push)",
  "A laptop with Python 3.10 or newer (8 GB RAM recommended)",
  "No paid API needed: free LLM tiers (Groq, Gemini) or local Ollama",
];

const REGISTER_CLASS =
  "mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#03535F] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#076573] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#03535F]";

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2 text-[17px] leading-7 text-[#4B4B4B]">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="text-[#03535F]" aria-hidden>
            -
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function LangchainEnrolHero({
  registerHref = "#langchain-register",
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
            LangChain &amp; LangGraph
          </li>
        </ol>
      </nav>

      <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-8">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div>
            <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#000000] md:text-[40px] md:leading-[48px]">
              LangChain &amp; LangGraph Cohort
            </h1>
            <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              Go from your first LLM call to a deployed LangGraph agent in 31
              days
            </p>
            <div className="ml-3 mt-6">
              <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#03535F]">
                What you will learn
              </p>
              <BulletList items={LEARN} />
              <p className="mt-6 text-[13px] leading-[18px] font-semibold uppercase text-[#03535F]">
                Prerequisites
              </p>
              <BulletList items={PREREQUISITES} />
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
            src="/langchain-cohort/langchain-hero.svg"
            alt="LangChain & LangGraph Cohort"
            width={577}
            height={298}
            className="h-auto w-full max-w-[520px] justify-self-center object-contain md:justify-self-end"
          />
        </div>
      </section>
    </div>
  );
}
