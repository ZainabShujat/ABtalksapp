import { PlatformRole, RoleScopeType } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PlatformConfigPanel } from "@/components/admin/platform-config-panel";
import { WorkshopConfigPanel } from "@/components/admin/workshop-config-panel";
import { PlatformAdminsPanel } from "@/components/admin/platform-admins-panel";
import {
  CONTACT_UNLOCK_COST_KEY,
  MOCK_FREE_ALLOWANCE_KEY,
  MOCK_POINT_COST_KEY,
  STARTING_GRANT_KEY,
  getIntConfig,
  getStringConfig,
  WORKSHOP_CALENDAR_VISIBLE_KEY,
  WORKSHOP_COMING_SOON_MESSAGE_KEY,
  WORKSHOP_MODE_KEY,
  WORKSHOP_WHATSAPP_LINK_KEY,
  WORKSHOP_ZOOM_LINK_KEY,
} from "@/lib/platform-config";

export const metadata = { title: "Settings | Admin" };

export default async function AdminSettingsPage() {
  await requireAdmin();

  const [
    startingGrantMinor,
    unlockCostMinor,
    mockFreeAllowance,
    mockPointCost,
    workshopMode,
    workshopCalendarVisible,
    workshopWhatsapp,
    workshopZoom,
    workshopComingSoon,
    admins,
  ] =
    await Promise.all([
      getIntConfig(STARTING_GRANT_KEY),
      getIntConfig(CONTACT_UNLOCK_COST_KEY),
      getIntConfig(MOCK_FREE_ALLOWANCE_KEY),
      getIntConfig(MOCK_POINT_COST_KEY),
      getStringConfig(WORKSHOP_MODE_KEY),
      getIntConfig(WORKSHOP_CALENDAR_VISIBLE_KEY),
      getStringConfig(WORKSHOP_WHATSAPP_LINK_KEY),
      getStringConfig(WORKSHOP_ZOOM_LINK_KEY),
      getStringConfig(WORKSHOP_COMING_SOON_MESSAGE_KEY),
      prisma.userRoleAssignment.findMany({
        where: {
          role: PlatformRole.ADMIN,
          scopeType: RoleScopeType.GLOBAL,
          revokedAt: null,
        },
        orderBy: { grantedAt: "asc" },
        select: {
          id: true,
          grantedAt: true,
          user: { select: { email: true, name: true } },
        },
      }),
    ]);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Settings"
        description="Runtime configuration and who holds the Platform Admin role. There is no company-admin persona and no deactivate-platform control."
      />

      <PlatformConfigPanel
        values={{
          startingGrantMinor,
          unlockCostMinor,
          mockFreeAllowance,
          mockPointCost,
        }}
      />

      <WorkshopConfigPanel
        values={{
          mode: workshopMode,
          calendarVisible: workshopCalendarVisible === 1,
          whatsappLink: workshopWhatsapp,
          zoomLink: workshopZoom,
          comingSoonMessage: workshopComingSoon,
        }}
      />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-[#353535]">
          Team & access
        </h2>
        <PlatformAdminsPanel
          admins={admins.map((r) => ({
            id: r.id,
            email: r.user.email,
            name: r.user.name,
            grantedAt: r.grantedAt.toISOString(),
          }))}
        />
      </section>
    </div>
  );
}
