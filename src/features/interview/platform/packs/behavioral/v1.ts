import type { InterviewPack } from "@/features/interview/platform/types";

/**
 * Workplace Situations — pack v1, scored against rubric `behavioral-v1`.
 *
 * Ships alongside AI Fluency deliberately: it shares none of that rubric's
 * competency ids, so any code that quietly assumes a fixed competency set fails
 * here in Phase 1 rather than at the eighth domain.
 *
 * What this pack is trying to measure is whether someone can describe one real
 * situation concretely — not whether they can recite the STAR acronym. So the
 * evidence checklists ask for situation, action, outcome and reflection as
 * CONTENT, and never for the shape of the answer.
 *
 * A note on the engine `competency` field below: behavioral questions are mapped
 * onto the five engine competencies (which drive the escalation ceiling and the
 * competence signal in `depth.ts`) using their generic meanings — PROBLEM_SOLVING
 * for reasoning under difficulty, COMMUNICATION for explaining to others,
 * PRACTICAL for describing work actually done. What the report reports is
 * `platformCompetencyId`, which is this pack's own rubric.
 *
 * PUBLISHED AND IMMUTABLE. Changes create `v2`.
 */

export const BEHAVIORAL_V1: InterviewPack = {
  id: "behavioral",
  version: 1,
  domainSlug: "behavioral",
  rubricId: "behavioral-v1",

  sections: [
    { id: "delivery", label: "Delivering work" },
    { id: "working-with-others", label: "Working with others" },
    { id: "growth", label: "Setbacks and growth" },
  ],

  questions: [
    {
      id: "beh-1",
      sectionId: "delivery",
      competency: "PRACTICAL",
      platformCompetencyId: "specificity",
      difficulty: "easy",
      mode: "EVIDENCE",
      text: "Tell me about something you worked on recently that you were genuinely pleased with. What was it?",
      expectedEvidence: [
        "names one specific piece of work rather than a general period",
        "says what the situation or goal actually was",
        "says what they personally produced",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "What specifically were you responsible for in that?",
      scaffoldProbes: [
        {
          text: "It does not have to be impressive. Just the most recent thing you finished that you were glad to have done.",
          targets: "names one specific piece of work rather than a general period",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "REFLECTION",
          text: "What made that one satisfying, as opposed to the other work you were doing around the same time?",
          expectedEvidence: [
            "gives a reason grounded in the work itself rather than in praise received",
            "distinguishes it from adjacent work concretely",
            "shows awareness of what they personally value in work",
          ],
        },
      ],
    },

    {
      id: "beh-2",
      sectionId: "delivery",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "ownership",
      difficulty: "medium",
      mode: "SCENARIO",
      text: "Tell me about a time something you were responsible for was going to be late or was not going to work. What did you do?",
      expectedEvidence: [
        "describes a real situation with a real constraint",
        "says what they did rather than what should have been done",
        "mentions telling someone, or deciding not to, and why",
        "says how it actually ended",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "When did you first know, and what did you do at that point?",
      scaffoldProbes: [
        {
          text: "Take any deadline that slipped, however small. What was the first thing you did once you realised?",
          targets: "describes a real situation with a real constraint",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "DECISION",
          text: "Who did you tell, and how did you decide when to tell them?",
          expectedEvidence: [
            "shows a reason for the timing rather than defaulting to 'immediately'",
            "considers who was affected",
            "distinguishes escalating from asking for help",
          ],
        },
      ],
    },

    {
      id: "beh-3",
      sectionId: "working-with-others",
      competency: "COMMUNICATION",
      platformCompetencyId: "ownership",
      difficulty: "medium",
      mode: "SCENARIO",
      text: "Tell me about a disagreement with someone you worked with. What was it about, and how did it end?",
      expectedEvidence: [
        "states the other person's position fairly",
        "says what they did during the disagreement",
        "describes the resolution honestly, including if it went badly",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt:
        "What was their reasoning? Put their side of it as they would have.",
      scaffoldProbes: [
        {
          text: "It does not need to have been a conflict. Just a time you and someone else wanted to go different ways on something.",
          targets: "states the other person's position fairly",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "REFLECTION",
          text: "Looking back, was there anything in their position you now think was right?",
          expectedEvidence: [
            "concedes something specific rather than a token concession",
            "gives a reason for the change of view",
            "does not simply restate that they were right all along",
          ],
        },
      ],
    },

    {
      id: "beh-4",
      sectionId: "working-with-others",
      competency: "PRACTICAL",
      platformCompetencyId: "specificity",
      difficulty: "medium",
      mode: "EVIDENCE",
      text: "Tell me about a time you had to get something done that depended on other people. How did you handle it?",
      expectedEvidence: [
        "names the actual dependency and who held it",
        "describes what they did to move it, specifically",
        "says what the outcome was",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt: "What did you do when it was not moving?",
      scaffoldProbes: [
        {
          text: "Who were you waiting on, and what were you waiting for?",
          targets: "names the actual dependency and who held it",
        },
      ],
    },

    {
      id: "beh-5",
      sectionId: "growth",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "reflection",
      difficulty: "medium",
      mode: "REFLECTION",
      text: "Tell me about a decision you made that you would make differently now.",
      expectedEvidence: [
        "names an actual decision they made, not a circumstance they suffered",
        "says what they would do differently and why",
        "shows the lesson came from what happened rather than from a general principle",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "What specifically would you do differently, and at what point?",
      scaffoldProbes: [
        {
          text: "It does not have to have gone badly. Just a call you have thought about since.",
          targets:
            "names an actual decision they made, not a circumstance they suffered",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "TRANSFER",
          text: "Has that actually changed how you decide things since? Give me a case.",
          expectedEvidence: [
            "cites a later situation where they applied it",
            "shows the behaviour changed, not only the belief",
            "is honest if it has not come up again",
          ],
        },
      ],
    },

    {
      id: "beh-6",
      sectionId: "growth",
      competency: "CONCEPTUAL",
      platformCompetencyId: "reflection",
      difficulty: "medium",
      mode: "REFLECTION",
      text: "Tell me about something you had to learn quickly because the work required it. How did you go about it?",
      expectedEvidence: [
        "names the specific thing and why it was needed then",
        "describes their actual method rather than 'I read the docs'",
        "says how they knew they had learned enough to proceed",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt: "How did you know when you knew enough to start?",
      scaffoldProbes: [
        {
          text: "What was the thing you did not know, and what were you trying to do with it?",
          targets: "names the specific thing and why it was needed then",
        },
      ],
    },

    {
      id: "beh-7",
      sectionId: "growth",
      competency: "COMMUNICATION",
      platformCompetencyId: "structure",
      difficulty: "hard",
      mode: "TRANSFER",
      text: "If I asked someone you have worked with what you are like to work with, what would they say?",
      expectedEvidence: [
        "gives a characterisation that sounds like a real person's view, not a self-assessment",
        "includes something that is not purely flattering",
        "grounds it in how they actually behave rather than in intentions",
      ],
      minEvidence: 2,
      maxFollowUps: 1,
      followUpPrompt:
        "And what would they say is the harder part of working with you?",
      scaffoldProbes: [
        {
          text: "Pick one specific person you worked closely with. What would they say?",
          targets:
            "gives a characterisation that sounds like a real person's view, not a self-assessment",
        },
      ],
    },
  ],
};
