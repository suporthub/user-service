/*
  Warnings:

  - You are about to drop the column `phone` on the `demo_users` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `isVerified` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `kycStatus` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `referralCode` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `referredBy` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `securityAnswerHash` on the `live_users` table. All the data in the column will be lost.
  - You are about to drop the column `securityQuestion` on the `live_users` table. All the data in the column will be lost.
  - Added the required column `userProfileId` to the `live_users` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "live_users_email_idx";

-- DropIndex
DROP INDEX "live_users_isActive_kycStatus_idx";

-- DropIndex
DROP INDEX "live_users_phone_idx";

-- DropIndex
DROP INDEX "live_users_referralCode_key";

-- AlterTable
ALTER TABLE "demo_users" DROP COLUMN "phone",
ADD COLUMN     "userProfileId" UUID;

-- AlterTable
ALTER TABLE "live_users" DROP COLUMN "email",
DROP COLUMN "isVerified",
DROP COLUMN "kycStatus",
DROP COLUMN "passwordHash",
DROP COLUMN "phone",
DROP COLUMN "referralCode",
DROP COLUMN "referredBy",
DROP COLUMN "securityAnswerHash",
DROP COLUMN "securityQuestion",
ADD COLUMN     "tradingPasswordHash" TEXT,
ADD COLUMN     "userProfileId" UUID NOT NULL;

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "masterPasswordHash" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'pending',
    "referralCode" TEXT,
    "referredBy" UUID,
    "securityQuestion" TEXT,
    "securityAnswerHash" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_phone_key" ON "user_profiles"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_referralCode_key" ON "user_profiles"("referralCode");

-- CreateIndex
CREATE INDEX "user_profiles_email_idx" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "user_profiles_phone_idx" ON "user_profiles"("phone");

-- CreateIndex
CREATE INDEX "demo_users_userProfileId_idx" ON "demo_users"("userProfileId");

-- CreateIndex
CREATE INDEX "live_users_userProfileId_idx" ON "live_users"("userProfileId");

-- CreateIndex
CREATE INDEX "live_users_isActive_idx" ON "live_users"("isActive");

-- AddForeignKey
ALTER TABLE "live_users" ADD CONSTRAINT "live_users_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_users" ADD CONSTRAINT "demo_users_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
