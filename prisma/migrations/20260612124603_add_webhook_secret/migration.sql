-- DropIndex
DROP INDEX "ContractEvent_txHash_kind_key";

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "webhookSecret" TEXT;
