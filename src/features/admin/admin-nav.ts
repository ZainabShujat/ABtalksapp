/**
 * T-207 Platform Admin console IA.
 *
 * Primary items match Shallika's console. Track/ops links stay reachable so
 * challenge, cohort, hackathon and hire inspection keep working.
 */

export type AdminNavIcon =
  | "overview"
  | "search"
  | "students"
  | "recruiters"
  | "credits"
  | "assessments"
  | "jobs"
  | "communications"
  | "audit"
  | "delivery"
  | "settings"
  | "notifications"
  | "submissions"
  | "content"
  | "analytics"
  | "ambassadors"
  | "referrals"
  | "hackathonLinks"
  | "redemptions"
  | "dataRequests"
  | "program"
  | "cohort"
  | "hackathon"
  | "workshop"
  | "mock-interview"
  | "talentProjects"
  | "platformAdmins"
  | "hire";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminNavIcon;
  match?: string[];
};

export type AdminNavGroup = {
  id: string;
  label: string | null;
  items: AdminNavItem[];
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "console",
    label: "Platform Admin",
    items: [
      { href: "/admin", label: "Overview", icon: "overview" },
      { href: "/admin/search", label: "Global Search", icon: "search" },
      { href: "/admin/search-health", label: "Search Health", icon: "search" },
      {
        href: "/admin/students",
        label: "Candidates",
        icon: "students",
        match: ["/admin/students"],
      },
      {
        href: "/admin/resume-imports",
        label: "Résumé Import",
        icon: "students",
        match: ["/admin/resume-imports"],
      },
      {
        href: "/admin/recruiters",
        label: "Recruiters",
        icon: "recruiters",
        match: ["/admin/recruiters"],
      },
      { href: "/admin/credits", label: "Credits & Plans", icon: "credits" },
      {
        href: "/admin/assessments",
        label: "Assessments",
        icon: "assessments",
      },
      { href: "/admin/jobs", label: "Jobs", icon: "jobs", match: ["/admin/jobs"] },
      {
        href: "/admin/notifications",
        label: "Communications",
        icon: "communications",
        match: ["/admin/notifications"],
      },
      {
        href: "/admin/actions",
        label: "Audit Log",
        icon: "audit",
        match: ["/admin/actions"],
      },
      { href: "/admin/deliveries", label: "Delivery Log", icon: "delivery", match: ["/admin/deliveries", "/admin/delivery"] },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: "settings",
        match: ["/admin/settings", "/admin/platform-admins"],
      },
    ],
  },
  {
    id: "tracks",
    label: "Tracks",
    items: [
      { href: "/admin/ai-cohort", label: "AI Cohort", icon: "cohort" },
      { href: "/admin/hackathon", label: "Hackathon", icon: "hackathon" },
      { href: "/admin/workshop", label: "Workshop", icon: "workshop" },
      { href: "/admin/mock-interview", label: "Mock interviews", icon: "mock-interview", match: ["/admin/mock-interview"] },
      { href: "/admin/submissions", label: "Submissions", icon: "submissions" },
      { href: "/admin/program", label: "Program", icon: "program" },
      { href: "/admin/hire", label: "Hire requests", icon: "hire" },
      {
        href: "/admin/hire/projects",
        label: "Talent Projects",
        icon: "talentProjects",
      },
      { href: "/admin/content", label: "Content", icon: "content" },
      { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
      {
        href: "/admin/campus-ambassadors",
        label: "Ambassadors",
        icon: "ambassadors",
      },
      { href: "/admin/referrals", label: "Referrals", icon: "referrals" },
      {
        href: "/admin/hackathon-links",
        label: "Hackathon Links",
        icon: "hackathonLinks",
      },
      { href: "/admin/redemptions", label: "Redemptions", icon: "redemptions" },
      {
        href: "/admin/data-requests",
        label: "Data Requests",
        icon: "dataRequests",
      },
    ],
  },
];

export function isAdminNavActive(pathname: string, item: AdminNavItem): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  const prefixes = item.match ?? [item.href];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
