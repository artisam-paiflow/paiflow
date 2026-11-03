CREATE TABLE "DeveloperTemplateGrant" (
  "tokenId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  CONSTRAINT "DeveloperTemplateGrant_pkey" PRIMARY KEY ("tokenId", "templateId"),
  CONSTRAINT "DeveloperTemplateGrant_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "DeveloperApiToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeveloperTemplateGrant_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FlowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DeveloperTemplateGrant_templateId_idx" ON "DeveloperTemplateGrant"("templateId");
ALTER TABLE "Deployment" ADD COLUMN "templateVersionId" UUID,
 ADD COLUMN "instanceSnapshot" JSONB,
 ADD COLUMN "instanceRequestDigest" TEXT,
 ADD COLUMN "preparedTxHash" TEXT;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "FlowTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Deployment_templateVersionId_createdAt_id_idx" ON "Deployment"("templateVersionId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Deployment_ownerId_sourceAccount_status_idx" ON "Deployment"("ownerId", "sourceAccount", "status");
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_instance_evidence" CHECK (
 ("templateVersionId" IS NULL AND "instanceSnapshot" IS NULL AND "instanceRequestDigest" IS NULL AND "preparedTxHash" IS NULL)
 OR ("templateVersionId" IS NOT NULL AND "instanceSnapshot" IS NOT NULL AND "instanceRequestDigest" ~ '^[a-f0-9]{64}$' AND "sourceAccount" IS NOT NULL AND "idempotencyKey" IS NOT NULL)
);
CREATE FUNCTION protect_instance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."templateVersionId" IS NOT NULL THEN
  IF ROW(NEW."templateVersionId",NEW."instanceSnapshot",NEW."instanceRequestDigest",NEW."ownerId",NEW."sourceAccount",NEW.network,NEW."flowId",NEW."graphSnapshot",NEW."paramsSnapshot",NEW."idempotencyKey") IS DISTINCT FROM ROW(OLD."templateVersionId",OLD."instanceSnapshot",OLD."instanceRequestDigest",OLD."ownerId",OLD."sourceAccount",OLD.network,OLD."flowId",OLD."graphSnapshot",OLD."paramsSnapshot",OLD."idempotencyKey") THEN
   RAISE EXCEPTION 'Template instance admission evidence is immutable';
  END IF;
  IF OLD."preparedTxHash" IS NOT NULL AND ROW(NEW."preparedTxHash",NEW."unsignedXdr",NEW."pipelineSnapshot") IS DISTINCT FROM ROW(OLD."preparedTxHash",OLD."unsignedXdr",OLD."pipelineSnapshot") THEN
   RAISE EXCEPTION 'Prepared template instance transaction is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Deployment_instance_evidence_immutable" BEFORE UPDATE ON "Deployment" FOR EACH ROW EXECUTE FUNCTION protect_instance_evidence();
