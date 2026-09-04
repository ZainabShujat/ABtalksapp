# Power BI & Analytics Cohort — content seed

Content JSONs for the **7-Day Power BI & Analytics Recruitment Cohort** (Power BI Desktop + Service, multi-industry rotation, 3–8+ yr candidates). Same seed structure as the Databricks, AI, and Data & Solution Architect cohorts so all of them render and grade identically.

Files:
- `modules.json` — the 6 modules (title, subtitle, color, start/end day).
- `days.json` — per-day mission briefs (`briefMd`) plus server-only `missionSpec` (`answers` for the Submit-your-answers questions and `repoChecks` for GitHub verification), `objectives`, `tools`, `estimatedMin`, `missionPoints`, `isProjectDay`, `missionType` (DATA_ROOM for the kickoff/calibration day, SHIP_IT for build/defense days).
- `concept-questions.json` — 5 multiple-choice concept questions per day (`options`, `correctIndex`, `explanation`).
- `entry-questions.json` — empty. This cohort is recruitment-only for 3–8+ yr candidates; the entrance-exam gate is out of scope (candidates come in via role-card + skills screening, not aptitude/technical MCQs).
- `exercises.json` — empty. Coding-arena drills (isolated Python/SQL snippets) aren't the right signal for a BI developer; the BI craft shows up in the daily deliverables (models, dashboards, DAX pattern library, design critique, performance report, published capstone, dashboard defense).
- `videos.json` — per-day YouTube resources (`youtubeId`) — Power BI modeling, DAX/time intelligence, dashboard design, RLS, Service/performance, and executive storytelling. **`youtubeId` is left `null` — curate and verify each one before every cohort run** (channel-owner takedowns / re-uploads are common).
- `rubrics.json` — module-level assessment rubrics grouped into 4 milestones (Data Modeling, Dashboard Design, Advanced DAX/KPIs/Security, Enterprise BI + Capstone Defense), loaded at grade time.

Verification model: candidates connect a **GitHub repo** (any Git provider works — the seed assumes GitHub) and push BI artifacts — dashboard screenshots (`.png` exports), model docs, DAX measure files, a DAX pattern library, a design critique, a deployment plan, a performance report, the capstone context deck, and the recorded defense link. `missionSpec.repoChecks` verifies committed file paths and content regex; `missionSpec.answers` are single fixed values (number or one word/token), matched case-insensitively — all correct to unlock the next day. (`.pbix` files aren't required in-repo; screenshots + markdown are the graded evidence, since `.pbix` binaries don't diff or verify cleanly.)

Capstone (Days 6–7) uses a **rapid-domain-adaptation** pattern: a new industry scenario is revealed on Day 6 morning (Logistics / Banking / Education / Manufacturing), and the candidate ships a full model → measures → dashboard → published-to-Service in one day. Day 7 is the recorded 30-min dashboard defense in front of a mock VP Analytics / CDO panel; the panel scores against `rubrics.json` and produces a seniority calibration note (BI Developer / Senior BI Developer / Lead / Analytics Manager / Not-Yet-Ready).

Naming: use current Power BI terms — **Power BI Service** (not "Power BI Online"), **semantic model** (the current name for a dataset), **Microsoft Fabric** for the browser-based option Mac/Linux candidates use in place of Desktop.

Seed via the same `db:seed:program` flow as the Databricks, AI, and Architect cohorts.
