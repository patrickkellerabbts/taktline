-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "descriptionCache" TEXT,
ADD COLUMN     "isGroupMilestone" BOOLEAN NOT NULL DEFAULT false;
