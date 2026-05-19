-- CreateTable
CREATE TABLE "AddressBookEntry" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressBookEntry_ownerId_idx" ON "AddressBookEntry"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AddressBookEntry_ownerId_label_key" ON "AddressBookEntry"("ownerId", "label");

-- AddForeignKey
ALTER TABLE "AddressBookEntry" ADD CONSTRAINT "AddressBookEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
