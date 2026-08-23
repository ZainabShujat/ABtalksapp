import "server-only";
import { prisma } from "@/lib/db";

/** Phase 3–5: ProgramMember lives here so features never call prisma.programMember. */
export const programMember = prisma.programMember;
