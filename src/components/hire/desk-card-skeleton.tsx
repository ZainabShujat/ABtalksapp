"use client";

/**
 * Placeholders shaped like `DeskMatchCard`, shown while a search is in flight.
 *
 * The point is that nothing moves when the real cards arrive: the box metrics
 * here are the same ones `.hire-app .desk-card` uses, so the swap is a
 * cross-fade rather than a reflow. Deliberately not `components/ui/skeleton` —
 * that primitive is a bare shimmering rectangle and would not hold the card's
 * shape, which is the only reason to show a skeleton at all.
 */
export function DeskCardSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="scout-results" aria-hidden="true">
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <div key={i} className="desk-skel">
          <div className="desk-skel__head">
            <span className="desk-skel__dot" />
            <div className="desk-skel__lines">
              <span className="desk-skel__bar" style={{ height: 14, width: "42%" }} />
              <span className="desk-skel__bar" style={{ height: 11, width: "64%" }} />
            </div>
            <span className="desk-skel__bar" style={{ height: 34, width: 52 }} />
          </div>
          <div className="desk-skel__pills">
            <span className="desk-skel__pill" style={{ width: 72 }} />
            <span className="desk-skel__pill" style={{ width: 94 }} />
            <span className="desk-skel__pill" style={{ width: 58 }} />
            <span className="desk-skel__pill" style={{ width: 80 }} />
          </div>
          <div className="desk-skel__foot">
            <span className="desk-skel__bar" style={{ height: 11, width: "38%" }} />
            <span className="desk-skel__pill" style={{ width: 110 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
