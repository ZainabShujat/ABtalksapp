/**
 * Public surface of the LangGraph interview agent.
 *
 * Import from here, never from `graph.ts`/`nodes.ts` directly, so the internals
 * (node names, the LangGraph version, the state channels) can move without
 * touching callers.
 *
 * Note what is NOT re-exported: `llm/registry.ts` and `llm/anthropic-provider.ts`
 * are `server-only`. A caller that needs a live provider imports the registry
 * itself, which keeps this module importable from a plain tsx test script.
 */
export { runInterviewTurn, buildInterviewGraph } from "@/features/interview/agent/graph";
export type { RunTurnInput, RunTurnResult } from "@/features/interview/agent/graph";
export { createMockInterviewLLM } from "@/features/interview/agent/llm/mock-provider";
export { createJsonInterviewLLM } from "@/features/interview/agent/llm/json-provider";
export type { AskJson } from "@/features/interview/agent/llm/json-provider";
export type {
  AnalyzeAnswerInput,
  InterviewLLM,
} from "@/features/interview/agent/llm/provider";
export {
  CLOSING_LINE,
  REDIRECT_LINE,
  REPEAT_LINE,
  closingLineFor,
  redirectLineFor,
  repeatLineFor,
  routeDecision,
} from "@/features/interview/agent/policy";
export type {
  AgentAction,
  InterviewAgentState,
  InterviewDecision,
} from "@/features/interview/agent/types";
