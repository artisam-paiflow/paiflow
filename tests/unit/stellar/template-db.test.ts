import { Prisma, TemplateKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ db: { $transaction: mocks.transaction } }));
import { setWasmHash } from "@/lib/stellar/template-db";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const abi = { specEntriesXdr: ["original-evidence"] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue({ wasmHash: hash, abiJson: abi });
  mocks.upsert.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback) => callback({ contractTemplate: mocks }));
});

describe("contract registry ABI preservation", () => {
  it("preserves same-hash ABI verbatim on omitted-metadata sync", async () => {
    await setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash);
    expect(mocks.upsert.mock.calls[0]![0].update).toEqual({ wasmHash: hash });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("refuses to carry ABI to a new hash without matching metadata", async () => {
    await expect(setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", otherHash)).rejects.toThrow(
      "matching ABI",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("registers supplied metadata for a new hash, without copying previous ABI", async () => {
    const nextAbi = { specEntriesXdr: ["new-evidence"] };
    await setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", otherHash, nextAbi);
    expect(mocks.upsert.mock.calls[0]![0].update).toEqual({
      wasmHash: otherHash,
      abiJson: nextAbi,
    });
  });

  it("does not clear evidence with explicitly empty metadata", async () => {
    await expect(setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash, {})).rejects.toThrow(
      "Empty ABI",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("allows legacy creation without evidence but does not fabricate ABI", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash);
    expect(mocks.upsert.mock.calls[0]![0].create).toEqual({
      kind: TemplateKind.SUBSCRIPTION,
      network: "testnet",
      wasmHash: hash,
      abiJson: {},
    });
  });

  it("limits scoped repair to the expected existing hash", async () => {
    mocks.findUnique.mockResolvedValue({ wasmHash: otherHash });
    await expect(
      setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash, abi, { expectedCurrentHash: hash }),
    ).rejects.toThrow("Registry hash changed");
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue(null);
    await expect(
      setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash, abi, { expectedCurrentHash: hash }),
    ).rejects.toThrow("Registry hash changed");
  });

  it("rechecks a concurrent changed hash after serialization conflict instead of preserving stale ABI", async () => {
    mocks.transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2034",
        clientVersion: "test",
      }),
    );
    mocks.findUnique.mockResolvedValue({ wasmHash: otherHash });
    await expect(setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash)).rejects.toThrow(
      "matching ABI",
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("bounds serialization retries and propagates unrelated errors", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    mocks.transaction.mockRejectedValue(conflict);
    await expect(setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash)).rejects.toBe(conflict);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    mocks.transaction.mockReset().mockRejectedValue(new Error("unavailable"));
    await expect(setWasmHash(TemplateKind.SUBSCRIPTION, "testnet", hash)).rejects.toThrow(
      "unavailable",
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
