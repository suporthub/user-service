/*
  Warnings:

  - The values [per_lot,per_trade,percent] on the enum `CommissionType` will be removed. If these variants are still used in the database, this will fail.
  - The values [money,percent,pips] on the enum `CommissionValueType` will be removed. If these variants are still used in the database, this will fail.
  - The values [pips,percent,currency] on the enum `SwapType` will be removed. If these variants are still used in the database, this will fail.
  - The `instrumentType` column on the `instruments` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `instrumentType` column on the `market_holidays` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `processedBy` on the `user_transactions` table. All the data in the column will be lost.
  - You are about to alter the column `userType` on the `user_transactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(30)`.
  - You are about to alter the column `currency` on the `user_transactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(10)`.
  - You are about to alter the column `gateway` on the `user_transactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - You are about to alter the column `gatewayTxnId` on the `user_transactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(128)`.
  - A unique constraint covering the columns `[txnRef]` on the table `user_transactions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `balanceAfter` to the `user_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceBefore` to the `user_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `direction` to the `user_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `txnRef` to the `user_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('forex', 'index', 'commodity', 'crypto');

-- CreateEnum
CREATE TYPE "TxnDirection" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum
BEGIN;
CREATE TYPE "CommissionType_new" AS ENUM ('round_turn', 'entry_only', 'exit_only');
ALTER TABLE "group_symbols" ALTER COLUMN "commissionType" DROP DEFAULT;
ALTER TABLE "group_symbols" ALTER COLUMN "commissionType" TYPE "CommissionType_new" USING ("commissionType"::text::"CommissionType_new");
ALTER TYPE "CommissionType" RENAME TO "CommissionType_old";
ALTER TYPE "CommissionType_new" RENAME TO "CommissionType";
DROP TYPE "CommissionType_old";
ALTER TABLE "group_symbols" ALTER COLUMN "commissionType" SET DEFAULT 'round_turn';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "CommissionValueType_new" AS ENUM ('per_lot', 'percentage');
ALTER TABLE "group_symbols" ALTER COLUMN "commissionValueType" DROP DEFAULT;
ALTER TABLE "group_symbols" ALTER COLUMN "commissionValueType" TYPE "CommissionValueType_new" USING ("commissionValueType"::text::"CommissionValueType_new");
ALTER TYPE "CommissionValueType" RENAME TO "CommissionValueType_old";
ALTER TYPE "CommissionValueType_new" RENAME TO "CommissionValueType";
DROP TYPE "CommissionValueType_old";
ALTER TABLE "group_symbols" ALTER COLUMN "commissionValueType" SET DEFAULT 'per_lot';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SwapType_new" AS ENUM ('points', 'percentage', 'noswap');
ALTER TABLE "group_symbols" ALTER COLUMN "swapType" DROP DEFAULT;
ALTER TABLE "group_symbols" ALTER COLUMN "swapType" TYPE "SwapType_new" USING ("swapType"::text::"SwapType_new");
ALTER TYPE "SwapType" RENAME TO "SwapType_old";
ALTER TYPE "SwapType_new" RENAME TO "SwapType";
DROP TYPE "SwapType_old";
ALTER TABLE "group_symbols" ALTER COLUMN "swapType" SET DEFAULT 'points';
COMMIT;

-- DropIndex
DROP INDEX "user_transactions_userId_userType_txnType_idx";

-- AlterTable
ALTER TABLE "group_symbols" ALTER COLUMN "spread" SET DATA TYPE DECIMAL(18,5),
ALTER COLUMN "spreadPip" SET DATA TYPE DECIMAL(18,5),
ALTER COLUMN "maxSpread" SET DATA TYPE DECIMAL(18,5),
ALTER COLUMN "swapBuy" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "swapSell" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "swapType" SET DEFAULT 'points',
ALTER COLUMN "commission" SET DATA TYPE DECIMAL(18,5),
ALTER COLUMN "commissionType" SET DEFAULT 'round_turn',
ALTER COLUMN "commissionValueType" SET DEFAULT 'per_lot';

-- AlterTable
ALTER TABLE "instruments" DROP COLUMN "instrumentType",
ADD COLUMN     "instrumentType" "InstrumentType" NOT NULL DEFAULT 'forex';

-- AlterTable
ALTER TABLE "live_users" ADD COLUMN     "walletBalance" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "market_holidays" DROP COLUMN "instrumentType",
ADD COLUMN     "instrumentType" "InstrumentType";

-- AlterTable
ALTER TABLE "user_transactions" DROP COLUMN "processedBy",
ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "approvedBy" UUID,
ADD COLUMN     "balanceAfter" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "balanceBefore" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "description" VARCHAR(255),
ADD COLUMN     "direction" "TxnDirection" NOT NULL,
ADD COLUMN     "ip" VARCHAR(45),
ADD COLUMN     "linkedPaymentId" UUID,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "tradingAccountId" UUID,
ADD COLUMN     "txnRef" VARCHAR(32) NOT NULL,
ALTER COLUMN "userType" SET DATA TYPE VARCHAR(30),
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(10),
ALTER COLUMN "gateway" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "gatewayTxnId" SET DATA TYPE VARCHAR(128);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "userType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "processedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_ticketId_eventType_key" ON "ledger_transactions"("ticketId", "eventType");

-- CreateIndex
CREATE INDEX "market_holidays_instrumentType_holidayDate_idx" ON "market_holidays"("instrumentType", "holidayDate");

-- CreateIndex
CREATE UNIQUE INDEX "user_transactions_txnRef_key" ON "user_transactions"("txnRef");

-- CreateIndex
CREATE INDEX "user_transactions_userId_userType_createdAt_idx" ON "user_transactions"("userId", "userType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_transactions_tradingAccountId_createdAt_idx" ON "user_transactions"("tradingAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_transactions_userId_txnType_status_idx" ON "user_transactions"("userId", "txnType", "status");

-- CreateIndex
CREATE INDEX "user_transactions_txnRef_idx" ON "user_transactions"("txnRef");

-- CreateIndex
CREATE INDEX "user_transactions_linkedPaymentId_idx" ON "user_transactions"("linkedPaymentId");
