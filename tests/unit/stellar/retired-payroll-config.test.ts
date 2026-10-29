import { beforeEach, expect, it, vi } from "vitest";
import { TemplateKind } from "@prisma/client";
const { one, many } = vi.hoisted(() => ({ one: vi.fn(), many: vi.fn() }));
vi.mock("@/lib/stellar/template-db", () => ({
  getWasmHashFromDb: one,
  getWasmHashesFromDb: many,
  getFactoryAddressFromDb: vi.fn(),
  setFactoryAddress: vi.fn(),
  setWasmHash: vi.fn(),
}));
import { clearStellarConfigCache, getWasmHash, getWasmHashes } from "@/lib/stellar/config";
beforeEach(() => {
  vi.clearAllMocks();
  clearStellarConfigCache();
});
it("historical PAYROLL enum and template never become a deployment WASM", async () => {
  one.mockResolvedValue("a".repeat(64));
  expect(await getWasmHash(TemplateKind.PAYROLL)).toBeUndefined();
  expect(one).not.toHaveBeenCalled();
  many.mockResolvedValue(
    new Map([
      [TemplateKind.PAYROLL, "a".repeat(64)],
      [TemplateKind.SUBSCRIPTION, "b".repeat(64)],
    ]),
  );
  const hashes = await getWasmHashes();
  expect(hashes.has(TemplateKind.PAYROLL)).toBe(false);
  expect(hashes.get(TemplateKind.SUBSCRIPTION)).toBe("b".repeat(64));
});
