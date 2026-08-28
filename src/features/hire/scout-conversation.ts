import "server-only";

import { logger } from "@/lib/logger";
import {
  HIRE_SLOTS,
  applyDefaultSkipped,
  isSlotFilled,
  jobSpecSchema,
  scoutTurnSchema,
  skippedSlots,
  type HireSlot,
  type JobSpec,
  type ScoutTurn,
} from "@/lib/validations/hire";
import {
  EVIDENCE_KEYS,
  asRoleTitle,
  formatSpecSalary,
  isMonthlyContext,
  parseMoney,
} from "@/features/hire/spec-fields";
import { readPoolExtra } from "@/features/hire/pool-brief";
import { trackLabels } from "@/features/hire/track-registry";
import { runScoutAgent } from "@/features/hire/scout-agent";
import { readOfferedChips, suggestChips, type ScoutChip } from "@/features/hire/scout-chips";
import { searchable, type ScoutToolDeps } from "@/features/hire/scout-tools";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * One conversational turn.
 *
 * This file used to be 1,500 lines and decided everything with regexes that ran
 * BEFORE the model saw the message: `extractPoolBrief` could commit a filter and
 * fire a search, so "who is prime minister of india" matched an India pattern and
 * searched the pool 94 lines before the question detector was reached. Scout's
 * understanding was exactly its keyword list.
 *
 * What is left is two things the agent should not be asked to do:
 *
 *   1. The CHIP PROTOCOL. A tapped chip carries an exact machine value
 *      (`skip:salary`, `salary:500000-1000000`, `edit:mustHaveStack`,
 *      `action:search`). An exact match is proof of a tap, so it is parsed here
 *      with no model call — instant, free, correct with Groq unreachable, and on
 *      an 8000-TPM plan the reason a conversation of taps costs nothing.
 *
 *   2. TURN ASSEMBLY. `spec`, `summary`, `readyToSearch` and the chips are
 *      computed from the brief. The agent supplies prose and tool calls; it never
 *      decides what the requirement says or whether a search is possible.
 *
 * Everything else — reading the message, asking the next question, answering
 * about the pool, choosing to search — is the agent's, through validated tools.
 */

/**
 * Merge the recruiter's answer into ONE named slot.
 *
 * Deliberately slot-scoped. The previous implementation guessed which field a
 * free-text reply belonged to, so the answer to "what role?" was filed as a
 * required skill and the real stack answer was then discarded. Answering a
 * question can no longer write to a field that question didn't ask about.
 *
 * This runs before the model does and does not depend on it, so a chip click
 * lands correctly even when the AI is unreachable.
 */
function mergeIntoSlot(spec: JobSpec, slot: HireSlot, raw: string): JobSpec {
  const msg = raw.trim();
  const lower = msg.toLowerCase();
  const next: JobSpec = { ...spec };

  // "skip:*" marks a slot answered-as-unspecified so it is not asked again.
  if (lower.startsWith("skip:")) {
    switch (slot) {
      case "salary":
        return { ...next, salaryMin: 0, salaryMax: 0 };
      case "employmentType":
        return { ...next, employmentType: "FULL_TIME" };
      case "workMode":
        return { ...next, workMode: "FLEXIBLE" };
      case "locationCity":
        return { ...next, locationCity: "Any" };
      case "noticePeriodDays":
        return { ...next, noticePeriodDays: 180 };
      case "experience":
        return { ...next, minExperience: 0, maxExperience: 50 };
      default: {
        // Seniority and evidence priority have no sentinel that reads as an
        // answer, so record the refusal itself. Returning `next` unchanged
        // here left the slot unanswered, and Scout re-asked the same
        // chip-only question forever.
        const prior = (next.extra ?? {}) as Record<string, unknown>;
        const already = Array.isArray(prior.skipped)
          ? (prior.skipped as string[])
          : [];
        return {
          ...next,
          extra: { ...prior, skipped: [...new Set([...already, slot])] },
        };
      }
    }
  }

  switch (slot) {
    case "title": {
      const role = asRoleTitle(msg);
      // An unusable title is worse than an empty one: it is echoed back in
      // every later question and stored on the request. A whole sentence —
      // "i want few candidates from india who has done atleast 30 days of
      // claude challenge" — became the job title, and then appeared inside
      // "What seniority for the …?" for the rest of the conversation.
      return role ? { ...next, title: role } : next;
    }

    case "seniority": {
      const hit = (["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD"] as const).find(
        (s) => lower === s.toLowerCase(),
      );
      // Deliberately does NOT back-fill an experience band. Doing so marked the
      // `experience` slot answered, so Scout silently stopped asking about it
      // and the progress bar jumped two steps on one reply.
      return hit ? { ...next, seniority: hit } : next;
    }

    case "mustHaveStack": {
      const stack = msg
        .split(/[,/|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12);
      return stack.length ? { ...next, mustHaveStack: stack } : next;
    }

    case "evidencePriority": {
      // Only the dimensions the ranker actually understands. Accepting free
      // text here once stored "what else do you need from me?" as a ranking
      // signal, which then silently weighted nothing.
      const keys = msg
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => EVIDENCE_KEYS.has(s))
        .slice(0, 5);
      return keys.length ? { ...next, evidencePriority: keys } : next;
    }

    case "salary": {
      const monthly = isMonthlyContext(next);
      // Chip values are always annual rupees; the period is read from the role,
      // not from the chip, so one set of values serves both.
      const chip = /salary:(\d+)-(\d+)/.exec(lower);
      if (chip) {
        return {
          ...next,
          salaryMin: Number(chip[1]),
          salaryMax: Number(chip[2]),
          salaryCurrency: "INR",
          salaryPeriod: monthly ? "MONTHLY" : "ANNUAL",
        };
      }
      const parsed = parseMoney(msg, monthly);
      if (!parsed) return next;
      return {
        ...next,
        salaryMin: parsed.min,
        salaryMax: parsed.max,
        salaryCurrency: "INR",
        salaryPeriod: parsed.period,
      };
    }

    case "employmentType": {
      const hit = (
        ["FULL_TIME", "CONTRACT", "INTERNSHIP", "PART_TIME"] as const
      ).find((s) => lower === s.toLowerCase());
      return hit ? { ...next, employmentType: hit } : next;
    }

    case "workMode": {
      const hit = (["ONSITE", "HYBRID", "REMOTE", "FLEXIBLE"] as const).find(
        (s) => lower === s.toLowerCase(),
      );
      return hit ? { ...next, workMode: hit } : next;
    }

    case "locationCity":
      return { ...next, locationCity: msg.slice(0, 80) };

    case "noticePeriodDays": {
      const n = /\d+/.exec(msg);
      return n
        ? { ...next, noticePeriodDays: Math.min(180, Number(n[0])) }
        : next;
    }

    case "experience": {
      const nums = msg.match(/\d+/g);
      if (!nums?.length) return next;
      const a = Number(nums[0]);
      const b = nums[1] ? Number(nums[1]) : a;
      return {
        ...next,
        minExperience: Math.min(a, b),
        maxExperience: Math.max(a, b),
      };
    }
  }
}

/** The running one-line summary under Scout's name. */
function summarize(spec: JobSpec): string {
  const parts: string[] = [];
  if (spec.title) parts.push(spec.title);
  if (spec.seniority) parts.push(spec.seniority.toLowerCase());
  if (spec.mustHaveStack?.length)
    parts.push(spec.mustHaveStack.slice(0, 4).join(" · "));
  if (spec.salaryMin && spec.salaryMax)
    parts.push(
      `₹${Math.round(spec.salaryMin / 100000)}–${Math.round(spec.salaryMax / 100000)} LPA`,
    );
  if (spec.workMode) parts.push(spec.workMode.toLowerCase());
  if (spec.locationCity && spec.locationCity !== "Any")
    parts.push(spec.locationCity);

  // Pool filters belong here too. Without them a recruiter who said "5 from the
  // claude challenge with 30+ days" set three real filters and the summary still
  // read "Starting a new requirement" — the one line meant to show what Scout is
  // about to search showed none of it.
  const pool = readPoolExtra(spec);
  const tracks = trackLabels(pool.sources);
  if (tracks.length) parts.push(tracks.join(" + "));
  if (pool.minEvidenceDays != null) {
    parts.push(`${pool.minEvidenceDays}+ verified days`);
  }
  if (pool.resultLimit != null) parts.push(`top ${pool.resultLimit}`);

  return parts.length ? parts.join(" • ") : "Starting a new requirement.";
}

/** Short, zero-token acknowledgement for a tapped chip. */
function chipAck(slot: HireSlot, spec: JobSpec): string {
  switch (slot) {
    case "title":
      return `${spec.title} — good brief.`;
    case "seniority": {
      const s = spec.seniority ?? "";
      return `${s.charAt(0)}${s.slice(1).toLowerCase()} it is.`;
    }
    case "mustHaveStack":
      return `Noted: ${(spec.mustHaveStack ?? []).join(", ")}.`;
    case "evidencePriority":
      return "Got it — I'll weight the ranking that way.";
    case "salary": {
      const money = formatSpecSalary(spec);
      return money && money !== "not specified"
        ? `Noted: ${money}.`
        : "No problem, skipping budget.";
    }
    case "employmentType":
      return "Noted.";
    case "workMode":
      return spec.workMode === "REMOTE"
        ? "Remote — then I won't ask about a city."
        : "Noted.";
    case "locationCity":
      return spec.locationCity === "Any"
        ? "Fine, any city."
        : `${spec.locationCity} it is.`;
    case "noticePeriodDays":
      return "Got it.";
    case "experience":
      return "Understood.";
  }
}

/**
 * Unset one slot so the engine asks about it again.
 *
 * "Change the stack" was rendered as a chip from the day the post-intake turn
 * existed and was never wired to anything: `isChipAnswer` waved `edit:` through,
 * and the handler behind it was guarded by a pending slot that, after intake,
 * is always null. Tapping it did nothing at all.
 *
 * Also clears the slot from the skipped list — re-opening a question the
 * recruiter previously declined has to actually re-ask it.
 */
function clearSlot(spec: JobSpec, slot: HireSlot): JobSpec {
  const next: JobSpec = { ...spec };
  const skipped = [...skippedSlots(spec)].filter((s) => s !== slot);
  next.extra = { ...(spec.extra ?? {}), skipped };

  switch (slot) {
    case "title":
      next.title = undefined;
      break;
    case "seniority":
      next.seniority = null;
      break;
    case "mustHaveStack":
      next.mustHaveStack = [];
      break;
    case "evidencePriority":
      next.evidencePriority = [];
      break;
    case "salary":
      next.salaryMin = null;
      next.salaryMax = null;
      break;
    case "employmentType":
      next.employmentType = null;
      break;
    case "workMode":
      next.workMode = null;
      break;
    case "locationCity":
      next.locationCity = null;
      break;
    case "noticePeriodDays":
      next.noticePeriodDays = null;
      break;
    case "experience":
      next.minExperience = null;
      next.maxExperience = null;
      break;
  }
  return next;
}


/**
 * Instructions the engine acts on directly, with no model in the loop.
 *
 * Handled first. These are unambiguous by construction — the client only ever
 * sends them because the recruiter tapped a button we generated.
 */
function engineAction(spec: JobSpec, msg: string): ScoutTurn | null {
  const m = msg.trim();

  if (/^action:search$/i.test(m)) {
    return turnFor(spec, "Searching the verified pool now.", {
      action: "search",
    });
  }

  if (/^action:reset$/i.test(m)) {
    return turnFor({}, "Starting fresh — tell me about the new role.", {
      action: "reset",
    });
  }

  const edit = /^edit:(.+)$/i.exec(m);
  if (edit?.[1]) {
    const raw = edit[1].trim();
    const slot =
      HIRE_SLOTS.find((s) => s.toLowerCase() === raw.toLowerCase()) ??
      // Older chips said "stack"; the slot is mustHaveStack.
      (raw.toLowerCase() === "stack" ? ("mustHaveStack" as HireSlot) : null);
    if (slot) {
      const cleared = clearSlot(spec, slot);
      return turnFor(cleared, `Alright — what should ${SLOT_WORD[slot]} be instead?`);
    }
  }

  // A chip that answers a specific field: `skip:<slot>` or `salary:<min>-<max>`.
  const scoped = /^(skip|salary):/i.exec(m);
  if (scoped) {
    const slot: HireSlot | null = /^salary:/i.test(m)
      ? "salary"
      : (HIRE_SLOTS.find(
          (s) => s.toLowerCase() === m.slice(5).trim().toLowerCase(),
        ) ??
        (m.slice(5).trim().toLowerCase() === "stack"
          ? ("mustHaveStack" as HireSlot)
          : null));
    if (slot) {
      const parsed = jobSpecSchema.safeParse(mergeIntoSlot(spec, slot, m));
      const next = parsed.success ? parsed.data : spec;
      return turnFor(next, isSlotFilled(next, slot) ? chipAck(slot, next) : "");
    }
  }

  // A generated chip whose value is a real field, not a protocol prefix —
  // "MID", "REMOTE", "Python, SQL". These used to fall through to the model,
  // so a tap of Mid could 429 and lose the answer.
  const enumSlot = enumChipSlot(m);
  if (enumSlot) {
    const parsed = jobSpecSchema.safeParse(mergeIntoSlot(spec, enumSlot, m));
    const next = parsed.success ? parsed.data : spec;
    if (isSlotFilled(next, enumSlot)) {
      return turnFor(next, chipAck(enumSlot, next));
    }
  }

  return null;
}

function enumChipSlot(raw: string): HireSlot | null {
  const m = raw.trim();
  if (/^(INTERN|JUNIOR|MID|SENIOR|LEAD)$/i.test(m)) return "seniority";
  if (/^(ONSITE|HYBRID|REMOTE|FLEXIBLE)$/i.test(m)) return "workMode";
  if (/^(FULL_TIME|CONTRACT|INTERNSHIP|PART_TIME)$/i.test(m)) {
    return "employmentType";
  }
  return null;
}

/** Plain words for a slot, for the one sentence `edit:` produces. */
const SLOT_WORD: Record<HireSlot, string> = {
  title: "the role",
  seniority: "the seniority",
  mustHaveStack: "the must-have skills",
  evidencePriority: "the evidence weighting",
  salary: "the budget",
  employmentType: "the engagement type",
  workMode: "the work mode",
  locationCity: "the office city",
  noticePeriodDays: "the start window",
  experience: "the experience band",
};

/**
 * A value only a generated chip could produce.
 *
 * Exact-match against the chips currently on offer, plus the four machine
 * prefixes. Anything else is typed text and belongs to the agent.
 */
function isChipValue(spec: JobSpec, msg: string): boolean {
  const m = msg.trim();
  if (/^(skip|salary|action|edit):/i.test(m)) return true;
  if (enumChipSlot(m)) return true;
  return suggestChips(spec, searchable(spec), readOfferedChips(spec)).some(
    (c) => c.value === m,
  );
}

/**
 * Stash (or clear) the chips offered this turn so the next tap can be
 * recognised without the model. Lives on `spec.extra`, which already carries
 * pool filters and skipped slots — one JSON column, no schema change.
 */
function withOfferedChips(
  spec: JobSpec,
  chips: ScoutChip[] | null | undefined,
): JobSpec {
  const extra = { ...(spec.extra ?? {}) } as Record<string, unknown>;
  if (chips && chips.length > 0) extra.offeredChips = chips;
  else delete extra.offeredChips;
  return { ...spec, extra };
}

/**
 * Assemble the visible turn.
 *
 * Everything here is computed, never taken from the model. `readyToSearch` is the
 * engine's judgement that a search would mean something — note that it no longer
 * triggers one: the client used to fire a search the moment this went true, which
 * was right for a form that ended and wrong for an agent that decides. The agent
 * asks for a search through its tool, and that arrives as `action`.
 */
function turnFor(
  spec: JobSpec,
  text: string,
  extra?: {
    action?: "search" | "reset" | null;
    notice?: string | null;
    offeredChips?: ScoutChip[] | null;
  },
): ScoutTurn {
  const ready = searchable(spec);
  const agentChips = extra?.offeredChips ?? null;
  return {
    spec: withOfferedChips(spec, agentChips),
    nextQuestion: text.trim() ? text.trim().slice(0, 500) : null,
    options: suggestChips(spec, ready, agentChips).slice(0, 12),
    allowFreeText: true,
    readyToSearch: ready,
    summary: summarize(spec),
    action: extra?.action ?? null,
    notice: extra?.notice ?? null,
  };
}

/** Last line of defence: a turn that fails its own schema is never returned. */
function checked(turn: ScoutTurn, fallback: ScoutTurn): ScoutTurn {
  const parsed = scoutTurnSchema.safeParse(turn);
  if (parsed.success) return parsed.data;
  logger.error("[hire] scout turn failed schema", {
    err: parsed.error.message.slice(0, 200),
  });
  return fallback;
}

/**
 * Row access for the agent's tools.
 *
 * Imported lazily so this module — and therefore both Server Actions — do not
 * pull the whole search stack into scope on a turn that never touches it. A chip
 * tap must not pay for Prisma.
 */
const toolDeps: ScoutToolDeps = {
  poolSnapshot: async () => {
    const { poolSnapshot } = await import("@/features/hire/pool-facts");
    return poolSnapshot() as unknown as Promise<Record<string, unknown>>;
  },
  previewMatch: async (spec) => {
    const { previewMatch } = await import("@/features/hire/pool-facts");
    return previewMatch(spec) as unknown as Promise<Record<
      string,
      unknown
    > | null>;
  },
};

export async function runScoutTurn(args: {
  priorSpec: JobSpec;
  history: ChatMessage[];
  userMessage: string;
}): Promise<ScoutTurn> {
  // Quiet the slots the conversation no longer opens with. Filled values are
  // left alone.
  const priorSpec = applyDefaultSkipped(args.priorSpec);
  const msg = args.userMessage.trim();
  const unchanged = turnFor(priorSpec, "");

  // 1 — chip protocol. No model, no tokens.
  if (isChipValue(priorSpec, msg)) {
    const direct = engineAction(priorSpec, msg);
    if (direct) return checked(direct, unchanged);
  }

  // 2 — the agent. It reads the message, decides, and acts only through tools.
  const out = await runScoutAgent({
    priorSpec,
    history: args.history,
    userMessage: msg,
    deps: toolDeps,
  });

  return checked(
    turnFor(out.spec, out.text, {
      action: out.action,
      offeredChips: out.offeredChips,
    }),
    unchanged,
  );
}
