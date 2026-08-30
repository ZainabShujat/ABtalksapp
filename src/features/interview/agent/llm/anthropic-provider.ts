import "server-only";
import { askClaudeJson } from "@/lib/anthropic";
import { createJsonInterviewLLM } from "@/features/interview/agent/llm/json-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * Anthropic implementation, built by handing the shared JSON provider a way to
 * call Claude. All validation, retry and fallback behaviour lives in
 * `json-provider.ts`, so this file stays the size it should be: one adapter.
 *
 * `server-only` because `askClaudeJson` reads the API key from the server
 * environment. Nothing in `agent/` outside `registry.ts` imports this.
 */
export function createAnthropicInterviewLLM(): InterviewLLM {
  return createJsonInterviewLLM({
    name: "anthropic",
    askJson: ({ system, user, maxTokens, temperature }) =>
      askClaudeJson<unknown>({ system, user, maxTokens, temperature }),
  });
}
