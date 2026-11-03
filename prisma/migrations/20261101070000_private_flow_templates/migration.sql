-- CreateTable
CREATE TABLE "FlowTemplate" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "draft" JSONB NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "nextVersion" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowTemplateVersion" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "network" TEXT NOT NULL,
    "artifacts" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowTemplate_ownerId_createdAt_id_idx" ON "FlowTemplate"("ownerId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "FlowTemplateVersion_templateId_createdAt_id_idx" ON "FlowTemplateVersion"("templateId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FlowTemplateVersion_templateId_version_key" ON "FlowTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "FlowTemplate" ADD CONSTRAINT "FlowTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowTemplateVersion" ADD CONSTRAINT "FlowTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FlowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published financial definitions are durable, immutable evidence. Retirement
-- changes admission metadata only and cannot erase or rewrite their contents.
CREATE FUNCTION "guard_flow_template_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published flow template versions cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'retiredAt') IS DISTINCT FROM (to_jsonb(OLD) - 'retiredAt') THEN
    RAISE EXCEPTION 'Published flow template version contents are immutable';
  END IF;
  IF OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Flow template version retirement is irreversible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FlowTemplateVersion_immutable"
  BEFORE UPDATE OR DELETE ON "FlowTemplateVersion"
  FOR EACH ROW EXECUTE FUNCTION "guard_flow_template_version"();

CREATE FUNCTION "guard_flow_template_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Flow template identity is immutable';
  END IF;
  IF OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Flow template retirement is irreversible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FlowTemplate_identity"
  BEFORE UPDATE ON "FlowTemplate"
  FOR EACH ROW EXECUTE FUNCTION "guard_flow_template_identity"();
