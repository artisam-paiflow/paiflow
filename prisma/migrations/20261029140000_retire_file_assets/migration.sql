-- Stored-file uploads, downloads and deletion are retired under #989.
-- This removes metadata only; no filesystem or object-store data is deleted.
ALTER TABLE "FileAsset" DROP CONSTRAINT "FileAsset_ownerId_fkey";

DROP TABLE "FileAsset";
