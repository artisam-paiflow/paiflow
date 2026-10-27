import { beforeEach, describe, expect, it, vi } from "vitest";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({ ledger: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ _getLedgerEntries: mocks.ledger }),
}));
import { readStreamerConfig } from "@/lib/stellar/streamer-config";
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const admin = Keypair.random().publicKey();
const field = (name: string, value: string) =>
  new xdr.ScMapEntry({
    key: nativeToScVal([name], { type: ["symbol"] }),
    val: new Address(value).toScVal(),
  });
let storage: xdr.ScMapEntry[];
beforeEach(() => {
  storage = [field("Admin", admin), field("Asset", asset)];
  mocks.ledger.mockReset().mockImplementation(async (key: xdr.LedgerKey) => ({
    latestLedger: 100,
    entries: [
      {
        key: key.toXDR("base64"),
        xdr: xdr.LedgerEntryData.contractData(
          new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: new Address(contract).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
            val: xdr.ScVal.scvContractInstance(
              new xdr.ScContractInstance({
                executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
                storage,
              }),
            ),
          }),
        ).toXDR("base64"),
      },
    ],
  }));
});
describe("STREAMER instance config", () => {
  it("reads exactly typed Admin and Asset without nonexistent ABI methods", async () => {
    expect(await readStreamerConfig(contract)).toEqual({ admin, asset });
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
  });
  it("accepts contract controllers for state/funding, leaving signing eligibility to controls", async () => {
    storage[0] = field("Admin", contract);
    expect((await readStreamerConfig(contract)).admin).toBe(contract);
  });
  it.each(["Admin", "Asset"])("rejects missing %s", async (name) => {
    storage = storage.filter((entry) => entry.key().vec()?.[0]?.sym().toString() !== name);
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("rejects duplicated keys", async () => {
    storage.push(field("Asset", contract));
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("rejects account-valued token", async () => {
    storage[1] = field("Asset", admin);
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it.each([
    { latestLedger: 100, entries: [] },
    { latestLedger: 0, entries: [] },
    { latestLedger: 100, entries: [{ key: { toXDR: () => Buffer.from("wrong-key") } }] },
  ])("fails closed on unavailable/mismatched instance %j", async (response) => {
    mocks.ledger.mockResolvedValue(response);
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("does not leak RPC/storage error details", async () => {
    mocks.ledger.mockRejectedValue(new Error("private raw storage"));
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({
      message: "Current Schedule data could not be verified. Please try again.",
    });
  });
  it("rejects malformed contract before RPC", async () => {
    await expect(readStreamerConfig("bad")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.ledger).not.toHaveBeenCalled();
  });
});
