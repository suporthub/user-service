-- AlterTable
ALTER TABLE "demo_users" ADD COLUMN     "accountName" TEXT;

-- AlterTable
ALTER TABLE "live_users" ADD COLUMN     "accountName" TEXT;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "isIB" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastName" TEXT;
