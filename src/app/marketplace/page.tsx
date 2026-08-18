import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/shared/app-header";
import { MarketplaceHero } from "@/components/marketplace/marketplace-hero";
import { ProductGrid } from "@/components/marketplace/product-grid";
import { getCatalog } from "@/features/marketplace/get-catalog";
import { getMySynergy } from "@/features/synergy/get-my-synergy";
import { prisma } from "@/lib/db";

export default async function MarketplacePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;

  const [items, balance, contact] = await Promise.all([
    getCatalog(),
    getMySynergy(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        studentProfile: { select: { phone: true } },
        hackathonParticipant: { select: { phone: true } },
      },
    }),
  ]);

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-[#030712] text-white">
      <div className="[&_header]:border-[#030712] [&_header]:bg-[#050C1D] [&_header]:shadow-none">
        <AppHeader user={headerUser} />
      </div>
      <MarketplaceHero />
      <main
        id="products"
        className="mx-auto w-full max-w-[1897px] flex-1 scroll-mt-20 px-4 py-8 sm:px-[67px] sm:py-10"
      >
        <ProductGrid
          items={items}
          balance={balance}
          defaultPhone={
            contact?.studentProfile?.phone ??
            contact?.hackathonParticipant?.phone ??
            ""
          }
        />
      </main>
    </div>
  );
}
