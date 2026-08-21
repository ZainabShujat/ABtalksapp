import "server-only";
import { prisma } from "@/lib/db";
import { isNewPointsRepoEnabled } from "@/lib/feature-flags";

export async function getBalance(userId: string): Promise<number> {
  if (isNewPointsRepoEnabled()) {
    const account = await prisma.pointsAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return account?.balance ?? 0;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { synergyPoints: true },
  });
  return user?.synergyPoints ?? 0;
}
