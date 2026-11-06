-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "goalOutcome" TEXT,
ADD COLUMN     "reviewNotes" TEXT;

-- CreateTable
CREATE TABLE "SprintRetroItem" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT,
    "issueIid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintRetroItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintRetroVote" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintRetroVote_pkey" PRIMARY KEY ("itemId","userId")
);

-- CreateIndex
CREATE INDEX "SprintRetroItem_sprintId_idx" ON "SprintRetroItem"("sprintId");

-- AddForeignKey
ALTER TABLE "SprintRetroItem" ADD CONSTRAINT "SprintRetroItem_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintRetroItem" ADD CONSTRAINT "SprintRetroItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintRetroVote" ADD CONSTRAINT "SprintRetroVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SprintRetroItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintRetroVote" ADD CONSTRAINT "SprintRetroVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

