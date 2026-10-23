-- Every schedule writer participates, including older cron/config/retirement
-- paths. Same-value writes are newer observations too; history-only writes are not.
ALTER TABLE "Deployment" ADD COLUMN "chargeScheduleRevision" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION advance_charge_schedule_revision() RETURNS trigger AS $$
BEGIN
  NEW."chargeScheduleRevision" := OLD."chargeScheduleRevision" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_charge_schedule_revision
BEFORE UPDATE OF "chargeRelayerMode", "chargeRelayerAddress", "chargeRelayerUrl",
  "chargeRelayerToken", "nextChargeAt", "chargeEndAt", "serviceState"
ON "Deployment"
FOR EACH ROW EXECUTE FUNCTION advance_charge_schedule_revision();
