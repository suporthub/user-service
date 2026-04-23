-- DropIndex
DROP INDEX "demo_users_phone_key";

-- DropIndex
DROP INDEX "live_users_phone_key";

-- CreateIndex
CREATE INDEX "live_users_phone_idx" ON "live_users"("phone");
