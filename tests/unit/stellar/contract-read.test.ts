import { beforeEach, describe, expect, it, vi } from "vitest";
import { Address, Keypair, Networks, Transaction, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const stub = vi.hoisted(() => ({
  source: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  rpc: {
    _getLedgerEntries: vi.fn(),
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  },
  log: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => stub.rpc }));
vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent" }),
  stellarRelayerAddress: () => stub.source,
  stellarPassphrase: () => Networks.TESTNET,
  soroswapRouterAddress: () => ROUTER,
  SWAP_ROUTER_UNSET_MESSAGE: "Router not set",
}));
vi.mock("@/lib/log", () => ({ log: stub.log }));
vi.mock("@/lib/stellar/relayer", async () => import("@/lib/stellar/contract-read"));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  buildRelayerTx: vi.fn(),
  relayerSourceChannel: vi.fn(),
}));
vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: (asset: { kind: string }) => (asset.kind === "native" ? XLM : USDC),
}));
vi.mock("@/lib/contract-read-cache", () => ({
  createContractReadCache: () => (_name: string, read: unknown) => read,
}));

import { simulateContractCall, simulateGetter } from "@/lib/stellar/contract-read";
import { paymentAccountResponse } from "./payment-account-fixture";
import { SimulationError } from "@/lib/stellar/sim-error";
import { readSoroswapQuote } from "@/lib/stellar/soroswap";

const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const FACTORY = "CADMRKVJHWAKO2ECTNQALFZ7VEXDIYJIJG3ZSEGIX2HDWADM7EOGCYDG";
const PAIR = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";
const XLM = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
const USDC = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";
const context = { requestId: "test-quote-request" };
const success = (retval: xdr.ScVal) => ({
  latestLedger: 42,
  result: { retval, auth: [] },
});

function accountResponse() {
  return paymentAccountResponse(stub.source, "123");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  stub.rpc._getLedgerEntries.mockReset().mockResolvedValue(accountResponse());
  // Installed SDK would hide the underlying fault. This method must never run.
  stub.rpc.getAccount.mockRejectedValue(new Error(`Account not found: ${stub.source}`));
  stub.rpc.simulateTransaction
    .mockReset()
    .mockResolvedValue(success(nativeToScVal(7n, { type: "i128" })));
});

describe("read-only contract RPC classification", () => {
  it("keeps an absent account as 402 only after a successful empty ledger response", async () => {
    stub.rpc._getLedgerEntries.mockResolvedValue({ latestLedger: 42, entries: [] });
    await expect(simulateGetter(ROUTER, "get_factory", context)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      status: 402,
    });
    expect(stub.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(stub.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ category: "account_absent", requestId: context.requestId }),
      expect.any(String),
    );
  });

  it.each([
    Object.assign(new Error("https://private-rpc.example?apiKey=secret"), { code: "ECONNRESET" }),
    new Error(`Account not found: ${stub.source}`),
  ])(
    "maps a rejected ledger read to sanitized 502 even with lossy SDK-style text (%#)",
    async (error) => {
      stub.rpc._getLedgerEntries.mockRejectedValue(error);
      await expect(simulateGetter(ROUTER, "get_factory", context)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
        status: 502,
        details: undefined,
      });
      expect(stub.rpc.getAccount).not.toHaveBeenCalled();
      expect(stub.rpc.simulateTransaction).not.toHaveBeenCalled();
      expect(stub.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "getLedgerEntries",
          functionName: "get_factory",
          requestId: context.requestId,
          elapsedMs: expect.any(Number),
        }),
        expect.any(String),
      );
      expect(JSON.stringify(stub.log.error.mock.calls)).not.toContain("secret");
      expect(JSON.stringify(stub.log.error.mock.calls)).not.toContain(stub.source);
    },
  );

  it("keeps the real source and sequence for other getters without calling lossy getAccount", async () => {
    await expect(simulateGetter(PAIR, "recipient")).resolves.toBe(7n);
    const tx = stub.rpc.simulateTransaction.mock.calls[0]![0] as Transaction;
    expect(tx.source).toBe(stub.source);
    expect(tx.sequence).toBe("124");
    expect(stub.rpc.getAccount).not.toHaveBeenCalled();
  });

  it("keeps readPayerRecipients using the existing relayer source for every getter", async () => {
    const { readPayerRecipients } =
      await vi.importActual<typeof import("@/lib/stellar/relayer")>("@/lib/stellar/relayer");
    stub.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      const op = tx.operations[0] as { func: xdr.HostFunction };
      const fn = op.func.invokeContract().functionName().toString();
      if (fn === "recipient") return success(new Address(stub.source).toScVal());
      if (fn === "configured_amount") return success(nativeToScVal(500n, { type: "i128" }));
      if (fn === "percentage_bps") return success(nativeToScVal(10000, { type: "u32" }));
      throw new Error(`Unexpected ${fn}`);
    });
    await expect(readPayerRecipients(PAIR)).resolves.toEqual([
      { address: stub.source, amount: "500", bps: 10000 },
    ]);
    expect(stub.rpc.simulateTransaction).toHaveBeenCalledTimes(3);
    for (const [tx] of stub.rpc.simulateTransaction.mock.calls) expect(tx.source).toBe(stub.source);
    expect(stub.rpc.getAccount).not.toHaveBeenCalled();
    expect(stub.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([null, [{ key: {}, xdr: {} }]])(
    "maps malformed ledger entries to 502, never account absence (%#)",
    async (entries) => {
      stub.rpc._getLedgerEntries.mockResolvedValue({ latestLedger: 42, entries });
      await expect(simulateGetter(ROUTER, "get_factory", context)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
        status: 502,
      });
      expect(stub.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ category: "account_unavailable" }),
        expect.any(String),
      );
    },
  );

  it("maps simulation rejection to 502 with safe timing/category/correlation", async () => {
    stub.rpc.simulateTransaction.mockRejectedValue(
      Object.assign(new Error("secret upstream body"), { code: "ETIMEDOUT" }),
    );
    await expect(simulateContractCall(FACTORY, "get_pair", [], context)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
      details: undefined,
    });
    expect(stub.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "simulateTransaction",
        functionName: "get_pair",
        category: "timeout",
        requestId: context.requestId,
        elapsedMs: expect.any(Number),
      }),
      expect.any(String),
    );
    expect(JSON.stringify(stub.log.error.mock.calls)).not.toContain("secret");
  });

  it("keeps a returned contract failure distinct from rejected RPCs and preserves diagnostics", async () => {
    const raw = `HostError: Error(Contract, #205)\n[Diagnostic Event] contract:${FACTORY}, topics:[error, Error(Contract, #205)]`;
    stub.rpc.simulateTransaction.mockResolvedValue({ latestLedger: 42, error: raw });
    const failure = await simulateContractCall(FACTORY, "get_pair").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SimulationError);
    expect(failure).toMatchObject({ code: "UPSTREAM_RPC", details: expect.stringContaining(raw) });
  });

  it("maps a simulation with no return value to structured 502", async () => {
    stub.rpc.simulateTransaction.mockResolvedValue({ latestLedger: 42 });
    await expect(simulateGetter(ROUTER, "get_factory")).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
    });
  });
});

describe("full unsigned Soroswap quote after a transient RPC error", () => {
  const input = {
    assetIn: { kind: "native" },
    assetOut: { kind: "known", symbol: "USDC" },
    amountStroops: "100000000",
    slippageBps: 100,
  } as const;

  function quoteSimulation(tx: Transaction) {
    const op = tx.operations[0] as { func: xdr.HostFunction };
    const fn = op.func.invokeContract().functionName().toString();
    switch (fn) {
      case "get_factory":
        return success(new Address(FACTORY).toScVal());
      case "get_pair":
        return success(new Address(PAIR).toScVal());
      case "get_reserves":
        return success(
          xdr.ScVal.scvVec([
            nativeToScVal(4170509596864n, { type: "i128" }),
            nativeToScVal(39364110253472n, { type: "i128" }),
          ]),
        );
      case "token_0":
        return success(new Address(USDC).toScVal());
      case "router_get_amounts_out":
        return success(
          xdr.ScVal.scvVec([
            nativeToScVal(100000000n, { type: "i128" }),
            nativeToScVal(10562889n, { type: "i128" }),
          ]),
        );
      default:
        throw new Error(`Unexpected ${fn}`);
    }
  }

  it("preserves factory transport failure as 502, then returns the normal quote without signing or submitting", async () => {
    const sign = vi.spyOn(Transaction.prototype, "sign");
    stub.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => quoteSimulation(tx));
    stub.rpc.simulateTransaction.mockImplementationOnce(async (tx: Transaction) =>
      quoteSimulation(tx),
    );
    stub.rpc.simulateTransaction.mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    );
    await expect(readSoroswapQuote(input)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
    });
    expect(stub.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "get_pair",
        requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      }),
      expect.any(String),
    );
    await expect(readSoroswapQuote(input)).resolves.toMatchObject({
      amountOutStroops: "10562889",
      amountOutMinStroops: "10488753",
      pairAddress: PAIR,
      routerAddress: ROUTER,
    });
    const fns = stub.rpc.simulateTransaction.mock.calls.map(([tx]) =>
      tx.operations[0].func.invokeContract().functionName().toString(),
    );
    expect(fns).toEqual([
      "get_factory",
      "get_pair",
      "get_factory",
      "get_pair",
      "get_reserves",
      "token_0",
      "router_get_amounts_out",
    ]);
    expect(sign).not.toHaveBeenCalled();
    expect(stub.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(stub.rpc.getAccount).not.toHaveBeenCalled();
    for (const [tx] of stub.rpc.simulateTransaction.mock.calls)
      expect(tx.signatures).toHaveLength(0);
  });
});
