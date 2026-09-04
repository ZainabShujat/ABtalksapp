"use client";

/**
 * What Scout understood, restated as structured chips while the search runs.
 *
 * This is show-your-work, not a confirmation gate. A search still fires for the
 * two reasons it always did — the recruiter tapped it, or the agent called its
 * own search tool — and nothing here can stop or start one. It exists so the
 * expensive moment is not a blank wait: the recruiter reads back the parsed
 * requirement and can open the Requirement menu to change it.
 *
 * Rows come from `specRows()` in `scout-chat.tsx`, so this panel and the
 * Requirement menu can never disagree about what was captured.
 */
const MAX_CHIPS = 6;

export function ScoutUnderstood({
  rows,
  onEdit,
}: {
  rows: { label: string; value: string }[];
  onEdit: () => void;
}) {
  if (rows.length === 0) return null;

  const shown = rows.slice(0, MAX_CHIPS);
  const extra = rows.length - shown.length;

  return (
    <div className="scout-understood" role="status">
      <div className="scout-understood__head">
        <p className="scout-understood__title">Searching on what I have</p>
        <button type="button" className="scout-understood__edit" onClick={onEdit}>
          Edit
        </button>
      </div>
      <ul className="scout-understood__chips">
        {shown.map((r) => (
          <li key={r.label} className="scout-understood__chip">
            <b>{r.label}</b>
            {r.value}
          </li>
        ))}
        {extra > 0 && <li className="scout-understood__chip">+{extra} more</li>}
      </ul>
    </div>
  );
}
