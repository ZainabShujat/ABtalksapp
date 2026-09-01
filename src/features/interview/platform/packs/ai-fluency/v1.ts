import type { InterviewPack } from "@/features/interview/platform/types";

/**
 * AI Fluency — pack v1, scored against rubric `ai-fluency-v1`.
 *
 * For anyone who works alongside these tools, not only engineers. It asks what
 * someone actually understands about how a language model behaves and what they
 * actually do when it is wrong — never for a definition they could recite.
 *
 * AUTHORING RULES, the same ones the cohort bank obeys:
 *   - `text` is asked verbatim and is the grading target. Never rewritten.
 *   - `expectedEvidence` items are what a COMPLETE spoken answer contains. They
 *     are graded by a model reporting which it saw, then scored in code.
 *   - `minEvidence` is the bar for "sufficient". Below it the candidate gets a
 *     scaffold; at or above it a deep probe, if one exists and the ceiling allows.
 *   - a `scaffoldProbes` entry must `target` a string that appears verbatim in
 *     `expectedEvidence`, or it cannot close the gap it was written for.
 *   - `deepProbes` must ascend by level and each must declare its own evidence,
 *     because a rung is judged against its own checklist, not the core one.
 *
 * PUBLISHED AND IMMUTABLE. Reports cite these ids permanently. Any change to
 * wording or evidence creates `v2` and leaves this file alone.
 */

export const AI_FLUENCY_V1: InterviewPack = {
  id: "ai-fluency",
  version: 1,
  domainSlug: "ai-fluency",
  rubricId: "ai-fluency-v1",

  sections: [
    { id: "how-it-works", label: "How the tools work" },
    { id: "working-with-it", label: "Working with them" },
    { id: "judgement", label: "Judgement and limits" },
  ],

  questions: [
    {
      id: "aif-1",
      sectionId: "how-it-works",
      competency: "CONCEPTUAL",
      platformCompetencyId: "mental-model",
      difficulty: "easy",
      mode: "CONCEPTUAL",
      text: "When you type a question into something like ChatGPT, what is actually happening to produce the answer?",
      expectedEvidence: [
        "predicts text rather than looking up a stored answer",
        "works from patterns learned in training, not a live database",
        "generates a piece at a time rather than retrieving a whole response",
      ],
      minEvidence: 1,
      maxFollowUps: 1,
      followUpPrompt:
        "Is it finding an answer somewhere, or making one? What makes you say that?",
      scaffoldProbes: [
        {
          text: "Put the technology aside for a second. Do you think it is looking the answer up, or producing it? Either is a fine answer.",
          targets: "predicts text rather than looking up a stored answer",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "TRANSFER",
          text: "Given that, why can it produce something completely wrong while sounding just as confident as when it is right?",
          expectedEvidence: [
            "fluency and accuracy are separate — it optimises for plausible text",
            "it has no internal check that what it produced is true",
            "confident tone is a property of the writing, not of the knowledge",
          ],
        },
      ],
    },

    {
      id: "aif-2",
      sectionId: "how-it-works",
      competency: "CONCEPTUAL",
      platformCompetencyId: "mental-model",
      difficulty: "medium",
      mode: "CONCEPTUAL",
      text: "If you ask the same tool the same question twice, you can get two different answers. Why would that be?",
      expectedEvidence: [
        "generation involves sampling, so it is not deterministic by default",
        "the phrasing or the preceding conversation changes the context it works from",
        "there is no stored canonical answer to return each time",
      ],
      minEvidence: 1,
      maxFollowUps: 1,
      followUpPrompt:
        "Does that make it broken, or is that expected behaviour? Talk me through your thinking.",
      scaffoldProbes: [
        {
          text: "If it were reading an answer out of a database, would you expect the same result twice?",
          targets: "there is no stored canonical answer to return each time",
        },
      ],
    },

    {
      id: "aif-3",
      sectionId: "working-with-it",
      competency: "PRACTICAL",
      platformCompetencyId: "practical-use",
      difficulty: "easy",
      mode: "EVIDENCE",
      text: "Tell me about something you have genuinely used one of these tools for recently. What did you ask it, and what did you get back?",
      expectedEvidence: [
        "names a specific real task rather than a category of task",
        "describes what they actually asked for",
        "describes what came back, including where it fell short",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt:
        "What did the first attempt give you, before you refined anything?",
      scaffoldProbes: [
        {
          text: "Just the most recent time you opened one of these tools. What were you trying to get done?",
          targets: "names a specific real task rather than a category of task",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "REFLECTION",
          text: "What did you change about how you asked, between the first attempt and the one you kept?",
          expectedEvidence: [
            "names a specific change to the request, not just 'I rephrased it'",
            "explains why that change helped",
            "shows the result improved in a way they can describe",
          ],
        },
      ],
    },

    {
      id: "aif-4",
      sectionId: "working-with-it",
      competency: "PRACTICAL",
      platformCompetencyId: "practical-use",
      difficulty: "medium",
      mode: "IMPLEMENTATION",
      text: "When you want a genuinely useful answer rather than a generic one, what do you put into the request?",
      expectedEvidence: [
        "supplies context or source material rather than asking cold",
        "states the audience, format or constraints they want",
        "gives an example of what good looks like",
        "iterates rather than accepting the first output",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt:
        "Give me a concrete example of that, from something you actually asked.",
      scaffoldProbes: [
        {
          text: "Think about a time the first answer was too generic. What did you add to the request?",
          targets: "supplies context or source material rather than asking cold",
        },
      ],
    },

    {
      id: "aif-5",
      sectionId: "judgement",
      competency: "TECHNICAL_DEPTH",
      platformCompetencyId: "limits-and-risk",
      difficulty: "medium",
      mode: "TRADEOFF",
      text: "Where would you not trust one of these tools? Give me a case where you would check the output yourself.",
      expectedEvidence: [
        "names a concrete category where it is unreliable — facts, figures, citations, recent events",
        "explains why that category specifically is weak",
        "describes an actual verification step they take",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt: "How do you check it, in practice?",
      scaffoldProbes: [
        {
          text: "Has one of these tools ever given you something that turned out to be wrong? What was it?",
          targets:
            "names a concrete category where it is unreliable — facts, figures, citations, recent events",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "SCENARIO",
          text: "Suppose a colleague sends you a report they produced this way and asks you to sign off on it. What do you check first, and why that first?",
          expectedEvidence: [
            "prioritises checkable claims — numbers, names, sources — over prose quality",
            "gives a reason for the ordering rather than a checklist",
            "recognises that fluent writing is not evidence of correctness",
          ],
        },
        {
          level: 3,
          mode: "DECISION",
          text: "Where would you draw the line and say this task should not be done this way at all?",
          expectedEvidence: [
            "names a category — high-stakes, regulated, unverifiable, personal data",
            "reasons from consequence of error rather than from difficulty",
            "accepts that the line is a judgement call and defends where they put it",
          ],
        },
      ],
    },

    {
      id: "aif-6",
      sectionId: "judgement",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "limits-and-risk",
      difficulty: "medium",
      mode: "DEBUGGING",
      text: "You ask for something, and the answer looks right but you suspect it is not. What do you do next?",
      expectedEvidence: [
        "verifies against a source outside the tool",
        "asks it to show reasoning or sources, while knowing those can also be fabricated",
        "narrows the request or splits the task to isolate the wrong part",
        "knows when to stop and do it manually",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt:
        "Say you ask it to justify the answer and it produces a confident justification. Does that settle it?",
      scaffoldProbes: [
        {
          text: "Where would you go to find out whether it was actually right?",
          targets: "verifies against a source outside the tool",
        },
      ],
    },

    {
      id: "aif-7",
      sectionId: "judgement",
      competency: "COMMUNICATION",
      platformCompetencyId: "practical-use",
      difficulty: "hard",
      mode: "TRANSFER",
      text: "If you had to explain to a colleague who has never used these tools what they are good and bad at, what would you tell them?",
      expectedEvidence: [
        "gives a usable rule for what to delegate and what not to",
        "explains the reason behind the rule, not just the rule",
        "avoids both dismissal and overclaiming",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt:
        "What is the single thing you would most want them to be careful about?",
      scaffoldProbes: [
        {
          text: "Start with one task you would happily hand to it, and one you would not.",
          targets: "gives a usable rule for what to delegate and what not to",
        },
      ],
    },
  ],
};
