import type { UserEnrollmentSummary } from "@/features/enrollment/get-user-enrollments";
import { TrackRow, type TrackIcon } from "./track-row";

type Props = {
  enrollments: UserEnrollmentSummary[];
  claudeEnabled: boolean;
};

type OpenTrack = {
  href: string;
  title: string;
  support: string;
  icon: TrackIcon;
};

export function TrackList({ enrollments, claudeEnabled }: Props) {
  const enrolledDomains = new Set(
    enrollments.map((enrollment) => enrollment.domain),
  );
  const hasCoreChallenge = ["SE", "DS", "AI"].some((domain) =>
    enrolledDomains.has(domain as UserEnrollmentSummary["domain"]),
  );

  const openTracks: OpenTrack[] = [];
  if (!hasCoreChallenge) {
    openTracks.push({
      href: "/challenges",
      title: "60-day challenge",
      support: "Pick AI, Data Science or SE",
      icon: "code",
    });
  }
  if (claudeEnabled && !enrolledDomains.has("CLAUDE")) {
    openTracks.push({
      href: "/claude-signup",
      title: "Claude challenge",
      support: "Build with Claude · 60 days",
      icon: "sparkles",
    });
  }
  openTracks.push(
    {
      href: "/hackathon?s=shr",
      title: "Vibe code hackathon",
      support: "48 hours · teams of 3",
      icon: "bolt",
    },
    {
      href: "/workshop",
      title: "Free AI bootcamp",
      support: "Live 1-hour session",
      icon: "play",
    },
  );

  return (
    <div className="mt-8 space-y-8">
      {enrollments.length > 0 ? (
        <section aria-labelledby="your-tracks-heading">
          <h2
            id="your-tracks-heading"
            className="font-display text-lg font-semibold"
          >
            Your tracks
          </h2>
          <ul className="mt-3 space-y-2">
            {enrollments.map((enrollment) => (
              <li key={enrollment.id}>
                <TrackRow
                  href={`/dashboard?challenge=${enrollment.id}`}
                  title={enrollment.challengeTitle}
                  support={`Day ${enrollment.daysCompleted} · ${enrollment.currentStreak}-day streak`}
                  icon={enrollment.domain === "CLAUDE" ? "sparkles" : "code"}
                  badge={{ label: "Active", tone: "success" }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openTracks.length > 0 ? (
        <section aria-labelledby="open-tracks-heading">
          <h2
            id="open-tracks-heading"
            className="font-display text-lg font-semibold"
          >
            Open to join
          </h2>
          <ul className="mt-3 space-y-2">
            {openTracks.map((track) => (
              <li key={track.href}>
                <TrackRow {...track} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You&apos;re in everything we run right now.
        </p>
      )}
    </div>
  );
}
