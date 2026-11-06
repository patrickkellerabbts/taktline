-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "wipLimits" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "BoardSnapshot" (
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "counts" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSnapshot_pkey" PRIMARY KEY ("projectId","date")
);

-- AddForeignKey
ALTER TABLE "BoardSnapshot" ADD CONSTRAINT "BoardSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

