import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "prog.mid@abtalks.dev" },
  });
  console.log("User found:", user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
