# Data & Solution Architect Cohort — content seed

Content JSONs for the **10-Day Data & Solution Architect Recruitment Cohort** (AWS-first Data + AI platform, multi-industry rotation, 8–15+ yr candidates). Same seed structure as the Databricks and AI cohorts so both render and grade identically.

Files:
- `modules.json` — the 7 phases (title, subtitle, color, start/end day).
- `days.json` — per-day mission briefs (`briefMd`) plus server-only `missionSpec` (`answers` for the Submit-your-answers questions and `repoChecks` for GitHub verification), `objectives`, `tools`, `estimatedMin`, `missionPoints`, `isProjectDay`, `missionType` (DATA_ROOM for kickoff/calibration days, SHIP_IT for build/defense days).
- `concept-questions.json` — 5 multiple-choice concept questions per day (`options`, `correctIndex`, `explanation`).
- `entry-questions.json` — empty. This cohort is recruitment-only for 8–15+ yr candidates; the entrance-exam gate is out of scope (candidates come in via role-card screening, not aptitude/technical MCQs).
- `exercises.json` — empty. Coding-arena drills (Python/SQL snippets) are not the right signal for senior architects; the architecture reasoning shows up in the daily deliverables (ADRs, HLDs, cost models, migration docs, whiteboard defense).
- `videos.json` — per-day YouTube resources (`youtubeId`) — AWS re:Invent talks, Well-Architected walkthroughs, dimensional modeling, Iceberg vs Delta, RAG on Bedrock, migration case studies. **Verify each `youtubeId` before every cohort run** (channel-owner takedowns / re-uploads are common).
- `rubrics.json` — module-level assessment rubrics grouped into 4 milestones (Data Architecture, AWS Solution Design, Solution + Data+AI Architecture, Transformation + Capstone), loaded at grade time.

Verification model: candidates connect a **GitHub repo** (any Git provider works — the seed assumes GitHub) and push architecture artifacts — Excalidraw / draw.io exports, ADR markdown, cost-model spreadsheets, migration docs, decisions logs, the 2-page architecture brief. `missionSpec.repoChecks` verifies committed file paths and content regex; `missionSpec.answers` are single fixed values (number or one word/token), matched case-insensitively — all correct to unlock the next day.

Capstone (Days 9–10) uses the **walking-skeleton** pattern: whiteboard/Excalidraw HLD + LLD sketches, decisions log (top 3 decisions / top 3 risks / top 3 week-1 validations), and a 2-page written architecture brief. Day 10 is the recorded 45-min defense in front of a mock CTO/CDO panel; the panel scores against `rubrics.json` and produces a seniority calibration note.

Naming: Delta Live Tables = **Lakeflow Declarative Pipelines**; Workflows = **Lakeflow Jobs**; AWS Lake House Architecture = **AWS Modern Data Architecture** (the current AWS-preferred term).

Seed via the same `db:seed:program` flow as the Databricks and AI cohorts.
