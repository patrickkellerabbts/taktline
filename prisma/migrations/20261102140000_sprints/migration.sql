-- CreateEnum
CREATE TYPE "SprintState" AS ENUM ('planned', 'active', 'closed');

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "state" "SprintState" NOT NULL DEFAULT 'planned',
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "completedPoints" INTEGER,
    "completedCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_projectId_number_key" ON "Sprint"("projectId", "number");

-- Pro Projekt höchstens ein aktiver Sprint, auch bei gleichzeitigen Anfragen.
-- Prisma kann partielle Indizes im Schema nicht ausdrücken.
CREATE UNIQUE INDEX "Sprint_one_active_per_project" ON "Sprint"("projectId") WHERE "state" = 'active';

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
