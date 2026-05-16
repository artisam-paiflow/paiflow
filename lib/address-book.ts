import "server-only";
import { db } from "./db";

export type AddressEntry = { label: string; address: string };

export async function getAddressBook(userId: string): Promise<AddressEntry[]> {
  const entries = await db.addressBookEntry.findMany({
    where: { ownerId: userId },
    select: { label: true, address: true },
  });
  return entries;
}

export async function upsertAddress(userId: string, label: string, address: string): Promise<void> {
  await db.addressBookEntry.upsert({
    where: { ownerId_label: { ownerId: userId, label } },
    update: { address },
    create: { ownerId: userId, label, address },
  });
}

export async function removeAddress(entryId: string): Promise<void> {
  await db.addressBookEntry.delete({ where: { id: entryId } });
}
