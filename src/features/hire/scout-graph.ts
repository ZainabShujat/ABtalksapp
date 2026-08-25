import "server-only";

import { ChatGroq } from "@langchain/groq";
import {
  Annotation,
  END,
  START,
  StateGraph,
  messagesStateReducer,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { logger } from "@/lib/logger";
import { groqApiKeys } from "@/lib/groq";

/**
 * The agent loop: model → tools → model, until the model stops calling tools.
 *
 * Two hard bounds, and they are separate on purpose. `recursionLimit` bounds
 * STEPS; it says nothing about seconds, and a slow upstream would sail past a
 * step budget while a recruiter waits on a blocked Server Action. The
 * `AbortSignal` bounds TIME. Both are required.
 *
 * Compiled with NO checkpointer. Conversation state already lives in Postgres
 * (`TalentRequest` + `TalentRequestMessage`); a checkpointer would be a second
 * store competing with the one that is already correct.
 *
 * The brief is not a state channel here — it lives in the per-turn tool context
 * (`scout-tools.ts`) that the executors mutate. Same guarantee, less machinery:
 * the model still cannot write the spec, because only a tool can.
 */

const ScoutState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

export type ScoutGraphState = typeof ScoutState.State;

/**
 * Steps, not round trips — LangGraph counts each node.
 *
 * Eight was too tight for the sequence a real search needs: list_tracks →
 * set_pool_filters → search_pool is already 7 steps with the closing message,
 * and one repeated call tipped it over. The loop was then cut off having queued
 * the search but never having told the recruiter — they saw a generic fallback
 * while their cards loaded. Twelve leaves room for a four-tool turn to still
 * finish speaking. The wall clock, not this, is what bounds a slow upstream.
 */
export const RECURSION_LIMIT = 12;

/**
 * `medium`, and this is not a tuning preference.
 *
 * At `low` the model's tool choice was measurably unstable: the same message
 * ("senior backend engineer, python and postgres, 25 LPA, remote") chose
 * `update_brief` on one run and `get_pool_stats` on another, from nothing but a
 * reordering of the system prompt. At `medium` the eval suite passed twice over.
 * The cost is ~950 tokens a hop instead of ~750, which matters against an
 * 8000-TPM ceiling — but an unstable router is not a cheaper agent, it is a
 * broken one.
 */
const REASONING_EFFORT = "medium";

function scoutModel(tools: StructuredToolInterface[]) {
  return new ChatGroq({
    apiKey: groqApiKeys()[0] ?? process.env.GROQ_API_KEY,
    model:
      process.env.HIRE_AGENT_MODEL ??
      process.env.HIRE_GROQ_MODEL ??
      "openai/gpt-oss-120b",
    temperature: 0.2,
    // gpt-oss reasons before it answers and that reasoning is billed against
    // max_tokens. Left at the default it spent the whole budget thinking and
    // returned a 400 rather than a parse error.
    maxTokens: 1200,
    reasoningEffort: REASONING_EFFORT,
  }).bindTools(tools);
}

/**
 * Build the graph for one turn.
 *
 * Rebuilt per turn because `tools` close over that turn's context. Cheap — it is
 * object wiring, not I/O.
 */
export function buildScoutGraph(
  system: string,
  tools: StructuredToolInterface[],
) {
  const model = scoutModel(tools);
  let hops = 0;

  async function agent(state: ScoutGraphState) {
    hops++;
    const res = await model.invoke([
      new SystemMessage(system),
      ...state.messages,
    ]);
    return { messages: [res] };
  }

  function shouldContinue(state: ScoutGraphState): "tools" | typeof END {
    const last = state.messages.at(-1);
    const calls = (last as AIMessage | undefined)?.tool_calls ?? [];
    return calls.length > 0 ? "tools" : END;
  }

  const graph = new StateGraph(ScoutState)
    .addNode("agent", agent)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      [END]: END,
    })
    .addEdge("tools", "agent")
    .compile();

  return { graph, hopCount: () => hops };
}

export type ScoutGraphRun =
  | { ok: true; text: string; hops: number }
  | {
      ok: false;
      reason: "timeout" | "recursion" | "rate_limit" | "error";
      hops: number;
    };

/**
 * Run one turn and return the model's closing words.
 *
 * Never throws. Every failure is a named reason so the caller can fall back to a
 * deterministic sentence — a recruiter must never meet silence, and must never
 * be shown a stack trace.
 */
export async function runScoutGraph(opts: {
  system: string;
  tools: StructuredToolInterface[];
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  deadlineMs: number;
}): Promise<ScoutGraphRun> {
  const { graph, hopCount } = buildScoutGraph(opts.system, opts.tools);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.deadlineMs);

  try {
    const out = await graph.invoke(
      {
        messages: [
          ...opts.history.map((m) =>
            m.role === "assistant"
              ? new AIMessage(m.content)
              : new HumanMessage(m.content),
          ),
          new HumanMessage(opts.userMessage),
        ],
      },
      { recursionLimit: RECURSION_LIMIT, signal: controller.signal },
    );

    const last = out.messages.at(-1);
    const text = typeof last?.content === "string" ? last.content.trim() : "";
    return { ok: true, text, hops: hopCount() };
  } catch (error) {
    const aborted = controller.signal.aborted;
    const name = error instanceof Error ? error.name : "";
    // 429 is not a bug and not a timeout — it is the plan's tokens-per-minute
    // ceiling, and it is common enough on the free tier that a recruiter must be
    // told to try again rather than shown a generic fallback that reads like an
    // answer.
    const rateLimited =
      /RateLimit|429/i.test(name) || /\b429\b|rate limit/i.test(String(error));
    const reason = aborted
      ? "timeout"
      : name === "GraphRecursionError"
        ? "recursion"
        : rateLimited
          ? "rate_limit"
          : "error";
    logger.error("[scout-graph] run failed", {
      reason,
      hops: hopCount(),
      error: String(error).slice(0, 200),
    });
    return { ok: false, reason, hops: hopCount() };
  } finally {
    clearTimeout(timer);
  }
}
