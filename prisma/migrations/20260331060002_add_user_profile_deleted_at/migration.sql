-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "deletedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "user_profiles_deletedAt_idx" ON "user_profiles"("deletedAt");
