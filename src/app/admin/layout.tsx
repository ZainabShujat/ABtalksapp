import { requireAdmin } from "@/lib/admin-auth";
import { AppHeader } from "@/components/shared/app-header";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  const navItems = [
    { href: "/admin", label: "Overview", icon: "overview" as const },
    { href: "/admin/actions", label: "Activity", icon: "submissions" as const },
    {
      href: "/admin/notifications",
      label: "Notifications",
      icon: "notifications" as const,
    },
    { href: "/admin/students", label: "Students", icon: "students" as const },
    { href: "/admin/ai-cohort", label: "AI Cohort", icon: "cohort" as const },
    { href: "/admin/hackathon", label: "Hackathon", icon: "hackathon" as const },
    { href: "/admin/workshop", label: "Workshop", icon: "workshop" as const },
    { href: "/admin/submissions", label: "Submissions", icon: "submissions" as const },
    { href: "/admin/jobs", label: "Jobs", icon: "jobs" as const },
    { href: "/admin/content", label: "Content", icon: "content" as const },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" as const },
    { href: "/admin/program", label: "Program", icon: "program" as const },
    {
      href: "/admin/campus-ambassadors",
      label: "Campus Ambassadors",
      icon: "ambassadors" as const,
    },
    { href: "/admin/referrals", label: "Referrals", icon: "referrals" as const },
    {
      href: "/admin/hackathon-links",
      label: "Hackathon Links",
      icon: "hackathonLinks" as const,
    },
    { href: "/admin/redemptions", label: "Redemptions", icon: "redemptions" as const },
    {
      href: "/admin/data-requests",
      label: "Data Requests",
      icon: "dataRequests" as const,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        user={{
          name: admin.name ?? "Admin",
          email: admin.email ?? "admin@local",
          image: null,
          role: "ADMIN",
          isAdmin: true,
        }}
      />
      <div className="flex md:h-[calc(100vh-3.5rem)] md:overflow-hidden">
        <div className="scrollbar-admin-purple hidden w-64 shrink-0 border-r bg-card md:block md:h-full md:overflow-y-auto">
          <div className="flex min-h-full flex-col px-4 py-6">
            <AdminSidebar navItems={navItems} />
          </div>
        </div>
        <main className="scrollbar-admin-purple min-w-0 flex-1 px-4 py-6 md:overflow-y-auto md:px-8">
          <AdminMobileNav navItems={navItems} />
          {children}
        </main>
      </div>
    </div>
  );
}
