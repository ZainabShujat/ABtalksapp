import type { PhraseTurnInput } from "@/features/interview/agent/llm/provider";

/**
 * STAGE 2: writing what the interviewer actually says.
 *
 * WHY THIS IS A SEPARATE CALL FROM THE ASSESSMENT.
 *
 * Until now one `gpt-4o` completion, at `temperature: 0`, against a ~4,000-token
 * system prompt, produced all of this at once: a relevance judgement, a matched
 * evidence list, three evidence axes, flagged issues, an action proposal, the
 * reason for a follow-up, the target of that follow-up, the follow-up question
 * itself, an acknowledgement, a bridge, a clarification and a simplified
 * question. Two things went wrong and both are structural rather than a matter
 * of prompt wording:
 *
 *   1. TEMPERATURE. Assessment must be reproducible — two candidates giving the
 *      same answer have to get the same evidence read, or the interview stops
 *      being comparable, which is why stage 1 is pinned at zero. But zero is
 *      also what makes prose sound scripted: it is the setting that produces the
 *      single most likely sentence, every time, forever. Every conversational
 *      line in the interview was being generated under the constraint that
 *      exists to make GRADING fair. Those two jobs want opposite settings, and
 *      no single call can hold both.
 *
 *   2. ATTENTION. Roughly sixty per cent of that prompt was craft instruction
 *      about sounding human, competing for attention with the evidence
 *      checklist on every single turn, and charged on every single turn.
 *
 * So stage 1 now reports what it heard and decides what move to make. Stage 2 is
 * handed that decision AS STRUCTURED INTENT and writes the sentence. It cannot
 * change the action, cannot touch the evidence, and cannot choose a question —
 * it receives a decision that has already been routed through `policy.ts` and
 * turns it into English.
 *
 * Pure module: prompt strings and one builder, no SDK, no network, so the
 * wording that shapes every interview is reviewable in a single diff and
 * testable with an injected `askJson`.
 */

/**
 * Worked examples, chosen rather than invented.
 *
 * Each pair is a real failure mode this interview has actually produced, with
 * the move a competent human interviewer makes instead. They are here because
 * the difference between a good probe and "can you elaborate on that?" is not
 * something a rule captures — it is a thing you recognise, and a model
 * recognises it from examples far better than from adjectives.
 *
 * Kept small on purpose. Ten pairs is enough to establish the register; forty
 * would start dictating sentence shapes and every interview would converge on
 * them, which is the same scripted feeling by another route.
 */
export const FOLLOW_UP_EXAMPLES = [
  {
    reason: "unsupported_claim",
    answer: "I used Chroma because it was faster.",
    target:
      "claimed Chroma was faster but never said faster than what, or on what",
    bad: "Can you elaborate on that?",
    good: "You said Chroma was faster for your workload. What did you compare it against, and what actually got quicker?",
  },
  {
    reason: "worth_deepening",
    answer: "I used a local model because privacy was important.",
    target: "chose local for privacy, has not named what that cost them",
    bad: "Okay. Next question.",
    good: "Privacy was the main reason you went local. What did you have to give up to make that work?",
  },
  {
    reason: "vague",
    answer: "The retrieval sometimes returned the wrong chunk.",
    target:
      "reported bad retrieval, has not said how they diagnosed where it came from",
    bad: "Can you explain your project further?",
    good: "You mentioned it sometimes pulled the wrong chunk. How did you work out whether that was the retrieval or the way you were splitting the documents?",
  },
  {
    reason: "incomplete",
    answer: "Redis fixed the slow API.",
    target: "said Redis fixed a slow API, never said what was cached",
    bad: "Can you explain how Redis works?",
    good: "You said Redis sorted out the API slowdown. What were you actually caching, and why did that take the pressure off?",
  },
  {
    reason: "surprising",
    answer: "I set the chunk overlap to about half the chunk size.",
    target: "an unusually large overlap; wants the reasoning",
    bad: "That is interesting. Tell me more.",
    good: "Half the chunk size is a lot of overlap. What were you seeing that made you push it that far?",
  },
  {
    reason: "contradicts_earlier",
    answer: "I went with FAISS because it was simpler to set up.",
    target: "earlier said they picked FAISS for memory reasons",
    bad: "That contradicts what you said earlier.",
    good: "Earlier you said FAISS was about the memory ceiling. Here it sounds like setup. Help me square those two.",
  },
  {
    reason: "challenge_opportunity",
    answer:
      "I batched the embedding calls and cached them by document hash, which brought indexing down from minutes to seconds.",
    target: "strong answer; push on where the design breaks",
    bad: "Excellent, that is a great answer.",
    good: "That would hold up nicely at this size. Where does the hash cache start to hurt you once documents get edited a lot?",
  },
  {
    reason: "vague",
    answer: "I did some prompt engineering to make the output more consistent.",
    target: "no concrete change named",
    bad: "What is prompt engineering?",
    good: "What did the prompt look like before, and what did you change about it?",
  },
  {
    reason: "incomplete",
    answer: "It worked well in testing.",
    target: "no definition of well, no test method",
    bad: "Can you be more specific?",
    good: "What were you checking when you tested it? I want to know what counted as working.",
  },
  {
    reason: "worth_deepening",
    answer:
      "I had to switch models halfway through because the first one kept refusing.",
    target: "a real incident; wants what they observed and concluded",
    bad: "Why did you switch models?",
    good: "What were the refusals actually triggered by? I am curious whether you worked out the pattern.",
  },
] as const;

export const PHRASE_TURN_SYSTEM_PROMPT = `You are a senior engineer interviewing a candidate about work they built themselves. You have already read their answer and decided what to do next. Your only job now is to say it out loud, like a person.

You are given the decision, not asked to make it. You do NOT choose the question, you do NOT judge the answer, and you do NOT decide whether to move on. Write the words.

## How you sound

This is SPOKEN. You are talking, not writing. Plain sentences. Contractions. No em dashes, no en dashes, no semicolons, no bullet points, no lists.

Calm and unhurried. Genuinely curious about how they built the thing. You do not perform enthusiasm, you never flatter, and you never lecture.

NEVER praise. No "Excellent", "Great answer", "Fantastic", "Amazing", "Perfect". A good technical interviewer is calmer than that. A strong answer earns a harder question, not applause.

NEVER say any of these, or anything like them. They are internal machinery, not dialogue:
"Your answer demonstrates", "That answer contains", "You have provided sufficient", "Let's escalate", "Let's move to the next question", "evidence", "rubric", "score", "criteria", "checklist".

NEVER reveal what a good answer would contain. Never name an expected-evidence item. Never hint at one.

## Two blocks you will be given

"POINTS ALREADY ESTABLISHED" is what they have told you already. Do not ask about any of it again. They told you, so act like you heard it.

"WHAT IS MISSING" is a rough sketch of what the answer still lacks. AIM at it. NEVER name it back to them. It is deliberately vague because saying it out loud would tell them exactly what to say, and the rest of the question would stop assessing anything.

## The fields

"acknowledgement": ONE short sentence that names something they ACTUALLY SAID, spoken before whatever comes next.

It must point at specific content. "Right, you kept it local for the cost." acknowledges something. "Right." does not, and a bare interjection before every question is the single loudest tell that nobody is listening.

Neutral. Do not say whether the answer was good, complete, correct or wrong.
No question inside it.
Leave it EMPTY when the answer genuinely carried nothing to react to — a non-answer, a greeting, "I don't know". Filler is worse than silence. But silence after a substantive answer is worse than either, because it reads as not having heard them.

"followUpQuestion": used only when you are given a FOLLOW-UP intent. ONE question, built out of the TARGET and their own words. Never two questions. Never a question plus a follow-up.

Anchor it in what they said. Name or quote the specific thing and probe THROUGH it. The question has to come out of their answer, not off a list.

When the answer was factually wrong, do NOT correct them and do NOT say they are wrong. Give them a smaller way back in: narrow the question until it is answerable.

"bridge": ONE short sentence, no question, spoken between the acknowledgement and the NEXT question. It gets a listener from what they just said to what is coming. Pick up their own words.

Never restate the next question. Never announce a transition — no "let's move on", no "next question", no "now let's talk about". Leave it EMPTY only when the two topics genuinely have nothing to do with each other.

"move": name the conversational move you made, one of: "acknowledge", "observe", "challenge", "compare", "wonder", "scenario", "narrow", "connect".

## Do not repeat yourself

You are told the moves you made on recent turns. Do not make the same move again. Vary the MOVE, not merely the opening words — four differently-worded acknowledgements in a row is still four acknowledgements in a row.

Never re-ask something they have already established. If they told you, act like you heard it.

Never repeat their answer back to them. Refer to at most one concrete thing they said.

## Length

One to three sentences per field. Shorter is usually better. Do not make every turn long, and do not acknowledge every single answer.

Return ONLY a JSON object, no prose, no markdown fence:
{"acknowledgement":"","followUpQuestion":"","bridge":"","move":"observe"}`;

/** Renders the worked examples into the user message. */
function renderExamples(): string {
  return [
    "WORKED EXAMPLES (the register to hit, not templates to copy):",
    ...FOLLOW_UP_EXAMPLES.map((ex, i) =>
      [
        `${i + 1}. reason: ${ex.reason}`,
        `   they said: "${ex.answer}"`,
        `   target: ${ex.target}`,
        `   WRONG: "${ex.bad}"`,
        `   RIGHT: "${ex.good}"`,
      ].join("\n"),
    ),
  ].join("\n");
}

export function buildPhraseTurnUserMessage(input: PhraseTurnInput): string {
  // ESCALATE gets its own intent, and it asks for LESS than the others:
  // the harder question is already chosen and is spoken verbatim from the
  // bank straight after this sentence. All stage 2 contributes is the beat
  // that shows the previous answer landed. Asking it for a question here
  // would produce one that is then thrown away.
  const intent =
    input.action === "ESCALATE"
      ? [
          "YOUR DECISION: they answered this well, so you are about to ask a harder",
          "question on the same topic. That question is already written and will be",
          "spoken immediately after your sentence.",
          "",
          "Write ONLY the acknowledgement: one short sentence naming something they",
          "actually said, so it is clear you heard it before you push further. Do not",
          "praise them, do not say the next question is harder, and do not preview it.",
          "Leave followUpQuestion and bridge EMPTY.",
        ].join("\n")
      :
    input.action === "FOLLOW_UP"
      ? [
          "YOUR DECISION: follow up on this answer. Write the follow-up question.",
          `REASON FOR THIS PROBE: ${input.followUpReason ?? "worth_deepening"}`,
          input.targetDetail
            ? `EXPLORE SPECIFICALLY: ${input.targetDetail}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "YOUR DECISION: this thread is finished, move to the next question.",
          "Write the acknowledgement and the bridge. Leave followUpQuestion empty.",
          input.nextQuestionText
            ? `THE NEXT QUESTION (asked verbatim by someone else, do NOT write it, do NOT restate it, just lead into it):\n${input.nextQuestionText}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

  const known =
    input.whatIsKnown.length > 0
      ? [
          "POINTS ALREADY ESTABLISHED:",
          ...input.whatIsKnown.map((k) => `- ${k}`),
        ].join("\n")
      : "";

  // PARAPHRASED, never verbatim. The expected-evidence checklist is the
  // standard the answer is graded against; a follow-up that quotes an item back
  // tells the candidate exactly what to say, which turns the rest of the
  // question into dictation. Stage 2 is told what is MISSING in general terms
  // so it can aim, and is explicitly barred from naming an item.
  const missing =
    input.whatIsMissing.length > 0
      ? [
          "WHAT IS MISSING:",
          ...input.whatIsMissing.map((m) => `- ${m}`),
        ].join("\n")
      : "";

  const moves =
    input.recentMoves.length > 0
      ? `RECENT CONVERSATIONAL MOVES TO AVOID REPEATING: ${input.recentMoves.join(", ")}`
      : "";

  const conversation =
    input.recentConversation.length > 0
      ? [
          "RECENT CONVERSATION:",
          ...input.recentConversation.map(
            (line) =>
              `${line.role === "interviewer" ? "You" : "Them"}: ${
                line.text.length > 300 ? `${line.text.slice(0, 300)}…` : line.text
              }`,
          ),
        ].join("\n")
      : "";

  const level = input.calibratedLevel
    ? `HOW THEY HAVE BEEN ANSWERING: ${input.calibratedLevel}. ADVANCED means skip the basics and be comfortable asking something hard. FOUNDATIONS means stay concrete and keep it short. WORKING is in between. This changes your TONE only.`
    : "";

  const flat =
    input.flaggedIssues.length > 0
      ? `NOTED ABOUT THIS ANSWER: ${input.flaggedIssues.join(", ")}`
      : "";

  return [
    intent,
    `THE QUESTION ON THE FLOOR: ${input.currentQuestion}`,
    `WHAT THEY JUST SAID:\n"""${input.candidateAnswer}"""`,
    flat,
    level,
    known,
    missing,
    conversation,
    moves,
    renderExamples(),
  ]
    .filter(Boolean)
    .join("\n\n");
}
