export const SUPPORT_EMAIL = "team@abtalks.in";

export type ChatbotCategory = {
  id: string;
  number: number;
  label: string;
  /**
   * The question sent through retrieval when a user picks this category.
   * Picking a menu item must produce a RETRIEVED answer, never a canned one —
   * the menu is a shortcut into the knowledge base, not a second source of
   * truth that can drift away from it.
   */
  seedQuestion: string;
};

export const CHATBOT_CATEGORIES: ChatbotCategory[] = [
  {
    id: "about",
    number: 1,
    label: "ABTalks",
    seedQuestion: "What is ABTalks and what does it do?",
  },
  {
    id: "programs",
    number: 2,
    label: "Programs & Challenges",
    seedQuestion: "What programs and challenges does ABTalks offer?",
  },
  {
    id: "hackathons",
    number: 3,
    label: "Hackathons",
    seedQuestion: "Tell me about the ABTalks hackathon, its rules and status.",
  },
  {
    id: "workshops-events",
    number: 4,
    label: "Workshops & Events",
    seedQuestion: "What workshops and events are coming up, and is registration open?",
  },
  {
    id: "claude-challenge",
    number: 5,
    label: "Claude Challenge",
    seedQuestion: "How does the 60-Day Claude Challenge work?",
  },
  {
    id: "ai-cohort",
    number: 6,
    label: "AI Cohort",
    seedQuestion: "What is the 31-Day AI Cohort and how do I apply?",
  },
  {
    id: "voice-interview",
    number: 7,
    label: "Voice Interview",
    seedQuestion: "What is the ABTalks AI voice interview and who can take it?",
  },
  {
    id: "certificates",
    number: 8,
    label: "Certificates",
    seedQuestion: "Which ABTalks programs give certificates and how do I claim mine?",
  },
  {
    id: "hiring",
    number: 9,
    label: "Hiring & Recruiters",
    seedQuestion: "How does hiring through ABTalks work and who can see my profile?",
  },
  {
    id: "socials-contact",
    number: 10,
    label: "Socials & Contact",
    seedQuestion: "What are the official ABTalks social channels and contact email?",
  },
];

/**
 * Opening suggestions. Three, not ten — a wall of pills reads as a phone menu
 * and pushes people away from typing, which is the interaction this assistant
 * is actually good at.
 */
export const OPENING_SUGGESTIONS: { id: string; question: string }[] = [
  { id: "programs-overview", question: "What programs does ABTalks offer?" },
  { id: "is-free", question: "Is ABTalks free?" },
  { id: "certificate-claim", question: "How do I get my certificate?" },
];

/**
 * Follow-up suggestions keyed by topic keywords found in the user's last
 * question. Contextual, capped at three by the widget, and every one of them
 * is answerable from the corpus — suggesting a question the bot must fall back
 * on is worse than suggesting nothing.
 */
export const FOLLOW_UP_SUGGESTIONS: { match: RegExp; questions: string[] }[] = [
  {
    match: /claude/i,
    questions: [
      "What do I have to post every day?",
      "Which accounts do I tag on LinkedIn?",
      "What happens if I miss a day?",
    ],
  },
  {
    match: /certificate|cert\b/i,
    questions: [
      "How do I verify a certificate?",
      "Do hackathon participants get certificates?",
      "What if my name is wrong on the certificate?",
    ],
  },
  {
    match: /hackathon|vicodathon/i,
    questions: [
      "What do I need to submit?",
      "How are winners judged?",
      "Can I enter solo?",
    ],
  },
  {
    match: /workshop|event|webinar/i,
    questions: [
      "What is the next workshop?",
      "Is registration open?",
      "How often do workshops run?",
    ],
  },
  {
    match: /cohort|program\b/i,
    questions: [
      "What are the prerequisites?",
      "How many hours a day does it take?",
      "What happens after the cohort?",
    ],
  },
  {
    match: /interview/i,
    questions: [
      "How long is the interview?",
      "Who can take the voice interview?",
      "What do I get afterwards?",
    ],
  },
  {
    match: /recruiter|hiring|hire|job/i,
    questions: [
      "Who can see my profile?",
      "Do recruiters get my phone number?",
      "How do I become discoverable?",
    ],
  },
];

export function followUpsFor(question: string): string[] {
  for (const entry of FOLLOW_UP_SUGGESTIONS) {
    if (entry.match.test(question)) return entry.questions.slice(0, 3);
  }
  return [];
}
