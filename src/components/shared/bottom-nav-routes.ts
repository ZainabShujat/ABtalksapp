/**
 * Does the mobile bottom nav belong on this route?
 *
 * One predicate, two callers: `BottomNav` asks it whether to render, and
 * `MainShell` asks it whether to reserve `pb-16` for it. They used to keep
 * separate hand-maintained lists of the same routes, which drifted — some
 * pages showed the bar *over* their own navigation, others reserved 64px for
 * a bar that never appeared. Asking one function makes disagreement
 * impossible.
 *
 * **The rule:** the bar is the navigation of last resort. It renders only
 * where nothing else navigates. A page hides it by having its own chrome —
 * `DashboardShell`'s side panel, `AdminMobileNav`, the recruiter portal, the
 * workshop shell — not by being remembered in a list.
 *
 * Adding a page with a side panel? Add it here, or it gets two navigations.
 *
 * Pure and dependency-free on purpose: both callers are Client Components,
 * and this is exhaustively testable without rendering anything.
 */

/**
 * Pages that render `DashboardShell`, which carries the side panel.
 *
 * Kept as data rather than prose because it is checked against the actual
 * `DashboardShell` consumers: every page importing it must appear here.
 */
const DASHBOARD_SHELL_EXACT = new Set([
  "/dashboard",
  "/profile",
  "/jobs",
  "/achievements",
  "/marketplace",
  "/messages",
  "/mock-interviews",
  "/assessments",
  // Challenge tracks render inside DashboardShell too.
  "/claude",
  "/ai",
  "/ds",
  "/se",
]);

const DASHBOARD_SHELL_PREFIXES = [
  "/jobs/",
  "/marketplace/",
  "/messages/",
  "/mock-interviews/",
  // `/profile/recruiter-view` renders DashboardShell. The old list matched
  // `/profile` exactly and therefore missed it.
  "/profile/",
  // Assessment detail, same shell as the list.
  "/assessments/",
  "/claude/day",
  "/challenge/",
];

/**
 * Surfaces that are not the student app at all, or carry their own chrome.
 *
 * `claim-profile` and `admin` were added upstream while this was in flight;
 * both are carried over here so folding the lists together does not undo that.
 *
 * `admin` is here because `/admin` renders `AdminMobileNav`; without it the
 * student's Home / Jobs / Rewards tabs sit on top of the admin console on
 * every one of its ~46 routes. `hire` and `talent` are the recruiter portal,
 * whose tabs these are not — and the bar was covering the page on mobile.
 */
const OWN_CHROME =
  /^\/(login|register|welcome|claude-signup|students|r|program|talent|hire|recruiter-onboarding|verify|claim-profile|admin|workshop|hackathon)(\/|$)/;

/** The marketing landing has its own header and footer. */
const LANDING = "/";

export function showsBottomNav(pathname: string): boolean {
  if (pathname === LANDING) return false;
  if (DASHBOARD_SHELL_EXACT.has(pathname)) return false;
  if (DASHBOARD_SHELL_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (OWN_CHROME.test(pathname)) return false;
  return true;
}
