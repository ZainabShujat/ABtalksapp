import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { buildContext, retrieve } from "@/lib/chatbot/retrieve";
import { generateStream, type ChatTurn } from "@/lib/chatbot/providers";
import {
  FALLBACK_MESSAGE,
  GENERATION_UNAVAILABLE_MESSAGE,
  RETRIEVAL_ERROR_MESSAGE,
  buildClarifyMessage,
  buildSystemPrompt,
} from "@/lib/chatbot/prompt";
import {
  THIRD_PARTY_DATA_REPLY,
  isThirdPartyDataRequest,
} from "@/lib/chatbot-matcher";
import { buildLiveFacts } from "@/lib/chatbot/live-facts";

/**
 * The chatbot endpoint.
 *
 * Order matters and is the whole design:
 *
 *   validate -> retrieve -> CONFIDENCE GATE -> generate
 *
 * Nothing reaches a generation provider until retrieval has decided the corpus
 * can actually support an answer. That ordering is what stops "does ABTalks
 * provide hostel accommodation?" from becoming a fluent, confident yes.
 *
 * `nodejs` runtime: the corpus is read from disk with `fs`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Turns sent upstream. The retrieval query uses the last two user-side turns;
 * the model gets a slightly longer window so it can resolve "and after that?"
 * without the history growing without bound.
 */
const HISTORY_TURNS = 8;

/**
 * One wire format for every provider: `data: {"text": "..."}`, terminated by
 * `data: [DONE]`. The browser parses exactly one shape and never learns which
 * provider served it.
 */
function sseFrame(text: string): string {
  return `data: ${JSON.stringify({ text })}\n\n`;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/** A complete, deterministic answer — no model involved. */
function staticStream(text: string): Response {
  return new Response(`${sseFrame(text)}data: [DONE]\n\n`, {
    headers: SSE_HEADERS,
  });
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const messages = parsed.data.messages;
  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    return Response.json(
      { error: "Last message must be from the user" },
      { status: 400 },
    );
  }

  // Asking for another person's data is out of scope regardless of what the
  // corpus contains, so it is refused before retrieval rather than after.
  if (isThirdPartyDataRequest(last.content)) {
    return staticStream(THIRD_PARTY_DATA_REPLY);
  }

  // Retrieval query: the current question plus the last two user turns before
  // it, so a bare follow-up ("who do I tag?", "i mean the cohort one") still
  // carries its subject. Assistant text is deliberately excluded — its wording
  // would drag retrieval toward whatever the last answer happened to mention.
  //
  // Two turns rather than one because a clarification costs a turn: after
  // "which did you mean?" -> "the cohort interview", the original question is
  // already two turns back, and a one-turn window has forgotten it.
  const priorUserTurns = messages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content);
  const query = [...priorUserTurns, last.content].join("\n");

  let retrieval;
  try {
    retrieval = await retrieve(query);
  } catch (error) {
    // The search itself broke. Saying the knowledge base has nothing would
    // blame the corpus for a system fault and hide the incident.
    logger.error("Chatbot retrieval failed", { error: String(error) });
    return staticStream(RETRIEVAL_ERROR_MESSAGE);
  }

  if (retrieval.verdict === "fallback") {
    logger.info("Chatbot fallback: insufficient retrieval confidence", {
      score: Number(retrieval.topScore.toFixed(3)),
    });
    return staticStream(FALLBACK_MESSAGE);
  }

  // A weak or split signal is handled BY THE MODEL, with the retrieved context
  // and the same grounding rules, rather than by a canned list of topic names.
  // The canned version could not see that the user had already answered the
  // clarifying question in their previous message, which is what made the
  // assistant feel like a phone menu instead of a conversation.
  const ambiguous = retrieval.verdict === "clarify";

  const today = formatInTimeZone(new Date(), IST, "d MMMM yyyy");
  // Dates and open/closed states come from the live site every request, not
  // from whenever the corpus was last ingested. See lib/chatbot/live-facts.ts.
  const liveFacts = await buildLiveFacts();
  const system = buildSystemPrompt(
    buildContext(retrieval.results),
    today,
    ambiguous,
    liveFacts,
  );
  const turns: ChatTurn[] = messages.slice(-HISTORY_TURNS);

  const generation = await generateStream(system, turns);
  if (!generation.ok) {
    // Retrieval SUCCEEDED and generation did not. Saying the knowledge base has
    // nothing would be false, and it hides an outage behind a content problem.
    // The deterministic clarification is a better answer than a wrong excuse.
    logger.error("Chatbot generation unavailable — every provider failed");
    return staticStream(
      ambiguous
        ? buildClarifyMessage(retrieval.topics)
        : GENERATION_UNAVAILABLE_MESSAGE,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = generation.stream.getReader();
      let produced = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            produced = true;
            controller.enqueue(encoder.encode(sseFrame(value)));
          }
        }
        // A provider that opened a stream and then said nothing must not leave
        // an empty bubble on screen. This is an upstream failure, so it reports
        // as one — the corpus already proved it had an answer.
        if (!produced) {
          controller.enqueue(
            encoder.encode(sseFrame(GENERATION_UNAVAILABLE_MESSAGE)),
          );
        }
      } catch (error) {
        logger.error("Chatbot stream broke mid-response", {
          provider: generation.provider,
          error: String(error),
        });
        if (!produced) {
          controller.enqueue(
            encoder.encode(sseFrame(GENERATION_UNAVAILABLE_MESSAGE)),
          );
        }
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
