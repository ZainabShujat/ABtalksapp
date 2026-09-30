import "./welcome-screen.css";

/*
 * Candidate welcome interstitial between sign-in and the dashboard
 * (Figma Abtalks node 1899:777). Server Component: the only motion is the
 * CSS ellipse loop, so it ships no client JavaScript. Geometry and effects
 * are documented in welcome-screen.css.
 *
 * Outfit comes from the root layout (`--font-outfit`, including Light 300).
 */

type WelcomeScreenProps = {
  /** First name from the candidate profile. Empty when none is on file. */
  name: string;
};

const ELLIPSES = [1, 2, 3, 4] as const;
const COLUMNS = Array.from({ length: 19 }, (_, i) => i);
// Band tops in the frame's 900px height, back to front.
const ROW_TOPS = [0, 104, 204, 304, 404, 504, 600, 700, 800] as const;

export function WelcomeScreen({ name }: WelcomeScreenProps) {
  const title = name ? `Welcome ${name}` : "Welcome";
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="cwelcome theme-abtalks-light"
    >
      {ELLIPSES.map((n) => (
        <div key={n} aria-hidden className={`cwelcome__ellipse cwelcome__ellipse--${n}`} />
      ))}

      <div aria-hidden className="cwelcome__grid">
        {COLUMNS.map((i) => (
          <div key={i} className="cwelcome__col" style={{ left: `${(i * 100) / 19}%` }} />
        ))}
      </div>

      <div aria-hidden className="cwelcome__grid">
        {ROW_TOPS.map((top) => (
          <div key={top} className="cwelcome__row" style={{ top: `${(top * 100) / 900}%` }} />
        ))}
      </div>

      <div className="cwelcome__frame">
        <h1 className="cwelcome__text">
          <span className="cwelcome__title">{title}</span>
          <span className="cwelcome__subtitle">Your dashboard will be ready soon</span>
        </h1>
      </div>
    </div>
  );
}
