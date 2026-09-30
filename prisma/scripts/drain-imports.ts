import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { drainResumeImports } from "../../src/features/resume/import/worker";
import { prisma } from "../../src/lib/db";

async function main() {
  console.log("\n─── Processing Pending Resume Registrations ───\n");
  const res = await drainResumeImports();
  console.log("Drain completed:", res);

  const imports = await prisma.resumeImport.findMany({
    select: {
      id: true,
      originalFilename: true,
      normalizedEmail: true,
      status: true,
      registerRequested: true,
      userId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log("\nRecent Resume Imports:");
  for (const imp of imports) {
    console.log(
      `  • [${imp.status}] ${imp.normalizedEmail ?? "no email"} - ${imp.originalFilename} (registerRequested: ${imp.registerRequested}, userId: ${imp.userId ?? "none"})`,
    );
  }
}

main()
  .catch((e) => {
    console.error("Error running drain:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
