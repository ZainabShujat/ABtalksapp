import { getBalance } from "@/repositories/points";

export async function getMySynergy(userId: string): Promise<number> {
  return getBalance(userId);
}
