"use client";

import { useState } from "react";
import Link from "next/link";
import confetti from "canvas-confetti";
import ReactMarkdown from "react-markdown";
import type { ProgramMissionType } from "@prisma/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  CheckList,
  type CheckItem,
} from "@/components/program/workbench/check-list";
import { DaySectionIcon } from "@/components/program/day-section-card";
import { programMdComponents } from "@/components/program/markdown-code";
import type { DatabricksMissionState } from "@/features/databricks/missions";
import { DATABRICKS_TOTAL_DAYS } from "@/features/databricks/constants";
import { submitDatabricksMissionAction } from "@/app/actions/databricks-actions";
import { dsButtonVariants } from "@/components/design/ds-button";
import { cn } from "@/lib/utils";

type Props = {
  dayNumber: number;
  missionType: ProgramMissionType;
  githubRepoUrl: string;
  missionState: DatabricksMissionState;
  dataRoomQuestions?: string[];
  verifyIntro?: string;
};

const ctaClass = dsButtonVariants({ size: "sm" });

const cardClass =
  "rounded-[12px] border border-[#E0E0E0] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-5";

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

function coerceAnswers(answers: string[]): (string | number)[] {
  return answers.map((a) => {
    const n = Number(a);
    return a.trim() !== "" && !Number.isNaN(n) ? n : a;
  });
}

export function DatabricksMissionPanel({
  dayNumber,
  missionType,
  githubRepoUrl,
  missionState: initialState,
  dataRoomQuestions = [],
  verifyIntro,
}: Props) {
  const [missionState, setMissionState] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState<CheckItem[] | null>(null);
  const [passedBanner, setPassedBanner] = useState<{
    points: number;
    unlockedDay?: number;
  } | null>(null);
  const questionCount =
    missionState.dataRoomQuestionCount ?? dataRoomQuestions.length;
  const [answers, setAnswers] = useState<string[]>(
    Array(Math.max(questionCount, 0) || 0).fill(""),
  );

  async function handleSubmit() {
    setSubmitting(true);
    setVerdict(null);
    try {
      const payload =
        questionCount > 0 ? { answers: coerceAnswers(answers) } : {};

      const result = await submitDatabricksMissionAction({
        dayNumber,
        payload,
      });
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

  if (missionState.dayState === "PASSED") {
    return (
      <div id="mission-verify" className={cn(cardClass, "space-y-4")}>
        <p className="font-semibold text-[#2E7D32]">Mission cleared ✓</p>
        {passedBanner?.unlockedDay &&
          passedBanner.unlockedDay <= DATABRICKS_TOTAL_DAYS && (
            <Link
              href={`/program/databricks/day/${passedBanner.unlockedDay}`}
              className={ctaClass}
            >
              Continue to Day {passedBanner.unlockedDay}
            </Link>
          )}
        {verdict && <CheckList items={verdict} />}
      </div>
    );
  }

  const submitLabel = submitting ? "Verifying…" : "Submit";

  return (
    <div id="mission-verify" className={cn(cardClass, "space-y-5")}>
      <div className="flex items-center gap-2.5">
        <DaySectionIcon name="verify" />
        <h2 className="font-heading text-base font-semibold text-[#111111] md:text-lg">
          {sectionTitle(missionType, questionCount)}
        </h2>
      </div>

      {passedBanner && (
        <div className="rounded-[12px] border border-[#E0E0E0] bg-[#FFECE3] p-4">
          <p className="font-semibold text-[#2E7D32]">
            Day {dayNumber} cleared — +{passedBanner.points} pts
            {passedBanner.unlockedDay
              ? ` · Day ${passedBanner.unlockedDay} unlocked`
              : ""}
          </p>
          {passedBanner.unlockedDay &&
            passedBanner.unlockedDay <= DATABRICKS_TOTAL_DAYS && (
              <Link
                href={`/program/databricks/day/${passedBanner.unlockedDay}`}
                className={cn(ctaClass, "mt-3")}
              >
                Continue to Day {passedBanner.unlockedDay}
              </Link>
            )}
        </div>
      )}

      {verifyIntro && questionCount > 0 && (
        <p className="text-sm text-[#4B4B4B]">{verifyIntro}</p>
      )}

      {missionType === "SHIP_IT" && (
        <div className="space-y-2">
          <p className="text-sm text-[#4B4B4B]">
            Build locally, then push your artifact to{" "}
            <a
              href={githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#E05226] underline-offset-4 hover:underline"
            >
              {githubRepoUrl}
            </a>
            . We verify the repo against the mission checklist.
          </p>
          {missionState.shipItHints && missionState.shipItHints.length > 0 && (
            <ul className="space-y-2 text-sm">
              {missionState.shipItHints.map((h, i) => (
                <li
                  key={`${h.check}:${h.path}:${i}`}
                  className="font-mono text-[#8F8F8F]"
                >
                  {h.check}: <span className="text-[#111111]">{h.path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dataRoomQuestions.length > 0 && (
        <div className="space-y-6">
          {answers.map((val, i) => {
            const question =
              dataRoomQuestions.length === answers.length
                ? dataRoomQuestions[i]
                : null;
            return (
              <div key={i} className="space-y-3">
                {question ? (
                  <div className="text-sm font-semibold text-[#111111] [&_p]:mb-0 [&_strong]:font-semibold [&_strong]:text-[#111111]">
                    <ReactMarkdown components={programMdComponents}>
                      {`Q${i + 1}) ${question}`}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[#111111]">
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
                  className="h-12 rounded-[10px] border border-[#E0E0E0] bg-white px-4 text-sm text-[#111111] placeholder:text-[#8F8F8F]"
                />
              </div>
            );
          })}
        </div>
      )}

      {verdict && (
        <div className="rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#E05226]">
            Verification
          </h3>
          <CheckList items={verdict} running={submitting} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className={cn(ctaClass, "disabled:opacity-60")}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
