import { prisma } from "@/lib/db";

export async function getMySynergy(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { synergyPoints: true },
  });
  return user?.synergyPoints ?? 0;
}
