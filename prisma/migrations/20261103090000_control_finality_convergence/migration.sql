ALTER TABLE "WalletControlIntent" ADD COLUMN "finalityNextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "WalletControlIntent_network_finalityNextCheckAt_id_idx" ON "WalletControlIntent"("network", "finalityNextCheckAt", "id");
