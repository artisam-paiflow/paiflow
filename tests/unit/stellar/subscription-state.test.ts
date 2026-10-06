import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeSubscriptionState } from "@/lib/stellar/subscription-state";

const { server } = vi.hoisted(() => ({
  server: { getAccount: vi.fn(), simulateTransaction: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));

import {
  relayer,
  subscriber,
  contract,
  asset,
  values,
  map,
  missingState,
} from "./subscription-state-fixtures";

beforeEach(async () => {
  vi.resetAllMocks();
  process.env.STELLAR_RELAYER_ADDRESS = relayer;
  vi.resetModules();
  server.getAccount.mockImplementation(async () => new Account(relayer, "1"));
  server.simulateTransaction.mockImplementation(async (tx) => {
    const fn = tx.operations[0].func.invokeContract().functionName().toString();
    const retval =
      fn === "state"
        ? map()
        : fn === "allowance"
          ? nativeToScVal(1000n, { type: "i128" })
          : values()[fn as keyof ReturnType<typeof values>];
    return { _parsed: true, id: "1", latestLedger: 1, events: [], result: { retval, auth: [] } };
  });
});
afterEach(() => {
  delete process.env.STELLAR_RELAYER_ADDRESS;
});

describe("decodeSubscriptionState", () => {
  it("keeps monetary precision and u64 bounds", () => {
    expect(decodeSubscriptionState(map())).toEqual({
      isCancelled: false,
      nextChargeAt: 1000n,
      amountPerPeriod: "200",
      subscriber,
      asset,
      relayer,
    });
    const fields = values();
    fields.amount_per_period = nativeToScVal((1n << 127n) - 1n, { type: "i128" });
    fields.next_charge_at = nativeToScVal((1n << 64n) - 1n, { type: "u64" });
    expect(decodeSubscriptionState(map(fields))).toMatchObject({
      amountPerPeriod: ((1n << 127n) - 1n).toString(),
      nextChargeAt: (1n << 64n) - 1n,
    });
  });
  it.each(Object.keys(values()))("rejects missing %s", (key) => {
    const fields: Record<string, xdr.ScVal> = values();
    delete fields[key];
    expect(() => decodeSubscriptionState(map(fields))).toThrow("malformed");
  });
  it.each([
    ["is_cancelled", xdr.ScVal.scvU32(0)],
    ["next_charge_at", nativeToScVal(1000n, { type: "i128" })],
    ["next_charge_at", nativeToScVal(-1n, { type: "i64" })],
    ["amount_per_period", nativeToScVal(200n, { type: "u64" })],
    ["amount_per_period", nativeToScVal(0n, { type: "i128" })],
    ["amount_per_period", nativeToScVal(-1n, { type: "i128" })],
    ["subscriber", xdr.ScVal.scvString(subscriber)],
    ["subscriber", xdr.ScVal.scvString("invalid")],
    ["asset", new Address(subscriber).toScVal()],
    ["relayer", xdr.ScVal.scvVoid()],
  ])("rejects wrong type/value for %s", (key, value) => {
    expect(() =>
      decodeSubscriptionState(map({ ...values(), [key as string]: value as xdr.ScVal })),
    ).toThrow("malformed");
  });
  it("rejects non-map, unknown, duplicate, and string keys", () => {
    expect(() => decodeSubscriptionState(xdr.ScVal.scvVoid())).toThrow("malformed");
    expect(() =>
      decodeSubscriptionState(map({ ...values(), extra: xdr.ScVal.scvBool(true) })),
    ).toThrow("malformed");
    const entries = map().map()!;
    entries[1] = entries[0]!;
    expect(() => decodeSubscriptionState(xdr.ScVal.scvMap(entries))).toThrow("malformed");
    const other = map().map()!;
    other[0]!.key(xdr.ScVal.scvString("amount_per_period"));
    expect(() => decodeSubscriptionState(xdr.ScVal.scvMap(other))).toThrow("malformed");
  });
});

describe("state capability and RPC costs", () => {
  // Load modules after setting env because setup scrubs each file's environment.
  async function reader() {
    return (await import("@/lib/stellar/subscription-state")).createSubscriptionStateReader();
  }
  it("reads one fresh snapshot each time without caching mutable fields", async () => {
    const read = await reader();
    expect((await read(contract))?.nextChargeAt).toBe(1000n);
    const updated = {
      ...values(),
      is_cancelled: xdr.ScVal.scvBool(true),
      next_charge_at: nativeToScVal(1060n, { type: "u64" }),
      relayer: new Address(subscriber).toScVal(),
    };
    server.simulateTransaction.mockResolvedValue({
      _parsed: true,
      result: { retval: map(updated) },
    });
    expect(await read(contract)).toMatchObject({
      isCancelled: true,
      nextChargeAt: 1060n,
      relayer: subscriber,
    });
    expect(server.getAccount).toHaveBeenCalledTimes(2);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
  });
  it("falls back only on a matching host diagnostic, once per workflow", async () => {
    server.simulateTransaction.mockResolvedValue(missingState());
    const read = await reader();
    expect(await read(contract)).toBeNull();
    expect(await read(contract)).toBeNull();
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(await (await reader())(contract)).toBeNull();
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    { error: "HostError: Error(Storage, MissingValue)", events: [] },
    { ...missingState(), events: [] },
    missingState({ contract: asset }),
    missingState({ function: "other" }),
    missingState({ type: xdr.ScError.sceStorage(xdr.ScErrorCode.scecMissingValue()) }),
    missingState({ message: "missing storage" }),
    { ...missingState(), error: "RPC unavailable" },
    {
      _parsed: true,
      transactionData: {},
      result: { retval: map() },
      restorePreamble: { transactionData: {} },
    },
    { _parsed: true },
    { _parsed: true, result: { retval: xdr.ScVal.scvVoid() } },
  ])("rejects upstream/restore/malformed failures and retries next read", async (response) => {
    server.simulateTransaction.mockResolvedValue(response);
    const read = await reader();
    await expect(read(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await expect(read(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(["getAccount", "simulateTransaction"] as const)(
    "does not fallback on %s outage",
    async (method) => {
      server[method].mockRejectedValue(new Error("unavailable"));
      await expect((await reader())(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    },
  );
  it("compares uncached 14, warm legacy 8, and combined 4 RPC requests", async () => {
    const readers = await import("@/lib/stellar/relayer");
    const allowance = () =>
      readers.readTokenAllowance({
        tokenContractAddress: asset,
        owner: subscriber,
        spender: contract,
      });
    const { createContractReadCache } = await import("@/lib/contract-read-cache");
    const cache = createContractReadCache({ enabled: true });
    const amount = cache("amount", readers.readSubscriptionAmountPerPeriod);
    const owner = cache("subscriber", readers.readSubscriptionSubscriber);
    const token = cache("asset", readers.readSubscriptionAsset);
    async function legacy(cached: boolean) {
      await Promise.all([
        readers.readSubscriptionIsCancelled(contract),
        readers.readSubscriptionNextChargeAt(contract),
        (cached ? amount : readers.readSubscriptionAmountPerPeriod)(contract),
        (cached ? owner : readers.readSubscriptionSubscriber)(contract),
        (cached ? token : readers.readSubscriptionAsset)(contract),
        readers.readSubscriptionRelayer(contract),
      ]);
      await allowance();
    }
    await legacy(false);
    expect(server.getAccount.mock.calls.length + server.simulateTransaction.mock.calls.length).toBe(
      14,
    );
    vi.clearAllMocks();
    await legacy(true);
    vi.clearAllMocks();
    await legacy(true);
    expect(server.getAccount.mock.calls.length + server.simulateTransaction.mock.calls.length).toBe(
      8,
    );
    vi.clearAllMocks();
    await (
      await reader()
    )(contract);
    await allowance();
    expect(server.getAccount.mock.calls.length + server.simulateTransaction.mock.calls.length).toBe(
      4,
    );
  });
});
