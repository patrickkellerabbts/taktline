-- CreateTable
CREATE TABLE "WorkPackageMr" (
    "id" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "mrIid" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sourceBranch" TEXT,
    "targetBranch" TEXT,
    "webUrl" TEXT NOT NULL,
    "pipelineId" INTEGER,
    "pipelineStatus" TEXT,
    "pipelineWebUrl" TEXT,
    "authorName" TEXT,
    "authorAvatarUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPackageMr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkPackageMr_workPackageId_idx" ON "WorkPackageMr"("workPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackageMr_workPackageId_mrIid_key" ON "WorkPackageMr"("workPackageId", "mrIid");

-- AddForeignKey
ALTER TABLE "WorkPackageMr" ADD CONSTRAINT "WorkPackageMr_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
