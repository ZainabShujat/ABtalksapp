import { PrismaClient } from "@prisma/client";
import { isDualWriteEnabled } from "@/lib/feature-flags";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDirect?: PrismaClient;
};

function neonDirectUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace("-pooler.", ".");
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function directClient(): PrismaClient {
  const url =
    process.env.DIRECT_URL?.trim() ||
    neonDirectUrl(process.env.DATABASE_URL);
  if (!url) return prisma;
  if (url === process.env.DATABASE_URL && !url.includes("-pooler.")) {
    return prisma;
  }
  globalForPrisma.prismaDirect ??= new PrismaClient({
    datasources: { db: { url } },
  });
  return globalForPrisma.prismaDirect;
}

/** Interactive transactions / SAVEPOINT dual-write must use the Neon session (direct) endpoint. */
export function writeClient(): PrismaClient {
  return isDualWriteEnabled() ? directClient() : prisma;
}
