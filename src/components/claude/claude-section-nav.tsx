export type SectionNavItem = {
  href: string;
  label: string;
};

export const CLAUDE_SECTION_NAV_HASH: SectionNavItem[] = [
  { href: "#claude-days", label: "Days" },
  { href: "#claude-faqs", label: "FAQs" },
  { href: "#claude-recent-runs", label: "Recent Runs" },
  { href: "#claude-quiz-history", label: "Quiz History" },
];

export const CLAUDE_SECTION_NAV_FROM_DAY: SectionNavItem[] =
  CLAUDE_SECTION_NAV_HASH.map((item) => ({
    href: `/claude${item.href}`,
    label: item.label,
  }));
