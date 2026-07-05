-- CreateTable
CREATE TABLE "FactoryDeployment" (
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "wasmHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryDeployment_pkey" PRIMARY KEY ("network")
);
