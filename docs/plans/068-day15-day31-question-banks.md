# 068 — DAY_15 / DAY_31 question banks (REVIEW ARTIFACT)

Draft for approval. Nothing here is wired into code.

Curriculum source: `prisma/content/program/days.json` (31 days),
`modules.json` (8 modules). Scoring axis: the five competencies approved in 066
(`rubric.ts`). Eligibility source: `ProgramMissionSubmission.passed === true`.

**Locked for V1:** DAY_15 unlocks when days 1–15 are all passed. DAY_31 unlocks
when days 1–31 are all passed. **DAY_31 replaces the existing `ProgramInterview`
end-of-cohort voice interview** (authorised — it was never fully rolled out).
The adjacency problem in the earlier draft is gone: DAY_31 *is* the exit
interview, at the same milestone, so a member is never interviewed twice.
Replacement consequences — including a hidden `/talent` dependency — are in §5.

---

## 1. Scope boundaries

| Blueprint | Days | Modules |
| --- | --- | --- |
| `DAY_15` | 1–15 | M1 Environment & Tooling · M2 Data Foundations · M3 Embeddings & Vector Search · M4 LLM Core, Prompting & Fine-Tuning |
| `DAY_31` | 1–31 | above **plus** M5 Chatbot App Build · M6 Agentic AI & MCP · M7 Governance & Evaluation · M8 Docker/K8s/Monitoring/Capstone (28–31) |

Day 15 is exactly where Module 4 ends — a real curriculum boundary. DAY_31
covers the whole programme including Day 31 (*Capstone — End-to-End Review &
Roadmap*), which makes it a true exit interview rather than a late checkpoint.

The cohort is a healthcare-coverage themed AI engineering build: all 31 days
contribute to one coverage chatbot. That shared artifact is what makes
standardized questions valid — every candidate built the same system, so the
same question is fair to all of them.

---

## 2. DAY_15 question bank

Composition: CONCEPTUAL 3 · PRACTICAL 3 · PROBLEM_SOLVING 2 · TECHNICAL_DEPTH 2.
`COMMUNICATION` carries no slots by design — it is observed across every answer.

---

### d15-q01

**Question.** You split the policy documents into chunks of 500 characters with
50 characters of overlap before embedding them. Why does the overlap matter, and
what would you expect to break if you set it to zero?

| Field | Value |
| --- | --- |
| Source | Day 6 *Building the Knowledge Base*, Day 7 *Embeddings Explained* |
| Competency | CONCEPTUAL |
| Difficulty | medium |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. Overlap preserves context across a chunk boundary
2. Zero overlap can cut a clause or sentence mid-idea
3. Retrieval may then return partial or missed exclusion clauses
4. Tradeoff: more overlap means more chunks, more storage and cost

**Follow-up prompt.** *"Think about a policy exclusion that spans two chunks — what does retrieval return?"*

**Why this assesses real cohort learning.** Day 6 hands them the exact
parameters (500/50) and asks them to sanity-check chunk coherence "especially
exclusion clauses". A candidate who only ran the script can state the numbers; a
candidate who did the sanity check can explain what a severed exclusion clause
does to an answer. The gap between those two is exactly what this bank exists to
detect.

---

### d15-q02

**Question.** On Day 10 you classified questions as structured, unstructured, or
both. Give me an actual question from your test harness that needed both paths,
and tell me what each path returned.

| Field | Value |
| --- | --- |
| Source | Day 4 *Structured Data*, Day 5 *Unstructured Data*, Day 10 *Retrieval / Matching Engine* |
| Competency | PRACTICAL |
| Difficulty | hard |
| Minimum evidence | 3 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Names a concrete question from their own harness
2. Describes the SQL/structured lookup returning plan or claim rows
3. Describes the vector lookup returning policy text
4. Explains how the two results were combined into one answer

**Follow-up prompt.** *"Which part of that answer came from SQL and which from the vector store?"*

**Why this assesses real cohort learning.** Day 10's deliverable is a
10-question harness with logged context, scored good/partial/poor. The answer is
unfakeable in a specific way: a candidate who built the harness has a concrete
question in memory, while one who copied the routing code has only the abstract
categories. Asking for *their* example rather than *an* example is what makes it
work.

---

### d15-q03

**Question.** Why did the program have you run a model locally with Ollama
before using any hosted API?

| Field | Value |
| --- | --- |
| Source | Day 1 *VS Code & Python Setup*, Day 2 *Ollama + AI Coding Assistant* |
| Competency | CONCEPTUAL |
| Difficulty | easy |
| Minimum evidence | 2 of 4 |
| Max follow-ups | **0 — never follows up** |
| Follow-up condition | n/a |

**Expected evidence.**
1. No API cost and no key required to start
2. Data stays on the machine — relevant for coverage/PHI data
3. Forces understanding of model size versus available RAM
4. Faster iteration, works offline

**Why this assesses real cohort learning.** Deliberately the easiest question in
the bank, placed to open the interview and settle the candidate. Day 2's real
lesson is picking a model size that fits your RAM — a constraint you only
internalise by hitting it. It is recall-level, so probing would pad the
transcript without adding signal; this is the one question with no follow-up.

---

### d15-q04

**Question.** You attached metadata like `plan_type` and `source_type` to every
chunk. Walk me through what actually differs in Chroma between a query with a
metadata filter and one without.

| Field | Value |
| --- | --- |
| Source | Day 9 *Building & Populating the Vector Database* |
| Competency | TECHNICAL_DEPTH |
| Difficulty | hard |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. The filter restricts the candidate set considered for similarity
2. It prevents returning another plan's policy text
3. Without it, top-k can be dominated by irrelevant plans
4. For coverage answers, correctness matters more than recall

**Follow-up prompt.** *"What could a member see if the filter were removed?"*

**Why this assesses real cohort learning.** Day 9 explicitly requires confirming
that metadata filtering scopes results to one plan. In a coverage product this
is not a tuning detail — an unfiltered query can show one member another plan's
terms. The question tests whether they understood filtering as a correctness
boundary rather than a search-quality knob.

---

### d15-q05

**Question.** You scored five system-prompt variants. Which one did you lock for
production, and what specifically made it win?

| Field | Value |
| --- | --- |
| Source | Day 12 *Prompt Engineering Fundamentals* |
| Competency | PRACTICAL |
| Difficulty | medium |
| Minimum evidence | 3 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Names the variant they chose
2. Cites the scoring axes — accuracy, tone, conciseness, compliance
3. Gives a concrete failure of a variant they rejected
4. Mentions the standard disclaimer / compliance language

**Follow-up prompt.** *"What did the runner-up get wrong that yours got right?"*

**Why this assesses real cohort learning.** Day 12 requires five variants scored
1–5 on four named axes, written up in `prompt_variants.md`. The discriminating
item is the third — describing why a *rejected* variant failed. Anyone can name
a winner; only someone who actually ran the comparison remembers the loser's
specific failure mode.

---

### d15-q06

**Question.** A member reports the bot gave them the wrong deductible amount.
Would you fix that with fine-tuning or with retrieval? Walk me through your
reasoning.

| Field | Value |
| --- | --- |
| Source | Day 14 *Fine-Tuning Concepts*, Day 15 *LoRA/QLoRA Hands-On* |
| Competency | PROBLEM_SOLVING |
| Difficulty | hard |
| Minimum evidence | 3 of 4 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Identifies this as a retrieval/data problem, not a style problem
2. Fine-tuning changes tone and format, not facts
3. Would inspect the knowledge base or the SQL source first
4. Fine-tuning on wrong facts bakes the error in

**Follow-up prompt.** *"Where would the wrong number have entered the pipeline?"*

**Why this assesses real cohort learning.** The strongest discriminator in this
bank. Day 14's first stated objective is literally "separate issues fine-tuning
can fix from retrieval problems", and Day 15 ends by asking whether fine-tuning
beat more prompt/retrieval work. It is also the industry's most common
misconception, so a wrong answer is genuinely informative rather than merely a
gap. Two follow-ups because reasoning this through out loud takes room.

---

### d15-q07

**Question.** You compared Chroma and Pinecone and chose Chroma. What was the
reasoning, and what would make you switch?

| Field | Value |
| --- | --- |
| Source | Day 7 *Embeddings Explained*, Day 8 *Vector Databases Overview* |
| Competency | CONCEPTUAL |
| Difficulty | medium |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. Local and persistent — no external service needed for this build
2. Cost / no hosting overhead
3. Pinecone for scale or managed operations
4. Notes the enterprise access-control consideration

**Follow-up prompt.** *"At what point does that choice stop working?"*

**Why this assesses real cohort learning.** Day 8 requires documenting the
trade-offs *including enterprise access control* and writing a paragraph of
reasoning for choosing Chroma. The "what would make you switch" half is what
separates a memorised justification from an understood one — a candidate who
only learned the answer cannot name the condition that invalidates it.

---

### d15-q08

**Question.** You validated every tool response with Pydantic before returning
it to the model. What goes wrong if you skip that step?

| Field | Value |
| --- | --- |
| Source | Day 13 *Function Calling & Structured Outputs* |
| Competency | TECHNICAL_DEPTH |
| Difficulty | hard |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. The model receives a malformed or unexpected shape
2. Downstream hallucination or crash
3. Type errors surface late, or silently
4. Validation is the trust boundary between tool output and the model

**Follow-up prompt.** *"What does the model do with a field it did not expect?"*

**Why this assesses real cohort learning.** Day 13 requires Pydantic validation
on every tool response. Most candidates will have written the validators because
the brief said so; this asks *why*, which is the difference between following a
checklist and understanding where a system's trust boundaries sit. The fourth
item is the one that marks genuine depth.

---

### d15-q09

**Question.** You logged 10 full-pipeline results on Day 11 and compared them to
your Day 10 retrieval baseline. What changed once generation was added?

| Field | Value |
| --- | --- |
| Source | Day 10 *Retrieval Engine*, Day 11 *RAG End-to-End & LLM API Basics* |
| Competency | PRACTICAL |
| Difficulty | medium |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. Names a specific improvement or regression
2. Distinguishes retrieval quality from generation quality
3. Notes grounding or citation behaviour
4. Identifies a case where retrieval was good but the answer still was not

**Follow-up prompt.** *"Was there a case where the right context still produced a wrong answer?"*

**Why this assesses real cohort learning.** Day 11 explicitly requires comparing
against the Day 10 baseline. The fourth evidence item — good retrieval, bad
answer — is the single most useful realisation in the whole RAG module, and it
is only available to someone who actually read their own logs.

---

### d15-q10

**Question.** Your local chatbot kept conversation history. Describe how you
stored it, and what breaks in a long conversation.

| Field | Value |
| --- | --- |
| Source | Day 3 *First Python Project, Local Chatbot & Git/GitHub* |
| Competency | PROBLEM_SOLVING |
| Difficulty | medium |
| Minimum evidence | 2 of 4 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 2 evidence items met |

**Expected evidence.**
1. Appended turns to a messages list passed back each call
2. Context window grows toward the token limit
3. Cost and latency grow with every turn
4. Would need truncation or summarisation

**Follow-up prompt.** *"What happens on turn fifty?"*

**Why this assesses real cohort learning.** Day 3 only asks them to call a local
model *with conversation history* — the failure mode is never taught at that
point. It surfaces properly on Day 20. Asking it inside the DAY_15 window tests
whether the candidate reasons forward from what they built rather than waiting
to be told, which is the clearest signal of an engineer who thinks past the
brief.

---

## 3. DAY_31 question bank

Composition: PRACTICAL 3 · PROBLEM_SOLVING 3 · CONCEPTUAL 2 · TECHNICAL_DEPTH 2.

Deeper than DAY_15, enforced three ways: minimum evidence is **3 on every
question** (versus 2 on half of DAY_15), eight of ten are `hard`, and
`PROBLEM_SOLVING` gains a slot while `CONCEPTUAL` loses one. Questions ask what
the candidate *decided and observed*, not what a thing *is*.

DAY_31 assumes nothing about whether DAY_15 was taken — the two milestones are
independent — so `d31-q10` deliberately spans early and late material.

---

### d31-q01

**Question.** Walk me through what happens between a member pressing send and
the first token appearing on their screen, in your streamed `/chat`.

| Field | Value |
| --- | --- |
| Source | Day 18 *Full-Stack Integration & Streaming Responses* |
| Competency | TECHNICAL_DEPTH |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Request reaches FastAPI `/chat`
2. Retrieval completes before generation can start
3. `StreamingResponse` yields SSE `data:` lines from the LLM SDK
4. Streamlit consumes with `stream=True` and `st.empty()`
5. Pre-first-token loading UX exists because retrieval adds latency

**Follow-up prompt.** *"Where does the delay before the first token come from?"*

**Why this assesses real cohort learning.** An end-to-end trace question: it
cannot be answered from one file. Day 18 requires both the SSE server side and
the Streamlit client side plus pre-first-token loading UX. The second item is
the tell — understanding *why* the loading state is needed means understanding
that retrieval blocks the stream.

---

### d31-q02

**Question.** A member's conversation passes roughly 2000 tokens of history.
What does your system do, and what is the risk of that strategy?

| Field | Value |
| --- | --- |
| Source | Day 20 *Conversation Memory & Context Management* |
| Competency | PROBLEM_SOLVING |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Summarises the oldest turns
2. Keeps the last N turns plus `plan_id`
3. Risk: the summary drops a detail that mattered — which plan, which claim
4. Token counting via tiktoken drives the threshold
5. Explicit tradeoff between cost and fidelity

**Follow-up prompt.** *"What is the one thing that must survive summarisation?"*

**Why this assesses real cohort learning.** Day 20 requires proving plan memory
across a 15+ turn conversation with token logs. The risk half is the real test:
summarisation is lossy, and in a coverage product the lost detail is often
exactly the one that determines the answer. Two follow-ups because naming the
risk requires thinking about their own design critically.

---

### d31-q03

**Question.** Why does PII redaction sit on the logging path specifically, and
what does putting it there *not* protect against?

| Field | Value |
| --- | --- |
| Source | Day 25 *AI Governance, PHI Handling & Guardrails* |
| Competency | CONCEPTUAL |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Logs persist PHI/PII well beyond the request lifetime
2. Redaction happens before the write
3. It does not protect the prompt sent to the model
4. It does not prevent leakage in the response to the member
5. Formal compliance review is still required regardless

**Follow-up prompt.** *"Does redacting the log stop PHI reaching the model?"*

**Why this assesses real cohort learning.** Day 25 requires wiring `redact_pii`
into `/chat` logging *and* noting that formal compliance review is still
required. The question is built around the limits of their own control — items 3
and 4 are things their implementation does **not** do. Candidates who believe
they solved PHI handling reveal it here, and in a healthcare context that
overconfidence is the thing worth catching.

---

### d31-q04

**Question.** You ran the same five questions through a single ReAct agent and
through the Router/Specialist multi-agent setup. When did multi-agent actually
help, and when was it worse?

| Field | Value |
| --- | --- |
| Source | Day 21 *LangChain Agents & Tool Use*, Day 22 *Multi-Agent Orchestration* |
| Competency | PROBLEM_SOLVING |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Names a concrete question where routing helped
2. Notes the added latency, cost, or complexity
3. A single agent was sufficient for a narrow tool set
4. Failure mode: the Router picks the wrong specialist
5. Cites the saved traces as evidence

**Follow-up prompt.** *"Was there a question where the extra hop bought you nothing?"*

**Why this assesses real cohort learning.** Day 22 asks them to document *when
multi-agent helps* — an explicitly two-sided judgement. Multi-agent is heavily
hyped, so a candidate who reports it helped everywhere probably did not measure.
Willingness to say "it was worse here" is the signal.

---

### d31-q05

**Question.** You chaos-tested a broken tool and required that no raw 500 ever
reaches the member. Tell me exactly what you broke and what the member saw.

| Field | Value |
| --- | --- |
| Source | Day 24 *Agentic Chatbot — Full Integration* |
| Competency | PRACTICAL |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Describes how the tool was broken
2. 10-second timeout, at most one retry
3. A canned support fallback message
4. Confirms no stack trace or raw 500 surfaced
5. The failure was still logged for observability

**Follow-up prompt.** *"What did the member actually see on screen?"*

**Why this assesses real cohort learning.** Day 24 specifies the numbers — 10s
timeout, max 1 retry, canned fallback, chaos test. Asking what the *member* saw
rather than what the code did forces the candidate to describe the system from
outside, which is where resilience work either lands or does not.

---

### d31-q06

**Question.** Which RAGAS metric came out weakest, what was your hypothesis, and
did your fix actually move it?

| Field | Value |
| --- | --- |
| Source | Day 27 *Evaluation Frameworks* (project day) |
| Competency | PRACTICAL |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Names the metric — faithfulness, relevancy, precision, or recall
2. States a hypothesis for why it was weakest
3. Describes one concrete change made
4. Reports the re-run result
5. Says so plainly if the fix did not work

**Follow-up prompt.** *"Did the number move after your fix?"*

**Why this assesses real cohort learning.** Day 27's loop is
measure → hypothesise → fix → re-measure, which is the scientific core of the
whole program. **A candidate who reports a fix that failed should score higher
than one who claims everything improved** — item 5 exists to reward honest
negative results, and evaluators should read it that way.

---

### d31-q07

**Question.** You cached exact-match general questions but never claim- or
member-specific ones. Why draw the boundary there?

| Field | Value |
| --- | --- |
| Source | Day 26 *Token Governance, Cost Management & Experiment Design* |
| Competency | TECHNICAL_DEPTH |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Member-specific answers depend on that member's private data
2. Caching them risks serving one member's data to another
3. Claim status changes over time — staleness
4. General policy answers are stable and shared across members
5. The cost saving concentrates on repeated general questions anyway

**Follow-up prompt.** *"What is the worst case if you cached a claim-status answer?"*

**Why this assesses real cohort learning.** Day 26 states the rule — cache
general questions only, never claim/member-specific — without belabouring why.
Item 2 is a cross-member data leak, the most serious bug available in this
product. Whether a candidate reaches it unprompted separates rule-followers from
engineers who model consequences.

---

### d31-q08

**Question.** You containerised the app, then deployed it to Minikube with two
backend replicas. What actually had to change between docker-compose and
Kubernetes?

| Field | Value |
| --- | --- |
| Source | Day 28 *Docker*, Day 29 *Kubernetes* |
| Competency | PRACTICAL |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Secrets moved from `env_file` to a Secret with `envFrom`
2. Deployment and Service manifests replace compose services
3. Health probes wired to `/health`
4. Images had to be loaded into the cluster
5. Chroma data mounting / replica state considerations

**Follow-up prompt.** *"What did you do about the Chroma data with two replicas?"*

**Why this assesses real cohort learning.** Days 28 and 29 are consecutive and
deliberately contrasted. Item 5 is the sharp one: two replicas sharing a mounted
Chroma directory is a genuine problem the brief does not spell out, so noticing
it means the candidate thought about state rather than copying manifests.

---

### d31-q09

**Question.** What does Langfuse tell you that `kubectl logs` does not?

| Field | Value |
| --- | --- |
| Source | Day 30 *Monitoring & Observability* |
| Competency | CONCEPTUAL |
| Difficulty | medium |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Per-call latency, token counts, cost
2. Prompt and response content per trace
3. Links a member session to specific model behaviour
4. Logs show process-level errors, not answer quality
5. Feeds the alerts they sketched — error rate, p95 latency, daily cost ceiling

**Follow-up prompt.** *"Which of your production alerts could you not build from logs alone?"*

**Why this assesses real cohort learning.** Day 30 requires both Langfuse
tracing and hands-on `kubectl logs`/`describe` on a broken pod, then sketching
production alerts. The comparison tests whether they understand these as
different *kinds* of observability — infrastructure health versus model
behaviour — rather than two logging tools.

---

### d31-q10

**Question.** A member says an answer is wrong, but the bot cited a policy
source. How do you investigate?

| Field | Value |
| --- | --- |
| Source | Day 10 *Retrieval Engine*, Day 19 *Response Formatting & Citations*, Day 27 *Evaluation Frameworks* |
| Competency | PROBLEM_SOLVING |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Check whether the cited chunk actually contains the claim
2. Separate a retrieval error from a generation error
3. Check the metadata filter and plan scoping
4. Reproduce against the eval set
5. Consider that the source document itself may be wrong or outdated

**Follow-up prompt.** *"How would you tell a retrieval bug from a generation bug?"*

**Why this assesses real cohort learning.** The synthesis question, spanning
early retrieval work, mid-program citations, and late evaluation. It is also the
only one with no clean answer — a citation that looks right while the answer is
wrong is the hardest class of RAG bug. Item 5 is the maturity marker: most
candidates debug the pipeline, few question the source data.

---

## 4. Curriculum coverage map

| Days | DAY_15 | DAY_31 |
| --- | --- | --- |
| 1–2 Environment, Ollama | q03 | — |
| 3 Local chatbot, history | q10 | — |
| 4–5 Structured / unstructured data | q02 | — |
| 6 Knowledge base / chunking | q01 | — |
| 7–8 Embeddings, vector DB choice | q01, q07 | — |
| 9 Populating Chroma, metadata | q04 | — |
| 10 Retrieval engine | q02, q09 | q10 |
| 11 RAG end-to-end | q09 | — |
| 12 Prompt engineering | q05 | — |
| 13 Function calling, Pydantic | q08 | — |
| 14–15 Fine-tuning | q06 | — |
| 16–17 Backend API, Streamlit UI | n/a | **not probed** |
| 18 Streaming | n/a | q01 |
| 19 Citations, rich outputs | n/a | q10 |
| 20 Memory | n/a | q02 |
| 21–22 Agents, multi-agent | n/a | q04 |
| 23 MCP | n/a | **not probed** |
| 24 Full agentic integration | n/a | q05 |
| 25 Governance / PHI | n/a | q03 |
| 26 Cost, caching | n/a | q07 |
| 27 RAGAS evaluation | n/a | q06, q10 |
| 28–29 Docker, Kubernetes | n/a | q08 |
| 30 Observability | n/a | q09 |
| 31 Capstone, v2 roadmap | n/a | **q12 (new)** |

**Two days remain unprobed by DAY_31: 16 and 17.** FastAPI `/chat` scaffolding
and the Streamlit UI are largely subsumed by q01, which traces that exact
request path end to end. Acceptable.

**Day 23 (Model Context Protocol) is a genuine gap** — a distinctive module
currently reachable only indirectly through q05's Day 24 integration. Spare
`d31-q11` closes it.

**Proposed final DAY_31 composition (11 questions):**

- Swap **`d31-q11` (MCP) in for `d31-q09` (observability)** — q09 is the weakest
  question in the bank at medium difficulty, and observability is partly
  assessed through q05's logging item.
- Add **`d31-q12` (Capstone)** as the closing question.

That gives PRACTICAL 3 · PROBLEM_SOLVING 4 · CONCEPTUAL 2 · TECHNICAL_DEPTH 2,
ending on the candidate's own prioritisation judgement. DAY_31 running one
question longer than DAY_15 is defensible for an exit interview, but it does
mean `INTERVIEW_QUESTION_COUNT` becomes per-blueprint rather than a global
constant. **Recommended, flagged rather than assumed.**

### d31-q11 (spare — MCP)

**Question.** You exposed `check_coverage` as an MCP tool and called it from
Claude Desktop or Cline. What does MCP give you that just defining the function
in your own agent does not?

| Field | Value |
| --- | --- |
| Source | Day 23 *Model Context Protocol*, Day 24 *Full Integration* |
| Competency | CONCEPTUAL |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | 1 |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. The tool becomes callable by any MCP-compatible client, not just their agent
2. Separates the tool server from the model/host application
3. A standard protocol rather than a per-framework tool definition
4. Describes registering the server and confirming a real tool call
5. Enterprise angle — one governed tool surface, many clients

**Follow-up prompt.** *"Who else could call your `check_coverage` tool once it speaks MCP?"*

**Why this assesses real cohort learning.** Day 23 requires standing up
`mcp_server.py`, registering it in a real client, and confirming a tool call.
The question separates candidates who see MCP as "another way to write tools"
from those who see it as a decoupling boundary — which is the entire point of
the protocol.

### d31-q12 (new — Capstone, Day 31)

**Question.** What is the top item on your v2 roadmap, and why did it beat
everything else on the list?

| Field | Value |
| --- | --- |
| Source | Day 31 *Capstone — End-to-End Review & Roadmap* (project day) |
| Competency | PROBLEM_SOLVING |
| Difficulty | hard |
| Minimum evidence | 3 of 5 |
| Max follow-ups | **2** |
| Follow-up condition | fewer than 3 evidence items met |

**Expected evidence.**
1. Names one specific top roadmap item
2. Gives the reason it outranked the others — impact, risk, or cost
3. References evidence from the five live scenarios or Langfuse traces
4. Acknowledges a known weakness of what they actually shipped
5. Notes that formal compliance review is still outstanding

**Follow-up prompt.** *"What did you leave on the list, and why does it wait?"*

**Why this assesses real cohort learning.** Day 31 requires running five live
scenarios against the deployed system, then writing a retrospective and a
*prioritised* v2 roadmap including compliance review. Prioritisation under
constraint is the most senior skill in the programme — anyone can list
improvements, few can defend an ordering. Item 4 rewards honest appraisal of
one's own system, the same instinct rewarded in q06. As the closing question of
an exit interview it also ends the conversation on the candidate's own judgement
rather than a recall check.

---

## 5. DAY_31 replaces `ProgramInterview`

Milestones are now clean, with no duplicate interview:

```
day 15 ──── DAY_15   (new)
day 31 ──── DAY_31   (new) ── replaces the ProgramInterview exit interview
```

Authorised on the basis that the existing exit interview was never fully rolled
out. Two things must be settled before any code moves.

### 5.1 One behavioural difference in the gate

| | Existing `ProgramInterview` | Proposed `DAY_31` |
| --- | --- | --- |
| Gate | `progressDay >= 31` **OR `cohort.endsAt` has passed** | all of days 1–31 passed |
| Effect | a member who never finished can still interview once the cohort ends | a member who never finished is locked out |

The `cohortEnded` escape hatch is a real product decision, not an oversight —
it lets stragglers still produce a talent signal. Our stricter rule removes it.
**Decision needed:** keep the escape hatch (add "or cohort ended" to DAY_31), or
accept that only members who complete all 31 days get the exit interview.
Recommendation: **keep the stricter rule**, since the whole premise is assessing
only completed work — but this changes who can be interviewed, so it is yours.

### 5.2 A hidden dependency that a text search misses

`ProgramInterview` is consumed through the **relation name `interview`**, not
the model name, so grepping for "ProgramInterview" does not find these:

| File | Reads |
| --- | --- |
| `src/features/talent-pool/pool.ts` | `interviewOverall` in the pool listing (ranking/display), and `status`, `overallScore`, `commScore`, `techScore`, `problemScore`, `summary` in the full recruiter profile |
| `src/features/program/admin.ts` | admin views |
| `src/app/actions/admin-program-export-actions.ts` | `exportProgramInterviewsAction` — CSV export |
| `src/components/program/program-export-buttons.tsx` | calls the export action |
| `src/app/admin/program/interviews/page.tsx` | admin interview list |
| `src/app/program/(app)/interview/page.tsx` + `src/components/program/interview-client.tsx` | candidate-facing voice interview |

**The score shapes do not map one-to-one:**

| `ProgramInterview` | `GeneralInterview` |
| --- | --- |
| `commScore` | `communicationScore` |
| `techScore` | `technicalDepthScore` |
| `problemScore` | `problemSolvingScore` |
| — | `conceptualScore` *(new)* |
| — | `practicalScore` *(new)* |
| `overallScore` | `overallScore` |

Three map cleanly; two are new. `/talent` is a live recruiter surface, so
repointing it is **not** building recruiter features — it is avoiding breaking an
existing one. It must be in scope for the replacement even though recruiter work
is otherwise deferred.

### 5.3 Recommended replacement sequence (non-destructive)

1. Build DAY_15 + DAY_31 alongside `ProgramInterview`, changing nothing.
2. Repoint `talent-pool/pool.ts` and `program/admin.ts` to read
   `GeneralInterview`, falling back to `ProgramInterview` where no new result
   exists.
3. Stop routing candidates to `/program/(app)/interview` — the entry point goes,
   the code stays.
4. Leave the `ProgramInterview` **table and data in place**. Do not drop it in
   this phase.
5. Remove the dead code and the model in a later, separate cleanup once the new
   interview has real results.

Deleting the model in the same change as building its replacement means any
existing attempt data is unrecoverable and there is no rollback. Deprecating
first costs one extra migration later and keeps the door open.
**Precondition to confirm:** are there any real `ProgramInterview` rows in
production today? If yes, step 4 is mandatory rather than advisory.

---

## 6. Eligibility, restated

```ts
day15Eligible = [1..15].every(d => passedDays.has(d))
day31Eligible = [1..31].every(d => passedDays.has(d))
```

(Pending the §5.1 decision on whether `cohort.endsAt` also unlocks DAY_31.)

`passedDays` comes from `collectPassSkipSets(ProgramMissionSubmission[])` —
`passed === true` only. Skipped days are `passed: false` and never count.

Explicit set membership, not `getMemberProgressDay() >= 15`: `deriveDayState`
takes a `bypassLocks` flag and `getMaxContentDay` accepts an admin
`highestUnlockedDay` floor, so a bypassed member could hold a passed day 20
without days 1–19. The explicit check is immune to that.

**Not used for eligibility:** `getMaxContentDay`,
`getCalendarDerivedMaxContentDay`, `highestUnlockedDay`, `getCohortCalendarDay`
— all describe availability, not completed work.

Each blueprint is claimable once, enforced by a partial unique index on
COMPLETED rows only; abandoned and invalid attempts consume nothing.

---

## 7. Review checklist

- [ ] DAY_15 questions are answerable from days 1–15 alone
- [ ] DAY_31 is meaningfully deeper, not merely longer
- [ ] Expected-evidence items are observable in a *spoken* answer
- [ ] Minimum-evidence thresholds are achievable under voice pressure
- [ ] Follow-up triggers fire on genuine gaps, not on phrasing
- [ ] `d15-q03` is the right sole zero-follow-up question
- [ ] `d31-q06` item 5 — honest negative results scoring well — is intended
- [ ] Swap `d31-q11` (MCP) in for `d31-q09`, and add `d31-q12` (Capstone)? (§4)
- [ ] Competency mix matches how you want candidates ranked

**Replacement decisions (§5):**

- [ ] §5.1 — does DAY_31 keep the `cohort.endsAt` escape hatch, or require all 31 days passed?
- [ ] §5.2 — `/talent` repointing is in scope for this phase (it breaks otherwise)
- [ ] §5.3 — deprecate `ProgramInterview` first, drop the model in a later cleanup
- [ ] Are there real `ProgramInterview` rows in production today?
