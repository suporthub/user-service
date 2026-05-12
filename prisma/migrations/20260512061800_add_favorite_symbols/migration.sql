-- CreateTable
CREATE TABLE "user_favorite_symbols" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userType" VARCHAR(30) NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_symbols_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_symbols_userId_userType_symbol_key" ON "user_favorite_symbols"("userId", "userType", "symbol");
