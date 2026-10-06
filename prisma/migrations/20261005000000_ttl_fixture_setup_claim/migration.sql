ALTER TABLE "TransactionFeeBudget" ADD COLUMN "fixtureSetupClaimedAt" TIMESTAMP(3);

-- Existing fixture preparations are already consumed, including uncertain ones.
-- Never reset their setup authorization when introducing the atomic claim.
UPDATE "TransactionFeeBudget" AS budget
SET "fixtureSetupClaimedAt" = reservation."claimedAt"
FROM (
  SELECT "network", "budgetName", MIN("createdAt") AS "claimedAt"
  FROM "TransactionFeeReservation"
  WHERE "purpose" IN ('fixture-setup', 'fixture-deposit')
  GROUP BY "network", "budgetName"
) AS reservation
WHERE budget."network" = reservation."network"
  AND budget."name" = reservation."budgetName";
