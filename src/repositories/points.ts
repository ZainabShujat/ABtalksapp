import "server-only";
import { prisma } from "@/lib/db";
import { isNewPointsRepoEnabled } from "@/lib/feature-flags";

type PointsReadClient = Pick<typeof prisma, "pointsAccount" | "user">;

export async function getBalance(
  userId: string,
  db: PointsReadClient = prisma,
): Promise<number> {
  if (isNewPointsRepoEnabled()) {
    const account = await db.pointsAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return account?.balance ?? 0;
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { synergyPoints: true },
  });
  return user?.synergyPoints ?? 0;
}
