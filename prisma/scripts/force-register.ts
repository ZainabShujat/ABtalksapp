import { createRequire } from "node:module";
import Module from "node:module";

function neutralizeServerOnly(): void {
  const require = createRequire(import.meta.url);
  try {
    const serverOnlyPath = require.resolve("server-only");
    require.cache[serverOnlyPath] = {
      id: serverOnlyPath,
      filename: serverOnlyPath,
      loaded: true,
      exports: {},
    } as NodeModule;
  } catch {
    // keep fallback
  }

  const mod = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = mod._load;
  mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
}

neutralizeServerOnly();

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { prisma } from "../../src/lib/db";
import { registerImportedStudent } from "../../src/features/resume/import/register";

async function main() {
  console.log("\n─── Diagnosing and Registering Stalled Imports ───\n");

  // 1. Release any lingering worker lease
  await prisma.platformConfig.updateMany({
    where: { key: "resume_import.worker_lease" },
    data: { stringValue: new Date(0).toISOString() },
  });

  // 2. Clear lease locks on pending rows
  await prisma.resumeImport.updateMany({
    where: { registerRequested: true },
    data: { leaseUntil: null },
  });

  const imports = await prisma.resumeImport.findMany({
    where: {
      OR: [
        { registerRequested: true },
        {
          normalizedEmail: {
            in: [
              "ompranav2003@gmail.com",
              "yasirhasan1000@gmail.com",
              "contactsuysahgupta@gmail.com",
            ],
          },
        },
      ],
    },
    select: {
      id: true,
      originalFilename: true,
      normalizedEmail: true,
      status: true,
      registerRequested: true,
      lastError: true,
      userId: true,
    },
  });

  console.log(`Found ${imports.length} target import(s):`);
  for (const imp of imports) {
    console.log(
      `\nProcessing: ${imp.originalFilename} (${imp.normalizedEmail}) [current status: ${imp.status}]...`,
    );

    if (imp.status === "REGISTERED") {
      console.log(`  ✓ Already REGISTERED (userId: ${imp.userId})`);
      continue;
    }

    try {
      const outcome = await registerImportedStudent(imp.id);
      console.log(`  Outcome: ${outcome}`);

      const updated = await prisma.resumeImport.findUnique({
        where: { id: imp.id },
        select: { status: true, userId: true, lastError: true },
      });
      console.log(`  Updated status: ${updated?.status}, userId: ${updated?.userId}, error: ${updated?.lastError}`);
    } catch (err) {
      console.error(`  ✗ Error registering ${imp.id}:`, err);
    }
  }

  console.log("\nDone!");
}

main()
  .catch((e) => {
    console.error("Diagnostic error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
