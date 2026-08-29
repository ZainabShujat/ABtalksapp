/**
 * The grounding contract handed to every generation provider.
 *
 * One prompt, shared by Gemini, Groq and Anthropic. A fallback provider that
 * answered under looser rules than the primary would make the bot's honesty
 * depend on which upstream happened to be up.
 */

export const SUPPORT_EMAIL = "team@abtalks.in";

export const FALLBACK_MESSAGE =
  `I couldn't find enough information about that in the ABTalks knowledge base. ` +
  `You can contact the ABTalks team at ${SUPPORT_EMAIL} and they'll help you directly.`;

/**
 * Shown when retrieval SUCCEEDED but every generation provider failed.
 *
 * This must never be `FALLBACK_MESSAGE`. Telling someone the knowledge base
 * lacks an answer when the real problem is an upstream outage is simply false,
 * and it is indistinguishable to them from the bot not knowing — so a provider
 * outage looks exactly like a knowledge gap and gets debugged as one. That is
 * precisely what happened in production: the assistant retrieved the right
 * material and then reported that it had found nothing.
 */
export const GENERATION_UNAVAILABLE_MESSAGE =
  `Sorry — I found the answer but couldn't finish writing it just now. ` +
  `Please try again in a moment. If it keeps happening, email ${SUPPORT_EMAIL}.`;

/**
 * Shown when the search itself failed — the corpus could not be read or scored.
 *
 * The third distinct outcome. A user must be able to tell "we don't have that"
 * (their question, our gap) from "something broke on our side" (our fault,
 * worth retrying), because the two call for completely different reactions:
 * one means rephrase or email us, the other means try again in a minute.
 * Collapsing them is how a real outage gets triaged as a content problem.
 */
export const RETRIEVAL_ERROR_MESSAGE =
  `Sorry — something went wrong while I was searching just now. ` +
  `Please try again in a moment. If it keeps happening, email ${SUPPORT_EMAIL}.`;

export const SYSTEM_PROMPT = `You are the ABTalks Help Assistant, the support assistant on the ABTalks website.

GROUNDING — this is absolute:
- Answer ONLY from the ABTalks context provided below. It is the sole authority.
- Never use general world knowledge to fill a gap in ABTalks information.
- Never invent dates, prices, eligibility rules, links, names, tags, statistics, prizes or program details. If the context does not state it, say you don't have it and point to ${SUPPORT_EMAIL}.
- Never state a fact "by analogy" from a different ABTalks program. Programs have different rules.

SOURCES AND CONFLICTS:
- Context lines marked [verified: ...] are hand-checked ABTalks knowledge. Lines marked [live site ...] are captured from the public website.
- When they conflict, the [verified: ...] source wins.
- If two sources genuinely disagree and neither is marked verified, say the information is unclear and direct the user to ${SUPPORT_EMAIL}. Never merge contradictory facts into one confident answer.

TIME AND STATUS:
- Today's date is provided below. Compare it against dates in the context.
- Never describe a past event as upcoming, and never tell a user to register for an event whose registration has closed.
- Ignore promotional wording like "coming soon" or "new" if the actual dates say otherwise. Dates and explicit registration status win.

LINKS:
- Only mention routes and URLs that literally appear in the context. Never construct a URL you have not seen.

STYLE:
- You are a support agent, not a document. Answer the question actually asked, in 2-5 sentences where possible, and stop.
- Do not dump an entire retrieved document. Pull out the part that answers the question.
- Use the conversation history to resolve follow-ups ("what do I post?", "who do I tag?") without making the user repeat themselves.
- Plain, friendly, direct. No preamble like "Based on the provided context".
- Never mention the knowledge base, retrieval, context, chunks, sources, scores, or how you work, unless the user explicitly asks how the assistant works.
- NEVER write the name of a source file. The bracketed labels above (for example "[verified: ai-cohort.md]") are internal bookkeeping, not citations, and mean nothing to the person asking. To point someone somewhere, name the page's route or the topic in plain words — "apply through the AI Cohort page", never "see ai-cohort.md".

If the context genuinely does not answer the question, reply exactly:
"${FALLBACK_MESSAGE}"`;

/**
 * Appended when retrieval was weak or spread across unrelated topics.
 *
 * The alternative — returning a fixed bullet list of topic names — is what made
 * the assistant feel like a phone menu: it never used the model, so it could
 * not notice that the user had already said which one they meant. Handing the
 * ambiguity to the model with the same grounding rules keeps the answer honest
 * while letting the conversation behave like a conversation.
 */
const AMBIGUITY_DIRECTIVE = `
The retrieved context is thin or spans more than one topic, so read the conversation carefully before answering:
- If the history makes it clear which thing the user means, just answer that.
- If it is genuinely unclear, ask ONE short clarifying question naming the two or three things it could be. Do not list every topic you know.
- If the context does not support any answer, use the fallback sentence.`;

export function buildSystemPrompt(
  context: string,
  today: string,
  ambiguous = false,
): string {
  return `${SYSTEM_PROMPT}${ambiguous ? AMBIGUITY_DIRECTIVE : ""}

Today's date: ${today}

ABTalks context:
<context>
${context}
</context>`;
}

/**
 * Asked when retrieval finds a weak, ambiguous signal. Deterministic — a
 * clarification is not worth a model call, and a generated one drifts into
 * answering the question it was supposed to be asking about.
 */
export function buildClarifyMessage(topics: string[]): string {
  const readable: Record<string, string> = {
    "claude-challenge": "the 60-Day Claude Challenge",
    "coding-challenge": "the 60-Day Coding Challenge",
    "ai-cohort": "the 31-Day AI Cohort",
    hackathon: "the Vibe Code Hackathon",
    vicodathon: "the Vibe Code Hackathon",
    workshops: "workshops and events",
    events: "workshops and events",
    certificates: "certificates",
    "voice-interview": "the AI voice interview",
    "hiring-and-recruiters": "hiring and recruiters",
    programs: "ABTalks programs",
    homepage: "ABTalks generally",
    abtalks: "ABTalks generally",
  };

  const options = topics
    .map((t) => readable[t])
    .filter((label): label is string => Boolean(label));

  if (options.length === 0) {
    return `Could you tell me a bit more about what you're looking for? If it's easier, you can also reach the team at ${SUPPORT_EMAIL}.`;
  }

  const list = options.map((o) => `- ${o}`).join("\n");
  return `I want to make sure I answer the right thing — which of these did you mean?\n\n${list}\n\nYou can reply with the one you want, or ask me something else.`;
}
