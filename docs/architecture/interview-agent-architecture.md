# AI Cohort Interview — Technical Architecture

**Status:** source-of-truth for the implementation on branch `interview-agent-2.0` as of 2026-08-29.
**Scope:** the AI Cohort milestone interview (`DAY_15` / `DAY_31`) at `/program/cohort-interview/[blueprint]`.
**Method:** every node, file, function and edge below was read from source. Anything the code does not do is marked **NOT IMPLEMENTED** or **PLANNED / FUTURE**.

> **What this is not.** The legacy *program exit interview* (`src/features/program/interview.ts`, `src/app/actions/program-interview-actions.ts`, `/api/program/interview/session`) is a **separate, older system** that uses the OpenAI Realtime API. It shares no code with the graph documented here. The general 60-day-challenge interview at `/app/interview/page.tsx` is a `redirect("/program/dashboard")` stub — its domain modules (`candidate-context.ts`, `challenge-context.ts`, `resume-context.ts`, `question-rules.ts`, `question-generation.ts`, `evaluation.ts`, `mock/`) are on disk but **not on any production path**.

---

## 0. One-paragraph orientation

A candidate speaks. Audio goes to `/api/interview/stt`, comes back as text, and is submitted through `submitInterviewAnswerAction` — the same Server Action a typed answer uses. The service reloads the frozen plan and the authoritative state from Postgres, and hands one turn to a **LangGraph** graph of **11 nodes**. Exactly one node calls a model, and that model may only *report what it saw*; it may not choose to escalate, may not score, and may not write the question. Deterministic modules (`policy.ts`, `depth.ts`, `state.ts`, `target-planner.ts`, `coverage.ts`) decide what happens next. Evidence is persisted per question (and per escalation rung). At the end, `finalizeInterview` computes every number in pure arithmetic, one LLM call writes prose that must cite real answered question ids, and the assembled document is validated and stored.

---

## Table of contents

1. [Diagram 1 — Complete end-to-end flow](#diagram-1--complete-end-to-end-flow)
2. [Diagram 2 — LangGraph node-by-node flow](#diagram-2--langgraph-node-by-node-flow)
3. [Diagram 3 — Adaptive decision flow](#diagram-3--adaptive-decision-flow)
4. [Diagram 4 — Conversational planner](#diagram-4--conversational-planner)
5. [Diagram 5 — Curriculum / candidate context](#diagram-5--curriculum--candidate-context)
6. [Diagram 6 — Evidence + scoring](#diagram-6--evidence--scoring)
7. [Diagram 7 — Report generation](#diagram-7--report-generation)
8. [Diagram 8 — Voice flow](#diagram-8--voice-flow)
9. [Diagram 9 — Persistence](#diagram-9--persistence)
10. [Diagram 10 — Complete single-turn trace](#diagram-10--complete-single-turn-trace)
11. [Diagram 11 — Interview completion](#diagram-11--interview-completion)
12. [Node reference table](#node-reference-table)
13. [Non-graph components](#non-graph-components)
14. [State flow](#state-flow)
15. [Provider boundaries](#provider-boundaries)
16. [Security / safety boundaries](#security--safety-boundaries)
17. [Not implemented / planned](#not-implemented--planned)
18. [Architecture principle](#architecture-principle)

---

## Diagram 1 — Complete end-to-end flow

Every box carries its real file. `LangGraph` is expanded in Diagram 2.

```mermaid
flowchart TD
    C(["Candidate"])

    subgraph BROWSER["Browser — client components"]
        ROOM["InterviewRoom<br/><code>components/interview/cohort/interview-room.tsx</code>"]
        SESSION["InterviewSession (brief / live / done)<br/><code>components/interview/cohort/interview-session.tsx</code>"]
        MIC["MicCheck<br/><code>components/interview/cohort/mic-check.tsx</code>"]
        TURNM["stepTurn — VAD turn machine<br/><code>features/interview/turn-state.ts</code>"]
    end

    subgraph EDGE["Route handlers (nodejs runtime)"]
        STT["POST /api/interview/stt<br/><code>app/api/interview/stt/route.ts</code>"]
        TTS["POST /api/interview/tts<br/><code>app/api/interview/tts/route.ts</code>"]
    end

    subgraph ACTIONS["Server Actions — <code>app/actions/interview-actions.ts</code>"]
        A1["startInterviewAction"]
        A2["submitInterviewAnswerAction"]
        A3["finishInterviewAction"]
        A4["abandonInterviewAction"]
    end

    subgraph SERVICE["Service + orchestrator"]
        PROV["getInterviewProvider()<br/><code>features/interview/prisma-provider.ts</code>"]
        SVC["startCohortInterview / recordCohortAnswer /<br/>finishCohortInterview / abandonCohortInterview<br/><code>features/interview/service.ts</code>"]
        ORCH["beginInterview / submitAnswer / finalizeInterview<br/><code>features/interview/orchestrator.ts</code>"]
    end

    subgraph GRAPH["LangGraph agent"]
        RUN["runInterviewTurn()<br/><code>features/interview/agent/graph.ts</code>"]
        NODES["11 nodes<br/><code>features/interview/agent/nodes.ts</code>"]
        LLM["InterviewLLM.analyzeAnswer<br/><code>agent/llm/registry.ts</code> → openai / groq / gemini / anthropic / mock"]
    end

    subgraph DET["Deterministic decision layer — no model"]
        POL["routeDecision<br/><code>agent/policy.ts</code>"]
        DEPTH["decideLadderMove / classifyAnswer<br/><code>agent/depth.ts</code>"]
        ADV["advanceTurn<br/><code>features/interview/state.ts</code>"]
        PLAN["selectNextTarget<br/><code>agent/target-planner.ts</code>"]
        COV["competencyCoverage / coverageNeed<br/><code>agent/coverage.ts</code>"]
    end

    subgraph SCORE["Scoring + report — no model touches a number"]
        MS["scoreQuestion / scoreModules<br/><code>features/interview/module-scoring.ts</code>"]
        SC["assessCompetencies / overallFromCompetencies<br/><code>features/interview/scoring.ts</code>"]
        RPT["buildInterviewReport<br/><code>features/interview/report.ts</code>"]
        ASM["assembleReport / filterNarrative / parseReport<br/><code>features/interview/report-assembly.ts</code>"]
        NARR["askForReport<br/><code>features/interview/report-provider.ts</code>"]
    end

    subgraph DB["Postgres — <code>features/interview/repository.ts</code>"]
        GI[("GeneralInterview")]
        IT[("InterviewTurn")]
        IR[("InterviewReport")]
    end

    RV["InterviewReportView<br/><code>components/interview/cohort/report-view.tsx</code>"]
    RPAGE["Report page (Server Component)<br/><code>app/program/(interview)/cohort-interview/[blueprint]/report/page.tsx</code>"]

    C -->|speaks| ROOM
    C -->|or types| ROOM
    SESSION --> ROOM
    MIC --> SESSION
    ROOM <--> TURNM
    ROOM -->|"FormData audio/webm"| STT
    STT -->|"transcribeAnswer + checkLanguage"| ROOM
    ROOM -->|"{interviewId, questionId, answerText}"| A2
    A2 --> PROV --> SVC --> ORCH --> RUN --> NODES
    NODES --> LLM
    NODES --> POL --> DEPTH
    NODES --> ADV --> PLAN --> COV
    NODES -->|"new InterviewState + prompt"| ORCH
    SVC -->|"saveTurn"| GI
    SVC -->|"saveTurn"| IT
    SVC -->|"AnswerTurnData {prompt, question, progress, finished}"| ROOM
    ROOM -->|"{interviewId, line kind}"| TTS
    TTS -->|"audio/mpeg + X-Interview-Line"| ROOM
    ROOM -->|next question audio| C
    ROOM -->|"finished or time-up or exit"| A3
    A3 --> SVC
    SVC --> ORCH --> MS --> SC
    SVC --> RPT --> NARR
    RPT --> ASM
    SVC -->|"completeAttempt"| GI
    SVC -->|"saveReport (validated)"| IR
    RPAGE -->|"getCohortInterviewReport → loadReportForBlueprint"| IR
    RPAGE --> RV --> C
    A1 --> PROV
    A4 --> PROV
```

**Notes on the loop.** One graph invocation handles exactly **one** answer and holds no cross-request memory. The "loop" in the diagram is the candidate speaking again, which arrives as a fresh request. This is what keeps the database authoritative and the whole thing safe on serverless (`graph.ts` header comment).

---

## Diagram 2 — LangGraph node-by-node flow

**Graph definition:** `src/features/interview/agent/graph.ts` → `buildInterviewGraph(llm)`
**Node implementations:** `src/features/interview/agent/nodes.ts`
**Channels:** `InterviewAnnotation` (graph.ts) typed by `InterviewAgentState` (`agent/types.ts`)
**Runtime:** `@langchain/langgraph@1.4.10`, compiled once per `InterviewLLM` instance and cached in a `WeakMap`.
**Execution:** `graph.stream(initial, { streamMode: ["updates","values"] })` — `updates` yields the executed node names into `trace[]`, `values` yields the merged final state.

**11 nodes.** No node is optional; all are registered unconditionally.

```mermaid
flowchart TD
    START(["START"])
    END1(["END"])

    RA["<b>receiveAnswer</b><br/><i>nodes.ts:receiveAnswer</i><br/>guards status + question identity<br/>appendLine(candidate)<br/>→ interviewState, transcript, all counters"]
    AA["<b>analyzeAnswer</b><br/><i>nodes.ts:createAnalyzeAnswer(llm)</i><br/><b>the only LLM call site</b><br/>questionAsAsked + activeQuestionView<br/>+ memory + curriculum + sessionFacts<br/>→ decision: InterviewDecision"]
    RR["<b>routeResponse</b><br/><i>nodes.ts:routeResponse</i><br/>calls <code>routeDecision()</code> (policy.ts)<br/>stages bridge+probe text<br/>→ lastDecision, nextPrompt<br/><i>persists nothing</i>"]

    FU["<b>followUp</b><br/><i>applyFollowUp</i><br/>resolveFollowUpText fallback<br/>→ nextPrompt"]
    ES["<b>escalate</b><br/><i>applyEscalate</i><br/>pass-through of banked rung<br/>no model fallback"]
    NQ["<b>nextQuestion</b><br/><i>applyNextQuestion</i><br/>no-op — text unknown<br/>until state advances"]
    RD["<b>redirect</b><br/><i>applyRedirect</i><br/>redirectLineFor + question restated"]
    RP["<b>repeat</b><br/><i>applyRepeat</i><br/>repeatLineFor + question restated"]
    CL["<b>clarify</b><br/><i>applyClarify</i><br/>resolveClarification + question verbatim"]

    US["<b>updateState</b><br/><i>nodes.ts:updateState</i><br/><b>the only node that writes persisted state</b><br/>classifyAnswer → updateCompetenceSignal + updateCalibration<br/>advanceTurn(...) → budgets, evidence, <b>selectNextTarget</b><br/>mergeEvidence for storage<br/>appendLine(interviewer)"]

    CO["<b>complete</b><br/><i>completeInterview</i><br/>status=COMPLETED<br/>appendLine(closingLineFor)"]

    START --> RA
    RA -->|"guardBranch: state.error set<br/>(not IN_PROGRESS / no open question /<br/>questionId mismatch)"| END1
    RA -->|"guardBranch: analyze"| AA
    AA --> RR

    RR -->|"actionBranch<br/>FOLLOW_UP"| FU
    RR -->|"ESCALATE"| ES
    RR -->|"REDIRECT"| RD
    RR -->|"REPEAT"| RP
    RR -->|"CLARIFY"| CL
    RR -->|"default → NEXT_QUESTION"| NQ

    FU --> US
    ES --> US
    NQ --> US
    RD --> US
    RP --> US
    CL --> US

    US -->|"shouldContinue: complete<br/>(finished OR status COMPLETED)"| CO
    US -->|"shouldContinue: continue"| END1
    CO --> END1
```

### Conditional edges, exactly as declared

| Edge source | Router function | Mapping |
|---|---|---|
| `START` | *(unconditional)* | → `receiveAnswer` |
| `receiveAnswer` | `guardBranch(state)` — `state.error ? "abort" : "analyze"` | `analyze → analyzeAnswer`, `abort → END` |
| `analyzeAnswer` | *(unconditional)* | → `routeResponse` |
| `routeResponse` | `actionBranch(state)` on `state.lastDecision` | `followUp`, `escalate`, `redirect`, `clarify`, `repeat`, **default** `nextQuestion` |
| `followUp` / `escalate` / `nextQuestion` / `redirect` / `repeat` / `clarify` | *(unconditional)* | → `updateState` |
| `updateState` | `shouldContinue(state)` | `complete → complete`, `continue → END` |
| `complete` | *(unconditional)* | → `END` |

### Important structural facts

- **There is no `planner` node.** The conversation planner (`selectNextTarget`) is invoked *inside* `advanceTurn` (`state.ts`), which is invoked by the `updateState` node. It is a function call, not a graph node.
- **`escalate` never invents text.** `routeResponse` stages `[bridgeText, probeText].join("\n\n")` from the policy's banked rung; `applyEscalate` returns `NEXT_QUESTION` with a null prompt if nothing was staged.
- **`redirect` / `repeat` / `clarify` never reach `advanceTurn`.** In `updateState` they take an early branch that only bumps `redirectsAsked` / `repeatsAsked` / `clarificationsAsked` and appends a transcript line. **No evidence is recorded and no question index moves.**
- **A graph-level throw is caught** in `runInterviewTurn` and returned as `{ ok: false }`, leaving persisted state untouched so the candidate can retry.

---

## Diagram 3 — Adaptive decision flow

This is the real precedence order inside `routeDecision` (`agent/policy.ts`), which is checked top-down. Note that REPEAT and CLARIFY are deliberately checked **before** relevance, because a meta-request shares no vocabulary with the question and would otherwise score as OFF_TOPIC.

```mermaid
flowchart TD
    ANS["Candidate answer text"]
    NR{"answerText === NO_RESPONSE_ANSWER?<br/><code>room-lines.ts</code>"}
    LLMC["<b>llm.analyzeAnswer</b> — semantic read only<br/>action ∈ {FOLLOW_UP, NEXT_QUESTION,<br/>REDIRECT, REPEAT, CLARIFY}<br/>evidence: {conceptualFound, practicalFound,<br/>tradeoffsFound, matchedEvidence[], relevance,<br/>flaggedIssues[]}<br/>+ followUpQuestion, acknowledgement,<br/>clarification, simplified, bridge"]
    SYNTH["Synthetic decision: NEXT_QUESTION,<br/>noResponse=true, flag stuck_or_evasive,<br/>no model call"]

    RDEC["<b>routeDecision(question, decision, counters, state)</b><br/><code>agent/policy.ts</code>"]

    R1{"action === REPEAT?"}
    R1Y{"repeatsAsked < MAX_REPEATS_PER_QUESTION (2)"}
    R2{"action === CLARIFY?"}
    R2Y{"clarificationsAsked < MAX_CLARIFICATIONS_PER_QUESTION (2)"}
    R3{"decision.noResponse?"}
    R4{"flaggedIssues has stuck_or_evasive?"}
    R4Y{"consecutiveStuckAnswers === 0<br/>AND scaffold text exists<br/>AND followUpsAsked < budget"}
    R5{"action === REDIRECT<br/>OR flag off_topic<br/>OR relevance === OFF_TOPIC?"}
    R5A{"firstContact?<br/>redirects=0 AND repeats=0 AND followUps=0"}
    R5B{"redirectsAsked < MAX_REDIRECTS_PER_QUESTION (3)"}
    R6{"flaggedIssues has factually_wrong?"}
    R6Y{"followUpsAsked < budget<br/>AND re-approach text exists"}

    LAD["<b>decideLadderMove(question, evidence, state)</b><br/><code>agent/depth.ts</code>"]
    CLS["<b>classifyAnswer</b><br/>matchedEvidence.length vs question.minEvidence<br/>≥ bar → STRONG · = bar-1 and &gt;0 → PARTIAL · else WEAK<br/><b>matchedEvidence === undefined ⇒ fall back to<br/>conceptual/practical/tradeoff axes (UNJUDGED, not MISSED)</b>"]

    STRONG{"STRONG"}
    PARTIAL{"PARTIAL"}
    WEAK{"WEAK"}

    CEIL["escalationCeiling(signal, competency, calibration.level)<br/>weak streak ≥2 → 0 · strong streak ≥2 → 2<br/>ADVANCED → 2 · FOUNDATIONS → 0 · else 1"]
    RUNG{"nextDeepProbe(question, depthLevel)<br/>exists AND escalationsAsked &lt; ceiling?"}

    SCAF["move = SCAFFOLD<br/>probe = nextScaffoldProbe (targets an UNCOVERED item)"]
    PICK["<b>WEAK</b> → banked scaffold first, then model probe<br/><b>PARTIAL</b> → model probe first, then scaffold<br/>fallback: question.followUpPrompt"]
    STRPROBE{"STRONG + model drafted a probe<br/>+ budget left?"}

    OUT_REPEAT(["<b>REPEAT</b> — question stays open, no evidence"])
    OUT_CLAR(["<b>CLARIFY</b> — question stays open, no evidence"])
    OUT_RED(["<b>REDIRECT</b> — question stays open, no evidence"])
    OUT_FU(["<b>FOLLOW_UP</b> — spends follow-up budget"])
    OUT_ESC(["<b>ESCALATE</b> — spends escalation budget, depthLevel+1"])
    OUT_NQ(["<b>NEXT_QUESTION</b> → advanceTurn → selectNextTarget"])

    ANS --> NR
    NR -->|yes| SYNTH --> RDEC
    NR -->|no| LLMC --> RDEC
    RDEC --> R1
    R1 -->|yes| R1Y
    R1Y -->|yes| OUT_REPEAT
    R1Y -->|no| OUT_NQ
    R1 -->|no| R2
    R2 -->|yes| R2Y
    R2Y -->|yes| OUT_CLAR
    R2Y -->|no| OUT_REPEAT
    R2 -->|no| R3
    R3 -->|yes| OUT_NQ
    R3 -->|no| R4
    R4 -->|yes| R4Y
    R4Y -->|yes| OUT_FU
    R4Y -->|no| OUT_NQ
    R4 -->|no| R5
    R5 -->|yes| R5A
    R5A -->|yes| OUT_REPEAT
    R5A -->|no| R5B
    R5B -->|yes| OUT_RED
    R5B -->|no| OUT_NQ
    R5 -->|no| R6
    R6 -->|yes| R6Y
    R6Y -->|yes| OUT_FU
    R6Y -->|no| OUT_NQ
    R6 -->|no| LAD
    LAD --> CLS
    CLS --> STRONG
    CLS --> PARTIAL
    CLS --> WEAK
    STRONG --> CEIL --> RUNG
    RUNG -->|yes| OUT_ESC
    RUNG -->|"no rung / ceiling spent → MOVE_ON"| STRPROBE
    STRPROBE -->|yes| OUT_FU
    STRPROBE -->|no| OUT_NQ
    WEAK -->|"stuck or off_topic → MOVE_ON"| OUT_NQ
    WEAK --> SCAF
    PARTIAL --> SCAF
    SCAF --> PICK
    PICK -->|"budget available"| OUT_FU
    PICK -->|"budget spent / no text"| OUT_NQ
```

**The withheld actions.** `LLM_ACTIONS` (agent/types.ts) is `["FOLLOW_UP","NEXT_QUESTION","REDIRECT","REPEAT","CLARIFY"]`. `ESCALATE` and `COMPLETE` are **deliberately not proposable by a model** — escalation is the adaptive judgment (`depth.ts` owns it) and completion belongs to the budget machine (`state.ts` owns it).

---

## Diagram 4 — Conversational planner

**Files:** `agent/target-planner.ts`, `agent/coverage.ts`, `cohort/concepts.ts`, `cohort/curriculum-context.ts`, invoked from `state.ts:advanceTurn`.

```mermaid
flowchart TD
    ANSTXT["Candidate answer text<br/><i>passed down from the graph:</i><br/>updateState → advanceTurn(..., answerText) → selectNextTarget"]

    subgraph VOCAB["Curriculum vocabulary — <code>cohort/concepts.ts</code>"]
        DAYS["<code>prisma/content/program/days.json</code><br/>build-time import"]
        CCTX["curriculumForDays(dayNumbers)<br/><code>cohort/curriculum-context.ts</code><br/>{dayNumber, title, objectives[≤3], tools[]}"]
        CFD["conceptsForDays → Concept{label, tokens[], days[]}<br/>tools = highest-signal, objectives tokenised"]
        CTOK["<b>conceptTokensForDays(question.sourceRef.sourceDays)</b><br/>Set&lt;token&gt; per candidate target"]
        OVL["<b>topicalOverlap(answerText, targetTokens)</b><br/>hits / max(uniqueWords, MIN_TOKENS_FOR_CONTINUITY=8)<br/>→ continuity ∈ 0..1"]
    end

    subgraph COVERAGE["Coverage state — <code>agent/coverage.ts</code> (derived, never stored)"]
        LFA["levelForAnswer(question, evidence)<br/>matched ≥ expected → STRONG<br/>matched ≥ minEvidence → SUFFICIENT<br/>matched &gt; 0 → PARTIAL · else NOT_ASSESSED<br/><b>matched === undefined ⇒ evidence axes (degraded turn)</b>"]
        CFQ["coverageForQuestion — folds in <code>id@L2</code> / <code>id@L3</code> rung evidence"]
        CC["competencyCoverage(plan, state)<br/>competency = its <b>BEST</b> answer, not its average"]
        CN["coverageNeed(level)<br/>NOT_ASSESSED 1 · PARTIAL 0.85 · SUFFICIENT 0.25 · STRONG 0"]
    end

    subgraph PLANNER["<code>agent/target-planner.ts</code> — pure, deterministic"]
        ASKED["<b>askedIds(plan, state)</b><br/>state.askedQuestionIds, else backfill<br/>plan.questions.slice(0, currentQuestionIndex+1)"]
        REM["<b>remainingTargets</b> = plan.questions − asked<br/><i>a question is never re-selected</i>"]
        SCORE["score = CONTINUITY_WEIGHT(1) × continuity<br/>+ COVERAGE_WEIGHT(0.6) × need<br/>need = min(coverageNeed(competencyLevel), coverageNeed(ownLevel))"]
        INC["<b>incumbent</b> = lowest <code>question.order</code> remaining<br/>(authored order is the DEFAULT, not a fallback)"]
        CHA["<b>challenger</b> = highest score<br/>ties → lower order"]
        MARG{"challenger.score − incumbent.score<br/>≥ REORDER_MARGIN (0.15)?"}
        WIN["TargetChoice {questionId, index, reason, considered[]}"]
    end

    NEXTQ["advanceTurn sets currentQuestionIndex = target.index<br/>askedQuestionIds += target.questionId<br/>resets followUpsAsked / redirects / repeats /<br/>clarifications / depthLevel=1 / escalationsAsked=0"]
    SPOKEN["updateState speaks:<br/>acknowledgement + bridge + <b>next.text verbatim</b>"]

    ANSTXT --> OVL
    DAYS --> CCTX --> CFD --> CTOK --> OVL
    ANSTXT --> ASKED
    LFA --> CFQ --> CC --> CN
    ASKED --> REM --> SCORE
    OVL --> SCORE
    CN --> SCORE
    SCORE --> INC
    SCORE --> CHA
    INC --> MARG
    CHA --> MARG
    MARG -->|yes| WIN
    MARG -->|no → incumbent wins| WIN
    WIN --> NEXTQ --> SPOKEN
```

### The rule, stated plainly

> **The curriculum defines the assessment space.** `plan.questions` comes from the fixed bank for the blueprint (`cohort/question-bank.ts`), scope-asserted at module load, again at plan time (`planner.ts:assertWithinScope`) and a third time at scoring (`module-scoring.ts:assertScopeIntegrity`). The planner can only ever choose **from inside that set** — it cannot invent, widen, or reach outside `plan.questions`.
>
> **The candidate's answers influence the path.** Continuity is measured against the curriculum's own vocabulary, so a candidate who volunteers "chunking" is pulled toward the target that assesses chunking.
>
> **The day number is not the conversational target.** In `concepts.ts` the day is explicitly a *lookup key* only; the topic travels forward. `grounding.ts` makes the same choice for spoken text — it says "In your Retrieval Engine work you pushed rag.py —", never "for Day 11".

### What is *not* in the planner

- **Concept-level coverage is NOT IMPLEMENTED.** Coverage is tracked per **competency** and per **question id** (+ rung), never per concept. `mentionedConcepts()` is exported from `cohort/concepts.ts` but has **no call sites anywhere in `src/` or `scripts/`** — it is a dead export awaiting a concept-coverage feature.
- **Question order is reordered, question text is not.** Only `spokenText` may ever vary (grounding clause, model phrasing); `question.text` is the immutable grading target.

---

## Diagram 5 — Curriculum / candidate context

```mermaid
flowchart TD
    subgraph SOURCES["Database reads — <code>cohort/candidate-context.ts</code> (4 parallel reads, no N+1)"]
        PM["<b>programMember.findUnique</b><br/><code>repositories/legacy/program-member</code><br/>fullName, jobRole, company, yearsExperience,<br/>githubRepoUrl, highestUnlockedDay, cohort.name"]
        PMS["<b>prisma.programMissionSubmission.findMany</b><br/>dayNumber, passed, payload, attemptNumber, createdAt"]
        PP["<b>prisma.programProject.findMany</b><br/>moduleNumber, repoUrl, writeup, aiScore, adminScore"]
        DS["<b>getMemberDayStates(memberId)</b><br/><code>features/program/progression</code>"]
    end

    CCC["<b>CohortCandidateContext</b><br/>progressDay (collectPassSkipSets → getMemberProgressDay)<br/>highestUnlockedDay · passedDays[] · currentModule<br/>moduleProgress[] · submissions[] (SubmittedDay)<br/>projects[] (SubmittedProject, title = 1st line of writeup)<br/>scopeDays (from blueprint) · beyondScopePassedDays"]

    subgraph ELIG["ELIGIBILITY — <code>cohort-eligibility.ts</code> + <code>cohort/eligibility-rules.ts</code>"]
        E1["getBlueprintEligibility → in_progress | taken | locked | ready<br/>missingDaysFor(blueprint, passedDays)<br/><b>EVERY day in scope must have passed:true</b>"]
        E2["assertCanStart — THE gate, re-derived immediately before createAttempt"]
    end

    subgraph GROUND["GROUNDING — <code>cohort/grounding.ts</code> (template only, no model)"]
        G1["groundQuestion(text, question.groundsOn, facts)<br/>repo → 'In your {title} work you pushed {repoRef} —'<br/>submission → 'When you worked through {title} —'<br/>project → 'In your Module N project, {title} —'<br/><b>missing artifact ⇒ NO clause, never a vaguer one</b>"]
        G2["→ PlannedQuestion.spokenText / .grounded / .groundingNote<br/>frozen at plan time, never recomputed per turn"]
    end

    subgraph PHRASE["PHRASING — <code>cohort/generate-phrasing.ts</code> (one LLM call, optional)"]
        P1["describeCandidateWork(context, sourceDays)<br/>+ describeCurriculum(sourceDays)"]
        P2["llm.phraseQuestions (temperature 0.9, one call for whole plan)"]
        P3["<b>choosePhrasing</b> validates each<br/><code>cohort/question-phrasing.ts</code><br/>reject ⇒ authored text · applies to spokenText only"]
    end

    subgraph CONV["CONVERSATIONAL ROUTING"]
        C1["conceptTokensForDays / topicalOverlap → continuity<br/><code>cohort/concepts.ts</code>"]
        C2["curriculumFor(sourceDays) — per-turn LLM context<br/><code>cohort/curriculum-kb.ts</code> reads<br/><code>knowledge/ai-cohort-interview/core-concepts.md</code><br/>cached, capped at 1,400 chars/question"]
        C3["progressContext — <code>cohort/progress-summary.ts</code><br/>frozen into plan.contextSummary, read from the PLAN not the DB"]
    end

    subgraph REPORT["REPORTING"]
        R1["candidate {name, cohort, jobRole, company}<br/>+ progressDay → report.milestone / report.candidate<br/>reloaded at finish by buildCohortCandidateContext"]
    end

    PM --> CCC
    PMS --> CCC
    PP --> CCC
    DS --> CCC
    PMS --> E1 --> E2
    CCC --> G1 --> G2
    CCC --> P1 --> P2 --> P3
    CCC --> C3
    CCC --> R1
    C1 -.->|"reads days.json, not the member"| CONV
    C2 -.->|"reads the knowledge base, not the member"| CONV
```

| Information | Used for eligibility | Used for grounding | Used for conversational routing | Used for reporting |
|---|:--:|:--:|:--:|:--:|
| `ProgramMissionSubmission.passed` per day | ✅ (`missingDaysFor`) | ✅ (`findSubmission`) | ⛔ | indirectly via `progressDay` |
| `payload.repoRef` | ⛔ | ✅ (`artifact: "repo"`) | ⛔ (phrasing prompt only) | ⛔ |
| `ProgramProject.writeup` first line | ⛔ | ✅ (`artifact: "project"`) | ⛔ (phrasing prompt only) | ⛔ |
| `progressDay` / `highestUnlockedDay` | ⛔ (never — availability ≠ completion) | ⛔ | ✅ via `progressContext` (tone only) | ✅ `milestone.progressDay` |
| `beyondScopePassedDays` | ⛔ | ⛔ | ⛔ | ✅ `beyondMilestone[]` (unscored) |
| `days.json` objectives/tools | ⛔ | ⛔ | ✅ continuity scoring + phrasing | ⛔ |
| `core-concepts.md` KB | ⛔ | ⛔ | ✅ per-turn LLM context only | ⛔ |
| `fullName`, `jobRole`, `company`, `cohort` | ⛔ | ⛔ | greeting only (`openingLine`) | ✅ `report.candidate` |

**Explicitly excluded from eligibility** (documented in `eligibility-rules.ts`): `cleanPassCount`, `progressDay`, `highestUnlockedDay`, `getMaxContentDay`, `cohort.endsAt`. Only "every scope day has a PASSED submission" unlocks a blueprint.

---

## Diagram 6 — Evidence + scoring

```mermaid
flowchart TD
    ANS["Candidate answer"]
    LLMJ["llm.analyzeAnswer → InterviewDecision.evidence<br/><code>agent/llm/json-provider.ts:validate</code>"]

    subgraph EXTRACT["Evidence extraction + hardening"]
        SCH["<b>interviewDecisionSchema</b> (zod, agent/types.ts)<br/>matchedEvidence: .max(40).catch([]).default([])"]
        COERCE["<b>coerceMatchedEvidence(raw, expectedCount)</b><br/>1-based → 0-based · out-of-range dropped<br/>splits concatenated ordinals ([123] → 1,2,3) only when<br/>every digit is a valid item and expectedCount ≤ 9<br/><b>worst case: a claim is ignored, never invented</b>"]
        AE["<b>AnswerEvidence</b><br/>conceptualFound · practicalFound · tradeoffsFound<br/>flaggedIssues[] (stuck_or_evasive, no_practical_evidence,<br/>factually_wrong, contradicts_earlier, off_topic)<br/>reasoning · matchedEvidence?[] · relevance?"]
    end

    subgraph KEYS["Evidence keying — <code>agent/depth.ts:activeQuestionView</code>"]
        K1["depthLevel 1 → key = <code>qid</code><br/>checklist = question.expectedEvidence, bar = minEvidence"]
        K2["depthLevel 2 → key = <code>qid@L2</code><br/>checklist = deepProbes[level 2].expectedEvidence<br/>bar = min(DEEP_PROBE_MIN_EVIDENCE 2, len)"]
        K3["depthLevel 3 → key = <code>qid@L3</code>"]
    end

    MERGE["<b>mergeEvidence(prior, next)</b> — <code>evidence.ts</code><br/>axes OR-ed · flaggedIssues unioned<br/><i>stored</i> merged; <i>routing</i> uses the RAW turn evidence"]

    PERSIST["state.evidenceByQuestionId[key]<br/>→ GeneralInterview.state + .evidence (projection)<br/>→ InterviewTurn.evidence (per-turn, null for REDIRECT/REPEAT)"]

    subgraph QS["Per-question score — <code>module-scoring.ts:scoreQuestion</code>"]
        J{"answered = core evidence exists?<br/><b>judged</b> = answered AND core.matchedEvidence !== undefined"}
        Z["score 0, cleared false, <b>judged:false</b><br/><i>excluded from every aggregate</i>"]
        CALC["cleared = matched ≥ minEvidence<br/>cleared → 70 + 30 × (matched−min)/(expected−min)<br/>below → 70 × (matched/min)<br/>+ 5 per cleared rung, capped at 100"]
    end

    MODS["<b>scoreModules(plan, state, scopeDays)</b><br/>CORE only · mean of answered AND judged<br/><b>null (not 0) when unassessed</b>"]
    COMPS["<b>assessCompetencies</b> — <code>scoring.ts</code><br/>mean of judged CORE scores per competency<br/>COMMUNICATION derived transcript-wide<br/>(<code>evidence.ts:deriveCommunicationTier</code>)"]
    OVER["<b>overallFromCompetencies</b><br/>Σ(score × weight) / TOTAL_RUBRIC_WEIGHT<br/><code>features/interview/rubric.ts</code>"]
    TEN["<b>toTen(score)</b> — <code>report-analysis.ts</code><br/>report.overall.scoreOutOfTen"]

    ANS --> LLMJ --> SCH --> COERCE --> AE
    AE --> K1 & K2 & K3
    K1 & K2 & K3 --> MERGE --> PERSIST
    PERSIST --> J
    J -->|"UNJUDGED"| Z
    J -->|"judged"| CALC
    CALC --> MODS & COMPS
    Z -.->|"excluded, not zeroed"| COMPS
    COMPS --> OVER --> TEN
```

### Why `qid` / `qid@L2` / `qid@L3` are separate keys

An escalation rung carries **its own expected-evidence checklist**. Rung and core checklists are different index spaces, so merging them would make `matchedEvidence: [1]` ambiguous about which checklist item it refers to (`depth.ts:activeQuestionView` comment). It also fixed a real defect: judging a level-2 answer against the level-1 checklist scored a perfect answer as zero, because the candidate was being marked against a question nobody asked them.

`coverageForQuestion` reads rung keys back to upgrade coverage (`SUFFICIENT` + a cleared rung → `STRONG`), and `scoreQuestion` awards `DEPTH_BONUS_PER_RUNG = 5` per cleared rung.

### UNJUDGED ≠ MISSED

```mermaid
flowchart LR
    A["evidence.matchedEvidence = <b>[]</b>"] --> A1["The evaluator looked and found nothing.<br/><b>A real zero.</b> judged = true."]
    B["evidence.matchedEvidence = <b>undefined</b>"] --> B1["Nothing judged this answer:<br/>provider outage → deterministic fallback,<br/>or an attempt persisted before the field existed.<br/><b>No verdict exists.</b> judged = false."]

    A1 --> C["counts in module score,<br/>competency mean, overall"]
    B1 --> D["score 0 as a placeholder,<br/><b>excluded from every aggregate</b><br/>module → null + note<br/>competency → 'evaluator was unavailable'<br/>classifyAnswer falls back to evidence axes<br/>levelForAnswer falls back to evidence axes"]
    D --> E["<b>assessIntegrity()</b> — report-analysis.ts<br/>unjudgedRatio vs turnRatio, max wins<br/>≥0.5 → DEGRADED · &gt;0 → PARTIALLY_DEGRADED<br/>else NORMAL"]
    E --> F["report.assessmentStatus + human-readable note"]
```

**A low score is not degraded.** `assessIntegrity` exists to keep the two apart: a candidate can answer poorly and receive a clean, valid, low assessment. Degradation means the *system* failed.

---

## Diagram 7 — Report generation

```mermaid
flowchart TD
    subgraph INPUTS["Inputs — <code>report.ts:BuildReportInput</code>"]
        I1["plan (frozen InterviewPlan)"]
        I2["state (final InterviewState)"]
        I3["turns: TurnRow[] — <b>required</b><br/><code>repository.ts:loadTurns</code><br/>deep-probe answers + per-turn degraded flags live ONLY here"]
        I4["blueprint, scopeDays (scopeDaysFor)"]
        I5["candidate {name, cohort, jobRole, company}, progressDay, durationSec"]
        I6["QUESTION_BANK_VERSION"]
    end

    subgraph DETPART["🟩 DETERMINISTIC — <code>report-assembly.ts</code> + <code>report-analysis.ts</code> + <code>module-scoring.ts</code> + <code>scoring.ts</code>"]
        D0["assertScopeIntegrity(plan, scopeDays) — 3rd and final scope check"]
        D1["scoreQuestion × CORE → coreScores"]
        D2["assessCompetencies → overallFromCompetencies → overall.score / scoreOutOfTen / readiness / tier"]
        D3["scoreModules → buildModuleReports"]
        D4["buildQuestionAssessments(plan, state, turns) → probes nested per question"]
        D5["classifySkills → SkillAssessment[] (STRONG/DEVELOPING/WEAK/NOT_DEMONSTRATED/NOT_ASSESSED)"]
        D6["buildAgentInsights · selectTranscriptExcerpts · assessIntegrity"]
        D7["evidence[] rows (verbatim answerExcerpt, matched[], missing[])"]
        D8["beyondMilestone[] — EXTENSION questions, <b>never scored</b>"]
        D9["deterministicNarrative(plan, coreScores) — fallback strengths/improvements"]
    end

    subgraph LLMPART["🟨 LLM-GENERATED NARRATIVE ONLY — <code>report.ts</code> (exactly one call)"]
        L1["NARRATIVE_SYSTEM_PROMPT<br/><i>'You are NOT given scores and must never state, guess, or imply one.'</i>"]
        L2["buildNarrativeUserMessage: answered CORE questions only<br/>asked · candidate's own words (≤420 chars) · Covered · Missed<br/><b>excluded: every score, module/competency numbers, extensions</b>"]
        L3["askForReport — <code>report-provider.ts</code><br/>OpenAI gpt-4o → Groq gpt-oss-120b → Claude · temperature 0.3<br/>429 handling with retry-after"]
        L4["strengths[] · improvements[] · summary · recommendation<br/>each item MUST carry evidenceRefs (question ids)"]
    end

    TRACE["<b>filterNarrative(items, answeredIds)</b> — report-assembly.ts<br/>keep only refs that resolve to an ANSWERED question<br/><b>an item left with zero refs is DELETED</b>"]
    DAYS["improvements[].suggestedDays are NOT from the model —<br/>read off the cited questions' own sourceRef.sourceDays"]

    ASM["<b>assembleReport()</b> → InterviewReportDocument (version 2)<br/>narrativeDegraded = degraded OR strengths empty OR improvements empty"]
    VAL["<b>parseReport → interviewReportSchema</b><br/><code>lib/validations/interview.ts</code>"]
    SAVE["saveReport — validates on WRITE, upsert on interviewId<br/>ownership checked via GeneralInterview.memberId"]
    IR[("InterviewReport<br/>{version, overallScore, report Json, narrativeDegraded, generatedAt}")]
    LOAD["loadReport / loadReportForBlueprint<br/><b>validates on READ too</b> — an old shape degrades to 'no report'"]
    UI["InterviewReportView (Server Component render, no client JS)<br/><code>components/interview/cohort/report-view.tsx</code>"]

    INPUTS --> DETPART
    INPUTS --> L2
    D0 --> D1 --> D2
    D1 --> D3
    I3 --> D4 --> D5 --> D6
    D1 --> D9
    L1 --> L3
    L2 --> L3 --> L4 --> TRACE
    L4 --> DAYS --> ASM
    TRACE --> ASM
    D2 & D3 & D4 & D5 & D6 & D7 & D8 --> ASM
    D9 -.->|"used when the model produced nothing usable"| ASM
    ASM --> VAL --> SAVE --> IR --> LOAD --> UI
```

### The anti-hallucination / traceability mechanism

```mermaid
flowchart LR
    N["narrative claim<br/>{ text, evidenceRefs: ['d15-q4', 'd15-q9'] }"]
    Q{"ref ∈ answeredIds?<br/>answeredIds = coreScores.filter(s ⇒ s.answered)"}
    KEEP["ref RETAINED"]
    DROP["ref DROPPED"]
    EMPTY{"item has 0 surviving refs?"}
    DEL["<b>item removed entirely</b>"]
    OUT["item kept with filtered refs"]
    FB["strengths/improvements empty ⇒<br/>deterministicNarrative substituted<br/>+ narrativeDegraded = true"]

    N --> Q
    Q -->|yes| KEEP --> EMPTY
    Q -->|no| DROP --> EMPTY
    EMPTY -->|yes| DEL --> FB
    EMPTY -->|no| OUT
```

The model is shown the candidate's words and the covered/missed checklist. It is shown **no score at all**. Every number in the document — overall, out-of-ten, readiness, tier, module scores, competency scores, skill levels, agent insights, integrity status — comes from `report-assembly.ts` / `report-analysis.ts` / `module-scoring.ts` / `scoring.ts`, which import no provider and make no network call. **The model does not generate scores at any point in the system.**

---

## Diagram 8 — Voice flow

**The current architecture is TURN-BASED. Barge-in / Realtime is NOT IMPLEMENTED.** `voice.ts`'s header states the reason explicitly: Realtime would hand the conversation to the model, bypassing the question bank, the depth ladder and `policy.ts` — which are the things that make the interview comparable between candidates.

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant R as InterviewRoom (client)
    participant TM as stepTurn (turn-state.ts)
    participant TTS as POST /api/interview/tts
    participant V as voice.ts (server-only)
    participant STT as POST /api/interview/stt
    participant LG as language-gate.ts
    participant A as submitInterviewAnswerAction

    Note over R,V: SPEAKING — the interviewer's turn
    R->>TTS: { interviewId, line: "latest"|"waiting"|"retry"|"repeat"|<br/>"time_up"|"language"|"moving_on", variant }<br/><b>NO text field exists in the schema</b>
    TTS->>TTS: isTtsConfigured() → 503 if not
    TTS->>TTS: resolveInterviewMemberId() → 403 if not enrolled
    TTS->>V: resolveSpeakableLine(interviewId, memberId, kind, variant)
    V->>V: composes from DB (last interviewer transcript line /<br/>getCurrentQuestion) or from room-lines.ts constants
    V->>V: synthesizeLine(text, safetyIdentifier)<br/>OpenAI gpt-4o-mini-tts voice "ash" (INTERVIEW_TTS_VOICE)<br/>or Groq canopylabs/orpheus-v1-english if INTERVIEW_TTS_MODEL set
    V-->>TTS: audio/mpeg ArrayBuffer
    TTS-->>R: 200 audio/mpeg<br/>X-Interview-Line: base64(exact words)<br/>Cache-Control: no-store, private
    alt TTS unavailable / non-ok / timeout
        R->>R: window.speechSynthesis fallback (SpeechSynthesisUtterance)
    end
    R->>C: audio + progressive text reveal
    R->>R: phase = "speaking" — microphone closed

    Note over C,TM: LISTENING — the candidate's turn
    R->>R: startRecording() — getUserMedia + MediaRecorder(audio/webm;codecs=opus)
    R->>TM: one AnalyserNode RMS frame per animation frame
    TM->>TM: WAITING_FOR_SPEECH → CANDIDATE_SPEAKING → CANDIDATE_PAUSED<br/>SPEECH_ON_RMS 0.018 / SPEECH_OFF_RMS 0.012 / SPEECH_SUSTAIN_MS 180
    alt no speech for NO_ANSWER_MS (4.5s)
        TM-->>R: effect "nudge" → speak(WAITING_LINES[variant], "waiting")
    else second silence
        TM-->>R: effect "moveOn" → send(NO_RESPONSE_ANSWER)
    else silence for INTERVIEW_SILENCE_MS (10s) after speech
        TM-->>R: effect "finalize"
    end
    R->>R: stopRecording() → Blob

    Note over R,LG: TRANSCRIBING
    R->>STT: FormData { audio: blob }
    STT->>STT: <b>auth BEFORE reading the body</b> → 403
    STT->>STT: rejectAudioUpload(size, type) → 413 / 415 (voice-contract.ts)
    STT->>STT: WebM EBML magic check (1a45dfa3) → 422 on headless container
    STT->>V: transcribeAnswer(blob, filename, safetyIdentifier)
    V->>V: OpenAI whisper-1 (verbose_json) or Groq whisper-large-v3<br/>temperature 0 · TRANSCRIPTION_VOCABULARY_HINT · no language pin<br/>timeout 180s
    V-->>STT: { text, language } — 422 if empty
    STT->>LG: checkLanguage(text, language) — NON_LATIN_RATIO 0.3
    STT-->>R: { ok: true, data: { text, english } }
    alt english === false
        R->>R: speak(LANGUAGE_RETRY_LINE, "language") and re-open the mic<br/>(max MAX_LANGUAGE_RETRIES_PER_QUESTION = 1)
    end

    Note over R,A: SAME PIPELINE AS TYPED TEXT
    R->>A: submitInterviewAnswerAction({ interviewId, questionId, answerText })
    A-->>R: AnswerTurnData { prompt, question, action, finished, progress }
    R->>R: phase = "speaking" → loop back to the TTS step
```

### Voice facts

| Concern | Implementation |
|---|---|
| STT provider | `voice.ts:sttVendor()` — **OpenAI** if `OPENAI_API_KEY`, else **Groq**, else `null` (503). Model: `INTERVIEW_STT_MODEL` ?? `whisper-large-v3` (Groq) / `whisper-1` (OpenAI). |
| Why `whisper-1` not `gpt-4o-transcribe` | Documented in `voice.ts`: gpt-4o transcribe models reject `audio/webm;codecs=opus`, and only Whisper supports `verbose_json`, which carries the detected language the gate prefers. |
| TTS provider | OpenAI `gpt-4o-mini-tts`, voice `ash`. Groq `canopylabs/orpheus-v1-english` **only if `INTERVIEW_TTS_MODEL` is set** (the model terms require org-admin acceptance). |
| TTS fallback | **Client-side** `window.speechSynthesis` — same words, since they come from the server transcript. |
| Second conversational AI | **NONE.** There is exactly one reasoning path. STT and TTS are transport. `voice.ts` header: *"voice must not become a second interview implementation that drifts from the first."* |
| Barge-in / interruption | **NOT IMPLEMENTED.** The microphone is closed while `phase === "speaking"`. Turn ownership is a strict state machine (`turn-state.ts`). |
| Realtime API | **Not used here.** Only the legacy program exit interview (`/api/program/interview/session`) mints Realtime client secrets. |
| Answer cap | `MAX_ANSWER_MS = 180_000`; server `TRANSCRIBE_TIMEOUT_MS = 180_000`, `REQUEST_TIMEOUT_MS = 120_000` for synthesis; client `PROCESSING_WATCHDOG_MS = 90_000`. |

---

## Diagram 9 — Persistence

```mermaid
erDiagram
    ProgramMember ||--o{ GeneralInterview : "memberId (cascade)"
    GeneralInterview ||--o{ InterviewTurn : "interviewId (cascade)"
    GeneralInterview ||--o| InterviewReport : "interviewId unique (cascade)"

    GeneralInterview {
        String id PK
        String memberId FK
        InterviewBlueprint blueprint "DAY_15 | DAY_31"
        GeneralInterviewStatus status "NOT_STARTED|IN_PROGRESS|COMPLETED|ABANDONED|INVALID"
        Json plan "frozen at open: questions, rubricSnapshot, contextSummary"
        Json state "AUTHORITATIVE runtime InterviewState"
        Json transcript "read-optimized projection of state.transcript"
        Json evidence "read-optimized projection of state.evidenceByQuestionId"
        IntArray scopeDays "provenance only, never read for eligibility"
        Int conceptualScore "denormalized"
        Int practicalScore "denormalized"
        Int problemSolvingScore "denormalized"
        Int technicalDepthScore "denormalized"
        Int communicationScore "denormalized"
        Int overallScore "denormalized"
        String summary "copied from report.summary"
        Int durationSec "server-derived from startedAt"
        String invalidReason
        DateTime startedAt
        DateTime endedAt
        DateTime evaluatedAt
    }

    InterviewTurn {
        String id PK
        String interviewId FK
        Int turnIndex "unique per interview, monotonic"
        String questionId "CORE bank id; rungs share it"
        String tier "CORE | EXTENSION"
        Int depthLevel "1 = banked question, 2+ = rung"
        String action "NEXT_QUESTION|FOLLOW_UP|ESCALATE|REDIRECT|REPEAT|CLARIFY|COMPLETE"
        String promptText "verbatim, sliced to 4000"
        String answerText "verbatim, sliced to 8000"
        Json evidence "AnswerEvidence; NULL for REDIRECT/REPEAT"
        Boolean degraded "model failure forced the deterministic path"
        Int latencyMs
    }

    InterviewReport {
        String id PK
        String interviewId FK "UNIQUE — one report per interview"
        Int version "INTERVIEW_REPORT_VERSION = 2"
        Int overallScore "denormalized for listing"
        Json report "full InterviewReportDocument"
        Boolean narrativeDegraded
        DateTime generatedAt
    }
```

### Lifecycle and write/read validation boundaries

```mermaid
flowchart TD
    S0["startCohortInterview"]
    S1["abandonStaleAttempts(memberId, COHORT_INTERVIEW_STALE_MS 1h)<br/>→ IN_PROGRESS older than cutoff becomes ABANDONED"]
    S2["findActiveAttemptId → closeAttemptWithoutConsuming('ABANDONED')<br/><b>interviews are deliberately NOT resumable</b>"]
    S3["gateStart → assertCanStart (re-derived from DB)"]
    S4["buildCohortPlan (context → phrasing → planCohortInterview)"]
    S5["beginInterview → opening line + first question appended"]
    S6["<b>createAttempt</b> — INSERT status IN_PROGRESS, plan/state/transcript/evidence/scopeDays/startedAt"]

    T1["recordCohortAnswer per turn"]
    T2["<b>saveTurn</b> — <code>updateMany WHERE status='IN_PROGRESS'</code><br/>a late turn is a NO-OP, not a resurrection"]
    T3["InterviewTurn.create — only if updated.count > 0<br/>P2002 duplicate turnIndex → warn + swallow (replay-safe)<br/>any other error → log + swallow (losing an audit row beats losing the interview)"]

    F1["finishCohortInterview → finalizeInterview"]
    F2{"durationSec ≥ 180s OR answered CORE ≥ 3?"}
    F3["<b>closeAttemptWithoutConsuming('INVALID', reason)</b><br/>milestone NOT consumed"]
    F4["buildInterviewReport (report generated BEFORE commit)"]
    F5["<b>completeAttempt</b> — <code>updateMany WHERE status='IN_PROGRESS'</code><br/>count 0 → NOT_OPEN · P2002 → ALREADY_TAKEN<br/><i>partial unique index</i> GeneralInterview_one_completed_per_blueprint<br/><i>ON (memberId, blueprint) WHERE status='COMPLETED'</i>"]
    F6["<b>saveReport</b> — parseReport on WRITE, ownership check, upsert<br/><b>failure is non-fatal</b>: interview stays COMPLETED and scored"]
    F7["loadReport / loadReportForBlueprint — <b>parseReport on READ</b><br/>old shape → null → 'No report is available'"]

    S0-->S1-->S2-->S3-->S4-->S5-->S6-->T1-->T2-->T3
    T3-->F1-->F2
    F2-->|no|F3
    F2-->|yes|F4-->F5-->F6-->F7
```

**Every repository function is scoped by `memberId` inside the `WHERE` clause**, so another member's interview id is indistinguishable from a nonexistent one.

---

## Diagram 10 — Complete single-turn trace

One candidate answer, end to end.

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant R as InterviewRoom
    participant SA as submitInterviewAnswerAction<br/>(interview-actions.ts)
    participant PR as prisma-provider.answer
    participant SV as recordCohortAnswer<br/>(service.ts)
    participant DB as repository.ts / Postgres
    participant OR as submitAnswer<br/>(orchestrator.ts)
    participant G as runInterviewTurn<br/>(agent/graph.ts)
    participant N as graph nodes<br/>(agent/nodes.ts)
    participant M as InterviewLLM<br/>(agent/llm/*)
    participant P as routeDecision<br/>(agent/policy.ts)
    participant D as depth.ts
    participant ST as advanceTurn (state.ts)<br/>+ selectNextTarget

    C->>R: speaks / types
    R->>SA: { interviewId, questionId, answerText }
    SA->>SA: resolveInterviewMemberId() — session only, no payload input
    SA->>SA: submitInterviewAnswerSchema.safeParse (zod)
    SA->>PR: answer(memberId, interviewId, questionId, answerText)
    PR->>SV: recordCohortAnswer(...)
    SV->>DB: loadActiveAttempt(interviewId, memberId, status IN_PROGRESS)
    DB-->>SV: { id, blueprint, plan, state, startedAt } or null → "no longer in progress"
    SV->>DB: nextTurnIndex(interviewId) [started, NOT awaited yet]
    SV->>OR: submitAnswer(plan, state, questionId, answerText,<br/>{ interviewId, blueprint, minutesLeft from persisted startedAt })
    OR->>OR: resolveInterviewLLM() (registry.ts, config only)
    OR->>G: runInterviewTurn(llm, RunTurnInput)
    G->>G: build InterviewAgentState from plan + persisted state<br/>maxFollowUps = followUpBudgetFor(openQuestion)
    G->>N: stream(initial, ["updates","values"])

    rect rgb(240,246,255)
    N->>N: <b>receiveAnswer</b> — status IN_PROGRESS? question id matches server?<br/>appendLine("candidate", text, question.id)
    alt guard fails
        N-->>G: error set → END → { ok:false }, persisted state untouched
    end
    end

    rect rgb(255,250,235)
    N->>N: <b>analyzeAnswer</b> — questionAsAsked(question, depthLevel)<br/>activeQuestionView → evidenceKey
    alt answerText === NO_RESPONSE_ANSWER
        N->>N: synthetic decision, NO model call
    else
        N->>M: analyzeAnswer({ question, answerText, priorEvidence,<br/>followUpsRemaining, recentTranscript, calibratedLevel,<br/>memory (memory.ts), curriculum (curriculum-kb.ts),<br/>sessionFacts, nextQuestionText, progressContext })
        M->>M: askJson → zod validate → coerceMatchedEvidence<br/>1 retry with STRICT_JSON_REMINDER<br/>on total failure: fallbackDecision (heuristics.ts, degraded:true)
        M-->>N: InterviewDecision (never throws, never rejects)
    end
    end

    rect rgb(245,240,255)
    N->>P: <b>routeResponse</b> → routeDecision(questionAsAsked, decision, counters, state)
    P->>D: classifyAnswer / decideLadderMove / escalationCeiling / nextScaffoldProbe
    D-->>P: LadderMove ESCALATE | SCAFFOLD | MOVE_ON
    P-->>N: PolicyOutcome { action, rationale, probeText?, probeLevel?, bridgeText? }
    N->>N: stage nextPrompt (ESCALATE = bridge + banked rung)<br/>log when applied ≠ proposed
    end

    N->>N: <b>branch node</b> followUp | escalate | nextQuestion | redirect | repeat | clarify

    rect rgb(240,255,244)
    alt REDIRECT / REPEAT / CLARIFY
        N->>N: <b>updateState</b> — bump only that counter, appendLine(interviewer)<br/><b>no evidence, no index move</b>
    else FOLLOW_UP / ESCALATE / NEXT_QUESTION
        N->>N: classifyAnswer(raw evidence) → updateCompetenceSignal + updateCalibration
        N->>ST: advanceTurn(plan, state, questionId, evidence, proposed, evidenceKey, answerText)
        ST->>ST: consecutiveStuckAnswers; ≥3 → END_INTERVIEW
        ST->>ST: budget checks → FOLLOW_UP / ESCALATE (depthLevel+1)
        ST->>ST: else <b>selectNextTarget(plan, next, answerText)</b><br/>continuity × 1 + need × 0.6, REORDER_MARGIN 0.15
        ST-->>N: { state, action }
        N->>N: mergeEvidence(prior, next) for STORAGE; raw evidence drove ROUTING
        N->>N: appendLine(interviewer, acknowledgement + bridge + next.text verbatim)
    end
    end

    N->>N: <b>shouldContinue</b> → "complete" → <b>complete</b> node (closingLineFor) | "continue" → END
    N-->>G: final merged state + trace[] of executed node names
    G-->>OR: { state, action, prompt, questionId, finished, degraded, proposed, trace }
    OR-->>SV: TurnResult { state, action, nextPrompt, nextQuestion, finished, degraded }

    SV->>SV: build TurnRecord (await turnIndexPromise)<br/>evidence null for REDIRECT/REPEAT, else state.evidenceByQuestionId[qid or qid@Ln]
    SV->>DB: saveTurn(interviewId, memberId, state, record)<br/>updateMany guarded on IN_PROGRESS; InterviewTurn.create
    SV->>SV: logger.info "[interview] turn latency" { llmMs, persistMs, serverMs }
    SV-->>R: AnswerTurnData { isFollowUp, action, prompt, question (ClientQuestion),<br/>finished, progress: coreProgressFor(plan, state) }
    R->>R: append prompt to transcript, setQuestion, setProgress
    R->>C: void speak(prompt) → /api/interview/tts → audio
```

**`ClientQuestion` deliberately excludes** `expectedEvidence`, `minEvidence`, `deepProbes`, `scaffoldProbes` and the rubric — revealing the checklist would let candidates recite it back (`service.ts:toClientQuestion`).

---

## Diagram 11 — Interview completion

```mermaid
flowchart TD
    TRIG["Termination triggers"]

    T1["<b>Graph-internal</b>: advanceTurn returns END_INTERVIEW<br/>· selectNextTarget returns questionId null (all targets assessed)<br/>· consecutiveStuckAnswers ≥ STUCK_ANSWERS_BEFORE_EARLY_END (3)<br/>→ shouldContinue → <code>complete</code> node → finished:true"]
    T2["<b>Room timer</b>: remainingSec === 0<br/>COHORT_INTERVIEW_DURATION_SEC 900<br/>speak(TIME_UP_LINE,'time_up') then finish"]
    T3["<b>Candidate exit</b> — 'End interview' dialog"]

    FIN["<b>finishInterviewAction</b> → finishCohortInterview"]
    ABD["<b>abandonInterviewAction</b> → abandonCohortInterview<br/>closeAttemptWithoutConsuming('ABANDONED')"]

    HALF{"progress.ratio ≥ 0.5?<br/>coreProgressFor: answered CORE / total CORE"}

    LOAD["loadActiveAttempt (must still be IN_PROGRESS)"]
    DUR["durationSec = now − persisted startedAt<br/><b>never a client input</b>"]
    FINAL["<b>finalizeInterview</b> — orchestrator.ts, NO model"]
    GATE{"durationSec ≥ COHORT_INTERVIEW_MIN_DURATION_SEC (180)<br/><b>OR</b> answered CORE ≥ COHORT_INTERVIEW_MIN_ANSWERED_CORE (3)"}
    INV["<b>closeAttemptWithoutConsuming('INVALID', message)</b><br/>status INVALID · milestone NOT consumed · retake allowed<br/>room shows the fatal dialog: 'This attempt was not scored'"]

    SCOREIT["scoreQuestion × CORE → assessCompetencies → overallFromCompetencies"]
    CTX["buildCohortCandidateContext(memberId, blueprint) — reloaded"]
    TURNS["loadTurns(interviewId, memberId)"]
    RPT["buildInterviewReport(askForReport, {...})"]
    COMMIT["<b>completeAttempt</b> — status COMPLETED + denormalized scores<br/>summary = report.summary || scores.summary<br/>partial unique index may reject → ALREADY_TAKEN"]
    SAVE["saveReport — <b>non-fatal</b>; failure is logged, reportReady:false"]
    DONE["FinishInterviewData { blueprint, scores, durationSec, reportReady }<br/>→ InterviewSession 'done' stage → link to /report"]

    TRIG --> T1 & T2 & T3
    T1 --> FIN
    T2 --> FIN
    T3 --> HALF
    HALF -->|"yes — 'End & get my report'"| FIN
    HALF -->|"no — 'End without a report'"| ABD
    FIN --> LOAD --> DUR --> FINAL --> GATE
    GATE -->|no| INV
    GATE -->|yes| SCOREIT --> CTX --> TURNS --> RPT --> COMMIT --> SAVE --> DONE
    FIN -.->|"finish failed after halfway exit"| ABD
```

### Exit-behaviour matrix (as implemented)

| Situation | Code path | DB status | Milestone consumed? | Report? |
|---|---|---|---|---|
| Exit **before** 50% of CORE answered | `abandonInterviewAction` (room never calls finish) | `ABANDONED` | **No** | No |
| Exit **at or after** 50% | `finishInterviewAction`; falls back to `abandonInterviewAction` if finish fails | `COMPLETED` (or `ABANDONED` on fallback) | Yes | Yes |
| Graph reached completion | `finished: true` → room calls `finishInterviewAction` | `COMPLETED` | Yes | Yes |
| Session timer hit 900s | room calls `finishInterviewAction` | `COMPLETED` if scorable, else `INVALID` | Yes / No | Yes / No |
| Too thin to score (< 180s **and** < 3 answered CORE) | `finalizeInterview` returns `ok:false` | `INVALID` | **No** | No |
| Tab closed, > 1h stale | `abandonStaleAttempts` on next start | `ABANDONED` | **No** | No |
| Provider degraded throughout | interview completes normally | `COMPLETED` | Yes | Yes, with `assessmentStatus: DEGRADED` and unjudged questions **excluded**, not zeroed |
| Second completion attempt (race) | partial unique index → `P2002` | unchanged | — | `ALREADY_TAKEN` |

---

## Node reference table

All 11 LangGraph nodes. Files are relative to `src/`.

| Node | File | Trigger | Input (read from state) | Output (NodeUpdate) | State changes | Next possible nodes |
|---|---|---|---|---|---|---|
| `receiveAnswer` | `features/interview/agent/nodes.ts` | `START` | `interviewState.status`, `plan`, `currentQuestionId`, `candidateAnswer` | `interviewState`, `transcript`, `currentQuestion`, `currentQuestionIndex`, `followUpCount`, `maxFollowUps`, `redirectCount`, `repeatCount`, `depthLevel`, `escalationsAsked` — **or** `{ error, finished }` | appends candidate transcript line; projects all per-question counters | `analyzeAnswer` (analyze) · `END` (abort) |
| `analyzeAnswer` | `agent/nodes.ts` → `createAnalyzeAnswer(llm)` | after `receiveAnswer` | current question, `depthLevel`, `candidateAnswer`, `evidenceByQuestionId[view.evidenceKey]`, `transcript`, `calibration.level`, `plan.contextSummary` | `{ decision }` — or `{ error, finished }` if no open question | none persisted | `routeResponse` |
| `routeResponse` | `agent/nodes.ts` | after `analyzeAnswer` | `decision`, current question at `depthLevel`, counters from `interviewState` | `{ lastDecision, nextPrompt }` | **none** — names the branch only | `followUp` · `escalate` · `nextQuestion` · `redirect` · `repeat` · `clarify` |
| `followUp` | `agent/nodes.ts` → `applyFollowUp` | `lastDecision === "FOLLOW_UP"` | `nextPrompt`, `decision`, current question | `{ nextPrompt }` or downgrade `{ lastDecision: "NEXT_QUESTION", nextPrompt: null }` | none | `updateState` |
| `escalate` | `agent/nodes.ts` → `applyEscalate` | `lastDecision === "ESCALATE"` | `nextPrompt` (bridge + banked rung, staged by `routeResponse`) | `{ nextPrompt }` or downgrade to `NEXT_QUESTION` | none | `updateState` |
| `nextQuestion` | `agent/nodes.ts` → `applyNextQuestion` | default branch | *(none)* | `{ nextPrompt: null }` | none — the text is unknown until state advances | `updateState` |
| `redirect` | `agent/nodes.ts` → `applyRedirect` | `lastDecision === "REDIRECT"` | `interviewId`, `currentQuestion` | `{ nextPrompt: redirectLineFor(id) + "\n\n" + currentQuestion }` | none | `updateState` |
| `repeat` | `agent/nodes.ts` → `applyRepeat` | `lastDecision === "REPEAT"` | `interviewId`, `currentQuestion` | `{ nextPrompt: repeatLineFor(id) + "\n\n" + currentQuestion }` | none | `updateState` |
| `clarify` | `agent/nodes.ts` → `applyClarify` | `lastDecision === "CLARIFY"` | `decision.clarification`, `currentQuestion` | `{ nextPrompt: resolveClarification(decision) + "\n\n" + currentQuestion }` | none | `updateState` |
| `updateState` | `agent/nodes.ts` | after any branch node | `plan`, `interviewState`, `decision`, `lastDecision`, `nextPrompt`, `candidateAnswer` | `interviewState`, `transcript`, `evidence`, `currentQuestionId`, `currentQuestion`, `currentQuestionIndex`, `followUpCount`, `maxFollowUps`, `redirectCount`, `repeatCount`, `depthLevel`, `escalationsAsked`, `lastDecision`, `nextPrompt`, `status`, `finished` | **the only writer.** REDIRECT/REPEAT/CLARIFY: bumps that one counter + transcript line. Otherwise: `competenceSignal`, `calibration`, `advanceTurn` (evidence, budgets, `consecutiveStuckAnswers`, `currentQuestionIndex`, `askedQuestionIds`, counter resets), `mergeEvidence`, transcript line | `complete` · `END` |
| `complete` | `agent/nodes.ts` → `completeInterview` | `shouldContinue === "complete"` | `interviewState`, `interviewId` | `interviewState`, `transcript`, `nextPrompt`, `lastDecision: "COMPLETE"`, `status: "COMPLETED"`, `finished: true` | sets `status: COMPLETED`, appends `closingLineFor(interviewId)` | `END` |

**Router functions (not nodes):** `guardBranch` and `actionBranch` in `agent/graph.ts`; `shouldContinue` in `agent/nodes.ts`.

---

## Non-graph components

| Component | File | Responsibility | Called by |
|---|---|---|---|
| `runInterviewTurn` / `buildInterviewGraph` | `features/interview/agent/graph.ts` | Compiles + caches the graph per provider; projects persisted state into graph channels; streams and captures the node trace; converts throws into `{ ok:false }` | `orchestrator.ts:submitAnswer` |
| `routeDecision`, `resolveAcknowledgement`, `resolveBridge`, `resolveClarification`, `resolveFollowUpText`, `resolveSimplified`, `speakable`, `openingLine`, `redirect/repeat/closingLineFor`, `pickFor` | `agent/policy.ts` | Deterministic action policy + all spoken-line guards (no `?` in acknowledgements, length caps, hollow-ack rejection, em-dash removal) | `nodes.ts`, `orchestrator.ts` |
| `classifyAnswer`, `decideLadderMove`, `escalationCeiling`, `updateCompetenceSignal`, `updateCalibration`, `activeQuestionView`, `questionAsAsked`, `nextDeepProbe`, `nextScaffoldProbe` | `agent/depth.ts` | The depth ladder — direction of adaptation. Pure, no model, no DB | `policy.ts`, `nodes.ts` |
| `advanceTurn`, `createInitialState`, `startInterview`, `getCurrentQuestion`, `appendLine`, `followUpBudgetFor`, `transcriptToText` | `features/interview/state.ts` | Budget + termination machine; calls the planner | `nodes.ts`, `orchestrator.ts`, `service.ts`, `voice.ts` |
| `selectNextTarget`, `askedIds` | `agent/target-planner.ts` | Chooses the next assessment target (continuity + coverage, authored-order incumbent, reorder margin) | `state.ts:advanceTurn` |
| `competencyCoverage`, `coverageForQuestion`, `coverageNeed` | `agent/coverage.ts` | Derived coverage per competency and per question (incl. rungs). Nothing stored | `target-planner.ts` |
| `conceptTokensForDays`, `topicalOverlap`, `conceptsForDays`, `mentionedConcepts`*(unused)* | `cohort/concepts.ts` | Curriculum vocabulary from `days.json`; continuity scoring | `target-planner.ts` |
| `curriculumForDay(s)`, `describeCurriculum` | `cohort/curriculum-context.ts` | Build-time `days.json` projection | `concepts.ts`, `generate-phrasing.ts` |
| `curriculumFor(sourceDays)` | `cohort/curriculum-kb.ts` | Parses + caches `knowledge/ai-cohort-interview/core-concepts.md` by `# DAY n`; per-question LLM context capped at 1,400 chars | `nodes.ts:analyzeAnswer` |
| `buildInterviewMemory` | `features/interview/memory.ts` | Standing summary (≤10 lines) of what each answered question established, from authored evidence items + verbatim quotes | `nodes.ts:analyzeAnswer` |
| `createJsonInterviewLLM`, `coerceMatchedEvidence` | `agent/llm/json-provider.ts` | Vendor-agnostic JSON provider: schema validation, one retry with `STRICT_JSON_REMINDER`, deterministic fallback, `phraseQuestions` | all vendor adapters |
| `resolveInterviewLLM` | `agent/llm/registry.ts` | Config-only provider resolution (`INTERVIEW_LLM_PROVIDER`); autodetect is **OpenAI or mock** | `orchestrator.ts`, `session.ts` |
| vendor adapters | `agent/llm/{openai,groq,gemini,anthropic,mock}-provider.ts` | HTTP/SDK bindings + `recordUsage` cost tracking (OpenAI) | `registry.ts` |
| `fallbackDecision`, `looksStuck`, `isBlankAnswer` | `agent/llm/heuristics.ts` | Structural-only degraded classification. **Off-topic detection was deliberately deleted** — degraded turns report `ON_TOPIC` | `json-provider.ts`, `mock-provider.ts` |
| `ANALYZE_SYSTEM_PROMPT`, `buildAnalyzeUserMessage`, `PHRASE_SYSTEM_PROMPT`, `buildPhraseUserMessage` | `agent/llm/prompt.ts` | Prompt construction | `json-provider.ts` |
| `beginInterview`, `submitAnswer`, `finalizeInterview` | `features/interview/orchestrator.ts` | Open / one turn / close. `finalizeInterview` consults **no model** | `service.ts` |
| `startCohortInterview`, `resumeCohortInterview`, `recordCohortAnswer`, `finishCohortInterview`, `abandonCohortInterview`, `getCohortInterviewOverview`, `getCohortInterviewReport`, `getInterviewReportById` | `features/interview/service.ts` | Security posture, DB orchestration, turn-record construction, latency logging | `prisma-provider.ts`, Server Components |
| `cohortInterviewProvider` / `getInterviewProvider` | `features/interview/prisma-provider.ts` | Uniform `(memberId, …)` surface over the service | Server Actions |
| `resolveInterviewMemberId`, `toProgramMemberId` | `features/interview/provider.ts` | The single source of member identity (session only); strips the 078 `pe_pm_` prefix | actions, routes, pages |
| repository functions | `features/interview/repository.ts` | All `GeneralInterview` / `InterviewTurn` / `InterviewReport` access; every query member-scoped | `service.ts` |
| `getBlueprintEligibility`, `assertCanStart` | `features/interview/cohort-eligibility.ts` | Eligibility read + **the** start gate | `session.ts` |
| `isBlueprintUnlocked`, `missingDaysFor`, `passedScopeCount` | `cohort/eligibility-rules.ts` | Pure unlock rule (every scope day passed) | `cohort-eligibility.ts` |
| `buildCohortPlan`, `gateStart`, `resolveCohortEligibility` | `features/interview/session.ts` | Assembles context → phrasing → plan | `service.ts` |
| `planCohortInterview`, `scopeDaysFor` | `cohort/planner.ts` | Bank → frozen `InterviewPlan`; grounding + phrasing applied once; extension selection | `session.ts`, `repository.ts`, `service.ts` |
| `getQuestionBank`, `questionCountFor`, `assertBankIntegrity` | `cohort/question-bank.ts` | The fixed banks + load-time integrity (scope, duplicate ids, satisfiable `minEvidence`, ascending rungs, scaffolds targeting real items) | `planner.ts`, `service.ts`, `report.ts` |
| `groundQuestion` | `cohort/grounding.ts` | Template-only factual clause; missing artifact ⇒ no clause | `planner.ts` |
| `generateCohortPhrasing`, `choosePhrasing`, `FRAMING` | `cohort/generate-phrasing.ts`, `cohort/question-phrasing.ts` | One optional LLM call to reword `spokenText`; every output validated | `session.ts`, `planner.ts`, `policy.ts` |
| `buildCohortCandidateContext` | `cohort/candidate-context.ts` | 4 parallel reads → `CohortCandidateContext` | `session.ts`, `service.ts` |
| `buildProgressSummary`, `formatProgressContext` | `cohort/progress-summary.ts` | Deterministic progress text frozen into the plan | `planner.ts` |
| `scoreQuestion`, `scoreModules`, `scoreToTier`, `assertScopeIntegrity` | `features/interview/module-scoring.ts` | Evidence → numbers. No model | `orchestrator.ts`, `report-assembly.ts` |
| `assessCompetencies`, `overallFromCompetencies`, `aggregateScores` | `features/interview/scoring.ts` | Rubric-weighted aggregation | `orchestrator.ts`, `report-assembly.ts` |
| `mergeEvidence`, `deriveCompetencyTier`, `deriveFallbackJudgments` | `features/interview/evidence.ts` | Evidence arithmetic incl. transcript-wide COMMUNICATION | `nodes.ts`, `scoring.ts` |
| `RUBRIC`, `EVIDENCE_TIER_SCORE`, `buildRubricSnapshot` | `features/interview/rubric.ts` | What is measured and what each axis is worth | `scoring.ts`, `planner.ts` |
| `buildInterviewReport` | `features/interview/report.ts` | One narrative call + fallbacks; `suggestedDays` from provenance | `service.ts` |
| `askForReport` | `features/interview/report-provider.ts` | OpenAI → Groq → Claude narrative chain with 429 handling | `service.ts` |
| `assembleReport`, `filterNarrative`, `deterministicNarrative`, `parseReport`, `answerExcerptFor` | `features/interview/report-assembly.ts` | Every number + the citation filter + write/read validation | `report.ts`, `repository.ts` |
| `buildQuestionAssessments`, `classifySkills`, `buildAgentInsights`, `selectTranscriptExcerpts`, `assessIntegrity`, `buildModuleReports`, `buildCompetencyReports`, `readinessFor`, `toTen`, `coreProgressFor` | `features/interview/report-analysis.ts` | The analytical layer; all deterministic | `report-assembly.ts`, `service.ts` |
| `transcribeAnswer`, `synthesizeLine`, `resolveSpeakableLine`, `isSttConfigured`, `isTtsConfigured` | `features/interview/voice.ts` | Speech transport only | STT/TTS routes |
| `rejectAudioUpload`, `audioFilenameFor`, `safetyIdentifierFor`, `MAX_AUDIO_BYTES`, `ALLOWED_AUDIO_TYPES` | `features/interview/voice-contract.ts` | Upload contract, importable without `server-only` | STT route, `voice.ts` |
| `checkLanguage`, `LANGUAGE_RETRY_LINE` | `features/interview/language-gate.ts` | English-only input gate between STT and the agent | STT route |
| `roomLineFor`, `repeatLine`, `NO_RESPONSE_ANSWER`, `TIME_UP_LINE`, `WAITING_LINES`, `RETRY_LINE`, `MOVING_ON_LINE` | `features/interview/room-lines.ts` | Lines the **room** says (never persisted by the graph); shared by client and TTS route so audio matches the screen | `interview-room.tsx`, `voice.ts` |
| `stepTurn`, `openTurn`, `TurnState`, `TurnEffect` | `features/interview/turn-state.ts` | Single-clock turn-ownership machine (VAD). Pure, `now` injected | `interview-room.tsx` |
| `initialSilenceState`, silence stepper | `features/interview/silence.ts` | Dual-threshold silence rule, extracted for testability | `interview-room.tsx` |
| `InterviewRoom` | `components/interview/cohort/interview-room.tsx` | The live room: audio capture, analyser, TTS playback + reveal, watchdogs, exit dialog, timer | `interview-session.tsx` |
| `InterviewSession`, `MicCheck` | `components/interview/cohort/{interview-session,mic-check}.tsx` | brief → live → done; mic must be **verified** (recorded *and* transcribed) before start | interview page |
| `InterviewReportView` | `components/interview/cohort/report-view.tsx` | Renders the stored document | report page |
| `InterviewAgentDemo` | `components/dev/interview-agent-demo.tsx` + `app/dev/interview-agent/page.tsx` + `app/actions/dev-interview-agent-actions.ts` | Dev harness showing the executed `trace[]`. **404s in production**; the actions re-check | dev only |

---

## State flow

`InterviewState` — `src/features/interview/types.ts`. Persisted to `GeneralInterview.state` (authoritative) with `transcript` / `evidence` as read-optimized projections.

| Field | Type | Written by | Read by |
|---|---|---|---|
| `status` | `NOT_STARTED\|IN_PROGRESS\|COMPLETED\|ABANDONED\|INVALID` | `createInitialState`, `startInterview`, `advanceTurn`, `updateState`, `completeInterview`, `finalizeInterview` | `receiveAnswer` (guard), `shouldContinue`, `service.ts`, `repository.ts` |
| `currentQuestionIndex` | `number` | `advanceTurn` (`= target.index`; `= plan.questions.length` when exhausted) | `getCurrentQuestion`, `askedIds` backfill, `analyzeAnswer` (`nextQuestionText`), `resumeCohortInterview` |
| `askedQuestionIds` | `string[]?` | `beginInterview` (first question), `advanceTurn` | `askedIds` → `remainingTargets` in `selectNextTarget` |
| `followUpsAsked` | `number` | `advanceTurn` (+1 on FOLLOW_UP; reset to 0 on NEXT_QUESTION) | `routeDecision` counters, `analyzeAnswer` (`followUpsRemaining`), `report.overall.followUpsAsked` |
| `consecutiveStuckAnswers` | `number` | `advanceTurn` | `routeDecision` (the `alreadyNudged` scaffold rule), `advanceTurn` early-end at 3 |
| `redirectsAsked` | `number?` | `updateState` (REDIRECT branch); reset by `advanceTurn` | `routeDecision` (cap 3, `firstContact`), `report.overall.redirectsIssued` |
| `repeatsAsked` | `number?` | `updateState` (REPEAT branch); reset by `advanceTurn` | `routeDecision` (cap 2, `firstContact`) |
| `clarificationsAsked` | `number?` | `updateState` (CLARIFY branch); reset by `advanceTurn` | `routeDecision` (cap 2) |
| `depthLevel` | `number?` (1 = core) | `advanceTurn` (+1 on ESCALATE; reset to 1) | `analyzeAnswer`, `routeResponse`, `updateState`, `activeQuestionView`, `nextDeepProbe`, `service.ts` turn record |
| `escalationsAsked` | `number?` | `advanceTurn` (+1 on ESCALATE; reset to 0) | `decideLadderMove` vs `escalationCeiling` |
| `competenceSignal` | `Partial<Record<Competency,{strong,weak}>>?` | `updateState` via `updateCompetenceSignal` (from the **raw** answer, before budgets) | `escalationCeiling`, `decideLadderMove` (projected forward to include the current answer) |
| `calibration` | `{answered,strong,weak,level}?` | `updateState` via `updateCalibration` — CORE answers only, frozen after `CALIBRATION_ANSWERS` (3) | `escalationCeiling` (starting posture), `analyzeAnswer` (`calibratedLevel`, tone only) |
| `transcript` | `TranscriptLine[]` | `appendLine` in `receiveAnswer`, `updateState`, `completeInterview`, `beginInterview` | `analyzeAnswer` (`recentTranscript`), `memory.ts`, `report-assembly.ts:answerExcerptFor`, `voice.ts:resolveSpeakableLine("latest")` |
| `evidenceByQuestionId` | `Record<string, AnswerEvidence>` keyed `qid` / `qid@L2` / `qid@L3` | `advanceTurn` (raw) then `updateState` overwrites with `mergeEvidence` when prior exists | `analyzeAnswer` (`priorEvidence`), `coverage.ts`, `module-scoring.ts`, `evidence.ts`, `report.ts`, `coreProgressFor` |
| `startedAtMs` | `number\|null` | `startInterview` | *(duration actually comes from the DB column `startedAt`, not this field)* |

### Coverage and "current assessment target"

Both are **derived, never stored fields**:

- **Assessment coverage** = `competencyCoverage(plan, state)` recomputed from `evidenceByQuestionId` on every planner call. Documented rationale: an attempt resumed from the database yields exactly the same coverage, and there is no new field that can drift out of sync with the evidence it summarises.
- **Current assessment target** = `plan.questions[state.currentQuestionIndex]` via `getCurrentQuestion`. The `TargetChoice` returned by `selectNextTarget` (with `reason` and `considered[]`) is **not persisted** — only its `index` and `questionId` land in state. *(Persisting the planner rationale per turn is **PLANNED / FUTURE**; `TargetChoice.reason` and `considered[]` are computed and discarded today.)*

### Graph-only channels (not persisted)

`InterviewAgentState` adds `interviewId`, `minutesLeft`, `blueprint`, `plan`, `currentQuestionId`, `currentQuestion`, `candidateAnswer`, `maxFollowUps`, `followUpCount`/`redirectCount`/`repeatCount` (flat projections), `decision`, `lastDecision`, `nextPrompt`, `finished`, `error`. These exist for one turn and are rebuilt from the persisted state on the next request.

---

## Provider boundaries

```mermaid
flowchart LR
    subgraph REASON["🧠 LLM reasoning — ONE call per turn"]
        A["analyzeAnswer<br/>registry.ts: INTERVIEW_LLM_PROVIDER<br/>openai | groq | gemini | anthropic | mock<br/><b>autodetect = OpenAI or mock ONLY</b>"]
        AF["fallback: heuristics.ts fallbackDecision<br/>degraded:true, relevance ON_TOPIC,<br/>matchedEvidence absent ⇒ UNJUDGED"]
    end
    subgraph PHR["✍️ Question phrasing — ONE call at plan build"]
        B["llm.phraseQuestions, temperature 0.9<br/>fallback: {} ⇒ every question asked as authored"]
    end
    subgraph SPEECH["🎙️ STT / 🔊 TTS — transport"]
        C["STT: OpenAI whisper-1 → Groq whisper-large-v3<br/>fallback: 503 'Voice is not configured'"]
        D["TTS: OpenAI gpt-4o-mini-tts (ash) → Groq (gated)<br/>fallback: browser speechSynthesis"]
    end
    subgraph NARR["📝 Report narrative — ONE call at finish"]
        E["askForReport: OpenAI gpt-4o → Groq gpt-oss-120b → Claude<br/>fallback: deterministicNarrative + narrativeDegraded"]
    end
    subgraph DETX["🔢 Deterministic scoring — NO provider"]
        F["module-scoring.ts · scoring.ts · rubric.ts<br/>evidence.ts · coverage.ts · depth.ts · policy.ts<br/>report-assembly.ts · report-analysis.ts"]
    end
```

| Boundary | Provider(s) | Purpose | Fallback | Affects scoring? | Can degrade the interview? |
|---|---|---|---|:--:|---|
| **LLM reasoning** | `INTERVIEW_LLM_PROVIDER` → OpenAI (`OPENAI_INTERVIEW_MODEL`) / Groq / Gemini / Anthropic / mock | Reads one answer: relevance, `matchedEvidence`, axes, flags, and drafts follow-up / acknowledgement / clarification / simplified / bridge | 1 retry with `STRICT_JSON_REMINDER`, then `fallbackDecision` (structural heuristics) | **Indirectly.** It supplies `matchedEvidence`, which every score is computed from — but it never emits a score, and its `action` is only a *request* that `routeDecision` may downgrade. A failure yields **UNJUDGED**, which is excluded from aggregates rather than scored as zero | **Yes, gracefully.** Turn is marked `degraded`; the interview continues. Ratio ≥ 0.5 → `assessmentStatus: DEGRADED` |
| **Question phrasing** | Same provider, `phraseQuestions` (optional method), temp 0.9 | Rewords `spokenText` only | `{}` ⇒ authored wording; every candidate string re-validated by `choosePhrasing` | **No.** `question.text` — the grading target — is never touched | No |
| **STT** | OpenAI `whisper-1` → Groq `whisper-large-v3` | Audio → text | None server-side (503). Client keeps the typed-answer path | No — it produces the input, then the same pipeline runs | Yes: an untranscribable answer costs a retry, never a turn (empty transcript is refused with 422 and nothing is submitted) |
| **TTS** | OpenAI `gpt-4o-mini-tts` (voice `ash`) → Groq `orpheus-v1-english` (only with `INTERVIEW_TTS_MODEL`) | Speaks server-composed lines | **`window.speechSynthesis`** in the browser, same words | No | No — worst case the candidate hears a different voice |
| **Report narrative** | OpenAI `gpt-4o` (`OPENAI_INTERVIEW_REPORT_MODEL`) → Groq `openai/gpt-oss-120b` → Claude (`lib/anthropic`) | Prose only: strengths, improvements, summary, recommendation | `deterministicNarrative` + `narrativeDegraded: true` | **No.** The prompt states the model is given no scores; every number is computed in `report-assembly.ts` | No — the interview is complete and scored either way; `saveReport` failure is explicitly non-fatal |
| **Deterministic scoring** | *(none)* | Every number in the product | n/a | It **is** the scoring | n/a |

---

## Security / safety boundaries

| Boundary | Implementation | File |
|---|---|---|
| **Member identity** | `resolveInterviewMemberId()` reads the session and DB and **takes no parameters** — there is no argument through which a caller could act as another member. Requires `ProgramMember.status ∈ {ENROLLED, COMPLETED}` | `features/interview/provider.ts` |
| **What a client may send** | A blueprint enum value, an interview id, a question id, and answer text. Nothing else. Plan, state, eligibility, scores and question index never cross the boundary inbound | `app/actions/interview-actions.ts` |
| **Input validation** | `startInterviewSchema`, `submitInterviewAnswerSchema`, `interviewIdSchema` (zod) at every action entry; `bodySchema` at the TTS route; `interviewReportSchema` on report write **and** read | `lib/validations/interview.ts` |
| **Interview ownership** | `memberId` is inside the `WHERE` clause of every repository query — another member's id resolves to `null`, indistinguishable from nonexistent | `features/interview/repository.ts` |
| **Answer identity** | `receiveAnswer` rejects an answer whose `questionId` ≠ the question the **server** believes is open. A stale or replayed client is a no-op, not a double-scored answer | `agent/nodes.ts` |
| **Start gate** | `assertCanStart` re-derives eligibility from the database immediately before `createAttempt`, in the same request. There is no path to `createAttempt` that skips it | `cohort-eligibility.ts`, `service.ts` |
| **One completion per milestone** | Postgres partial unique index `GeneralInterview_one_completed_per_blueprint ON (memberId, blueprint) WHERE status='COMPLETED'`. `P2002` → `ALREADY_TAKEN`, not a 500. Stronger than an app-level lock | migration + `repository.ts` |
| **Attempt cannot be burned by failure** | Unscorable → `INVALID`; abandoned/stale → `ABANDONED`. Neither is `COMPLETED`, so neither consumes the milestone | `service.ts`, `repository.ts` |
| **Duration** | Computed from the persisted `startedAt` column, never accepted from the client — a client-supplied duration could clear the minimum-length floor | `service.ts` |
| **`minutesLeft`** | Also derived from persisted `startedAt` before being shown to the model | `service.ts` |
| **TTS text sourcing** | The route schema has **no text field**. It takes `{ interviewId, line: enum, variant: int 0..999 }` and composes the line server-side from the interview's own transcript, the server's open question, or a fixed constant. `variant` selects among authored sentences and cannot introduce one. Without this, a paid speech API would be an open TTS service for any signed-in member | `app/api/interview/tts/route.ts`, `features/interview/voice.ts` |
| **TTS caching** | `Cache-Control: no-store, private` — per-attempt, per-member audio must never reach a CDN or shared proxy | TTS route |
| **STT ordering** | Authentication runs **before** `request.formData()`, so an unauthenticated request cannot make the server buffer megabytes | STT route |
| **Upload limits** | `rejectAudioUpload(size, type)` → 413 / 415; WebM EBML magic check (`1a45dfa3`) → 422 | `voice-contract.ts`, STT route |
| **Provider abuse identifier** | `OpenAI-Safety-Identifier: safetyIdentifierFor(memberId)` on both STT and TTS upstream calls | `voice-contract.ts`, `voice.ts` |
| **Checklist secrecy** | `ClientQuestion` omits `expectedEvidence`, `minEvidence`, probes and the rubric | `service.ts:toClientQuestion` |
| **Scope integrity** | Asserted three times: bank module load (`assertBankIntegrity`), plan build (`assertWithinScope`), and at the moment a number is produced (`assertScopeIntegrity`) | `question-bank.ts`, `planner.ts`, `module-scoring.ts` |
| **Grounding non-invention** | Every clause is a template over a database row. A missing artifact yields **no clause**, never a hedge. `groundQuestion` must never receive model-generated text | `cohort/grounding.ts` |
| **Model cannot escalate or complete** | `LLM_ACTIONS` excludes both | `agent/types.ts` |
| **Narrative cannot praise fictional work** | `filterNarrative` deletes any item whose citations do not resolve to an answered question | `report-assembly.ts` |
| **Report immutability** | Reports are never regenerated on view — *"a report is a record of an assessment that happened"* | `service.ts`, report page |
| **Dev harness** | `/dev/interview-agent` `notFound()` in production, and `dev-interview-agent-actions.ts` repeats the check (a route guard does not protect an action endpoint) | `app/dev/interview-agent/page.tsx` |
| **Day-lock bypass** | Read from `isDayLockBypassEnabled()` **and nowhere else**. A previous unconditional `missingDays = []` disabled the progress rule in every environment including production | `cohort-eligibility.ts` |
| **Page-level auth** | `requireProgramMember()` runs **before** the URL params are read on both the interview and report pages | both pages |

### Not a guarantee (stated honestly)

- The **demo reset path** (`resetDemoInterviewAction`, and the `reattemptAction` server actions inlined in both pages) hard-codes `demo-day31@abtalks.dev` and calls `prisma.generalInterview.deleteMany`. It is gated on that exact email, but it is a production code path that deletes completed interviews and uses `blueprint as any`.
- There is **no production/test database boundary represented in the interview code**. `docs/plans/070-interview-dev-database.md` describes one; nothing in `src/features/interview/**` references it. **NOT IMPLEMENTED.**
- There is **no rate limiting** on `/api/interview/stt` or `/api/interview/tts` beyond authentication, the upload size cap, and the `variant` bound.

---

## Not implemented / planned

| Item from the brief or the plans | Status |
|---|---|
| Barge-in / interruptible speech | **NOT IMPLEMENTED.** The mic is closed while the interviewer speaks; `turn-state.ts` enforces strict turn ownership |
| Realtime conversational API for this interview | **NOT IMPLEMENTED, and deliberately rejected** — see the rationale in `voice.ts`. Used only by the separate legacy program exit interview |
| A second conversational AI | **Does not exist.** One `analyzeAnswer` call per turn; STT/TTS are transport |
| A `planner` LangGraph node | **Does not exist as a node.** `selectNextTarget` is called from `advanceTurn` inside `updateState` |
| Concept-level coverage ("already assessed concepts") | **NOT IMPLEMENTED.** Coverage is per competency and per question id (+ rungs). `mentionedConcepts()` is exported but has zero call sites |
| Persisting the planner's `reason` / `considered[]` per turn | **PLANNED / FUTURE.** Computed on every advance and discarded; `InterviewTurn` has no column for it |
| Resuming an interview | **Deliberately disabled.** `resumeCohortInterview` exists in `service.ts` and is exposed on the provider, but `startCohortInterview` abandons any open attempt first, and no UI calls `resume` |
| `evaluation.ts` (`judgeInterview` — model-assigned competency tiers) | **Off the path.** Kept on disk as the reference implementation of that prompt; `finalizeInterview` no longer calls it |
| General 60-day-challenge interview (`/interview`, `question-rules.ts`, `question-generation.ts`, `challenge-context.ts`, `resume-context.ts`, `eligibility.ts`, `mock/`, `read-model.ts`) | **PLANNED / FUTURE.** Route redirects to `/program/dashboard`; modules intact but unreachable |
| Repository/code reading for grounding | **NOT IMPLEMENTED.** `payload.repoRef` is a **filename**, not file contents; `describeCandidateWork` says so explicitly |
| Separate dev/test database boundary | **NOT IMPLEMENTED** in `src/` (see `docs/plans/070`) |
| Question `simplified` rephrasing (`resolveSimplified`) | **Implemented in `policy.ts` but not wired.** `routeDecision` never returns a simplified question, and no node calls `resolveSimplified` — CLARIFY answers the term and restates the question verbatim instead |

---

## Architecture principle

The interviewer is not a chatbot with a system prompt. It is a **constrained adaptive assessment instrument**, and every layer exists to keep one property true: *two candidates whose answers contain the same evidence receive the same score, no matter which model answered the phone that day.*

- **The question bank is the legal assessment space.** `cohort/question-bank.ts` is code, not data, so a malformed bank is a compile error. Its scope is asserted three separate times. `question.text` — the thing evaluation grades against — is byte-identical for every candidate at a milestone, and nothing in the system may rewrite it. Only `spokenText` can vary, and only via a template over a database row (grounding) or a validated rewording (phrasing).
- **LangGraph owns conversation state and routing, as named nodes and declared edges.** The transitions *are* the assessment rules; as a graph they can be read, tested without a network and audited in a diff. Inside a prompt they would be suggestions a model may ignore.
- **The model reports; it does not decide.** It may propose five of seven actions, and `routeDecision` may downgrade any of them. It cannot request an escalation or a completion. It cannot ask a question outside the bank — an "acknowledgement" or "bridge" containing `?` is rejected as an unbudgeted follow-up in disguise. It supplies exactly one thing that reaches a number: which checklist items an answer covered, and even that is range-filtered against the real checklist so an invented item cannot inflate a score.
- **The planner chooses what to explore next, from inside the bank.** Continuity against the curriculum's own vocabulary pulls the interview toward what the candidate raised; coverage need pulls it toward what is still dark. Authored order is the incumbent and only loses by a margin, so an interview never reshuffles itself on noise.
- **Depth is earned deterministically.** `depth.ts` decides direction (escalate / scaffold / move on) from evidence and streaks; `state.ts` decides affordability from budgets; `policy.ts` applies both. All three are pure.
- **Evidence drives every score, and evidence has provenance.** Scores are arithmetic over which authored checklist items were covered, keyed per question and per escalation rung so two checklists' index spaces never mix. A provider outage produces **UNJUDGED**, which is excluded from every aggregate rather than counted as a failure — an outage must not become a scoring event.
- **The LLM supplies semantic interpretation and prose, never authority.** The report's narrative model is shown no scores at all, and any sentence it writes that cannot be traced to a real answered question id is deleted before the document is stored.
- **Nothing trusts the client except the words the candidate said.** Member identity comes from the session, the plan and state are reloaded from Postgres on every turn, the duration comes from a database column, the answer must match the question the server has open, and the speech endpoint accepts a line *kind* rather than a line.

The result is an interview that adapts — it goes deeper on a strong answer, narrows on a weak one, follows what someone actually said, and answers "what do you mean by that?" like a person would — while remaining an instrument two people can be compared on.
