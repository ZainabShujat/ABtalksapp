# LangChain & LangGraph Cohort: content seed

Content JSONs for the **LangChain & LangGraph Cohort** (31 days). Learners who already know Python go from their first LLM call to a deployed, evaluated LangGraph application: the **AI Interview & Career Agent** capstone. The structure matches `prisma/content/Databricks/`, so it renders and grades the same way. There is **no `videos.json`**: this cohort ships without video resources.

Files:
- `modules.json`: the 6 modules, one per phase (Foundations, RAG, Tools & Agents, LangGraph, Production AI, Capstone).
- `days.json`: per-day mission briefs (`briefMd`) plus server-only `missionSpec` (`answers` for the Submit-your-answers questions and `repoChecks` for GitHub verification), `objectives`, `tools`, `estimatedMin`, `missionPoints`, `isProjectDay`, `missionType` (DATA_ROOM for the Day 1 setup day, SHIP_IT for build days).
- `concept-questions.json`: 5 multiple-choice concept questions per day (`options`, `correctIndex`, `explanation`).
- `entry-questions.json`: entrance exam with APTITUDE (20) and TECHNICAL Python prerequisites (20): type hints, TypedDict, Pydantic, decorators, async, venv and secrets.
- `exercises.json`: 12 practice-arena Python exercises. They use the standard library only and never call an LLM, because `expectedOutput` is an exact match.
- `rubrics.json`: one grading rubric per module (6 in total), loaded at grade time.

Learner repo: one GitHub repo, `langchain-langgraph-cohort`, holds everything: `days/dayNN_*.py`, `projects/mp1_*` to `projects/mp4_*`, `projects/api/`, `evals/`, `capstone/` and a running `interview_notes.md`. Every SHIP_IT day checks the committed paths and that `interview_notes.md` has a `## Day NN` section, where the learner answers 2 interview questions in their own words. By Day 31 each learner has about 60 written interview answers.

Projects: Day 5 (Resume & JD Analyzer), Day 11 (Chat With Your Documents), Day 16 (Career Assistant Agent plus capstone proposal), Day 23 (Corrective RAG Graph), Day 31 (Demo Day). Each mini project is reused in the capstone, so Days 27 to 31 are integration work rather than a fresh start.

Verification model: `missionSpec.answers` are single fixed values (a number or one token), matched case-insensitively, and all must be correct to unlock the next day. Where possible the answers can only be known by running the code (for example `len(graph.get_graph().nodes)` or the chunk count of a fixed string), not by reading the brief. `repoChecks` use `fileExists`, `contentMatches` and `minLines`. Regexes use plain JavaScript syntax with no inline flags such as `(?i)`, because `verify-mission.ts` compiles them with `new RegExp(regex, "m")`. Content checks only run once `SHIP_IT_CONTENT_CHECKS` is switched on. Until then, file existence plus the answers are the gate.

Points: 12 per day, 31 days. **Max = 372.**

Cost: the whole cohort runs on free tiers. The LLM comes from Groq, Google Gemini or local Ollama through `init_chat_model`. Embeddings (`all-MiniLM-L6-v2`), the reranker and Chroma run locally. LangSmith uses its free developer plan. Deployment goes to Render, Hugging Face Spaces or Streamlit Community Cloud free tiers.

Versions: the content targets **LangChain 1.x and LangGraph 1.x** (`create_agent`, `interrupt`, `Command`, `Send`, `InMemorySaver`). Legacy APIs such as `AgentExecutor`, `LLMChain`, `RetrievalQA` and `ConversationBufferMemory` are deliberately not taught. Provider model ids change often, so the briefs tell learners to copy a current id rather than hard-coding one. Re-check import paths against the LangChain and LangGraph docs before each run.

App: LearningProgram `langchain`, cohort `langchain-open` (rolling, IST), served at `/program/langchain` behind `ENABLE_LANGCHAIN=true`. Day activities are `act_lcg_day_01` to `act_lcg_day_31`. The track is a file-for-file clone of the 31-day Databricks track (`src/features/langchain`, `src/repositories/langchain.ts`, `src/components/langchain`, `src/app/program/langchain`).

Seeding: `npm run db:seed:langchain` (`prisma/seed-langchain.ts`). It is the Databricks seed without the video loop, because this cohort has no `videos.json`. Like the other seeds it only reads `modules.json` and `days.json`, and it refuses the production Neon host unless `SEED_ALLOW_PRODUCTION=true`.
