-- Lease stamp for the atomic off-ramp job claim.
-- A PENDING->RUNNING claim is a genuine CAS on its own; a resume of a stale
-- RUNNING job (crashed/timed-out prior run) instead CAS-matches on the exact
-- lockedAt it was read with, so only one overlapping cron tick can re-claim it
-- and re-run the money-movement branch.
ALTER TABLE "OffRampPayoutJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
