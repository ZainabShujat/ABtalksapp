import type { InterviewPack } from "@/features/interview/platform/types";

/**
 * Vibe Coding — pack v1, scored against rubric `agentic-coding-v1`.
 *
 * VOICE ONLY, deliberately. The domain reserves `CODE_SANDBOX` for a future
 * version, but nothing here needs one: what separates people who build well
 * with an agent from people who merely build fast with one is not whether they
 * can type — it is what they hand over, what they check, and whether they can
 * still explain what shipped. All of that is spoken.
 *
 * The questions are written to be answerable by someone who has genuinely done
 * this and unanswerable by someone who has only read about it, which is why
 * almost every one asks for a specific instance rather than an approach. "How
 * do you verify AI-generated code" has a correct-sounding answer everybody
 * knows; "tell me about a time it looked right and wasn't" does not.
 *
 * It assumes no particular tool, and takes no position on whether heavy
 * delegation is good. A candidate who hands the agent almost everything and
 * checks it rigorously scores well; so does one who keeps most of it.
 *
 * PUBLISHED AND IMMUTABLE. Changes create `v2`.
 */

export const AGENTIC_CODING_V1: InterviewPack = {
  id: "agentic-coding",
  version: 1,
  domainSlug: "agentic-coding",
  rubricId: "agentic-coding-v1",

  sections: [
    { id: "working", label: "How you work with the agent" },
    { id: "checking", label: "Checking the output" },
    { id: "judgement", label: "Where you draw the line" },
  ],

  questions: [
    {
      id: "vibe-1",
      sectionId: "working",
      competency: "PRACTICAL",
      platformCompetencyId: "delegation",
      difficulty: "easy",
      mode: "EVIDENCE",
      text: "Tell me about something you've built recently where an AI coding agent did a real share of the work. What was it, and roughly how much of it did you write yourself?",
      expectedEvidence: [
        "names one specific project or feature rather than a general habit",
        "gives a sense of how the work was split between them and the agent",
        "says what the thing actually does",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt:
        "Which parts of that did you end up writing yourself rather than handing over?",
      scaffoldProbes: [
        {
          text: "It doesn't have to be a big project — a script or a single feature is fine. Just the most recent one where the agent did real work.",
          targets:
            "names one specific project or feature rather than a general habit",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "DECISION",
          text: "How did you decide which parts to hand over? Was that settled up front, or did it move as you went?",
          expectedEvidence: [
            "gives a reason for the split beyond speed",
            "describes the split changing in response to something concrete",
            "distinguishes work suited to the agent from work that wasn't",
          ],
        },
      ],
    },

    {
      id: "vibe-2",
      sectionId: "working",
      competency: "PRACTICAL",
      platformCompetencyId: "direction",
      difficulty: "medium",
      mode: "IMPLEMENTATION",
      text: "When you start the agent on a task, what do you actually give it? Walk me through what you put in front of it before it writes anything.",
      expectedEvidence: [
        "names specific context they supply, such as existing files, conventions or constraints",
        "describes how much of the task they hand over at once",
        "explains why they supply that rather than just the request",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "What happens to the output when you skip that?",
      scaffoldProbes: [
        {
          text: "Concretely — for the last task you gave it, what did the agent have to work from?",
          targets:
            "names specific context they supply, such as existing files, conventions or constraints",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "TRADEOFF",
          text: "Do you get better results from one large task or several small ones? What made you settle on that?",
          expectedEvidence: [
            "takes a position based on observed results rather than principle",
            "names the failure mode of the approach they rejected",
            "connects task size to how they check the result",
          ],
        },
      ],
    },

    {
      id: "vibe-3",
      sectionId: "checking",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "verification",
      difficulty: "medium",
      mode: "DECISION",
      text: "The agent hands back a change and it runs. How do you decide whether it's actually right?",
      expectedEvidence: [
        "names a concrete check beyond the code running",
        "distinguishes what they read closely from what they skim",
        "says what would make them look harder at a particular change",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt:
        "Is there a kind of change where running clean isn't enough for you?",
      scaffoldProbes: [
        {
          text: "Take the last change it gave you. What did you do between reading it and keeping it?",
          targets: "names a concrete check beyond the code running",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "TRADEOFF",
          text: "Reviewing everything line by line gets slow enough that people stop doing it. Where do you spend the attention you do have?",
          expectedEvidence: [
            "acknowledges the cost honestly rather than claiming to read everything",
            "names what earns closer attention and why",
            "ties the choice to consequence rather than to volume",
          ],
        },
      ],
    },

    {
      id: "vibe-4",
      sectionId: "checking",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "verification",
      difficulty: "hard",
      mode: "DEBUGGING",
      text: "Tell me about a time the agent produced something that looked completely right and wasn't. What was wrong, and how did you find out?",
      expectedEvidence: [
        "describes one specific defect rather than a category of defect",
        "says how it was eventually caught, and by what",
        "says what they changed afterwards, if anything",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "What caught it in the end?",
      scaffoldProbes: [
        {
          text: "Anything at all — a wrong assumption, a case it silently didn't handle, something plausible it invented.",
          targets:
            "describes one specific defect rather than a category of defect",
        },
      ],
      deepProbes: [
        {
          level: 2,
          mode: "REFLECTION",
          text: "Would the same thing get through today, or does something now stop it?",
          expectedEvidence: [
            "answers honestly rather than claiming the problem is solved",
            "names a specific change in how they work, or explains why nothing changed",
            "shows the lesson generalised beyond that one bug",
          ],
        },
      ],
    },

    {
      id: "vibe-5",
      sectionId: "working",
      competency: "PROBLEM_SOLVING",
      platformCompetencyId: "direction",
      difficulty: "hard",
      mode: "SCENARIO",
      text: "You're four attempts into a task and the agent isn't converging — each version fixes one thing and breaks another. What do you do at that point?",
      expectedEvidence: [
        "describes changing their own approach rather than only re-prompting",
        "names a point at which they stop and take it over",
        "gives a reason the loop happens, grounded in something they've seen",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "At what point do you stop asking and write it yourself?",
      scaffoldProbes: [
        {
          text: "Has that happened to you? Start with what you did the last time it did.",
          targets:
            "describes changing their own approach rather than only re-prompting",
        },
      ],
    },

    {
      id: "vibe-6",
      sectionId: "judgement",
      competency: "COMMUNICATION",
      platformCompetencyId: "verification",
      difficulty: "medium",
      mode: "SCENARIO",
      text: "Someone asks you to change a part of the project the agent wrote a few weeks ago. How well do you know that code?",
      expectedEvidence: [
        "answers candidly about what they do and don't remember",
        "describes how they get back up to speed on it",
        "connects that to how the code was reviewed at the time",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt:
        "Is there code in that project you'd struggle to explain to someone?",
      deepProbes: [
        {
          level: 2,
          mode: "REFLECTION",
          text: "Does that change how much you're willing to let it write in the first place?",
          expectedEvidence: [
            "links long-term maintainability to the delegation decision",
            "takes a position rather than deferring to circumstance",
            "grounds it in a project they actually maintained",
          ],
        },
      ],
    },

    {
      id: "vibe-7",
      sectionId: "judgement",
      competency: "PRACTICAL",
      platformCompetencyId: "delegation",
      difficulty: "medium",
      mode: "DECISION",
      text: "Is there anything you deliberately don't let the agent do?",
      expectedEvidence: [
        "names something specific they keep for themselves",
        "gives the reason, tied to risk or to understanding rather than to preference",
        "distinguishes it from work they are happy to hand over",
      ],
      minEvidence: 2,
      maxFollowUps: 2,
      followUpPrompt: "What makes that one different from the rest?",
      scaffoldProbes: [
        {
          text: "Even something small — a file, a kind of change, anything you'd rather do by hand.",
          targets: "names something specific they keep for themselves",
        },
      ],
    },
  ],
};
