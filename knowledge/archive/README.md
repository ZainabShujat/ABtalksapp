# knowledge/archive

Files here are **deliberately excluded from the chatbot's retrieval corpus**.
The chat API reads `knowledge/processed/` (and, once wired,
`knowledge/generated/`) — never this directory.

- `chatbot-implementation-plan.md` — the assistant's own internal build plan
  (architecture, retrieval design, file layout). It was sitting in
  `knowledge/processed/`, which meant internal implementation detail was
  retrievable by end users and its meta-instructions competed with real
  product knowledge in the context window. Kept for reference, not served.
