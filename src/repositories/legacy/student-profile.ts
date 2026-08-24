import "server-only";
import { prisma } from "@/lib/db";

/** Phase 3–5: StudentProfile lives here so features never call prisma.studentProfile. */
export const studentProfile = prisma.studentProfile;
