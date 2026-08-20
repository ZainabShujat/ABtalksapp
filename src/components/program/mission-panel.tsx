"use client";

import { useState } from "react";
import Link from "next/link";
import confetti from "canvas-confetti";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import type { ProgramMissionType } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckList, type CheckItem } from "@/components/program/workbench/check-list";
import { DaySectionIcon } from "@/components/program/day-section-card";
import { programMdComponents } from "@/components/program/markdown-code";
import type { MissionState } from "@/features/program/missions";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import {
  submitMissionRunAction,
} from "@/app/actions/program-mission-actions";
import { requestMentorReviewAction } from "@/app/actions/program-ai-actions";
import { cn } from "@/lib/utils";

type Props = {
  dayNumber: number;
  dayTitle: string;
  missionType: ProgramMissionType;
  githubRepoUrl: string;
  missionState: MissionState;
  initialMentorFeedback?: string | null;
  dataRoomQuestions?: string[];
  verifyIntro?: string;
};

const figmaBtnClass =
  "inline-flex h-9 items-center justify-center rounded-[12px] border border-black bg-[#7364E6] px-4 text-sm font-bold text-white shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5)] hover:bg-[#7364E6]/90";

const cardClass =
  "rounded-[16px] border border-[rgba(46,57,75,0.69)] bg-[rgba(5,12,33,0.89)] p-4 md:p-5";

function MentorFeedbackCard({ feedback }: { feedback: string }) {
  return (
    <div className="rounded-xl border border-[#8365E3]/40 bg-[#110528] p-4 text-sm text-white [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-[#BCBCBC]">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#968BEC]">
        AI Mentor review
      </p>
      <ReactMarkdown components={programMdComponents}>{feedback}</ReactMarkdown>
    </div>
  );
}

function fireConfetti() {
  void confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
}

function sectionTitle(
  missionType: ProgramMissionType,
  questionCount: number,
): string {
  if (missionType === "DATA_ROOM" || questionCount > 0) {
    return "Let’s test your work!";
  }
  if (missionType === "SHIP_IT") return "What we’ve achieved";
  return "Mission verification";
}

export function MissionPanel({
  dayNumber,
  missionType,
  githubRepoUrl,
  missionState: initialState,
  initialMentorFeedback = null,
  dataRoomQuestions = [],
  verifyIntro,
}: Props) {
  const [missionState, setMissionState] = useState(initialState);
  const [mentorFeedback, setMentorFeedback] = useState<string | null>(
    initialMentorFeedback,
  );
  const [mentorLoading, setMentorLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState<CheckItem[] | null>(null);
  const [passedBanner, setPassedBanner] = useState<{
    points: number;
    unlockedDay?: number;
  } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [bossRepo, setBossRepo] = useState(githubRepoUrl);
  const [bossWriteup, setBossWriteup] = useState("");
  const [answers, setAnswers] = useState<string[]>(
    Array(missionState.dataRoomQuestionCount ?? 1).fill(""),
  );

  async function handleSubmit() {
    setSubmitting(true);
    setVerdict(null);
    try {
      let payload: unknown = {};

      if (missionType === "CODE_SPRINT") {
        toast.error(
          "In-browser code execution was removed. Complete CODE_SPRINT missions locally; this day type is unused in the current curriculum.",
        );
        return;
      } else if (missionType === "SHIP_IT") {
        if ((missionState.dataRoomQuestionCount ?? 0) > 0) {
          payload = {
            answers: answers.map((a) => {
              const n = Number(a);
              return a.trim() !== "" && !Number.isNaN(n) ? n : a;
            }),
          };
        } else {
          payload = {};
        }
      } else if (missionType === "DATA_ROOM") {
        payload = {
          answers: answers.map((a) => {
            const n = Number(a);
            return a.trim() !== "" && !Number.isNaN(n) ? n : a;
          }),
        };
      } else if (missionType === "PROMPT_FORGE") {
        payload = { prompt };
      } else if (missionType === "BOSS_BUILD") {
        payload = { repoUrl: bossRepo, writeup: bossWriteup };
      }

      const result = await submitMissionRunAction({ dayNumber, payload });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      const lines: CheckItem[] = result.data.verdict.map((v) => ({
        check: v.check,
        passed: v.passed,
        detail: v.detail,
      }));
      setVerdict(lines);

      if (result.data.passed) {
        fireConfetti();
        setPassedBanner({
          points: result.data.pointsAwarded,
          unlockedDay: result.data.unlockedDay,
        });
        setMissionState((s) => ({
          ...s,
          dayState: "PASSED",
          passed: true,
        }));
      } else {
        setMissionState((s) => ({
          ...s,
          failedRunCount: s.failedRunCount + 1,
        }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMentorReview() {
    if (mentorFeedback) {
      toast.info("Already reviewed — showing your saved note.");
      return;
    }
    setMentorLoading(true);
    try {
      const result = await requestMentorReviewAction({ dayNumber });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMentorFeedback(result.data.feedback);
      toast.success("AI Mentor review ready!");
    } finally {
      setMentorLoading(false);
    }
  }

  if (missionState.dayState === "PASSED") {
    return (
      <div
        id="mission-verify"
        className={cn(cardClass, "space-y-4 border-emerald-500/40")}
      >
        <p className="font-semibold text-emerald-400">Mission cleared ✓</p>
        {passedBanner?.unlockedDay &&
          passedBanner.unlockedDay <= PROGRAM_TOTAL_DAYS && (
            <Link
              href={`/program/day/${passedBanner.unlockedDay}`}
              className={figmaBtnClass}
            >
              Continue to Day {passedBanner.unlockedDay}
            </Link>
          )}
        {verdict && <CheckList items={verdict} />}
        {mentorFeedback ? (
          <MentorFeedbackCard feedback={mentorFeedback} />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 border-[#8365E3]/50 bg-transparent text-white"
            onClick={() => void handleMentorReview()}
            disabled={mentorLoading}
          >
            <Sparkles className="size-4" />
            {mentorLoading ? "Reviewing…" : "Get AI Mentor review"}
          </Button>
        )}
      </div>
    );
  }

  if (missionState.dayState === "SKIPPED") {
    return (
      <div
        id="mission-verify"
        className={cn(cardClass, "border-amber-500/40 text-sm text-[#BCBCBC]")}
      >
        You skipped this mission (0 points). Continue with the next unlocked
        day when you are ready.
      </div>
    );
  }

  const questionCount = missionState.dataRoomQuestionCount ?? 0;

  const submitLabel =
    missionType === "SHIP_IT"
      ? submitting
        ? "Verifying…"
        : "Submit"
      : submitting
        ? "Verifying…"
        : "Submit";

  return (
    <div id="mission-verify" className={cn(cardClass, "space-y-5")}>
      <div className="flex items-center gap-2.5">
        <DaySectionIcon name="verify" />
        <h2 className="text-base font-semibold text-[#968BEC] md:text-lg">
          {sectionTitle(missionType, questionCount)}
        </h2>
      </div>

      {passedBanner && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <p className="font-semibold text-emerald-400">
            Day {dayNumber} cleared — +{passedBanner.points} pts
            {passedBanner.unlockedDay
              ? ` · Day ${passedBanner.unlockedDay} unlocked`
              : ""}
          </p>
          {passedBanner.unlockedDay &&
            passedBanner.unlockedDay <= PROGRAM_TOTAL_DAYS && (
              <Link
                href={`/program/day/${passedBanner.unlockedDay}`}
                className={cn(figmaBtnClass, "mt-3")}
              >
                Go to Day {passedBanner.unlockedDay}
              </Link>
            )}
        </div>
      )}

      {verifyIntro && questionCount > 0 && (
        <p className="text-sm text-[#BCBCBC]">{verifyIntro}</p>
      )}

      {missionType === "SHIP_IT" && (
        <div className="space-y-2">
          <p className="text-sm text-[#BCBCBC]">
            Build locally in VS Code, then push your artifact to{" "}
            <a
              href={githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#968BEC] underline-offset-4 hover:underline"
            >
              {githubRepoUrl}
            </a>
            .{" "}
            <mark className="rounded bg-[#968BEC] px-1.5 py-0.5 font-semibold text-[#030712]">
              We verify the repo against the mission checklist.
            </mark>
          </p>
          {missionState.shipItHints && missionState.shipItHints.length > 0 && (
            <ul className="space-y-2 text-sm">
              {missionState.shipItHints.map((h, i) => (
                <li
                  key={`${h.check}:${h.path}:${i}`}
                  className="font-mono text-[#A5A5A5]"
                >
                  {h.check}: <span className="text-white">{h.path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {missionType === "PROMPT_FORGE" && (
        <div className="space-y-2">
          <Label htmlFor="prompt" className="text-[#BCBCBC]">
            Your system prompt
          </Label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-40 w-full rounded-[10px] border border-[#8365E3] bg-[#110528] p-3 font-mono text-sm text-white"
            placeholder="Write the prompt that satisfies the mission spec…"
          />
        </div>
      )}

      {missionType === "BOSS_BUILD" && (
        <div className="space-y-4 rounded-[20px] border border-[#8365E3] bg-[#110528] p-4">
          <div className="space-y-2">
            <Label htmlFor="boss-repo" className="text-[#BCBCBC]">
              Project repository URL
            </Label>
            <Input
              id="boss-repo"
              value={bossRepo}
              onChange={(e) => setBossRepo(e.target.value)}
              placeholder="https://github.com/you/project"
              className="border-[#8365E3] bg-[#110528] text-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="boss-writeup" className="text-[#BCBCBC]">
              Write-up
            </Label>
            <textarea
              id="boss-writeup"
              value={bossWriteup}
              onChange={(e) => setBossWriteup(e.target.value)}
              className="min-h-32 w-full rounded-[10px] border border-[#8365E3] bg-[#030712] p-3 text-sm text-white"
              placeholder="Describe what you built and how to run it…"
            />
          </div>
        </div>
      )}

      {questionCount > 0 && (
        <div className="space-y-6">
          {answers.map((val, i) => {
            const question =
              dataRoomQuestions.length === answers.length
                ? dataRoomQuestions[i]
                : null;
            return (
              <div key={i} className="space-y-3">
                {question ? (
                  <div className="text-sm font-semibold text-white [&_p]:mb-0 [&_strong]:font-bold [&_strong]:text-white">
                    <ReactMarkdown components={programMdComponents}>
                      {`Q${i + 1}) ${question}`}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-white">
                    {`Answer ${i + 1}`}
                  </p>
                )}
                <Input
                  id={`answer-${i}`}
                  value={val}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = e.target.value;
                    setAnswers(next);
                  }}
                  placeholder="Type answer here..."
                  className="h-12 rounded-[10px] border border-[#8365E3] bg-[#110528] px-4 text-sm text-white placeholder:text-[#8F8F8F]"
                />
              </div>
            );
          })}
        </div>
      )}

      {missionType === "CODE_SPRINT" && (
        <div className="rounded-[20px] border border-[#8365E3]/40 bg-[#110528] p-4 text-sm text-[#BCBCBC]">
          In-browser Workbench was removed. CODE_SPRINT days are not used in the
          current curriculum — build and verify via SHIP_IT repo checks instead.
        </div>
      )}

      {verdict && (
        <div className="rounded-[20px] border border-[#8365E3]/40 bg-[#110528] p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#968BEC]">
            Verification
          </h3>
          <CheckList items={verdict} running={submitting} />
        </div>
      )}

      {missionType !== "CODE_SPRINT" && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className={cn(figmaBtnClass, "disabled:opacity-60")}
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
