-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TemplateKind" ADD VALUE 'DEPOSIT_TRIGGER';
ALTER TYPE "TemplateKind" ADD VALUE 'ROUTER';
ALTER TYPE "TemplateKind" ADD VALUE 'TIMELOCK';

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "pipelineSnapshot" JSONB;
