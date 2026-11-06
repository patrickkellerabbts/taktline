-- AlterTable
ALTER TABLE "WorkPackage" ADD COLUMN     "estimateSeconds" INTEGER,
ADD COLUMN     "isTask" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spentSeconds" INTEGER,
ADD COLUMN     "storyId" TEXT;

-- CreateIndex
CREATE INDEX "WorkPackage_storyId_idx" ON "WorkPackage"("storyId");

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "WorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

