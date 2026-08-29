# ABTalks — Helper Chatbot Knowledge Base (LEGACY SNAPSHOT — LOWEST PRECEDENCE)

> **Precedence warning.** This is a site snapshot taken on **10 August 2026**
> and it is the OLDEST source in the corpus. Wherever it disagrees with a
> dedicated topic file — `homepage.md`, `certificates.md`, `hackathon.md`,
> `workshops.md`, `events.md`, `voice-interview.md`,
> `hiring-and-recruiters.md`, `legal-and-privacy.md`, `website.md` — **those
> files win and this one is wrong**. Two known-stale claims in particular:
> its blanket "every flagship program is free for participants" predates the
> current pricing wording (see `legal-and-privacy.md`), and every event or
> registration state it describes is now historical. Never quote a date,
> registration status or price from this file.

**Purpose:** Ground truth for an ABTalks helper chatbot serving four audiences: students, recruiters, working professionals, and investors.
**Sources:** abtalks.in (all public pages) + 60-Day Claude AI Challenge tracker + individual challenge task pages (Days 1–60).
**Currency:** Reflects state as of Aug 10, 2026. Update numbers on `10,000+ members / 500+ projects / 100+ hiring partners` if the site changes.
**Anti-hallucination rule for the bot:** Never invent numbers, testimonial names, program dates, or curriculum items not present in this document. If asked something outside this KB, say so and offer to route to `team@abtalks.in`.

---

## 0. THIRTY-SECOND SUMMARY

ABTalks is an India-focused AI-native learning community, founded by Anil Bajpai, that helps college students and working professionals build public proof of work through daily challenges, cohort programs, and hackathons — then routes the strongest builders to a hiring partner network. Community participation and the flagship programs are free to join. For the precise current wording — the Terms state the service is **currently provided free of charge**, the homepage says most challenges are free with any paid cohort priced up front, and nobody placed through the recruiter network pays a placement fee — see `legal-and-privacy.md`, which supersedes this line. Public tagline: *"Code consistently. Post publicly. Get noticed."* Stated scale: **10,000+ members, 500+ projects, 100+ hiring partners**. Positioning line to remember: **"Not a course. A build challenge."**

Flagship products:
1. **60-Day Claude AI Challenge** — daily prompt-engineering + capstone builds
2. **60-Day Coding Challenge** — Software Engineering / Data Science / AI tracks
3. **31-Day AI Cohort** — production-grade enterprise chatbot in 31 days
4. **Vibe Code Hackathon (ViCodathon)** — 48-hour AI-first hackathon

---

## 1. ORGANIZATION FACTS

- **Name:** ABTalks
- **Founder:** Anil Bajpai *(surfaced on auth pages: "Built by Anil Bajpai's ABTalks community")*
- **Core team member surfaced publicly:** Sarthak Gupta (Founding Member)
- **Location / focus market:** India
- **Website:** https://abtalks.in
- **Contact:** team@abtalks.in
- **Auth:** Google OAuth (single sign-in method site-wide)
- **Tech stack signal:** Next.js on Vercel (deployment IDs visible in HTML)

**Handle across every social platform:** `abtalksonai` / `@ABTalksOnAI`
- Instagram: instagram.com/abtalksonai/
- LinkedIn: linkedin.com/company/abtalks-on-ai/
- YouTube: youtube.com/@ABTalksOnAI
- X: x.com/abtalksonai
- Discord: discord.gg/j4Q8tvDj6
- WhatsApp community: chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi

**Stated headline metrics (site-wide):**
- 10,000+ members
- 500+ projects
- 100+ hiring partners

*(Bot note: these are the ONLY member/project/partner counts to use. Don't cite individual program sub-numbers unless someone asks specifically — internal figures like "~2,400 Claude Challenge participants" are not public-marketing numbers and should not be quoted.)*

---

## 2. CORE POSITIONING & VALUE PROPOSITION

### Master narrative
> "Build in public. Grow together."
>
> India's coding + AI community for college students and professionals to learn, build, and accelerate their careers through **visible proof of work**.

### The three-step model
1. **Learn Daily** — Choose your track and build practical skills through focused challenges and live sessions.
2. **Build & Showcase** — Ship real work, publish your progress, and turn consistent effort into a visible portfolio.
3. **Get Hired** — Stand out through proof of work and become discoverable to recruiters in the ABTalks network.

### Anti-course positioning (used on `/claude-signup`)
> **"Not a course. A build challenge."**

Everything ABTalks ships is oriented around visible artifacts (GitHub commits, deployed URLs, LinkedIn posts, PROMPTS.md files) rather than passive lectures or completion certificates as the primary reward.

### Six narrative levers to reuse
1. **Proof of work over credentials.** Every program terminates in public artifacts, not just a certificate.
2. **Consistency as the outcome.** Streaks, daily cadence, and IST day boundaries are marketed as the transformative variable.
3. **Recruiter visibility as the reward.** All flagships end in "ranked profile / hiring network / recruiter discovery."
4. **India-first, college-first.** Explicit for the hackathon; language and testimonial roster confirm the rest.
5. **Free at point of entry.** The flagships are free to join; see `legal-and-privacy.md` for the current, precise pricing wording, which supersedes this line.
6. **Claude-native.** Anthropic's Claude is the primary AI stack across content, curriculum, and community identity.

---

## 3. PROGRAM PORTFOLIO

Four distinct products. Each has its own tagline, audience, cadence, and success metric — the chatbot should route a user to the right one based on stated goals.

### 3.1 60-Day Claude AI Challenge — `/claude-signup`
- **Status:** Live (launched June 1, 2026)
- **Tagline:** "Master Claude AI in 60 Days"
- **Positioning:** "Not a course. A build challenge."
- **Format:** Daily prompt-engineering task for 50 days + 10-day capstone (build & ship a real product)
- **Cost:** Free
- **Audience:** Anyone — students, working professionals, career switchers
- **Success outcome:** Portfolio of 50 daily interactive artifacts + 1 deployed v1.0.0 product with docs
- **Full curriculum:** See **Section 4**.

**Route this program to:** anyone whose goal is *learning Claude / prompt engineering / building daily* or who wants a habit-forming AI mastery path.

---

### 3.2 60-Day Coding Challenge — `/challenges`
- **Status:** Enrolling now
- **Tagline:** "60 Days. One task a day. A portfolio that speaks."
- **Cost:** Free
- **Tracks (pick one at registration):**
  - **Software Engineering** — Build apps, APIs, and production-ready systems.
  - **Data Science** — Turn raw data into useful analysis and insight.
  - **Artificial Intelligence** — Create practical AI workflows and applications.
- **Daily loop:** Open today's task → Build → Push to GitHub → Post on LinkedIn.
- **Success outcome:** 60 verified public repos + LinkedIn proof-of-work trail → top portfolios get recruiter visibility.
- **Register URL pattern:** `/register?domain=SE` (or `DS`, `AI`) → Google sign-in.

**Community rules (explicit sanctions):**
| Violation | Consequence |
|---|---|
| Foul language, harassment, harmful messaging | **Permanent ban** from ABTalks |
| Plagiarism, platform misuse | **60-day challenge ban** |

**FAQ (verbatim from the page):**
- *Do I need prior experience?* — No. Pick the domain that matches what you want to learn. Tasks build progressively, and each day includes a focused problem and learning resources.
- *What if I miss a day?* — You can continue the challenge, but a missed day breaks your current streak. Submissions follow IST day boundaries.
- *How do I submit my work?* — Push your solution to GitHub, then publish your progress on LinkedIn. Both links become proof of work on your ABTalks profile.
- *Do I get a certificate?* — Completing the challenge gives you a finished public portfolio and completion recognition. The core outcome is visible proof of consistent work.

**Route this program to:** college students who want structured daily coding practice + hireable public portfolio in their chosen domain.

---

### 3.3 31-Day AI Cohort — `/program`
- **Status:** Applications open
- **Tagline:** Production-grade enterprise AI chatbot in 31 days.
- **Cost:** Free (requires cohort join code)
- **Audience:** Students & recent grads · ~2–4 hrs/day for 31 days
- **Prerequisites:** Python fundamentals · SQL & DB fundamentals · Git/GitHub/CLI · REST APIs & backend basics · JavaScript & React fundamentals
- **Requirements:** Laptop with ≥8 GB RAM · GitHub account · Ollama / Groq / Chroma (no paid API keys needed)

**Course roadmap — 8 phases across 31 days:**
| Phase | Days | Title | Focus |
|---|---|---|---|
| 1 | 1–3 | Env & Tooling | Local AI stack, Git, Ollama |
| 2 | 4–6 | Data | Coverage data & structured queries |
| 3 | 7–10 | Embeddings & Vector | Knowledge base + retrieval |
| 4 | 11–15 | LLM & Prompting | Prompting, fine-tune basics |
| 5 | 16–20 | App Build | Streamlit chatbot + FastAPI |
| 6 | 21–24 | Agentic + MCP | Tools, agents, MCP servers |
| 7 | 25–27 | Governance & Eval | Guardrails, evals, safety |
| 8 | 28–31 | Docker / K8s / Prod | Ship to production |

**Cohort flow (4 stages):**
1. **Apply** — Confirm laptop and GitHub setup.
2. **31 days of missions** — Build locally; GitHub artifacts verified.
3. **AI interview** — A real-time voice interview to close it out.
4. **Recruiter visibility** — Ranked profile + build portfolio delivered to hiring partners.

**Route this program to:** anyone whose goal is a *serious AI engineering job* — this is the most technical, prerequisite-heavy program.

---

### 3.4 Vibe Code Hackathon (ViCodathon) — `/hackathon`
- **Status:** Registration closed (last edition ran Aug 7–9, 2026)
- **Format:** 48 hours · Solo or teams of up to 3
- **Eligibility:** Indian college students
- **Cost:** Free
- **Tagline:** "48 hours · No boilerplate · Just you, your ideas, and AI."

**Timeline (last edition):**
| Event | Date/Time (IST) |
|---|---|
| Registration closes | Fri, 7 Aug · 6:00 PM |
| Kickoff | Fri, 7 Aug · 8:00 PM |
| Submission deadline | Sun, 9 Aug · 8:00 PM |
| Winners announced | Fri, 14 Aug |

**Three required deliverables:**
1. **Public GitHub repo** — Full source, cloneable. Private repos not judged.
2. **Live deployed URL** — Vercel/Netlify/any reachable host. README-only demos don't count.
3. **AI-usage log** — `PROMPTS.md` in the repo or exported chat transcripts. This verifies the build was genuinely vibe-coded.

**Judging criteria:** originality, polish, how well you steered the AI.

**Sponsor: Breeth** — memory layer for AI agents. Every participant gets Breeth Pro free.
- Persistent memory, no infra (one API call to save, one to search — no embeddings/vector-DB work required)
- MCP server — plugs into Claude Code and Cursor
- Facts carry reasoning; old beliefs fade when contradicted
- Links: thebreeth.com · docs.thebreeth.com
- Sponsor track prize: **Best use of Breeth**

**Route this program to:** Indian college students who want a short-format competitive AI build event.

---

## 4. 60-DAY CLAUDE AI CHALLENGE — FULL CURRICULUM

This is the flagship product. Every day is a single Claude prompt the participant runs, deploys, and publishes. Days 51–60 form a real-SDLC capstone (Requirements → Design → Setup → Implementation → Testing → Deployment → Maintenance).

### 4.1 Structure at a glance
- **Days 1–7:** Prompt Fundamentals
- **Days 8–15:** Applied Utilities (resumes, jobs, health, portfolio)
- **Days 16–21:** Data & Analytical Apps
- **Days 22–25:** Business & Startup Reasoning
- **Days 26–31:** Healthcare & Ops Simulators
- **Days 32–38:** Learning & Reflection Games
- **Days 39–43:** Productivity Tools
- **Days 44–50:** Advanced Prompting & Systems
- **Days 51–60:** Capstone (real SDLC)

### 4.2 Full 60-day curriculum table

| Day | Title | Focus / Artifact |
|---|---|---|
| 1 | Claude Setup | AI Personality Profile + cinematic portrait |
| 2 | Prompt Engineering | Beginner explainer + LinkedIn image concept |
| 3 | Role-based Prompt | Persona cards, expert-level answers |
| 4 | Chain of Thought | Personalized 4-question career roadmap PDF |
| 5 | Context Engineering | With-context vs without-context comparison |
| 6 | ATS Resume | Optimizer with score before/after + A4 one-pager |
| 7 | Claude AI Guide | Model & effort recommender (Haiku/Sonnet/Opus) |
| 8 | Health Analyzer | Environmental Health Dashboard (AQI, water quality) |
| 9 | Nutrition Analysis | NutriScope MVP + enhancements |
| 10 | Profiling Website | Single-file portfolio with dark/light toggle |
| 11 | Update Resume (JD) | ATS keyword-matched rewrite |
| 12 | Cover Letter/Email | 12-section job-search toolkit |
| 13 | Job Search | 3-stage profile → criteria → discovery |
| 14 | AI Red Flag Generator | JD toxicity + risk scorer |
| 15 | Vedic Horoscope | Parashara-based 5-year forecast |
| 16 | Analyze Any Stock | NSE/BSE fundamental analyzer, no buy/sell calls |
| 17 | EV vs Petrol vs E85 | CSV → SVG dashboard |
| 18 | Custom Skill for Meeting | Brain-dump action planner HTML |
| 19 | FIFA World Cup | Football Intelligence Hub (3-stage) |
| 20 | Face Puzzle | Webcam-based single-file game |
| 21 | Digital Footprint | Privacy dashboard from apps list |
| 22 | Startup Validation | McKinsey-style validation report |
| 23 | MVP Planning | Customer & MVP Blueprint |
| 24 | Startup Future | YC-style business strategy + scorecard |
| 25 | AI Shark Tank | Simulator with 4 judges |
| 26 | Healthcare Workflow | Prior Authorization drag-and-drop sim |
| 27 | Prior Authorization | Rahul & Priya story simulator (8 scenes) |
| 28 | Hospital Operations | Admission Readiness Simulator |
| 29 | AI Supply Chain | "Operation Lifeline" crisis lab |
| 30 | Supply Chain Optimizer | Supply Chain Builder |
| 31 | Supply Chain Control Tower | 3-min alert-response game |
| 32 | Think Like a Marketing Strategist | Brand growth simulator (incl. personal brand mode) |
| 33 | Media Integrity Analyzer | Headline Detective + Emotion Detector |
| 34 | Marketing Detective | Detective-game with 10–20 cases |
| 35 | Prompt Puzzle | Build/Clean/Choose prompt game |
| 36 | Cognitive Pattern Explorer | Thinking-styles self-reflection |
| 37 | Task Compass | Ownership/routing/collaboration 3-stage sim |
| 38 | Typing Speed Studio | Monkeytype-style typing platform |
| 39 | PDF Splitter & Merger | Client-side PDF tools |
| 40 | AI Assistant Builder | Interview-driven Claude-powered assistant |
| 41 | Interactive Learning Studio | 4-module tutorial with quizzes |
| 42 | Personal Financial Command Center | Persona-based finance dashboard |
| 43 | AI Workflow Architect | End-to-end workflow generator |
| 44 | LinkedIn Profile Optimizer | Roast → Rebuild → 7-day activation plan |
| 45 | AI Decision Strategist | 4-question interview → HTML Decision Report |
| 46 | Autonomous Agent Studio | Real multi-agent loop with live API |
| 47 | Content Intelligence Studio | Multi-reviewer content consultant |
| 48 | The Verdict Engine | Compare-and-decide builder with real citations |
| 49 | Personal AI Playbook | Reusable workflow builder (Prompt + Loop) |
| 50 | Defend Your Experience | Skeptical interviewer for résumé claims |
| 51 | Product Discovery & Sprint Planning | PRD + 10-Day Implementation Blueprint + Pitch Deck |
| 52 | System Design | Tech stack, architecture, DB schema, API, wireframes, folder structure |
| 53 | Project Setup & Foundation | Env, repo, dependencies, "Hello World" scaffold |
| 54 | Core Feature Implementation | First milestone-by-milestone build |
| 55 | Continue Core Features | Extend without breaking; free-tools-only constraint locked in |
| 56 | Complete the MVP | Ship a working end-to-end demo, deployed |
| 57 | Product Refinement & UX | Senior designer/engineer polish pass; ZIP-based delivery for large changes |
| 58 | Testing, Debugging & Prod Optimization | Multi-lens QA (QA/Security/Perf); no new features |
| 59 | Launch & Production Readiness | Release Readiness Review; docs, metadata, branding, SEO, license |
| 60 | Final Review, Portfolio & Graduation | v1.0.0 release + portfolio artifacts + Certificate of Completion |

### 4.3 Capstone deep-dive (Days 51–60)

**Framing:** A real software-development lifecycle spread across 10 days, carried inside a single Claude conversation (or re-uploaded blueprint/sprint workbook when context is lost). Free-tier tools only — no paid Anthropic API keys, no paid hosting assumed.

- **Day 51 — Product Discovery & Sprint Planning:** Interview-driven idea selection; produce PRD, 10-Day Implementation Blueprint, and Project Pitch Deck. Optimizes for the *most impressive project shippable in 10 days*, not the most ambitious.
- **Day 52 — System Design:** Finalize tech stack (prefer free), architecture diagrams (Mermaid preferred), DB schema, API endpoints, low-fi wireframes, folder structure. Deliverables: ARCHITECTURE.md, SCHEMA.md, API.md, UI-WIREFRAMES.md, PROJECT-STRUCTURE.md.
- **Day 53 — Project Setup & Foundation:** Env, GitHub repo, dependencies, config, routing scaffold, "Hello World" running. Deliverables: SETUP.md, ENVIRONMENT.md, DAY3-SUMMARY.md.
- **Day 54 — Core Feature Implementation:** Milestone-by-milestone, screenshot-gated. Full file contents only — no snippets, TODOs, or "…existing code…". Debug fully before moving forward.
- **Day 55 — Continue Core Features:** Read prior day's work first; enforce free-tools-only; shift from screenshot-gated to judgment-based pausing. Refactor obvious duplication.
- **Day 56 — Complete the MVP:** Explicit goal: **end today with a fully functional MVP that runs start-to-finish, deployed, and demonstrable to someone else.** Preferred hosts: Vercel, Netlify, Render, Railway. Preferred free APIs: Gemini, Supabase, Firebase.
- **Day 57 — Product Refinement & UX:** Review the working MVP as a Senior Product Designer / UI-UX Designer / Senior Software Engineer. Polish layout, typography, colors, responsiveness, loading/empty/error states, accessibility, micro-interactions. **Don't change the core vision.**
- **Day 58 — Testing, Debugging & Production Optimization:** Review as Senior QA + Senior Software Engineer + Security Reviewer + Performance Engineer. No new features. Bar: "ready to launch publicly tomorrow."
- **Day 59 — Launch & Production Readiness:** Release Readiness Review — deployment, env vars, README, install docs, GitHub repo hygiene, license, project metadata, SEO/OG tags, favicon, error pages, final UI consistency, perf, accessibility, security. End with a **meaningful final launch commit**.
- **Day 60 — Final Review, Portfolio & Graduation:** Review from five lenses (Senior SWE / PM / UI-UX / Recruiter / Open Source Maintainer). Produce:
  - Portfolio-ready README, project descriptions, resume bullets, interview talking points, demo script
  - `future-scope.md` (3/6/12-month evolution)
  - `challenge-retrospective.md` (Day 1–10 timeline, real decisions, real pivots, real debugging)
  - `30-day-growth-plan.md` (day-by-day 30-day roadmap from MVP → complete product)
  - `daily-build-prompt.md` (one reusable prompt for the 30-day plan)
  - **Release Version v1.0.0** on GitHub
  - Premium HTML-to-PDF **Certificate of Completion** (name, project, v1.0.0, date, ABTalks branding, Claude credited as co-creator/mentor, links to abtalks.in + LinkedIn company page)
  - 200-word graduation reflection, single-file HTML graduation infographic, LinkedIn graduation post

**Key constraints across the capstone (memorize for the bot):**
- Only free tools. No paid Anthropic API keys or paid hosting assumed. Anything paid requires explicit user approval.
- One long-running Claude conversation is the intended path; the Blueprint/Sprint Workbook can be re-uploaded if context resets.
- Screenshot-gated on Day 54; judgment-based pausing from Day 55 onward.
- Refinement days do not add scope.

---

## 5. WHAT A GRADUATE CAN ACTUALLY DO (SKILLS MATRIX FOR RECRUITERS)

A student who completes the 60-Day Claude AI Challenge has demonstrably built each of the following as a public, deployed artifact:

**Prompt engineering skills:**
- Role-based prompting, chain-of-thought, context engineering
- Building agentic loops with stop conditions
- Writing production-quality system prompts
- Prompt Puzzle-style deconstruction (build/clean/choose)

**Full-stack shipping skills:**
- Single-file HTML apps with vanilla JS and no external deps
- React-via-CDN artifacts
- Client-side PDF processing
- Client-side webcam and drag-and-drop
- Deployed live URLs on Vercel/Netlify/Render/Railway
- GitHub hygiene: public repos, meaningful commits, README, license, tagged v1.0.0 release

**AI-native product skills:**
- Building assistants that call the Anthropic Messages API (`/v1/messages`) directly from an artifact
- Multi-agent orchestration (Planner/Executor/Evaluator/Critic/Improver)
- Content review pipelines with multi-reviewer agents
- RAG/embeddings knowledge (from AI Cohort track)
- MCP server integration (Claude Code / Cursor)

**Real-world domain reasoning:**
- Startup validation → MVP planning → business strategy → scorecard
- Financial dashboards, stock fundamental analysis
- Healthcare workflows (Prior Auth, Hospital Admission Readiness)
- Supply chain simulation and control tower
- Marketing strategy, content strategy, media literacy

**Career-adjacent skills:**
- ATS resume optimization and JD-alignment
- LinkedIn profile roast/rebuild + 7-day activation plan
- Interview defense (Defend Your Experience app)
- Decision-making frameworks (AI Decision Strategist, Verdict Engine)

**SDLC discipline (from capstone):**
- Requirements → Design → Setup → Implementation → Testing → Deployment → Launch → Retrospective
- Screenshot-gated milestones, judgment-based pausing
- Refinement vs stabilization vs launch as distinct passes
- Producing a versioned v1.0.0 release, not an ambiguous "done-ish" project

**Public artifacts a recruiter can inspect:**
- 50 single-file HTML artifacts, one per day
- 1 deployed v1.0.0 capstone product with README, license, docs
- LinkedIn build log across 60 days
- ABTalks profile with proof-of-work URLs
- (Optional) capstone Certificate of Completion PDF

---

## 6. TESTIMONIAL ROSTER

Real names from the site's testimonial section (60-Day Claude Challenge grads):

| Name | Affiliation | Notable quote-theme |
|------|-------------|---------------------|
| Samridhi Gupta | Axis Institute of Technology and Management, Kanpur | Consistency > content; "I don't just write better prompts, I finish what I start." |
| Vivek | IT Leader · 20+ years | Mid-career reframing; "The challenge may have ended, but my AI journey has just begun." |
| Lakshay | — | AI for real projects, not just Q&A |
| Rida Khan | AI Enthusiast | "This wasn't just a 60-day challenge. It was a journey that taught me consistency can turn uncertainty into achievement." |
| Devpal Singh Anand | — | "AI isn't just something I learn. It's a tool I use to solve meaningful problems." |
| Nandika Sharma | IMS Noida | Prompt engineering as gateway skill |
| Komal Goswami | MPGI Kanpur | "Confidence to solve real-world problems" |
| Yashaswani Singh | AI Enthusiast | Growth mindset framing |
| Divya | Aspiring Software Developer | Prompting, tools, automation, Git & GitHub, real-world projects |

**Bot rule:** Only quote these names/affiliations. Never invent new ones.

---

## 7. FAQs BY AUDIENCE

### 7.1 For STUDENTS

**Q: What's the difference between the 60-Day Coding Challenge and the 60-Day Claude AI Challenge?**
A: The 60-Day Coding Challenge lets you pick a broad domain (Software Engineering / Data Science / AI) and build daily projects in it. The 60-Day Claude AI Challenge is specifically about mastering Claude and prompt engineering, with a 10-day capstone to ship a deployed product. Both are free.

**Q: Which program should I pick if I want a job?**
A: If you already meet the prerequisites (Python, SQL, Git, React basics), the **31-Day AI Cohort** is the most jobs-oriented — it ends in a real-time AI voice interview and recruiter visibility. If you're earlier in your journey, do the **60-Day Coding Challenge** in your target track to build a portfolio first.

**Q: Do I need a laptop with a GPU?**
A: No. The AI Cohort explicitly asks for ≥8 GB RAM only, and uses Ollama / Groq / Chroma — all free-tier / local. No paid API keys required.

**Q: Do I need to know how to code?**
A: For the 60-Day Coding Challenge and AI Cohort, yes — pick the track that matches your current level. For the 60-Day Claude AI Challenge, you can start as a beginner; the daily tasks are prompts you run, not code you write from scratch (though the outputs are apps you'll deploy).

**Q: How do I submit work?**
A: Push your code to GitHub, then post progress on LinkedIn. Both links become proof of work on your ABTalks profile.

**Q: What if I miss a day?**
A: You can keep going, but the missed day breaks your streak. Submissions follow IST day boundaries.

**Q: Do I get a certificate?**
A: You get **completion recognition** and a public portfolio. The 10-Day Capstone Sprint (Days 51–60 of the Claude Challenge) produces a proper printable HTML-to-PDF Certificate of Completion. The core outcome, though, is visible proof of consistent work — that's what recruiters actually look at.

**Q: How much time per day does it take?**
A: 31-Day AI Cohort: ~2–4 hours/day. 60-Day Claude Challenge: varies by task, generally 30–90 min. 60-Day Coding Challenge: designed as "one task a day."

**Q: What are the community rules?**
A: Foul language / harassment → **permanent ban**. Plagiarism or platform misuse → **60-day challenge ban**. Be real, be respectful, ship real work.

**Q: How do I join the community?**
A: WhatsApp community: chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi. Also Discord, LinkedIn, Instagram, YouTube, X — all under `abtalksonai`.

**Q: How do I apply for placements or internships through ABTalks?**
A: Email your resume, cover letter, and anything else relevant (portfolio link, GitHub, LinkedIn, project links) to **team@abtalks.in**. The team reviews applications and routes strong profiles to the hiring partner network. Openings themselves — internships, full-time roles, freelance briefs — are shared inside the **ABTalks WhatsApp community** (chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi), so join it if you haven't already, so you don't miss role announcements.

**Q: Do I need to have finished a program before applying?**
A: No — you can email team@abtalks.in anytime. But a completed program (any of the four) gives you public artifacts to point to in your application, which is exactly the signal recruiters in the network are looking for.

**Q: What should go in the application email?**
A: Resume, cover letter, and links that prove work — GitHub, deployed projects, LinkedIn build log, ABTalks profile, portfolio site. Anything else material to the role you're targeting.

---

### 7.2 For RECRUITERS / HIRING PARTNERS

**Q: What talent does ABTalks produce?**
A: Indian college students and early-career professionals who have shipped 50+ public artifacts + a deployed v1.0.0 product with full SDLC documentation. See **Section 5** for the full skills matrix.

**Q: How do I access candidates?**
A: ABTalks maintains a hiring partner network (stated: 100+ hiring partners). Top portfolios get **exclusive visibility** to partner recruiters. Contact team@abtalks.in to be onboarded. Candidates themselves apply by emailing resume + cover letter + work links to the same address, so profiles come in pre-curated.

**Q: How do openings get to candidates?**
A: Openings shared by partners are announced inside the **ABTalks WhatsApp community**, which is where active candidates already are. That's the primary distribution channel; team@abtalks.in handles the intake side.

**Q: What signal does an ABTalks profile give?**
A: **Consistency** (visible streak across 60+ days), **shipping ability** (deployed URLs, not just repos), **modern AI stack fluency** (Claude, MCP, RAG, agents, prompt engineering), and **SDLC discipline** (versioned releases, docs, retrospectives).

**Q: Are candidates screened?**
A: Each program has verification: GitHub artifact checks (AI Cohort), a real-time AI voice interview at the end (AI Cohort), and community rules that permanently ban plagiarism (all programs).

**Q: What roles are ABTalks graduates suited for?**
A: AI application engineers, prompt engineers, AI product engineers, junior full-stack engineers with AI-native skills, and (for the AI Cohort) production LLM systems engineers with RAG/agents/MCP experience.

**Q: How large is the candidate pool?**
A: 10,000+ community members and 500+ shipped projects as of Aug 2026.

---

### 7.3 For WORKING PROFESSIONALS

**Q: Is ABTalks only for students?**
A: The 60-Day Claude AI Challenge is open to anyone. The 60-Day Coding Challenge is described as "for college students" but the Claude Challenge testimonial roster explicitly includes a 20+ year IT leader (Vivek). The ViCodathon is restricted to Indian college students.

**Q: I already have a job. What do I get out of this?**
A: Structured daily practice with the modern AI stack — Claude, MCP, RAG, agents — plus 50+ shipped artifacts and a deployed capstone product you can point to. Several testimonials come from mid-career professionals repositioning into GenAI.

**Q: Can I do this alongside a full-time job?**
A: Yes. The 60-Day Claude Challenge tasks are typically 30–90 min; the AI Cohort explicitly assumes 2–4 hrs/day for 31 days.

**Q: What's the community like for someone senior?**
A: Public roster includes mid-career professionals (Vivek — 20+ years IT leadership; Devpal Singh Anand). The community is IST-timezone dominant with active WhatsApp/Discord presence.

---

### 7.4 For INVESTORS

**Q: What is ABTalks in one sentence?**
A: An India-focused, community-first AI upskilling platform that turns learners into hireable builders through daily challenges and a curated hiring partner network.

**Q: What's the current stated scale?**
A: 10,000+ members, 500+ projects, 100+ hiring partners. Four flagship programs live. Community distributed across WhatsApp, Discord, LinkedIn, YouTube, Instagram, X — all under one handle (`abtalksonai`).

**Q: What's the business model?**
A: Free at point of entry across the flagships as of this snapshot; `legal-and-privacy.md` carries the current wording and supersedes this answer. Monetization signals visible today: **hiring partner network** (100+ partners) and **event sponsorships** (Breeth sponsored the last ViCodathon, giving free Pro accounts to all participants).

**Q: What's the moat?**
A: 1) **Community depth** — multi-platform, IST-native, single unified handle. 2) **Proof-of-work rail** — every graduate produces public artifacts, giving the platform a permanent LinkedIn-visible growth flywheel. 3) **Claude-native curriculum** — early positioning as the go-to Indian Claude community. 4) **SDLC-grade capstone** — no other Indian AI upskilling program mandates a versioned v1.0.0 release with docs, retrospective, and 30-day growth plan.

**Q: How is it built?**
A: Next.js on Vercel. Google OAuth. Free-tier tooling philosophy runs through the curriculum itself (Ollama, Groq, Chroma, Supabase, Firebase, Vercel, Netlify, Render, Railway) — infrastructure cost per learner is structurally low.

**Q: Founder?**
A: Anil Bajpai (founder). Sarthak Gupta (Founding Member). The founder attribution appears on auth pages: "Built by Anil Bajpai's ABTalks community."

**Q: What's the roadmap signal?**
A: Four flagships shipped and running in parallel by Aug 2026. Capstone framework proves an operator-grade SDLC teaching loop. Sponsored hackathon (ViCodathon + Breeth) demonstrates a repeatable event-sponsorship revenue pathway.

**Q: Are there dependencies or key partnerships to know?**
A: Anthropic (Claude is the primary AI stack — programs are Claude-native). Breeth (sponsor of the last ViCodathon). Vercel (hosting/deployment). Free-tier infra vendors across the curriculum.

---

## 8. COMMUNITY & CULTURE

**Community CTAs on the site:**
- "Join our community for instant updates — Meet builders, get event alerts, and stay accountable."
- Primary CTA: WhatsApp (chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi)

**Cultural signals in the curriculum:**
- "Be real, be respectful, and ship real work."
- Screenshot-gated verification of daily work
- Public LinkedIn posts as required proof
- IST day boundaries as the accountability clock
- Zero tolerance for plagiarism or harassment

**Language & content tone across marketing:**
- Direct, informal, brevity-first
- Anti-course, anti-passive, anti-certificate-farming
- Consistent premium visual aesthetic — references to Stripe, Linear, Vercel, Notion, and Apple appear in the curriculum's own design prompts

---

## 9. SITE MAP

**Public (no login required):**
- `/` — Home
- `/challenges` — 60-Day Coding Challenge
- `/program` — 31-Day AI Cohort
- `/hackathon` — Vibe Code Hackathon (ViCodathon)
- `/claude-signup` — 60-Day Claude AI Challenge

**Auth-walled (Google OAuth):**
- `/login`
- `/register?domain=SE|DS|AI`
- `/program/apply`
- `/hackathon/register`
- (Presumed) `/dashboard`, `/profile`, `/leaderboard`

**External / referenced from the site:**
- WhatsApp community: chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi
- Discord: discord.gg/j4Q8tvDj6
- LinkedIn (company): linkedin.com/company/abtalks-on-ai/
- Instagram: instagram.com/abtalksonai/
- YouTube: youtube.com/@ABTalksOnAI
- X: x.com/abtalksonai

---

## 10. BOT BEHAVIOR GUARDRAILS

**Do:**
- Answer directly and briefly. Match ABTalks' brevity-first tone.
- Route users to the right program based on their stated goal (see the "Route this program to" lines in Section 3).
- Quote the exact community rules and sanctions when asked about conduct.
- Refer people to `team@abtalks.in` for anything commercial or partnership-related.
- **For placement / internship / job questions:** always give both channels — email resume + cover letter + work links to `team@abtalks.in`, and join the WhatsApp community for live opening announcements. Never send just one side.

**Do NOT:**
- Invent member counts, program dates, curriculum items, testimonial names, or founder details not in this document.
- Quote internal-only numbers (e.g. specific per-program participant counts). Use the site-wide 10K / 500 / 100 numbers.
- Promise recruiter placement or income outcomes. The site never does; you shouldn't either.
- Recommend paid tools inside curriculum discussions — the capstone explicitly locks to free-tier tooling.
- Speculate about Anil Bajpai's or Sarthak Gupta's backgrounds beyond what's on the site.
- Provide legal, financial, or medical advice — even though several curriculum apps model those domains, they're educational simulators only.

**When you don't know:** Say so, and offer `team@abtalks.in` for follow-up or point to the specific program page URL.

**Length default:** 2–5 sentences. Expand only when the user asks for detail (e.g., full curriculum, specific day's prompt, phase-by-phase roadmap).

---

## 11. BRAND VOICE GUIDE (for tone matching)

- **Direct.** No hedging, no "I'd love to help you explore…" openings.
- **Confident about the model, humble about the outcome.** "This is a build challenge, not a course" — but never "you'll definitely get a job."
- **Verbs of shipping.** Build, ship, deploy, post, push, publish, release. Not "learn about" / "explore" / "discover."
- **Time-boxed.** Every commitment on the site is exactly numbered (60 days, 31 days, 48 hours, 10 days). Preserve that specificity.
- **No emojis in first replies.** The site itself uses almost no emojis in body copy; only inside curriculum prompts as functional markers (🟢🟡🔴 for status, 🚨 for alerts).
- **India-native but not India-limited.** Use IST for timing. Say "college students" not "undergrads."

---

## 12. CANONICAL CONTACT & LINKS

- **Email:** team@abtalks.in
- **Homepage:** https://abtalks.in
- **LinkedIn (for graduation posts / Certificate of Completion links):** https://www.linkedin.com/company/abtalks-on-ai/
- **Founder attribution line:** "Built by Anil Bajpai's ABTalks community" (appears on auth pages)

---

*End of knowledge base. Keep this file as the single source of truth. When the site changes, update Sections 1, 3, and 9 first — those carry the highest hallucination risk if stale.*
