-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "eventsPolledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Deployment_status_eventsPolledAt_idx" ON "Deployment"("status", "eventsPolledAt");

-- CreateIndex
CREATE INDEX "EventCursor_updatedAt_idx" ON "EventCursor"("updatedAt");
