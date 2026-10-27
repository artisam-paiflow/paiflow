-- Support flow-name filtering in the developer deployment picker.
CREATE INDEX "Flow_name_idx" ON "Flow"("name");
