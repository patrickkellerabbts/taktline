-- AlterTable
ALTER TABLE "WorkPackage" ADD COLUMN     "boardRank" INTEGER,
ADD COLUMN     "isUnscheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storyPoints" INTEGER;
