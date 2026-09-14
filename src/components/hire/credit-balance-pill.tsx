import Link from "next/link";
import {
  formatCreditsMinor,
  formatCreditsSpelled,
  type CreditLevel,
} from "@/lib/credits-format";
import { cn } from "@/lib/utils";

/**
 * The recruiter's credit balance, in the desk header (T-229, T-231).
 *
 * A link to `/hire/credits`, where the balance is explained: what was granted,
 * where it went, and what to do when it runs low. The figure shows in dollars;
 * the hover text spells it as credits (one credit = one dollar).
 *
 * `level` is decided on the server from `PlatformConfig` thresholds — this
 * component only styles it, so no threshold number lives in the client.
 *
 * Approved recruiters only; the layout decides, and hands nothing otherwise.
 */
const LEVEL_HINT: Record<CreditLevel, string> = {
  normal: "",
  low: " Your balance is getting low.",
  "very-low": " Only a small balance remains.",
  empty: " You are out of credits for paid unlocks.",
};

export function CreditBalancePill({
  balanceMinor,
  currency,
  level,
  current = false,
}: {
  balanceMinor: number;
  currency: string;
  level: CreditLevel;
  current?: boolean;
}) {
  const amount = formatCreditsMinor(balanceMinor, currency);

  return (
    <Link
      href="/hire/credits"
      className={cn(
        "hire-hbtn hire-credits",
        level !== "normal" && `hire-credits--${level}`,
        current && "is-current",
      )}
      aria-current={current ? "page" : undefined}
      title={`${formatCreditsSpelled(balanceMinor)} available.${LEVEL_HINT[level]} View credit history.`}
      aria-label={`Credits: ${formatCreditsSpelled(balanceMinor)}.${LEVEL_HINT[level]} View credit history.`}
    >
      <span className="hire-credits__label">Credits</span>
      {/* Not inside the label span: at ≤900px the header hides pill labels, and
          the one part of this that must survive is the number. */}
      <span className="hire-credits__value">{amount}</span>
    </Link>
  );
}
