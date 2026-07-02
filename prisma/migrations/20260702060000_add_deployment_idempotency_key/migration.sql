-- Add a client-supplied idempotency key to Deployment so a retry of the
-- dev-payroll deploy endpoint returns the existing deployment instead of
-- deploying a second set of contracts. Unique per owner; NULLs are distinct in
-- Postgres so existing rows and non-opted-in endpoints are unaffected.
ALTER TABLE "Deployment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Deployment_ownerId_idempotencyKey_key" ON "Deployment"("ownerId", "idempotencyKey");
