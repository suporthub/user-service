-- Migration: refactor_payment_method_profile_link
-- Re-points UserPaymentMethod.userId from live_users → user_profiles
-- This allows payment methods (banks, crypto wallets) to be shared across
-- all trading accounts that belong to the same Master Profile.

-- DropForeignKey
ALTER TABLE "user_payment_methods" DROP CONSTRAINT "user_payment_methods_userId_fkey";

-- AddForeignKey
ALTER TABLE "user_payment_methods" ADD CONSTRAINT "user_payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
