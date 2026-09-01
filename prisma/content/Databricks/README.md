# Databricks Cohort — content seed

Content JSONs for the **31-Day Databricks Data Engineering Cohort** (healthcare-claims Lakehouse on Databricks Free Edition). Same seed structure as the AI cohort so both render and grade identically.

Files:
- `modules.json` — the 9 modules (phase title, subtitle, color, start/end day).
- `days.json` — per-day mission briefs (`briefMd`) plus server-only `missionSpec` (`answers` for the Submit-your-answers questions and `repoChecks` for GitHub verification), `objectives`, `tools`, `estimatedMin`, `missionPoints`, `isProjectDay`, `missionType` (DATA_ROOM for setup days, SHIP_IT for build days).
- `concept-questions.json` — 5 multiple-choice concept questions per day (`options`, `correctIndex`, `explanation`).
- `entry-questions.json` — entrance exam (APTITUDE + TECHNICAL prerequisites: Python, SQL, data basics).
- `exercises.json` — practice-arena coding exercises (PYTHON / SQL) with `expectedOutput`.
- `videos.json` — per-day YouTube resources (`youtubeId`).
- `rubrics.json` — module-level project grading rubrics, loaded at grade time.

Verification model: learners connect a **Databricks Git folder** to their GitHub repo and push notebooks/SQL/pipeline code/bundle/exports (plus screenshots for visual days). `missionSpec.repoChecks` verifies committed file paths and content; `missionSpec.answers` are single fixed values (number or one word/token), matched case-insensitively — all correct to unlock the next day.

Naming: Delta Live Tables = **Lakeflow Declarative Pipelines**; Workflows = **Lakeflow Jobs**.

Seed via the same `db:seed:program` flow as the AI cohort.
