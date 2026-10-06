import { Account, StrKey, nativeToScVal, type Transaction } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";

const { getAccount, simulate } = vi.hoisted(() => ({
  getAccount: vi.fn<(address: string) => Promise<Account>>(),
  simulate: vi.fn<(transaction: Transaction) => Promise<unknown>>(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getAccount, simulateTransaction: simulate }),
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
import { createTokenBalanceReader, fetchTokenBalance } from "@/lib/stellar/balance";
import { createDashboardBalanceCache } from "@/lib/stellar/dashboard-balance-cache";

const source = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const token = StrKey.encodeContract(Buffer.alloc(32, 1));
const holder = StrKey.encodeContract(Buffer.alloc(32, 2));
const target = { tokenAddress: token, holderAddress: holder };

beforeEach(() => {
  getAccount.mockReset().mockResolvedValue(new Account(source, "42"));
  simulate
    .mockReset()
    .mockResolvedValue({ result: { retval: nativeToScVal(9007199254740993n, { type: "i128" }) } });
});

it("loads one account for concurrent targets and builds each simulation with an independent sequence", async () => {
  const loaded = new Account(source, "42");
  getAccount.mockResolvedValue(loaded);
  const read = createTokenBalanceReader(source);
  expect(getAccount).not.toHaveBeenCalled();
  const balances = await Promise.all(Array.from({ length: 4 }, () => read(target)));
  expect(balances).toEqual(Array(4).fill(9007199254740993n));
  expect(getAccount).toHaveBeenCalledExactlyOnceWith(source);
  expect(simulate).toHaveBeenCalledTimes(4);
  expect(simulate.mock.calls.map(([tx]) => tx.sequence)).toEqual(Array(4).fill("43"));
  expect(loaded.sequenceNumber()).toBe("42");
});

it("fresh callers do not reuse an account lookup or cached token balance", async () => {
  simulate.mockResolvedValueOnce({ result: { retval: nativeToScVal(1n, { type: "i128" }) } });
  expect(await fetchTokenBalance({ ...target, sourceAccount: source })).toBe(1n);
  expect(await fetchTokenBalance({ ...target, sourceAccount: source })).toBe(9007199254740993n);
  expect(getAccount).toHaveBeenCalledTimes(2);
  expect(simulate).toHaveBeenCalledTimes(2);
});

it("a dashboard batch performs N+1 RPC calls, shares hits, and leaves sensitive reads fresh", async () => {
  const cache = createDashboardBalanceCache();
  const deployment = {
    id: "d",
    ownerId: "owner",
    status: "CONFIRMED",
    sourceAccount: source,
    contractAddress: null,
    graphSnapshot: {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        { id: "p", type: "pay", config: { asset: { kind: "native" }, recipient: source } },
      ],
      edges: [{ id: "tp", source: "t", target: "p" }],
    },
    pipelineSnapshot: Array.from({ length: 8 }, (_, i) => ({
      nodeId: `p${i}`,
      templateKind: "PAYER",
      contractAddress: StrKey.encodeContract(Buffer.alloc(32, i + 2)),
    })),
    flow: { templateKind: "PAYER" as const },
  };
  const environment = { network: "testnet", rpcUrl: "https://example.test" };
  const result = await cache.read(deployment, environment);
  expect(result.freshness.targets).toHaveLength(8);
  expect(getAccount).toHaveBeenCalledTimes(1);
  expect(simulate).toHaveBeenCalledTimes(8);
  await cache.read(deployment, environment);
  expect(getAccount).toHaveBeenCalledTimes(1);
  expect(simulate).toHaveBeenCalledTimes(8);
  simulate.mockResolvedValueOnce({ result: { retval: nativeToScVal(7n, { type: "i128" }) } });
  expect(await fetchTokenBalance({ ...target, sourceAccount: source })).toBe(7n);
  expect(getAccount).toHaveBeenCalledTimes(2);
  expect(simulate).toHaveBeenCalledTimes(9);
});

it("shares an account failure across the batch without simulating", async () => {
  getAccount.mockRejectedValue(new Error("offline"));
  const read = createTokenBalanceReader(source);
  const results = await Promise.allSettled([read(target), read(target)]);
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(getAccount).toHaveBeenCalledTimes(1);
  expect(simulate).not.toHaveBeenCalled();
});

it.each([
  [{ error: "contract unavailable" }, /Balance simulation failed/],
  [{}, /returned no result/],
  [{ result: { retval: nativeToScVal("bad") } }, /Unexpected balance type/],
])("rejects unusable simulation results", async (response, message) => {
  simulate.mockResolvedValue(response);
  await expect(createTokenBalanceReader(source)(target)).rejects.toThrow(message);
});
