Yes. For an **AI interviewer agent**, you should not store the concepts as a normal tutorial. The agent needs a **knowledge base with concept definitions, what the candidate should understand, interviewable dimensions, common misconceptions, follow-ups, and expected answer depth**.

Below is a Markdown format you can directly use as an interviewer knowledge file. It is grounded in the Day 1–15 material you provided. The curriculum explicitly progresses through environment setup, LLMs, structured/unstructured data, knowledge bases, embeddings, vector databases, retrieval, RAG, prompting, tool calling, and fine-tuning/LoRA/QLoRA.

---

# AI INTERVIEWER KNOWLEDGE BASE — DAYS 1–15

## Purpose

This document trains an AI interviewer to evaluate whether a beginner actually understands the concepts introduced during Days 1–15.

The interviewer should:

* test understanding rather than memorization
* start with simple questions
* progressively increase difficulty
* ask follow-ups based on the candidate's answer
* distinguish conceptual understanding from implementation knowledge
* ask "why" and "what happens if" questions
* identify misconceptions
* connect concepts across different days
* avoid expecting knowledge that was not introduced by Day 15

---

# DAY 1 — PYTHON ENVIRONMENT & DEVELOPMENT BASICS

## Core Concepts

### Python Interpreter

**Beginner explanation:**

The Python interpreter is the program that actually executes Python code.

VS Code is only the editor. Python is what runs the code.

### Virtual Environment

A virtual environment creates an isolated Python environment for a project.

It allows different projects to have different package versions without conflicts.

### pip

`pip` is Python's package installer.

It installs packages into the currently active Python environment.

### Dependencies

Dependencies are external packages that a project needs to run.

They are commonly recorded in `requirements.txt`.

### Debugging

Debugging means finding and fixing problems in a program.

A breakpoint pauses execution so the developer can inspect the current state of the program.

### Git

Git is a version-control system.

A commit records a version of the project.

A push sends local commits to a remote repository.

### .gitignore

`.gitignore` specifies files that Git should not track.

Typical examples include:

* `.venv`
* `__pycache__`
* `.env`
* generated files

---

## What the Candidate Should Understand

A beginner should be able to explain:

* why virtual environments exist
* difference between Python and VS Code
* why dependencies are installed
* what a Git commit represents
* difference between commit and push
* why `.env` should not be committed

---

## Basic Interview Questions

### Q1

What is a virtual environment in Python?

**Expected understanding:**

An isolated environment where project-specific Python packages and versions can be installed without affecting other projects.

### Q2

Why shouldn't every Python project use the system-wide Python packages?

**Expected understanding:**

Different projects may require different package versions, causing dependency conflicts.

### Q3

What is the difference between `git commit` and `git push`?

**Expected:**

`commit` records changes locally; `push` sends those commits to a remote repository.

---

## Follow-ups

If candidate says:

> "Virtual environments isolate dependencies."

Ask:

> What problem could occur if two projects require different versions of the same package?

If candidate says:

> "Commit saves the changes."

Ask:

> Where are those changes saved after a commit but before a push?

---

## Common Misconceptions

* VS Code is the Python interpreter.
* GitHub and Git are the same thing.
* `git commit` automatically uploads code.
* `.gitignore` deletes files.
* A virtual environment makes Python itself faster.

---

# DAY 2 — LLMs & LOCAL AI

## Core Concepts

### LLM

An LLM is a language model trained on large amounts of data to generate and understand language.

### Parameters

Parameters are learned numerical values inside a model.

Model sizes such as `3B`, `7B`, or `14B` refer approximately to billions of parameters.

### Local LLM

A local LLM runs on the user's own machine rather than requiring inference from a remote provider.

### Ollama

Ollama provides a convenient way to run and interact with local models.

The curriculum uses Ollama's local API.

### API

An API provides a defined interface through which one program communicates with another.

---

## What the Candidate Should Understand

The candidate should understand:

```text
Application
    ↓
API
    ↓
LLM
    ↓
Response
```

They should also understand the basic trade-offs of local models:

* privacy
* hardware requirements
* cost
* latency
* model capability

---

## Basic Questions

### Q1

What is an LLM?

**Expected:**

A machine-learning model designed to process and generate language, trained on large amounts of data.

### Q2

What does 7B mean when talking about a model?

**Expected:**

Approximately 7 billion parameters.

### Q3

What is the advantage of running an LLM locally?

**Expected:**

Data can remain local and there may be no per-request cloud inference cost, but the machine must have sufficient resources.

---

## Follow-ups

If candidate says:

> "A larger model is better."

Ask:

> Is a larger model always the best choice for an application? Why or why not?

Good candidates should mention trade-offs such as:

* memory
* latency
* cost
* task requirements

---

## Common Misconceptions

* 7B means 7 billion training examples.
* Larger models are always better.
* Ollama itself is the LLM.
* An API is the model.
* Local inference requires no hardware resources.

---

# DAY 3 — CHATBOT, API & STATE

## Core Concepts

### LLM API Call

A program sends a request containing information/instructions to the LLM and receives a generated response.

### Stateless LLM Calls

Individual API calls do not automatically remember previous calls.

If an application wants conversation history, it must provide the relevant history again.

### Conversation Memory

At this stage, memory is primarily implemented by storing previous messages and including them in future requests.

### FastAPI

FastAPI allows Python applications to expose HTTP API endpoints.

Example:

```text
GET /health
```

### Git Workflow

Understand:

```text
edit
 ↓
git add
 ↓
git commit
 ↓
git push
```

---

## Key Interview Concept

Ask the candidate:

> If I tell the chatbot my name and then make a completely new API request asking for my name, how does the model know it?

Expected understanding:

> It doesn't automatically know. The application needs to send the previous conversation/history as part of the new request.

---

## Follow-ups

> Where should conversation history live?

Possible answer:

> In the application/backend/database/session state, depending on the architecture.

Then ask:

> What happens if the conversation becomes extremely long?

This tests whether they understand that sending increasing amounts of history has cost/context implications.

---

# DAY 4 — STRUCTURED DATA

## Core Concepts

### Structured Data

Data organized into predictable fields, rows and columns.

Examples:

* CSV
* Excel-like tables
* SQL databases

### Pandas DataFrame

A DataFrame is a tabular data structure used by Pandas.

### SQL

SQL is used to query and manipulate relational databases.

### WHERE

Filters rows.

### JOIN

Combines related information from tables.

### GROUP BY

Groups rows so aggregate operations can be performed.

### SQLite

A lightweight relational database that can be stored locally.

---

## Beginner Mental Model

```text
Database
 ├── plans
 └── claims

plans.plan_id
       ↓
claims.plan_id

JOIN
       ↓
Combined information
```

---

## Questions

### Q1

What is structured data?

### Q2

Why would you use SQL instead of an LLM to find a user's claim status?

**Expected:**

Because claim status is structured and deterministic. A database query is more reliable and precise.

### Q3

What does a JOIN do?

**Expected:**

Combines related records from multiple tables using a relationship between columns.

---

## Important Follow-up

Ask:

> Would you use vector search to find a claim with ID `C12345`?

Good answer:

> Not necessarily. If the claim is stored structurally, a database lookup is more appropriate.

---

# DAY 5 — UNSTRUCTURED DATA

## Core Concepts

### Unstructured Data

Information that doesn't naturally fit into rows and columns.

Examples:

* PDFs
* Word documents
* scanned forms
* web pages
* policy documents

### Text Extraction

Converting documents into machine-readable text.

### OCR

OCR converts text contained inside images/scans into machine-readable text.

### Web Scraping

Extracting relevant information from publicly accessible webpages.

### Text Normalization

Cleaning extracted text by handling things such as:

* unnecessary whitespace
* duplicate content
* headers/footers
* encoding issues

---

## Important Distinction

Ask:

> What's the difference between PDF text extraction and OCR?

Expected:

**Text extraction** works when the PDF already contains machine-readable text.

**OCR** is needed when the document is essentially an image/scan.

---

## Follow-ups

> What problems can OCR introduce?

Expected:

* incorrect characters
* poor handling of handwriting
* checkbox recognition issues
* formatting loss

---

# DAY 6 — KNOWLEDGE BASE & CHUNKING

## Core Concepts

### Knowledge Base

A collection of information organized so that an application can retrieve relevant information later.

### Chunking

Breaking large documents into smaller pieces.

### Chunk Size

Controls how much text is contained in each chunk.

### Chunk Overlap

Allows neighboring chunks to share some text/context.

The Day 6 implementation uses:

```text
chunk_size = 500
chunk_overlap = 50
```



### Metadata

Additional information attached to each chunk.

Example:

```json
{
  "id": "...",
  "text": "...",
  "source_file": "...",
  "source_type": "unstructured",
  "plan_type": "...",
  "section": "coverage"
}
```

The curriculum specifically emphasizes metadata such as `source`, `section`, `plan_type`, and document type because these become important for filtering later. 

---

## Questions

### Q1

Why do we chunk documents?

### Q2

Why might chunks overlap?

### Q3

What happens if chunks are too large?

Expected:

They may contain too much unrelated information and retrieval may become less precise.

### Q4

What happens if chunks are too small?

Expected:

Important context may be separated across chunks.

---

## Strong Follow-up

> Why is metadata useful if the embedding already represents the meaning of the text?

Expected:

Embeddings help with semantic similarity, while metadata allows explicit filtering such as plan type or section.

---

# DAY 7 — EMBEDDINGS

## Core Concept

An embedding is a numerical vector representation of text meaning.

Example:

```text
"physical therapy coverage"
        ↓
[0.12, -0.43, 0.81, ...]
```

The Day 7 curriculum specifically covers dense vector representations, embedding models, similarity metrics and dimensionality trade-offs. 

---

## Similarity

Vectors can be compared using:

* cosine similarity
* dot product
* Euclidean distance

The basic intuition:

> Similar meanings should produce vectors that are relatively close according to the chosen similarity measure.

---

## Questions

### Q1

Why do we need embeddings?

### Q2

Why might these two questions have similar embeddings?

> "Is physiotherapy covered?"

> "Does my plan pay for physical therapy?"

Because their semantic meaning is similar even though their wording differs.

---

## Strong Follow-up

> Are embeddings the same thing as the original text?

Expected:

No. They are numerical representations of the text's semantic information.

---

## PCA

PCA reduces high-dimensional data into fewer dimensions for analysis/visualization.

The Day 7 implementation reduces embeddings to **2 dimensions** for visualization. 

---

# DAY 8 — VECTOR DATABASES

## Core Concepts

### Vector Database

A database designed to store and search vector representations efficiently.

Examples introduced include:

* Chroma
* Pinecone

### Collection

A logical container for vectors/documents/metadata.

### Vector Search

Search based on similarity between vectors rather than exact keyword matching.

### Index

A structure designed to make searching more efficient.

---

## Question

> Why not just store embeddings in a normal Python list?

Expected:

You could for a tiny dataset, but it becomes inefficient at scale. Vector databases provide optimized storage, indexing and retrieval capabilities.

---

## Strong Follow-up

> What does the vector database actually return?

Expected:

Relevant stored records, typically including documents/chunks and associated metadata, based on similarity.

---

# DAY 9 — POPULATING & QUERYING VECTOR DB

## Core Concepts

### Embedding Pipeline

```text
Document
   ↓
Chunk
   ↓
Embedding
   ↓
Vector Database
```

### Query Pipeline

```text
User Question
      ↓
Embedding
      ↓
Vector Search
      ↓
Relevant Chunks
```

### Metadata Filtering

Example:

```text
plan_type = "Silver"
```

The vector search can be restricted using metadata.

### Upsert

Adding/updating records in the vector database.

---

## Interview Scenario

Ask:

> You have 100,000 chunks. A user asks whether physical therapy is covered under the Silver plan. Walk me through what happens.

Strong answer should approximately describe:

```text
Question
 ↓
Embedding
 ↓
Vector DB
 ↓
Metadata filtering
 ↓
Similarity search
 ↓
Top relevant chunks
```

---

# DAY 10 — RETRIEVAL / MATCHING ENGINE

## Core Concept

Not every question should use the same retrieval mechanism.

The curriculum introduces:

* structured search
* vector search
* routing
* hybrid retrieval
* reranking



---

## Router

A router decides what type of retrieval is appropriate.

Example:

```text
Question
   ↓
Router
 ┌──────┼──────┐
 ↓      ↓      ↓
SQL   Vector   Both
```

---

## Hybrid Retrieval

Combining different retrieval strategies.

Example:

> "What is my deductible and is physical therapy covered?"

Potentially:

```text
deductible → SQL
coverage → vector retrieval
```

---

## Reranking

Initial retrieval may produce several candidates.

A reranker determines which retrieved results are most relevant.

---

## Interview Scenario

> A vector search returns five chunks, but only two actually answer the question. What could you do?

Expected:

Use reranking, better chunking, metadata filtering, better embeddings, or improved retrieval logic.

---

# DAY 11 — RAG

## Core Concept

RAG = **Retrieval-Augmented Generation**.

Basic pipeline:

```text
Question
   ↓
Retrieve relevant information
   ↓
Context
   ↓
Prompt
   ↓
LLM
   ↓
Answer
```

---

## Why RAG?

RAG allows the model to answer using external knowledge that isn't necessarily contained in the model's training data.

It is particularly useful for:

* company documents
* policies
* internal knowledge
* changing information

---

## Grounding

The LLM is instructed to answer based on retrieved context.

---

## Streaming

Instead of waiting for the complete response, tokens/content can be delivered incrementally.

---

## Interview Question

> What problem does RAG solve that prompting alone doesn't?

Expected:

Prompting changes instructions, while RAG supplies relevant external information to the model.

---

## Strong Follow-up

> If the retriever retrieves the wrong document, can the LLM magically fix the problem?

Expected:

Not reliably. Poor retrieval can lead to poor or unsupported answers.

This is a key understanding checkpoint.

---

# DAY 12 — PROMPT ENGINEERING

## Concepts

### System Prompt

Defines high-level behavior, constraints, persona and instructions.

### User Prompt

Contains the user's request.

### Zero-Shot

Ask the model to perform a task without providing examples.

### Few-Shot

Provide examples to demonstrate the desired behavior.

### Prompt Templates

Reusable prompts containing variables.

Example:

```text
Answer the question using this context:

Context:
{context}

Question:
{question}
```

The curriculum also explores system-prompt variants and compares them using accuracy, tone, conciseness and compliance. 

---

## Interview Question

> Why might few-shot prompting improve output quality?

Expected:

Examples demonstrate the desired pattern, format, tone or behavior to the model.

---

## Strong Follow-up

> If your model gives incorrect factual information because the required document wasn't retrieved, would adding more prompt instructions necessarily fix it?

Expected:

No. The underlying problem may be retrieval rather than prompting.

---

# DAY 13 — FUNCTION CALLING & STRUCTURED OUTPUTS

## Core Concepts

### Tool Calling

The model decides that it needs an external function/tool and generates a structured request to invoke it.

Example:

```text
User:
What is the status of claim C123?

LLM:
Call get_claim_status

Tool:
Pending

LLM:
Your claim is currently pending.
```

The Day 13 tools include:

* `check_coverage`
* `get_claim_status`
* `get_plan_details`
* `estimate_out_of_pocket_cost`



---

## Tool Schema

A schema tells the model:

* tool name
* purpose
* required arguments
* argument types

---

## Structured Output

Instead of free-form text, the model can produce a predictable structure such as JSON.

### Pydantic

Pydantic can validate that structured data matches the expected schema.

---

## Interview Scenario

> Why would you use a tool instead of asking the LLM to answer directly?

Expected:

When the answer requires reliable external data or an action, such as querying a database.

---

## Strong Follow-up

> Should the LLM itself determine whether claim `C123` is pending?

Expected:

The LLM should request the claim-status tool; the authoritative database/tool should determine the status.

---

## Critical Concept

```text
LLM = reasoning/interface layer

Database/tool = source of authoritative structured information
```

---

# DAY 14 — FINE-TUNING

## Core Concepts

Fine-tuning adapts a model using examples of desired behavior.

The curriculum specifically emphasizes determining which problems fine-tuning can solve versus which are actually retrieval problems. 

---

## Prompting vs RAG vs Fine-Tuning

### Prompting

Changes instructions.

Useful for:

* tone
* formatting
* behavior
* constraints

### RAG

Provides external information.

Useful for:

* documents
* policies
* changing knowledge

### Fine-Tuning

Teaches consistent patterns/behavior from training examples.

Useful for:

* consistent terminology
* response style
* recurring behavior
* formatting patterns

---

## Critical Interview Question

> Your chatbot frequently gives the wrong deductible because the retriever returns the wrong policy chunk. Would fine-tuning fix this?

Expected:

No. That's primarily a retrieval/data problem.

---

## Another Question

> Your chatbot knows the correct answer but frequently forgets to use the required response style or disclaimer. Could fine-tuning help?

Expected:

Potentially yes, if the issue is consistent behavioral/output patterns rather than missing factual knowledge.

---

## Dataset

Day 14 prepares:

```text
20–30 examples
        ↓
25 training examples
5 held-out test examples
```

The test examples must not be used during training. 

---

# DAY 15 — LoRA / QLoRA

## Core Concepts

### LoRA

LoRA = Low-Rank Adaptation.

Instead of updating the entire base model, training focuses on smaller trainable adapter components.

### QLoRA

QLoRA combines quantization with LoRA to reduce memory requirements.

### PEFT

PEFT = Parameter-Efficient Fine-Tuning.

LoRA is an example of PEFT.

---

## Basic Mental Model

Traditional fine-tuning:

```text
Huge model
   ↓
Update many parameters
```

LoRA:

```text
Base model
   +
Small trainable adapter
```

QLoRA:

```text
Quantized base model
   +
LoRA adapter
```

---

## Evaluation

Day 15 explicitly requires comparing:

```text
Base model
     VS
Fine-tuned model
```

using the **5 held-out test questions** from Day 14. 

The comparison considers:

* tone
* correctness
* disclaimer usage
* terminology clarity

---

# CROSS-DAY CONCEPT CONNECTIONS

The interviewer should not only ask isolated questions.

It should test whether the candidate understands how the concepts connect.

---

## Connection 1 — Data → RAG

Ask:

> We have a 100-page PDF. How do we make it usable for RAG?

Expected chain:

```text
PDF
 ↓
Text extraction
 ↓
Cleaning
 ↓
Chunking
 ↓
Metadata
 ↓
Embeddings
 ↓
Vector DB
 ↓
Retrieval
 ↓
LLM
```

---

## Connection 2 — SQL vs Vector Search

Ask:

> When would you use SQL and when would you use vector search?

Expected:

```text
Structured / exact data
        ↓
       SQL

Semantic document knowledge
        ↓
    Vector search
```

---

## Connection 3 — Retrieval vs Generation

Ask:

> Which component is responsible for finding information and which is responsible for producing the natural-language answer?

Expected:

```text
Retriever
   ↓
finds relevant information

LLM
   ↓
generates answer
```

---

## Connection 4 — RAG vs Fine-Tuning

Ask:

> A company updates its policy every week. Would you fine-tune the model every week?

Expected:

No. RAG is more appropriate for frequently changing external knowledge.

---

## Connection 5 — LLM + Tools

Ask:

> Why should a chatbot use a database tool for claim status rather than asking the LLM to generate the status?

Expected:

Because the database is the authoritative source and the LLM should not invent factual database values.

---

# INTERVIEWER QUESTION DIFFICULTY

The interviewer should use three levels.

## Level 1 — Recall / Understanding

Examples:

> What is an embedding?

> What is a vector database?

> What is RAG?

> What is LoRA?

Use these to establish basic understanding.

---

## Level 2 — Application

Examples:

> Why would you use a vector database instead of SQL for a policy document?

> Why do chunks overlap?

> When would you use OCR?

> Why would you use metadata filtering?

These test whether the candidate can apply the concept.

---

## Level 3 — Reasoning / Architecture

Examples:

> Your RAG chatbot gives incorrect answers even though the LLM is capable. How would you debug it?

Expected areas:

```text
data quality
 ↓
chunking
 ↓
embeddings
 ↓
retrieval
 ↓
metadata filtering
 ↓
reranking
 ↓
prompt
 ↓
generation
```

Another:

> Design a chatbot that can answer both "What's my claim status?" and "Is physiotherapy covered?"

Strong answer:

```text
                 User
                   ↓
                 Router
              /          \
             ↓            ↓
           SQL          Vector DB
             \            /
              \          /
                 Context
                   ↓
                  LLM
                   ↓
                Answer
```

---

# INTERVIEWER FOLLOW-UP RULES

The interviewer should behave differently depending on the candidate's answer.

### If answer is correct but shallow

Ask:

> Why?

Then:

> Can you give an example?

Then:

> What could go wrong?

---

### If answer is partially correct

Do not immediately reveal the answer.

Ask a narrower question.

Example:

Candidate:

> "RAG helps the model know more information."

Interviewer:

> "Where does that additional information come from?"

Then:

> "What happens between the user's question and that information reaching the LLM?"

---

### If candidate gives memorized terminology

Ask for an example.

Example:

Candidate:

> "We use embeddings for semantic similarity."

Interviewer:

> "Give me two questions that would have similar embeddings even though they use different words."

---

### If candidate confuses concepts

Test the distinction.

Example:

Candidate:

> "Fine-tuning is used to add company knowledge."

Interviewer:

> "Suppose the company's policy changes every Monday. Would you retrain the model every Monday? Why?"

---

# HIGH-VALUE MISCONCEPTIONS TO DETECT

The interviewer should actively look for these.

| Misconception                             | Correct understanding                                         |
| ----------------------------------------- | ------------------------------------------------------------- |
| VS Code runs Python                       | Python interpreter executes Python                            |
| Ollama is the LLM                         | Ollama provides local model management/runtime/API            |
| Bigger model is always better             | Model choice involves capability/resource/cost trade-offs     |
| LLM automatically remembers everything    | Application must manage conversation context                  |
| Embeddings are stored text                | Embeddings are numerical representations                      |
| Vector DB replaces SQL                    | They solve different retrieval problems                       |
| RAG trains the model                      | RAG retrieves external information                            |
| Prompting adds new knowledge              | Prompting primarily changes instructions/context              |
| Fine-tuning fixes bad retrieval           | Fine-tuning doesn't solve missing/wrong retrieved information |
| LLM should know database values           | Tools/databases should provide authoritative structured data  |
| More chunks always means better retrieval | Chunk size and overlap affect retrieval quality               |
| OCR and PDF extraction are identical      | OCR is needed when text is image-based                        |
| LoRA retrains the entire model            | LoRA uses parameter-efficient adapters                        |
| Test data can be used for training        | Held-out test data must remain unseen during training         |

---

# MASTER INTERVIEW SCENARIO

Use this as a final Day 1–15 checkpoint.

> **You are asked to build a chatbot for an insurance company. It needs to answer questions about policy documents, retrieve plan information, check claim status, and respond naturally. Explain how you would design the system using what you learned in Days 1–15.**

A strong beginner answer should gradually reach something similar to:

```text
                  USER
                    │
                    ▼
                CHAT API
                    │
                    ▼
                  ROUTER
              ┌─────┴─────┐
              │           │
              ▼           ▼
          STRUCTURED   UNSTRUCTURED
             DATA          DATA
              │              │
             SQL       Vector Search
              │              │
              │          Embeddings
              │              │
              │        Vector Database
              │              │
              └──────┬───────┘
                     ▼
                 RETRIEVED
                  CONTEXT
                     │
                     ▼
                    RAG
                     │
                     ▼
                   LLM
                     │
              ┌──────┴──────┐
              │             │
         Tool Calling   Final Answer
              │
          Database/API
```

Then the interviewer should follow up:

1. **Why SQL for claims?**
2. **Why embeddings for policy documents?**
3. **Why chunk documents?**
4. **Why metadata?**
5. **What happens if retrieval returns irrelevant chunks?**
6. **How does RAG help the LLM?**
7. **When would you use tool calling?**
8. **Would fine-tuning fix bad retrieval?**
9. **What could LoRA change compared with full fine-tuning?**
10. **How would you evaluate whether your fine-tuned model actually improved?**

This gives your interviewer agent a **concept graph**, rather than just a list of definitions. That is much more useful for a real interview because it lets the agent move from **definition → application → reasoning → architecture → misconception detection** while staying within the Day 1–15 knowledge boundary.
