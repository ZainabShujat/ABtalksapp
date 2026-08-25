/** Illustrated empty-folder search — shared by Shortlist and Saved for later. */
export function PodEmptyArt() {
  return (
    <svg
      className="pe"
      viewBox="0 0 165 165"
      role="img"
      aria-label="An empty folder being searched"
    >
      <ellipse className="pe__ground" cx="82" cy="139" rx="40" ry="3.5" />
      <g className="pe__paper pe__paper--a">
        <rect x="30" y="36" width="56" height="68" rx="3" />
      </g>
      <g className="pe__paper pe__paper--b">
        <rect x="46" y="30" width="56" height="68" rx="3" />
      </g>
      <g className="pe__paper pe__paper--c">
        <rect x="58" y="26" width="52" height="64" rx="3" />
        <path d="M74 44 96 66M96 44 74 66" />
      </g>
      <g className="pe__glass">
        <circle className="pe__lens" r="18" />
        <path className="pe__handle" d="M12.7 12.7 26 26" />
        <path className="pe__glint" d="M-7-10A12 12 0 0 1 4-13" />
      </g>
    </svg>
  );
}
