-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "accountId" UUID,
    "tokenCreatorId" UUID,
    "apiTokenId" UUID,
    "deploymentId" UUID,
    "txHash" TEXT,
    "preparationRequestId" UUID,
    "callerType" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "network" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "audience" "AnalyticsAudience" NOT NULL,
    "trackingVersion" TEXT NOT NULL,
    "persistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiRequestLog_occurredAt_id_idx" ON "ApiRequestLog"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "ApiRequestLog_network_environment_audience_occurredAt_idx" ON "ApiRequestLog"("network", "environment", "audience", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_accountId_occurredAt_idx" ON "ApiRequestLog"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiTokenId_occurredAt_idx" ON "ApiRequestLog"("apiTokenId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_endpoint_occurredAt_idx" ON "ApiRequestLog"("endpoint", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_txHash_idx" ON "ApiRequestLog"("txHash");

-- CreateIndex
CREATE INDEX "AnalyticsDelivery_event_occurredAt_idx" ON "AnalyticsDelivery"("event", "occurredAt");

-- CreateIndex
CREATE INDEX "StreamerClaimJob_runAt_idx" ON "StreamerClaimJob"("runAt");

-- CreateIndex
CREATE INDEX "PayrollRun_runAt_idx" ON "PayrollRun"("runAt");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_runAt_idx" ON "OffRampPayoutJob"("runAt");


INSERT INTO "AnalyticsPolicy" (version, "activatedAt") VALUES ('api-requests-v1', CURRENT_TIMESTAMP);

CREATE INDEX "ApiRequestLog_preparationRequestId_apiTokenId_idx" ON "ApiRequestLog"("preparationRequestId", "apiTokenId");
