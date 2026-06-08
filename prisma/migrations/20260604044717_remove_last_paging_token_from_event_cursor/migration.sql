/*
  Warnings:

  - You are about to drop the column `lastPagingToken` on the `EventCursor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "EventCursor" DROP COLUMN "lastPagingToken";
