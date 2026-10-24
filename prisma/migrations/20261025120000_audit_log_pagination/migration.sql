-- Support the admin audit log's newest-first ordering, including timestamp ties.
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt" DESC, "id" DESC);
