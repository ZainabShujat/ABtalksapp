"use server";

import { z } from "zod";
import { isInterviewBlueprint } from "@/features/interview/cohort/blueprint";
import {
  answerDemoSession,
  resetDemoSession,
  startDemoSession,
  type DemoResult,
  type DemoView,
} from "@/features/interview/agent/demo-session";

/**
 * Server Actions for the developer LangGraph demo.
 *
 * DEVELOPMENT ONLY. Every action re-checks `NODE_ENV` itself rather than
 * trusting the page to have guarded the route: a Server Action is a public HTTP
 * endpoint, so a route guard alone would leave these callable in production.
 * The check is here, at the entry point, on every action.
 *
 * These touch no database, no session, and no `ProgramMember`, so there is
 * nothing here that could affect a real candidate's milestone.
 */

function devOnly(): { ok: false; message: string } | null {
  if (process.env.NODE_ENV === "production") {
    return { ok: false, message: "The demo is not available in production." };
  }
  return null;
}

const startSchema = z.object({
  blueprint: z.string().refine(isInterviewBlueprint, "Unknown blueprint."),
});

const answerSchema = z.object({
  sessionId: z.string().uuid(),
  answerText: z.string().trim().min(1).max(4000),
});

const resetSchema = z.object({ sessionId: z.string().uuid() });

export async function startDemoInterviewAction(
  input: unknown,
): Promise<DemoResult> {
  const blocked = devOnly();
  if (blocked) return blocked;

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid blueprint." };
  }

  const data: DemoView = startDemoSession(
    parsed.data.blueprint as "DAY_15" | "DAY_31",
  );
  return { ok: true, data };
}

export async function submitDemoAnswerAction(
  input: unknown,
): Promise<DemoResult> {
  const blocked = devOnly();
  if (blocked) return blocked;

  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter an answer first." };
  }

  return answerDemoSession(parsed.data.sessionId, parsed.data.answerText);
}

export async function resetDemoInterviewAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const blocked = devOnly();
  if (blocked) return blocked;

  const parsed = resetSchema.safeParse(input);
  if (parsed.success) resetDemoSession(parsed.data.sessionId);
  return { ok: true };
}
