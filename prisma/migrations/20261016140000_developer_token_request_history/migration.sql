ALTER TABLE "ApiRequestLog" ADD COLUMN "developerApiTokenId" UUID;
CREATE INDEX "ApiRequestLog_developerApiTokenId_occurredAt_idx" ON "ApiRequestLog"("developerApiTokenId", "occurredAt");
CREATE INDEX "ApiRequestLog_preparationRequestId_developerApiTokenId_idx" ON "ApiRequestLog"("preparationRequestId", "developerApiTokenId");
