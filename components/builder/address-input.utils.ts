import type { AddressEntry } from "@/lib/address-book.types";

export function filterAddressBook(entries: AddressEntry[], query: string): AddressEntry[] {
  const normalized = query.trim().toLowerCase();
  const matched = normalized
    ? entries.filter(
        (entry) =>
          entry.label.toLowerCase().includes(normalized) ||
          entry.address.toLowerCase().includes(normalized),
      )
    : entries;
  // The address book can contain duplicate addresses (e.g. saved twice with
  // different labels); keep the first occurrence so React keys stay unique.
  const seen = new Set<string>();
  return matched.filter((entry) => {
    const key = entry.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function nextHighlightIndex(
  current: number,
  direction: "up" | "down",
  length: number,
): number {
  if (length <= 0) return -1;
  if (direction === "down") {
    return current >= length - 1 ? 0 : current + 1;
  }
  return current <= 0 ? length - 1 : current - 1;
}

export function findInitialHighlightIndex(entries: AddressEntry[], value: string): number {
  const selected = entries.findIndex((entry) => entry.address === value.trim());
  if (selected >= 0) return selected;
  return entries.length > 0 ? 0 : -1;
}
