-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "definitionOfDone" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "productGoal" TEXT;

