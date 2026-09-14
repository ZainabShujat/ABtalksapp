"use client";

/** T-231: history/balance fetch failure. The server already logged the error. */
export default function HireCreditsError({ reset }: { reset: () => void }) {
  return (
    <div className="hire-jobs hire-creditsx">
      <p className="hire-jobs__error" role="alert">
        We could not load your credits right now. Your balance has not changed.
      </p>
      <button type="button" className="hire-jobs__btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
