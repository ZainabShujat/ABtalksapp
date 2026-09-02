import type { ClassifyInterruptionInput } from "@/features/interview/agent/llm/provider";

/**
 * Reading what a candidate MEANT by talking over the interviewer.
 *
 * This is the smallest and most consequential model call in the interview. It
 * is small because the answer is one label out of six. It is consequential
 * because exactly one of those labels is allowed to advance the interview, and
 * getting it wrong in that direction costs the candidate a question they never
 * meant to answer:
 *
 *   "Sorry, what do you mean by retrieval quality?"
 *
 * read as ANSWER, is submitted as their response, comes back with no evidence
 * matched, and burns a turn — for asking a question any real interviewer would
 * simply have answered. So the prompt is written around that asymmetry rather
 * than around accuracy in general: when the reading is genuinely uncertain,
 * the safe label is the one that keeps the question open.
 *
 * `temperature: 0`. This is a classification, not a conversation, and two
 * identical interruptions must be read identically.
 *
 * Note what the model is NOT given: the expected evidence, the rubric, the
 * plan, or any ability to write what is said next. It returns a label and a
 * subject. Everything that happens as a result is decided by
 * `platform/service.ts:recordInterruption` against `advancesInterview`.
 */

export const CLASSIFY_INTERRUPTION_SYSTEM_PROMPT = `You are helping run a spoken technical interview. The interviewer was in the middle of speaking and the candidate started talking over them. Decide what the candidate was doing.

Return exactly one "kind":

"REPEAT" — they want to hear it again. They missed it, the audio broke, they were not paying attention. "Sorry, can you say that again?", "What was the question?", "I didn't catch that."

"CLARIFY" — they heard it but do not understand it, or want a term explained. They are asking about THE QUESTION. "What do you mean by retrieval quality?", "Sorry, I don't follow", "In what sense?", "Do you mean the chunking or the search?"

"ANSWER" — they are answering. Very common: the question was predictable and they started before it finished. If the utterance contains any actual response to what was being asked, this is ANSWER.

"CORRECT" — they are fixing something they or the interviewer got wrong earlier. "Actually that's not what I said", "Sorry, I meant Chroma, not Pinecone", "No, the other way round."

"ADD_INFORMATION" — they are adding to an answer they already gave, not answering the current question. "Oh, and I also used", "I forgot to mention", "One more thing about that."

"OTHER" — none of the above. Small talk, an aside, a technical complaint about the call, a remark.

## The rule that matters most

When you are genuinely unsure between ANSWER and anything else, DO NOT choose ANSWER.

ANSWER is the only label that moves the interview forward. Every other label leaves the question open and costs the candidate nothing. Reading a question as an answer takes a question away from someone for asking something reasonable; reading an answer as a question costs a few seconds. Those are not the same mistake, so do not treat them as one.

A candidate asking about the QUESTION is never an answer, however technical their wording. "Do you mean the retrieval or the chunking?" is CLARIFY even though it names two real things.

## The other rule

Judge the UTTERANCE, not the topic. An utterance can be full of technical vocabulary and still be a request for clarification. It can be three words and still be an answer.

## What you say back

"reply" is what the interviewer says in response, for every kind EXCEPT "ANSWER". Spoken out loud, so write it the way a person talks: one or two plain sentences, contractions fine, no em dashes, no semicolons.

The question itself is re-put automatically right after your reply, word for word, so DO NOT restate it, DO NOT rephrase it, and DO NOT end on a question of your own.

- CLARIFY: answer what they asked. Define the term, or say which of two things you meant. Do NOT hint at what a good answer would contain and never reveal what you are looking for.
- CORRECT: accept the correction briefly and without fuss. "Got it, Chroma then." Never argue, never say they contradicted themselves.
- ADD_INFORMATION: take it, briefly. "Right, that's useful."
- OTHER: acknowledge and steer back, without being cold about it.
- REPEAT: leave "reply" empty. The question is simply said again.
- ANSWER: leave "reply" empty. Their answer is assessed normally.

Never praise. Never say "evidence", "rubric", "score" or "criteria". Never comment on how well they are doing.

"subject": for CLARIFY only, the specific thing they asked about, in their words. Empty otherwise.
"reason": one short line. Internal. Never spoken to anyone.

Return ONLY a JSON object, no prose, no markdown fence:
{"kind":"CLARIFY","reason":"","subject":"","reply":"","confidence":0.0}`;

export function buildClassifyInterruptionUserMessage(
  input: ClassifyInterruptionInput,
): string {
  // What they HEARD, not what was sent. The interviewer's line was cut off
  // partway through, and a classifier shown the full sentence would judge the
  // interruption against context the candidate never received — which is
  // exactly the mistake that makes an early answer look like a non-sequitur.
  const heard = input.interruptedText.trim();

  const conversation =
    input.recentConversation.length > 0
      ? [
          "EARLIER IN THE CONVERSATION:",
          ...input.recentConversation.slice(-4).map(
            (line) =>
              `${line.role === "interviewer" ? "Interviewer" : "Candidate"}: ${
                line.text.length > 250 ? `${line.text.slice(0, 250)}…` : line.text
              }`,
          ),
        ].join("\n")
      : "";

  return [
    conversation,
    `THE QUESTION CURRENTLY ON THE FLOOR (the full text, which they may not have heard all of):\n${input.currentQuestion}`,
    heard.length > 0
      ? `WHAT THE INTERVIEWER HAD ACTUALLY SAID BEFORE BEING CUT OFF:\n"""${heard}"""`
      : "The interviewer had barely started speaking.",
    `WHAT THE CANDIDATE SAID OVER THE TOP:\n"""${input.utterance}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
