-- Migration: add is_default to user_payment_methods
-- Adds a boolean flag to mark one payment method as the user's preferred
-- payout destination. Only one method per user should be true at a time
-- (enforced at the application layer via atomic transaction in Prisma).

ALTER TABLE "user_payment_methods"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
