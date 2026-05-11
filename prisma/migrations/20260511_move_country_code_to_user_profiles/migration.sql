-- Migration: move_country_code_to_user_profiles
-- Country belongs to the person (UserProfile), not to a trading account (LiveUser).

-- Step 1: Add countryCode to user_profiles
ALTER TABLE "user_profiles" ADD COLUMN "countryCode" TEXT;

-- Step 2: Back-fill from live_users (take the countryCode of the earliest live account per profile)
UPDATE "user_profiles" up
SET "countryCode" = sub."countryCode"
FROM (
  SELECT DISTINCT ON ("userProfileId") "userProfileId", "countryCode"
  FROM "live_users"
  WHERE "countryCode" IS NOT NULL
  ORDER BY "userProfileId", "createdAt" ASC
) sub
WHERE up.id = sub."userProfileId"
  AND up."countryCode" IS NULL;

-- Step 3: Add index on user_profiles.countryCode (matches Prisma schema)
CREATE INDEX IF NOT EXISTS "user_profiles_countryCode_idx" ON "user_profiles"("countryCode");

-- Step 4: Remove countryCode from live_users
ALTER TABLE "live_users" DROP COLUMN IF EXISTS "countryCode";
