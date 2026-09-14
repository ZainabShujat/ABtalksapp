import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getWorkspaceCreditOverview,
  type CreditHistoryRow,
} from "@/features/hire/credits";
import {
  formatCreditsMinor,
  formatCreditsSpelled,
  type CreditLevel,
} from "@/lib/credits-format";
import { formatDateTimeIST } from "@/lib/date-utils";
import { LEGAL_ENTITY } from "@/lib/legal-constants";

/**
 * T-231 — the recruiter's credits: balance, where it came from, where it went,
 * and what to do when it runs low. Every figure is read from the ledger
 * (`getWorkspaceCreditOverview`); nothing on this page is a demo value.
 *
 * Deliberately not a purchase surface. More credits are requested from
 * ABTalks by email; bigger plans are shown as Coming Soon with no numbers.
 */
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<CreditHistoryRow["type"], string> = {
  GRANT_ONBOARDING: "Free plan credits",
  PURCHASE: "Credits added",
  UNLOCK_CONTACT: "Contact unlock",
  ADMIN_ADJUSTMENT: "Adjustment by ABTalks",
  REFUND: "Refund",
};

const LEVEL_COPY: Record<
  Exclude<CreditLevel, "normal">,
  { title: string; body: string }
> = {
  low: {
    title: "Your credits are getting low",
    body: "You may need more credits soon to keep unlocking candidate contact details.",
  },
  "very-low": {
    title: "Only a small balance remains",
    body: "You have enough for very few contact unlocks. Request more credits now so your outreach is not interrupted.",
  },
  empty: {
    title: "You have run out of credits",
    body: "Paid contact unlocks are paused until more credits are added. Candidates you already unlocked stay free to reopen, and search and assessments remain free.",
  },
};

const CONTACT_HREF = `mailto:${LEGAL_ENTITY.email}?subject=${encodeURIComponent(
  "Request for more ABTalks Hire credits",
)}`;

export default async function HireCreditsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/talent/login?from=/hire/credits");

  const result = await getWorkspaceCreditOverview();
  if (!result.ok) {
    return (
      <div className="hire-jobs hire-creditsx">
        <p className="hire-jobs__error" role="alert">
          {result.message}
        </p>
      </div>
    );
  }

  const c = result.data;
  const money = (minor: number) => formatCreditsMinor(minor, c.currency);
  const warning = c.level === "normal" ? null : LEVEL_COPY[c.level];
  const unlocksLeft = Math.floor(c.balanceMinor / Math.max(c.unlockCostMinor, 1));

  return (
    <div className="hire-jobs hire-creditsx">
      <nav className="hire-jobs__crumb" aria-label="Breadcrumb">
        <span>Hiring</span>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Credits</span>
      </nav>

      <div className="hire-jobs__head">
        <div>
          <h1>Credits &amp; plan</h1>
          <p>
            Every credit movement on your account, newest first. One credit is
            one dollar.
          </p>
        </div>
      </div>

      {warning ? (
        <div
          className={`hire-creditsx__alert hire-creditsx__alert--${c.level}`}
          role={c.level === "empty" ? "alert" : "status"}
        >
          <strong>{warning.title}</strong>
          <p>{warning.body}</p>
          <a href={CONTACT_HREF}>
            Contact ABTalks at {LEGAL_ENTITY.email} for more credits
          </a>
        </div>
      ) : null}

      <section className="hire-creditsx__stats" aria-label="Credit summary">
        <Stat label="Current balance" minor={c.balanceMinor} currency={c.currency} strong />
        <Stat label="Total granted" minor={c.grantedMinor} currency={c.currency} />
        <Stat label="Total spent" minor={c.spentMinor} currency={c.currency} />
      </section>

      <div className="hire-creditsx__grid">
        <section className="hire-creditsx__card" aria-labelledby="plan-h">
          <p className="hire-creditsx__kicker">Current plan</p>
          <h2 id="plan-h">Free</h2>
          <dl className="hire-creditsx__facts">
            <div>
              <dt>Included credits</dt>
              <dd title={formatCreditsSpelled(c.grantedMinor)}>{money(c.grantedMinor)}</dd>
            </div>
            <div>
              <dt>Used</dt>
              <dd title={formatCreditsSpelled(c.spentMinor)}>
                {money(c.spentMinor)} / {money(c.grantedMinor)}
              </dd>
            </div>
            <div>
              <dt>Contact unlock</dt>
              <dd title={formatCreditsSpelled(c.unlockCostMinor)}>
                {money(c.unlockCostMinor)} each
              </dd>
            </div>
            <div>
              <dt>Re-opening an unlocked candidate</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Search &amp; assessments</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Unlocks your balance covers</dt>
              <dd>{unlocksLeft}</dd>
            </div>
          </dl>
        </section>

        <div className="hire-creditsx__side">
          <section className="hire-creditsx__card" aria-labelledby="more-h">
            <p className="hire-creditsx__kicker">Need more credits?</p>
            <h2 id="more-h">Contact ABTalks</h2>
            <p>
              Email ABTalks at{" "}
              <a href={CONTACT_HREF} className="hire-creditsx__mail">
                {LEGAL_ENTITY.email}
              </a>{" "}
              and we will add credits to your account. There is no online
              purchase yet.
            </p>
            <a href={CONTACT_HREF} className="hire-jobs__btn">
              Email {LEGAL_ENTITY.email}
            </a>
          </section>

          <section
            className="hire-creditsx__card hire-creditsx__card--soon"
            aria-labelledby="soon-h"
          >
            <p className="hire-creditsx__kicker">
              Bigger plans <span className="hire-creditsx__badge">Coming soon</span>
            </p>
            <h2 id="soon-h">Higher limits are on the way</h2>
            <p>
              Larger plans with more credits and higher limits are coming. Buying
              credits online is not available yet.
            </p>
            <button type="button" className="hire-jobs__btn" disabled>
              Buy credits · Coming soon
            </button>
          </section>
        </div>
      </div>

      <section
        className="hire-creditsx__card hire-creditsx__history"
        aria-labelledby="hist-h"
      >
        <div className="hire-creditsx__histhead">
          <h2 id="hist-h">Credit history</h2>
          <span>
            {c.transactionCount}{" "}
            {c.transactionCount === 1 ? "transaction" : "transactions"}
          </span>
        </div>
        {c.history.length === 0 ? (
          <p className="hire-creditsx__empty">
            No credit activity yet. Your free plan credits will appear here once
            they are added to your account.
          </p>
        ) : (
          <ol className="hire-creditsx__list">
            {c.history.map((row) => (
              <li key={row.id} className="hire-creditsx__row">
                <div className="hire-creditsx__what">
                  <strong>
                    {TYPE_LABEL[row.type]}
                    {row.candidateLabel ? ` — ${row.candidateLabel}` : ""}
                  </strong>
                  <span>
                    {row.reason} · {formatDateTimeIST(new Date(row.createdAt))} IST
                  </span>
                </div>
                <div className="hire-creditsx__amounts">
                  <span
                    className={
                      row.amountMinor < 0
                        ? "hire-creditsx__amt hire-creditsx__amt--out"
                        : "hire-creditsx__amt hire-creditsx__amt--in"
                    }
                    title={formatCreditsSpelled(Math.abs(row.amountMinor))}
                  >
                    {row.amountMinor < 0 ? "−" : "+"}
                    {money(Math.abs(row.amountMinor))}
                  </span>
                  <span title={formatCreditsSpelled(row.balanceAfterMinor)}>
                    Balance {money(row.balanceAfterMinor)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        {c.transactionCount > c.history.length ? (
          <p className="hire-creditsx__empty">
            Showing the latest {c.history.length} of {c.transactionCount}.
          </p>
        ) : null}
      </section>

      <p className="hire-creditsx__foot">
        <Link href="/hire/projects">Back to projects</Link>
      </p>
    </div>
  );
}

function Stat({
  label,
  minor,
  currency,
  strong = false,
}: {
  label: string;
  minor: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "hire-creditsx__stat is-strong" : "hire-creditsx__stat"}>
      <span>{label}</span>
      <strong title={formatCreditsSpelled(minor)}>
        {formatCreditsMinor(minor, currency)}
      </strong>
    </div>
  );
}
