-- AlterTable
ALTER TABLE "WorkPackage" ADD COLUMN     "milestoneId" TEXT;

-- CreateIndex
CREATE INDEX "WorkPackage_milestoneId_idx" ON "WorkPackage"("milestoneId");

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
