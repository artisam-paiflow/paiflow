BEGIN;

-- Retain both existing template-instance branches verbatim. Only explicitly
-- tagged ordinary conditional preparations may additionally seal an exact hash.
-- Full graph/constructor validation remains in the application; JSON shape alone
-- never grants a runtime capability or proves executable provenance.
ALTER TABLE "Deployment" DROP CONSTRAINT "Deployment_instance_evidence";
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_instance_evidence" CHECK (
 ("templateVersionId" IS NULL AND "instanceSnapshot" IS NULL AND "instanceRequestDigest" IS NULL AND "preparedTxHash" IS NULL)
 OR ("templateVersionId" IS NOT NULL AND "instanceSnapshot" IS NOT NULL AND "instanceRequestDigest" ~ '^[a-f0-9]{64}$' AND "sourceAccount" IS NOT NULL AND "idempotencyKey" IS NOT NULL)
 OR COALESCE((
   "templateVersionId" IS NULL
   AND "instanceSnapshot" IS NULL AND "instanceRequestDigest" IS NULL
   AND "preparedTxHash" IS NOT NULL AND "preparedTxHash" ~ '^[a-f0-9]{64}$'
   AND "sourceAccount" IS NOT NULL AND "unsignedXdr" IS NOT NULL
   AND "idempotencyKey" ~ '^conditional-deploy:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND "graphSnapshot" @> '{"generation":"conditional-v2"}'::jsonb
   AND "paramsSnapshot" @> '{"generation":"conditional-v2","version":2}'::jsonb
   AND jsonb_typeof("paramsSnapshot"->'definition') = 'object'
   AND jsonb_typeof("paramsSnapshot"->'manifest') = 'object'
   AND jsonb_typeof("paramsSnapshot"->'nodes') = 'array'
   AND jsonb_typeof("pipelineSnapshot") = 'array'
 ), FALSE)
);

CREATE FUNCTION protect_conditional_deployment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."templateVersionId" IS NULL
    AND OLD."preparedTxHash" IS NOT NULL
    AND OLD."paramsSnapshot" @> '{"generation":"conditional-v2","version":2}'::jsonb THEN
  IF TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'Prepared conditional deployment evidence must be retained';
  END IF;
  IF ROW(NEW."ownerId",NEW.network,NEW."flowId",NEW."templateVersionId",NEW."instanceSnapshot",NEW."instanceRequestDigest",NEW."sourceAccount",NEW."graphSnapshot",NEW."paramsSnapshot",NEW."pipelineSnapshot",NEW."unsignedXdr",NEW."preparedTxHash",NEW."idempotencyKey")
     IS DISTINCT FROM
     ROW(OLD."ownerId",OLD.network,OLD."flowId",OLD."templateVersionId",OLD."instanceSnapshot",OLD."instanceRequestDigest",OLD."sourceAccount",OLD."graphSnapshot",OLD."paramsSnapshot",OLD."pipelineSnapshot",OLD."unsignedXdr",OLD."preparedTxHash",OLD."idempotencyKey") THEN
   RAISE EXCEPTION 'Prepared conditional deployment evidence is immutable';
  END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Deployment_conditional_evidence_immutable"
 BEFORE UPDATE OR DELETE ON "Deployment" FOR EACH ROW
 EXECUTE FUNCTION protect_conditional_deployment_evidence();

COMMIT;
