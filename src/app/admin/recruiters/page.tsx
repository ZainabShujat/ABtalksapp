import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { listRecruiters } from "@/features/talent-pool/recruiter-registration";
import { AdminRecruitersPanel } from "@/components/talent/admin-recruiters-panel";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CreateRecruiterForm } from "@/components/admin/create-recruiter-form";
import { isEmailLoginEnabled } from "@/lib/feature-flags";
import {
  RecruiterSeatsPanel,
  type SeatRow,
} from "@/components/admin/recruiter-seats-panel";

export const metadata: Metadata = {
  title: "Recruiters | Admin",
};

export default async function AdminRecruitersPage() {
  await requireAdmin();

  const [recruiters, seats] = await Promise.all([
    listRecruiters(),
    prisma.verifiedRecruiterSeat.findMany({
      orderBy: [{ active: "desc" }, { verifiedAt: "desc" }],
      take: 500,
      select: {
        id: true,
        email: true,
        company: true,
        contactName: true,
        active: true,
        notes: true,
        verifiedAt: true,
      },
    }),
  ]);

  const users = await prisma.user.findMany({
    where: { email: { in: seats.map((s) => s.email) } },
    select: { email: true },
  });
  const withAccount = new Set(users.map((u) => u.email));

  const seatRows: SeatRow[] = seats.map((s) => ({
    id: s.id,
    email: s.email,
    company: s.company,
    contactName: s.contactName,
    active: s.active,
    notes: s.notes,
    verifiedAt: s.verifiedAt.toISOString(),
    hasAccount: withAccount.has(s.email),
  }));

  return (
    <div className="space-y-10">
      <AdminPageHeader
        title="Recruiters"
        description="Everyone who has registered to hire, plus admin-created accounts. Disable / restore / secure is on each row. There is no approval queue."
      />

      <section className="space-y-3">
        <CreateRecruiterForm emailLoginEnabled={isEmailLoginEnabled()} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">
          All recruiters
          {recruiters.length > 0 ? ` (${recruiters.length})` : ""}
        </h2>
        <AdminRecruitersPanel recruiters={recruiters} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Verified emails</h2>
        <RecruiterSeatsPanel seats={seatRows} />
      </section>
    </div>
  );
}
