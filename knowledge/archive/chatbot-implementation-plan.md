# ABTalks Knowledge Assistant — Implementation Plan

## 1. Project Goal

Build a small, website-embedded ABTalks Help Assistant.

The user sees a compact chat bubble in the corner of the ABTalks website. Clicking it opens a small chat panel with:

- A short welcome message
- A handful of suggested questions
- A normal text input so the user can ask anything
- Grounded answers from the approved ABTalks knowledge base
- A strict fallback when the knowledge base cannot support an answer

This is **not** a general-purpose chatbot.

### Core rule

> The assistant may answer only from approved ABTalks knowledge. If the retrieved knowledge does not contain enough information to answer reliably, the assistant must not guess, infer unpublished information, or use general model knowledge. It must direct the user to the official ABTalks support email.

The target behavior is:

```text
User question
      |
      v
Retrieve relevant ABTalks knowledge
      |
      v
Is there enough authoritative information?
   /                     \
 YES                      NO
 |                         |
 v                         v
Answer from context       Fallback
                           |
                           v
                  Contact team@abtalks.in
```

---

# 2. What the Assistant Should Know

The knowledge base should cover all publicly answerable ABTalks information that is available in the supplied source material.

## Main knowledge areas

1. ABTalks identity and positioning
2. What ABTalks is
3. Why ABTalks exists
4. Who ABTalks is for
5. Anil Bajpai
6. ABTalks community
7. 60-Day Coding Challenge
8. 60-Day Claude AI Challenge
9. AI Cohort
10. AI Tools Workshop
11. Figma × Cursor AI/UI/UX Workshop
12. ViCodathon / Vibe Code Hackathon
13. Hackathon rules
14. Hackathon submission requirements
15. Hackathon judging and verification
16. Community rules
17. Certificates
18. Registration
19. Events
20. Social channels
21. Contact information
22. Website sections
23. Publicly described recruiter/talent ecosystem
24. Publicly described ABTalks vision and future direction
25. FAQs and common variations of already-answered questions

The assistant should be able to answer the same fact even when the user phrases the question differently.

Example:

```text
Stored knowledge:
"Students from all years in BTech can participate."

User:
"Can a second-year student join?"

Answer:
"Yes. Students from all years of BTech can participate."
```

Do not manually create dozens of identical FAQ variants. RAG/semantic retrieval should handle natural-language variation.

---

# 3. Important Source Interpretation Rules

The supplied documents are NOT all from the same date.

They are snapshots of ABTalks at different points in time. The knowledge system must preserve source dates and scope instead of treating every document as simultaneous.

## Confirmed interpretation for this project

### Community numbers

The `10,000+` figure is the overall ABTalks community figure.

The older approximately `2,400+` figure was associated with the hackathon context and subsequently increased.

Therefore, these are not automatically a contradiction.

When a question asks about the overall ABTalks community, use the current overall community figure from the appropriate source.

### Instagram

The current official identity is:

`@abtalksonai`

The older `@abtalks_official` reference should not be used as the current official Instagram identity because it was flagged for duplication.

### Workshops

The following are separate offerings:

1. The broader/free AI Tools Workshop
2. The Figma × Cursor AI/UI/UX Workshop

They must not be merged into one workshop.

### Dates

Documents represent different moments.

The knowledge system must distinguish:

- historical
- current
- upcoming
- expired
- unknown

A historical event must not be presented as currently open for registration.

---

# 4. Repository Structure

Use the existing `abtalksapp` repository.

This knowledge system is part of the application, but the knowledge files are NOT React components.

Recommended structure:

```text
abtalksapp/
│
├── src/
│   └── components/
│       └── chatbot/
│           ├── ChatBubble.tsx
│           ├── ChatPanel.tsx
│           ├── ChatMessage.tsx
│           ├── SuggestedQuestions.tsx
│           ├── ChatInput.tsx
│           └── chatbot.css / styles
│
├── knowledge/
│   ├── raw/
│   │   ├── master-fact-sheet/
│   │   ├── abtalks-overview/
│   │   ├── workshops/
│   │   ├── vicodathon/
│   │   └── strategy/
│   │
│   ├── processed/
│   │   ├── abtalks.md
│   │   ├── anil-bajpai.md
│   │   ├── programs.md
│   │   ├── coding-challenge.md
│   │   ├── claude-challenge.md
│   │   ├── ai-cohort.md
│   │   ├── workshops.md
│   │   ├── vicodathon.md
│   │   ├── community.md
│   │   ├── events.md
│   │   ├── socials-and-contact.md
│   │   ├── website.md
│   │   └── faq.md
│   │
│   └── metadata/
│       ├── sources.json
│       └── facts.json
│
├── docs/
│   └── plans/
│
└── ...
```

## Why three knowledge layers?

### `raw/`

Original source material.

Never rewrite the source files here.

This is the evidence layer.

### `processed/`

Clean, human-readable ABTalks knowledge extracted from the raw material.

This is the primary retrieval layer.

### `metadata/`

Source authority, dates, scope, status, and provenance.

This makes answers traceable and allows newer authoritative information to beat older material.

---

# 5. Source File Conversion Plan

The following is the intended treatment of every currently supplied source.

---

## Source 1: ABTalks Master Fact Sheet PDF

### Role

This is the primary foundation for:

- ABTalks identity
- positioning
- audience
- operating model
- program index
- core program information
- community
- channels
- site map
- stakeholder value

The document states that it was compiled from the ABTalks website and relevant program pages on 31 July 2026.

### Convert into

```text
processed/abtalks.md
processed/programs.md
processed/community.md
processed/socials-and-contact.md
processed/website.md
```

### Extract

- ABTalks name
- description
- category
- audience
- tagline
- cost model
- contact
- why it exists
- operating model
- program list
- program durations
- URLs
- community figures
- social channels
- website sections
- stakeholder value

### Do NOT blindly copy

- temporary event dates
- old/ambiguous social handles
- stale countdown information
- facts that are clearly superseded by later official documents

Preserve the source date in metadata.

---

## Source 2: ABTalks Overview PPTX

### Role

Use this as a broad overview and visual/structural source for:

- What ABTalks is
- Why it exists
- operating model
- community
- program portfolio
- individual program positioning
- AI Cohort overview
- workshop overview

### Convert into

```text
processed/abtalks.md
processed/programs.md
processed/community.md
processed/ai-cohort.md
```

### Important

Because this is a presentation, inspect both:

- parsed text
- slide visuals/layout

Text alone may not capture relationships between sections.

Do not duplicate every sentence if the same fact already exists in a higher-authority source.

---

## Source 3: ABTalks Fact Sheet DOCX

### Role

Treat this as a duplicate/alternate representation of the Master Fact Sheet unless it contains information not present in the PDF.

### Action

Compare against the PDF.

If content is identical:

```text
DO NOT create a second knowledge entry.
```

Use one canonical fact and retain both sources in metadata if useful.

If the DOCX contains additional information:

- extract only the additional facts
- attach the DOCX as a supporting source

---

## Source 4: ABTalks Fact Sheet PDF

### Role

Same treatment as the Master Fact Sheet.

If this is a duplicate version, do not ingest it twice.

The vector database should not contain five copies of the same paragraph merely because humans saved it in five formats.

---

## Source 5: AI Tools Workshop Program Overview

### Role

Primary source for:

- AI Tools Workshop
- workshop purpose
- duration
- format
- audience
- tools covered
- curriculum
- ongoing ABTalks programs
- examples of Claude Challenge projects
- AI Cohort positioning

### Convert into

```text
processed/workshops.md
processed/claude-challenge.md
processed/ai-cohort.md
```

### Extract

Workshop facts such as:

- approximately one hour
- live
- beginner-friendly
- free
- Google Meet or campus
- curriculum
- tools covered
- Q&A
- role of workshop in the ABTalks ecosystem

Do not turn the list of AI tools into claims about ABTalks itself.

For example:

```text
"NotebookLM is a source-grounded research assistant"
```

is workshop content about NotebookLM, not necessarily an ABTalks product.

---

## Source 6: Figma × Cursor AI/UI/UX Workshop PDF

### Role

This is a separate workshop.

Create a dedicated section in:

```text
processed/workshops.md
```

Cover:

- workshop name
- date/time as stated by the source
- duration
- platform
- price
- registration
- Figma fundamentals
- Cursor
- AI plugins
- Figma MCP × Cursor
- prompt-to-prototype
- design systems/tokens
- design-to-code
- Q&A
- upcoming event information contained in the source

### Critical rule

Do not merge this with the general AI Tools Workshop.

If the user asks:

> "What workshops does ABTalks have?"

the assistant may list both.

If the user asks:

> "What will I learn in the Figma workshop?"

retrieve the Figma × Cursor knowledge specifically.

---

## Source 7: ViCodathon 2026 Official Event Notice

### Role

This is the highest-authority source for the event-specific facts contained in the official notice.

### Convert into

```text
processed/vicodathon.md
processed/events.md
processed/faq.md
```

### Extract

- event name
- organizer
- mode
- eligibility
- team size
- intercollege participation
- registration fee
- registration deadline
- kickoff
- end
- duration
- theme
- building rules
- fair play
- required submissions
- results
- prizes
- certificate
- official registration
- support email

### Status

Because the event dates are now past relative to the current project date, mark the event:

```text
status: historical/completed
```

Do not let the chatbot answer "How do I register?" as if registration is still open.

---

## Source 8: ViCodathon Influencer Brief

### Role

Supporting source for:

- hackathon positioning
- content angles
- what makes the event different
- non-coder positioning
- AI usage log
- live deployment requirement
- portfolio value
- program ecosystem context

### Use it for

Additional explanatory answers such as:

> "What makes the hackathon different?"

> "Do I need to be a traditional coder?"

> "Why do I need an AI-usage log?"

### Do NOT use it to override the official event notice.

If the two conflict, the official event notice wins for operational rules.

---

## Source 9: Problem Statements & Judging Protocol PDF

### Role

This is extremely important for the hackathon knowledge base.

It contains detailed information about:

- the three hackathon briefs
- minimum deliverables
- out-of-scope requirements
- submission flow
- verification
- eligibility gate
- authenticity checks
- scored judging
- live steer
- judging rubric
- disqualifying conditions
- scaling/evaluation protocol

### Convert into

```text
processed/vicodathon.md
processed/vicodathon-judging.md
processed/faq.md
```

### Extract questions such as

- What are the hackathon problem statements?
- What are the three briefs?
- What does Brief 1 require?
- What does Brief 2 require?
- What does Brief 3 require?
- What is out of scope?
- What is the judging rubric?
- How many points are available?
- What is Live Steer?
- How does verification work?
- What causes a submission to fail eligibility?
- What is checked automatically?
- What counts as an authenticity flag?
- What causes disqualification?

Do not reduce this document to just a generic "hackathon FAQ." It contains the actual judging protocol.

---

## Source 10: ABTalks Investor / Seed Deck

### Role

Use for deeper questions about:

- Anil Bajpai's founder story
- why ABTalks exists
- long-term vision
- proof-of-work philosophy
- talent operating system
- capability graph
- marketplace
- business model
- roadmap

### Convert into

```text
processed/anil-bajpai.md
processed/abtalks-vision.md
```

### Important privacy/publicity rule

Only expose information that is appropriate for the public chatbot.

The deck contains business strategy and contact information intended for investor context.

Do NOT automatically expose:

- private email addresses
- fundraising details that are not public website facts
- internal business strategy
- confidential operational information

The chatbot is a public website assistant, not an investor relations leak machine.

If unsure whether a detail is public-facing, leave it out until explicitly approved.

---

# 6. The Knowledge Entry Format

Every processed fact should ideally have provenance.

A canonical fact can be represented like:

```json
{
  "id": "vicodathon.team-size",
  "topic": "ViCodathon 2026",
  "category": "hackathon",
  "fact": "Teams can contain 1 to 3 members.",
  "status": "historical",
  "source": "vicodathon-official",
  "source_date": "2026-08-06",
  "authority": "official"
}
```

For a current fact:

```json
{
  "id": "abtalks.instagram",
  "topic": "Socials",
  "category": "contact",
  "fact": "The official Instagram handle is @abtalksonai.",
  "status": "current",
  "source": "approved-current-brand-information",
  "authority": "official"
}
```

---

# 7. Source Priority Rules

When multiple documents contain information about the same thing:

## Priority 1

Current official ABTalks source specifically covering that subject.

## Priority 2

Later official ABTalks document.

## Priority 3

Earlier official ABTalks document.

## Priority 4

Supporting material such as an influencer brief.

## Priority 5

Strategic/investor material for strategic context.

The assistant should prefer the newest applicable authoritative fact.

---

# 8. RAG Design

The chatbot should use semantic retrieval.

The user does NOT need to use the wording of the stored FAQ.

Example:

Stored:

> "Students from all years in BTech can participate."

User:

> "I'm in second year, am I eligible?"

The retrieval system should find the eligibility fact.

The assistant then answers using that retrieved context.

---

# 9. Retrieval Must Have a Confidence Gate

Do NOT use:

```text
retrieve something
      ↓
LLM always answers
```

Use:

```text
retrieve
   ↓
evaluate relevance
   ↓
sufficient evidence?
   /          \
 yes          no
 |             |
answer       fallback
```

A related document is not automatically sufficient evidence.

Example:

Knowledge:

> ViCodathon is a 48-hour hackathon.

Question:

> "Is accommodation provided?"

The system must NOT infer an answer.

Fallback:

> "I don't have information about accommodation in my current ABTalks knowledge base. Please contact the ABTalks team at team@abtalks.in."

---

# 10. System Prompt

The eventual assistant system prompt should enforce:

```text
You are the ABTalks Knowledge Assistant.

Your job is to answer questions about ABTalks using ONLY the
provided approved knowledge context.

Rules:

1. Never invent facts.
2. Never use general world knowledge to fill a missing ABTalks fact.
3. Never infer policies, prices, eligibility, dates, availability,
   guarantees, partnerships, or outcomes unless supported by context.
4. Prefer newer authoritative information when sources conflict.
5. Respect the status of information:
   current, upcoming, historical, expired, or unknown.
6. If the retrieved context does not sufficiently answer the
   question, do not guess.
7. When information is unavailable, clearly say so and direct
   the user to team@abtalks.in.
8. Keep answers concise and conversational.
9. Answer the user's actual question rather than dumping
   unrelated ABTalks information.
10. Do not expose internal/private business information unless
    it has been explicitly marked public.
```

---

# 11. Suggested Questions in the UI

The chat bubble should show a small set of common questions.

Examples:

```text
What is ABTalks?
What programs does ABTalks offer?
What is the 60-Day Claude AI Challenge?
Tell me about the AI Cohort
What workshops are available?
Tell me about ViCodathon
How can I contact ABTalks?
```

These are just shortcuts.

The user must still be able to ask any question.

---

# 12. Fallback UX

Do not make the fallback sound like an error.

Bad:

> Error: No relevant documents found.

Better:

> I don't have enough information about that in my current ABTalks knowledge base.

Then:

> Please contact the ABTalks team at **team@abtalks.in** for help.

If the question is partially answerable:

> I can tell you that the AI Cohort is a 31-day program covering RAG, agents, MCP, guardrails, Docker and Kubernetes. I don't have information about the specific enrollment deadline you're asking about. Please contact **team@abtalks.in** for the current details.

---

# 13. What the Chatbot Must NOT Do

It must not:

- make up event dates
- invent fees
- invent prizes
- invent certificates
- promise internships
- promise jobs
- invent eligibility
- invent partnerships
- invent workshop schedules
- claim something is "coming soon" without source support
- reveal private investor information
- reveal private email addresses from internal documents
- answer unrelated general questions as though ABTalks knows them
- treat old event information as current
- combine two separate workshops into one
- treat supporting marketing material as stronger than an official operational document

---

# 14. First Knowledge-Building Phase

Before implementing RAG, complete this sequence:

### Step 1 — Organize raw sources

Put the original files under:

```text
knowledge/raw/
```

### Step 2 — Build source metadata

Create:

```text
knowledge/metadata/sources.json
```

### Step 3 — Extract canonical knowledge

Create the processed Markdown files.

### Step 4 — Resolve known source context

Document:

- source date
- source scope
- current/historical status
- authority

### Step 5 — Build FAQ examples

Create representative questions from every knowledge category.

Aim initially for approximately:

```text
100–150 canonical facts
+
80–120 representative questions
```

The number is a starting point, not a sacred cow.

### Step 6 — Review the knowledge manually

ABTalks team should approve the public-facing facts before indexing them.

### Step 7 — Index processed knowledge

Only approved processed knowledge goes into the vector retrieval system.

### Step 8 — Implement retrieval

User question → embeddings → relevant chunks.

### Step 9 — Add confidence/relevance gate.

### Step 10 — Connect the LLM.

### Step 11 — Build the chat bubble UI.

### Step 12 — Test with known and unknown questions.

---

# 15. Evaluation Dataset

Before calling this finished, create a test set.

## Known-answer tests

Examples:

```text
What is ABTalks?
Who is eligible for the 60-Day Coding Challenge?
What is the Claude AI Challenge?
How long is the AI Cohort?
What does the AI Cohort cover?
What workshops does ABTalks offer?
What is ViCodathon?
Can I participate alone?
What are the hackathon submission requirements?
What is the official Instagram handle?
```

Expected result:

```text
Correct grounded answer
```

## Paraphrase tests

```text
I'm in second year. Can I join the hackathon?
How many people can be on one hackathon team?
Is there a fee?
What do I need to submit?
Can I use AI tools?
```

Expected:

```text
Same underlying facts retrieved despite different wording.
```

## Unknown tests

These are even more important:

```text
Will ABTalks hire me after the Claude Challenge?
Do you provide hostel accommodation?
What is the salary of ABTalks interns?
Will I definitely get a job?
Can I get a refund?
When is the next 2027 hackathon?
```

If those facts are not in approved current knowledge:

```text
FALLBACK
```

The chatbot should score higher for **refusing correctly** than for confidently hallucinating an answer.

---

# 16. Definition of Done

The feature is complete when:

- [ ] Chat bubble appears on the ABTalks site
- [ ] Chat panel opens without taking over the page
- [ ] Suggested questions work
- [ ] Free-form questions work
- [ ] Semantic paraphrases retrieve the correct information
- [ ] Answers are grounded in approved context
- [ ] Current vs historical information is respected
- [ ] Source priority is respected
- [ ] Unknown questions trigger fallback
- [ ] No unsupported claims are generated
- [ ] Public/private information boundaries are respected
- [ ] Workshop offerings remain distinct
- [ ] Official current social identity is correct
- [ ] Hackathon information is treated according to its event status
- [ ] Knowledge can be updated without rewriting the chatbot UI
- [ ] Raw source documents remain preserved
- [ ] Each processed knowledge area has source provenance
- [ ] Known-question tests pass
- [ ] Paraphrase tests pass
- [ ] Unknown-question tests correctly refuse
- [ ] The final public knowledge base has been reviewed by ABTalks

---

# 17. The Immediate Task

Do NOT start by building the vector database.

Do NOT start by writing 100 questions manually.

Do NOT start by designing the chat bubble.

First:

```text
1. Create knowledge/raw/
2. Put every source document into its appropriate folder.
3. Create knowledge/metadata/sources.json
4. Create the processed knowledge files.
5. Review and approve those facts.
6. Then build RAG.
```

The knowledge base is the product's source of truth.

The chatbot is merely the interface that lets people ask it questions.
