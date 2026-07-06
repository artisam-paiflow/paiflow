import { describe, expect, it } from "vitest";
import {
  filterAddressBook,
  findInitialHighlightIndex,
  nextHighlightIndex,
} from "@/components/builder/address-input.utils";
import type { AddressEntry } from "@/lib/address-book.types";

const entries: AddressEntry[] = [
  { label: "Alice", address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
  { label: "Bob", address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
  { label: "Acme Corp", address: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" },
];

describe("filterAddressBook", () => {
  it("returns all entries when query is empty", () => {
    expect(filterAddressBook(entries, "")).toEqual(entries);
    expect(filterAddressBook(entries, "   ")).toEqual(entries);
  });

  it("filters by label", () => {
    expect(filterAddressBook(entries, "alice")).toEqual([entries[0]]);
    expect(filterAddressBook(entries, "Acme")).toEqual([entries[2]]);
  });

  it("filters by address substring", () => {
    expect(filterAddressBook(entries, "GBBBB")).toEqual([entries[1]]);
  });

  it("is case-insensitive", () => {
    expect(filterAddressBook(entries, "BOB")).toEqual([entries[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterAddressBook(entries, "zzz")).toEqual([]);
  });
});

describe("nextHighlightIndex", () => {
  it("returns -1 for an empty list", () => {
    expect(nextHighlightIndex(0, "down", 0)).toBe(-1);
  });

  it("moves down and wraps", () => {
    expect(nextHighlightIndex(0, "down", 3)).toBe(1);
    expect(nextHighlightIndex(2, "down", 3)).toBe(0);
  });

  it("moves up and wraps", () => {
    expect(nextHighlightIndex(1, "up", 3)).toBe(0);
    expect(nextHighlightIndex(0, "up", 3)).toBe(2);
  });
});

describe("findInitialHighlightIndex", () => {
  it("selects the index matching the current value", () => {
    expect(findInitialHighlightIndex(entries, entries[1]!.address)).toBe(1);
    expect(findInitialHighlightIndex(entries, `  ${entries[1]!.address}  `)).toBe(1);
  });

  it("falls back to the first item when no match", () => {
    expect(findInitialHighlightIndex(entries, "GUNKNOWN")).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(findInitialHighlightIndex([], "G...")).toBe(-1);
  });
});
