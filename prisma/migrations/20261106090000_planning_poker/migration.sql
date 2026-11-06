-- CreateTable
CREATE TABLE "EstimationRound" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),
    "result" INTEGER,
    "adoptedAt" TIMESTAMP(3),

    CONSTRAINT "EstimationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimationVote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimationVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimationRound_projectId_idx" ON "EstimationRound"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EstimationRound_workPackageId_number_key" ON "EstimationRound"("workPackageId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EstimationVote_roundId_userId_key" ON "EstimationVote"("roundId", "userId");

-- AddForeignKey
ALTER TABLE "EstimationRound" ADD CONSTRAINT "EstimationRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimationRound" ADD CONSTRAINT "EstimationRound_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimationRound" ADD CONSTRAINT "EstimationRound_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimationVote" ADD CONSTRAINT "EstimationVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "EstimationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimationVote" ADD CONSTRAINT "EstimationVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

