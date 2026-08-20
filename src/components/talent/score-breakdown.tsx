type Props = {
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
  totalScore: number;
  compact?: boolean;
};

const MAX = {
  mission: 372,
  concept: 93,
  commit: 155,
  project: 400,
};

function Bar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreBreakdown({
  missionPoints,
  conceptPoints,
  commitPoints,
  projectPoints,
  totalScore,
  compact = false,
}: Props) {
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        <Bar label="M" value={missionPoints} max={MAX.mission} />
        <Bar label="C" value={conceptPoints} max={MAX.concept} />
        <Bar label="Git" value={commitPoints} max={MAX.commit} />
        <Bar label="P" value={projectPoints} max={MAX.project} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-display text-2xl font-bold">{totalScore} pts</p>
      <Bar label="Missions" value={missionPoints} max={MAX.mission} />
      <Bar label="Concepts" value={conceptPoints} max={MAX.concept} />
      <Bar label="Commits" value={commitPoints} max={MAX.commit} />
      <Bar label="Projects" value={projectPoints} max={MAX.project} />
    </div>
  );
}
