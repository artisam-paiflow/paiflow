BEGIN;
-- Forward compatibility for targets that already completed the ORIGINAL empty
-- cleanup. Never rewrite their recorded checksum or rerun that migration.
DO $$
BEGIN
  -- Prisma shadow replay deliberately has no migration metadata. It may only
  -- replay the already-complete preservation schema, never an absent/partial one.
  IF to_regclass('"_prisma_migrations"') IS NULL THEN
    IF to_regclass('"Employee"') IS NOT NULL AND to_regclass('"PayrollRun"') IS NOT NULL
      AND to_regclass('"PayrollPayout"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='"TemplateKind"'::regtype AND enumlabel='PAYROLL') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Payroll preservation blocked: metadata-free replay has incomplete historical schema (#1144)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20261029150000_retire_payroll' AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND checksum IN ('241106af4be5cb6e787610ae8c2672c435a714fecb84b3dbd977227a4be1a949','5bd9e33ae0805489bae9b6fdb3ef6e8db878a1eae63529379016b8741daa19b1'))
    OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20261029150000_retire_payroll' AND (finished_at IS NULL OR rolled_back_at IS NOT NULL OR checksum NOT IN ('241106af4be5cb6e787610ae8c2672c435a714fecb84b3dbd977227a4be1a949','5bd9e33ae0805489bae9b6fdb3ef6e8db878a1eae63529379016b8741daa19b1'))) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unsupported, partial or unknown retirement migration history (#1144)';
  END IF;
  IF ((to_regclass('"Employee"') IS NOT NULL)::int + (to_regclass('"PayrollRun"') IS NOT NULL)::int + (to_regclass('"PayrollPayout"') IS NOT NULL)::int) NOT IN (0,3) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: partial historical storage requires review (#1144)';
  END IF;
END $$;
ALTER TYPE "TemplateKind" ADD VALUE IF NOT EXISTS 'PAYROLL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='PayrollRunStatus') THEN
    CREATE TYPE "PayrollRunStatus" AS ENUM ('PENDING','CHARGED','FAILED','CANCELLED');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "Employee" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "amountStroops" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PayrollRun" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "txHash" TEXT,
    "totalStroops" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PayrollPayout" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amountStroops" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Employee_deploymentId_idx" ON "Employee"("deploymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_deploymentId_address_key" ON "Employee"("deploymentId", "address");
CREATE INDEX IF NOT EXISTS "PayrollRun_deploymentId_runAt_idx" ON "PayrollRun"("deploymentId", "runAt");
CREATE INDEX IF NOT EXISTS "PayrollRun_status_runAt_idx" ON "PayrollRun"("status", "runAt");
CREATE INDEX IF NOT EXISTS "PayrollPayout_payrollRunId_idx" ON "PayrollPayout"("payrollRunId");
CREATE INDEX IF NOT EXISTS "PayrollPayout_employeeId_idx" ON "PayrollPayout"("employeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_txHash_key" ON "PayrollRun"("txHash");
CREATE INDEX IF NOT EXISTS "PayrollRun_deploymentId_createdAt_idx" ON "PayrollRun"("deploymentId", "createdAt");
CREATE INDEX IF NOT EXISTS "PayrollRun_runAt_idx" ON "PayrollRun"("runAt");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Employee_deploymentId_fkey') THEN ALTER TABLE "Employee" ADD CONSTRAINT "Employee_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PayrollRun_deploymentId_fkey') THEN ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PayrollPayout_payrollRunId_fkey') THEN ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PayrollPayout_employeeId_fkey') THEN ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
COMMIT;
