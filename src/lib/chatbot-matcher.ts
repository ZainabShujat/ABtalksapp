import { QUICK_QUESTION_IDS, CHATBOT_CATEGORIES, type ChatbotCategory } from "@/data/chatbot-menu";

const INTENTS: { regex: RegExp; answer: string }[] = [
  {
    regex: /\b(how\s*to\s*)?(apply|join|work\s*for)\s*(to\s*)?(the\s*)?(abtalks|team|company)\b/i,
    answer: "If you're interested in joining the ABTalks team or working with us, please email your cover letter, resume, and any other relevant details to team@abtalks.in!",
  },
  {
    regex: /\b(how\s*to\s*)?(apply|register|sign\s*up|join)\s*(to\s*)?(program|cohort|challenge)?\b/i,
    answer: "To join ABTalks, you can sign in using your Google account at /login. We have multiple programs you can sign up for: The 60-Day Coding Challenge (/challenges), the 60-Day Claude AI Challenge (/claude-signup), and the 31-Day AI Cohort (/ai-cohort-register).",
  },
  {
    regex: /\b(what is|tell me about)\s*(the\s*)?(60\s*day\s*coding\s*challenge|coding\s*challenge)\b/i,
    answer: "The 60-Day Coding Challenge is a self-paced, community-driven program where you complete one coding task every day for 60 days. You track your progress on our platform, and it's completely free to participate. You can sign up at /challenges!",
  },
  {
    regex: /\b(what is|tell me about)\s*(the\s*)?(60\s*day\s*claude\s*challenge|claude\s*ai\s*challenge)\b/i,
    answer: "The 60-Day Claude AI Challenge focuses on mastering prompt engineering. Every day you'll receive a new AI prompt task to complete using Claude. To participate, post your daily update with the required tags: @abtalksonai, #abtalks, #60DaysOfClaude, #60DaysOfGenAI. Sign up at /claude-signup!",
  },
  {
    regex: /\b(what is|tell me about)\s*(the\s*)?(ai\s*cohort|31\s*day\s*ai\s*cohort)\b/i,
    answer: "The 31-Day AI Cohort is our flagship intensive program where participants build a production-grade enterprise chatbot in 31 days. It includes daily guided missions, mentorship, and a final capstone project. You can register your interest at /ai-cohort-register.",
  },
  {
    regex: /\b(who is|tell me about)\s*(anil|anil\s*bajpai|the\s*founder)\b/i,
    answer: "Anil Bajpai is the founder of ABTalks. He created this community to help students and professionals build real-world skills through public, consistent coding.",
  },
  {
    regex: /\b(what is|tell me about)\s*abtalks\b/i,
    answer: "ABTalks is India's coding community for college students to learn, build, and accelerate careers through visible proof of work. Our tagline is 'Build in public. Grow together.'",
  },
  {
    regex: /\b(is\s*abtalks\s*free|how\s*much\s*does\s*it\s*cost)\b/i,
    answer: "Yes! The community and every flagship program (like the 60-Day Challenges and the AI Cohort) are completely free for participants.",
  },
  {
    regex: /\b(who\s*can\s*participate|is\s*this\s*for\s*me)\b/i,
    answer: "ABTalks serves students, recruiters, working professionals, and investors. Anyone looking to learn, build, or hire is welcome to join the community!",
  },
  {
    regex: /\b(contact\s*email|how\s*to\s*contact|email\s*address)\b/i,
    answer: "You can contact the ABTalks team directly at team@abtalks.in.",
  },
];

export function matchQuestion(query: string): { answer: string; confidence: number } | null {
  const lowerQuery = query.toLowerCase().trim();
  
  // Check regex intents first
  for (const intent of INTENTS) {
    if (intent.regex.test(lowerQuery)) {
      return { answer: intent.answer, confidence: 1.0 };
    }
  }

  // Exact match for category numbers
  const asNumber = /^\d+$/.test(lowerQuery) ? parseInt(lowerQuery, 10) : null;
  if (asNumber !== null) {
    const category = CHATBOT_CATEGORIES.find((c) => c.number === asNumber);
    if (category) {
      return { answer: `You selected ${category.label}. I can answer any questions you have about this topic!`, confidence: 1.0 };
    }
  }

  return null;
}
