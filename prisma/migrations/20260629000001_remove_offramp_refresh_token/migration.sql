-- The PDAX refresh token must live only in the environment (OFFRAMP_REFRESH_TOKEN).
-- Drop it from the database credential table.
ALTER TABLE "OffRampProviderCredential" DROP COLUMN "refreshToken";
