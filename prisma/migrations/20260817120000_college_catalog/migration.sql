-- CreateTable
CREATE TABLE "College" (
    "id" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "district" TEXT,
    "city" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier" INTEGER NOT NULL DEFAULT 3,
    "searchText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "College_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "College_nameKey_key" ON "College"("nameKey");

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN "collegeId" TEXT;
