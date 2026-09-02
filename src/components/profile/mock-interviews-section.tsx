import Link from "next/link";
import type { HistoryEntry } from "@/features/interview/platform/service";

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  ABANDONED: "Left early",
  INVALID: "Not scored",
};

/**
 * How many attempts the profile shows before deferring to the history page.
 *
 * The profile is a summary surface: a candidate with fifteen attempts should
 * see that they have fifteen, not scroll through fifteen. The full list has its
 * own page and this links to it.
 */
const PREVIEW_COUNT = 2;

type Props = {
  /** Newest first. Already user-scoped by the caller. */
  attempts: HistoryEntry[];
};

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

/**
 * Mock interviews on the profile, read-only.
 *
 * Server Component — rendered by the page and handed to the client wizard as a
 * ReactNode. No wizard context, no form.
 */
export function MockInterviewsSection({ attempts }: Props) {
  if (attempts.length === 0) {
    return (
      <>
        <p className="pw-note">
          You haven&rsquo;t taken a mock interview yet. They are live voice
          interviews with an AI interviewer, and each one you finish keeps its
          own scored report.
        </p>
        <div className="pw-action-wrap" style={{ marginTop: 18 }}>
          <Link href="/mock-interviews" className="pw-btn-action">
            <MicIcon />
            <span>Take a mock interview</span>
          </Link>
        </div>
      </>
    );
  }

  const recent = attempts.slice(0, PREVIEW_COUNT);
  const hidden = attempts.length - recent.length;

  return (
    <div>
      <p className="pw-note">
        {attempts.length} interview{attempts.length === 1 ? "" : "s"} taken
        {recent.length < attempts.length
          ? ` — showing the ${recent.length} most recent`
          : ""}
        .
      </p>

      <ul className="pw-mock-list">
        {recent.map((a) => (
          <li key={a.id} className="pw-mock-item">
            <div>
              <p className="pw-mock-item-title">{a.domainLabel}</p>
              <p className="pw-mock-item-meta">
                Attempt {a.attemptNumber}
                {" · "}
                {a.createdAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {" · "}
                {STATUS_LABEL[a.status] ?? a.status}
                {a.status === "COMPLETED" && a.overallScore !== null
                  ? ` · ${(a.overallScore / 10).toFixed(1)}/10`
                  : ""}
              </p>
            </div>
            {a.hasReport ? (
              <Link
                href={`/mock-interviews/${a.domainSlug}/attempt/${a.id}/report`}
                className="pw-mock-link"
              >
                View report
              </Link>
            ) : (
              <span className="pw-mock-item-meta">Not scored</span>
            )}
          </li>
        ))}
      </ul>

      <div className="pw-mock-links">
        <Link href="/mock-interviews" className="pw-btn-action">
          <MicIcon />
          <span>Take another</span>
        </Link>
        <Link href="/mock-interviews/history" className="pw-mock-link">
          {hidden > 0
            ? `All ${attempts.length} interviews and reports`
            : "Full practice history"}
        </Link>
      </div>
    </div>
  );
}
