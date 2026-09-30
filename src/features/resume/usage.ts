import "server-only";
import type { ResumeParseSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { costMicroUsd } from "@/features/resume/providers/openai";

/**
 * One `ResumeParseUsage` row per résumé model HTTP call (plan 154), on every
 * path — registration, profile and admin import — including calls that were
 * rate-limited or failed, because those cost budget too.
 *
 * Never throws: losing a usage row must not fail a parse the candidate is
 * waiting on.
 */

export type ParseContext = {
  source: ResumeParseSource;
  userId?: string | null;
  resumeImportId?: string | null;
};

export async function recordParseUsage(input: {
  ctx: ParseContext;
  provider: "openai" | "gemini";
  model: string;
  outcome: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}): Promise<number> {
  const cost =
    input.provider === "openai"
      ? costMicroUsd(input.model, input.promptTokens, input.completionTokens)
      : 0;
  try {
    await prisma.resumeParseUsage.create({
      data: {
        source: input.ctx.source,
        userId: input.ctx.userId ?? null,
        resumeImportId: input.ctx.resumeImportId ?? null,
        provider: input.provider,
        model: input.model,
        outcome: input.outcome,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        costMicroUsd: cost,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
      },
      select: { id: true },
    });
  } catch (error) {
    logger.warn("[resume] usage row not recorded", {
      source: input.ctx.source,
      outcome: input.outcome,
      error: String(error),
    });
  }
  return cost;
}
