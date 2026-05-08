/*
  Warnings:

  - You are about to drop the column `contractSize` on the `group_symbols` table. All the data in the column will be lost.
  - You are about to drop the column `instrumentType` on the `group_symbols` table. All the data in the column will be lost.
  - You are about to drop the column `pipCurrency` on the `group_symbols` table. All the data in the column will be lost.
  - You are about to drop the column `pips` on the `group_symbols` table. All the data in the column will be lost.
  - You are about to drop the column `profitCurrency` on the `group_symbols` table. All the data in the column will be lost.
  - You are about to drop the column `showPoints` on the `group_symbols` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "market_holidays_symbol_holidayDate_key";

-- AlterTable
ALTER TABLE "group_symbols" DROP COLUMN "contractSize",
DROP COLUMN "instrumentType",
DROP COLUMN "pipCurrency",
DROP COLUMN "pips",
DROP COLUMN "profitCurrency",
DROP COLUMN "showPoints";

-- AlterTable
ALTER TABLE "market_holidays" ADD COLUMN     "instrumentType" SMALLINT;

-- CreateTable
CREATE TABLE "instruments" (
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "instrumentType" SMALLINT NOT NULL DEFAULT 0,
    "contractSize" DECIMAL(18,4) NOT NULL DEFAULT 100000,
    "profitCurrency" TEXT NOT NULL DEFAULT 'USD',
    "pipCurrency" TEXT,
    "pips" DECIMAL(10,4) NOT NULL DEFAULT 0.0001,
    "showPoints" SMALLINT NOT NULL DEFAULT 5,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("symbol")
);

-- CreateIndex
CREATE INDEX "market_holidays_symbol_holidayDate_idx" ON "market_holidays"("symbol", "holidayDate");

-- CreateIndex
CREATE INDEX "market_holidays_instrumentType_holidayDate_idx" ON "market_holidays"("instrumentType", "holidayDate");

-- AddForeignKey
ALTER TABLE "group_symbols" ADD CONSTRAINT "group_symbols_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_sessions" ADD CONSTRAINT "market_sessions_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_holidays" ADD CONSTRAINT "market_holidays_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE CASCADE ON UPDATE CASCADE;
