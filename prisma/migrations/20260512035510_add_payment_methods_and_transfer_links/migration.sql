-- AlterTable
ALTER TABLE "user_transactions" ADD COLUMN     "linkedTxnId" UUID,
ADD COLUMN     "paymentMethodId" UUID;

-- CreateTable
CREATE TABLE "user_payment_methods" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "details" JSONB NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_payment_methods_userId_isActive_idx" ON "user_payment_methods"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "user_payment_methods" ADD CONSTRAINT "user_payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "live_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
