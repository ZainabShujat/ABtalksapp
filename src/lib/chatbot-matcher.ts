import { CHATBOT_CATEGORIES, SUPPORT_EMAIL } from "@/data/chatbot-menu";

/**
 * The deterministic fast path, running BEFORE retrieval.
 *
 * THE RULE FOR ADDING ANYTHING HERE:
 *
 *   An intent may return a constant only if the answer is a route, an email
 *   address, or a UI affordance — something that cannot go stale. Anything
 *   about dates, eligibility, pricing, tags, rules or program details belongs
 *   in `knowledge/` and must go through retrieval.
 *
 * This rule is not academic. Two intents used to live here that broke it, and
 * both silently served wrong answers for months, because a match here means
 * the knowledge base is never consulted:
 *
 *   - a Claude Challenge intent listing tags "@abtalksonai, #abtalks,
 *     #60DaysOfClaude, #60DaysOfGenAI". The live challenge page and the
 *     official guidelines PDF both say to tag Anthropic, Anil Bajpai and
 *     ABTalksOnAI. Retrieval had the right answer; this overrode it.
 *   - an "is ABTalks free" intent answering "completely free" after the site
 *     had moved to "most challenges are free; paid cohorts are priced up
 *     front".
 *
 * Both are deleted. Do not reintroduce factual answers here, and do not grow
 * this file into a keyword FAQ — that is what the retrieval pipeline is for.
 */

export type MatchResult = { answer: string; confidence: number };

const INTENTS: { regex: RegExp; answer: string }[] = [
  {
    // Careers/recruitment enquiry — an email address, not a fact about a program.
    regex:
      /\b(how\s*(do\s*i|to)\s*)?(apply|join|work)\s*(for|with|at)\s*(the\s*)?(abtalks\s*)?(team|company|abtalks)\b.*\b(job|role|hiring|career|work)\b|\bwork\s*(for|with)\s*abtalks\b/i,
    answer: `If you'd like to work with the ABTalks team, email your cover letter, resume and anything else relevant to ${SUPPORT_EMAIL}.`,
  },
  {
    regex: /\b(contact\s*(email|details)?|email\s*address|support\s*email|reach\s*(you|the\s*team))\b/i,
    answer: `You can reach the ABTalks team at ${SUPPORT_EMAIL}.`,
  },
];

/**
 * Requests for someone else's data, or to act on another person's account.
 *
 * Retrieval cannot catch these: "can you tell me my friend's profile details"
 * is built entirely from words the knowledge base uses constantly, so it
 * sails through the confidence gate and lands on real documents about
 * profiles. The problem was never that the corpus lacks the answer — it is
 * that answering at all is the wrong behaviour. That makes it a scope rule,
 * checked before retrieval, not a knowledge gap.
 */
/**
 * Written to tolerate how people actually type possessives: apostrophes are
 * routinely dropped ("someone elses certificate") and the noun is as often
 * plural as singular ("another students submission"). Matching only the
 * grammatically correct forms let the two most natural phrasings straight
 * through, which is the opposite of what a privacy guard is for.
 */
const THIRD_PARTY_DATA =
  /\b(my\s+)?(friends?'?s?|someone\s*else'?s?|somebody\s*else'?s?|another\s+(person|user|student|candidate|member|participant)s?'?s?|other\s+(people|students|users)'?s?|his|her|their)\b[^?]*\b(profile|account|details|data|email|phone|number|score|submission|certificate|application|progress|report)s?\b/i;

export function isThirdPartyDataRequest(input: string): boolean {
  return THIRD_PARTY_DATA.test(input.trim());
}

export const THIRD_PARTY_DATA_REPLY =
  `I can't look up or share anyone else's account, profile or personal details — that information is private to them. ` +
  `I can help with anything about ABTalks itself, or you can reach the team at ${SUPPORT_EMAIL}.`;

/** Menu / greeting / navigation commands. UI affordances, never facts. */
const MENU_COMMANDS =
  /^(menu|help|options|start|hi|hey|hello|main\s*menu|home|topics|what\s*can\s*you\s*do\??)$/i;

export function isMenuCommand(input: string): boolean {
  return MENU_COMMANDS.test(input.trim());
}

/**
 * Resolves "5" or "claude challenge" to a menu category, so a user can drive
 * the menu by number without that turning into a factual answer — the returned
 * category becomes a retrieval query, not a canned reply.
 */
export function matchCategory(input: string): { label: string; query: string } | null {
  const trimmed = input.trim();
  const asNumber = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : null;
  const category =
    asNumber !== null
      ? CHATBOT_CATEGORIES.find((c) => c.number === asNumber)
      : CHATBOT_CATEGORIES.find(
          (c) => c.label.toLowerCase() === trimmed.toLowerCase(),
        );
  if (!category) return null;
  return { label: category.label, query: category.seedQuestion };
}

export function matchQuestion(query: string): MatchResult | null {
  const trimmed = query.trim();
  for (const intent of INTENTS) {
    if (intent.regex.test(trimmed)) {
      return { answer: intent.answer, confidence: 1 };
    }
  }
  return null;
}
