import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  Keypair,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";

const stub = vi.hoisted(() => ({
  relayer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  db: { deployment: { findFirst: vi.fn() } },
  rpc: {
    _getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  buildRelayerTx: vi.fn(),
  relayerSourceChannel: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => stub.rpc,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRelayerAddress: () => stub.relayer,
}));
vi.mock("@/lib/db", () => ({ db: stub.db }));
vi.mock("@/lib/log", () => ({ log: stub.log }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: () => "203.0.113.1",
}));

import { GET, POST } from "@/app/api/deployments/[id]/subscription-allowance/route";
import { assetContractId } from "@/lib/stellar/assets";
import { simulateGetter } from "@/lib/stellar/contract-read";
import {
  loadAllowanceReadAccount,
  withAllowancePreparation,
} from "@/lib/stellar/allowance-preparation";
import { loadPaymentAccount } from "@/lib/stellar/load-payment-account";
import {
  interactiveRpcBudget,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { paymentAccountResponse } from "./payment-account-fixture";

const customer = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 2));
const token = assetContractId({ kind: "native" });
const id = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id }) };
let subscriber = customer;

function request(userAddress = subscriber) {
  return new NextRequest(`https://paiflow.test/api/deployments/${id}/subscription-allowance`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "untrusted-request-id" },
    body: JSON.stringify({ amount: "10", userAddress }),
  });
}
function accountAddress(key: xdr.LedgerKey) {
  return Address.fromScAddress(
    xdr.ScAddress.scAddressTypeAccount(key.account().accountId()),
  ).toString();
}
function getter(tx: Transaction) {
  const operation = tx.operations[0];
  if (operation?.type !== "invokeHostFunction") throw new Error("Unexpected operation");
  return operation.func.invokeContract().functionName().toString();
}
function phaseLogs() {
  return [...stub.log.info.mock.calls, ...stub.log.warn.mock.calls]
    .filter(([, message]) => String(message).startsWith("Allowance preparation phase"))
    .map(([fields]) => fields as Record<string, unknown>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  subscriber = customer;
  stub.db.deployment.findFirst.mockResolvedValue({
    id,
    network: "testnet",
    flow: { name: "Allowance test", templateKind: "SUBSCRIPTION" },
    graphSnapshot: {
      nodes: [
        {
          id: "sub",
          type: "subscription",
          config: { subscriber, asset: { kind: "native" }, amountPerPeriodStroops: "10" },
        },
      ],
      edges: [],
    },
    pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: contract }],
  });
  stub.rpc._getLedgerEntries
    .mockReset()
    .mockImplementation(async (key: xdr.LedgerKey) =>
      paymentAccountResponse(accountAddress(key), "123"),
    );
  stub.rpc.getLatestLedger.mockReset().mockResolvedValue({ sequence: 1000 });
  stub.rpc.simulateTransaction.mockReset().mockImplementation(async (tx: Transaction) => {
    const name = getter(tx);
    const value =
      name === "subscriber"
        ? new Address(subscriber).toScVal()
        : name === "asset"
          ? new Address(token).toScVal()
          : name === "allowance"
            ? nativeToScVal(0n, { type: "i128" })
            : nativeToScVal(name === "approve");
    return {
      _parsed: true,
      id: "1",
      latestLedger: 1000,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: "1000",
      result: { auth: [], retval: value },
    };
  });
});

describe("public allowance request-scoped read account", () => {
  it("prepares with eight RPC calls, stable simulation sequences and a separate fresh approval source", async () => {
    const sign = vi.spyOn(Transaction.prototype, "sign");
    const response = await POST(request(), ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.allowance).toBe("10");
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
    expect(stub.rpc._getLedgerEntries.mock.calls.map(([key]) => accountAddress(key))).toEqual([
      stub.relayer,
      customer,
    ]);
    expect(stub.rpc.simulateTransaction).toHaveBeenCalledTimes(5);
    expect(stub.rpc.getLatestLedger).toHaveBeenCalledOnce();
    const simulations = stub.rpc.simulateTransaction.mock.calls.map(([tx]) => tx as Transaction);
    expect(simulations.map(getter)).toEqual([
      "subscriber",
      "asset",
      "is_cancelled",
      "allowance",
      "approve",
    ]);
    expect(simulations.map((tx) => tx.sequence)).toEqual(Array(5).fill("124"));
    const approval = TransactionBuilder.fromXDR(data.xdr, Networks.TESTNET) as Transaction;
    expect(approval.source).toBe(customer);
    expect(approval.sequence).toBe("124");
    expect(approval.signatures).toHaveLength(0);
    expect(approval.hash().toString("hex")).toBe(data.txHash);
    expect(sign).not.toHaveBeenCalled();
    expect(stub.rpc.sendTransaction).not.toHaveBeenCalled();
    const logs = phaseLogs();
    expect(logs.map((entry) => entry.phase)).toEqual(
      expect.arrayContaining([
        "total",
        "state",
        "relayer-account",
        "allowance",
        "ledger",
        "subscriber-account",
        "approval-simulation",
        "approval-assembly",
      ]),
    );
    expect(new Set(logs.map((entry) => entry.requestId)).size).toBe(1);
    expect(logs[0]?.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(logs[0]?.requestId).not.toBe("untrusted-request-id");
    expect(
      logs.every(
        (entry) => typeof entry.elapsedMs === "number" && typeof entry.remainingRpcMs === "number",
      ),
    ).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(customer);
    expect(JSON.stringify(logs)).not.toContain(data.xdr);
    expect(JSON.stringify(logs)).not.toContain(data.intent);
  });

  it("still reloads the subscriber at approval when subscriber and relayer are the same address", async () => {
    subscriber = stub.relayer;
    stub.rpc._getLedgerEntries
      .mockResolvedValueOnce(paymentAccountResponse(stub.relayer, "123"))
      .mockResolvedValueOnce(paymentAccountResponse(stub.relayer, "456"));
    expect((await POST(request(), ctx)).status).toBe(200);
    expect(
      stub.rpc.simulateTransaction.mock.calls.map(([tx]) => (tx as Transaction).sequence),
    ).toEqual(["124", "124", "124", "124", "457"]);
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
    expect(stub.rpc._getLedgerEntries.mock.calls.map(([key]) => accountAddress(key))).toEqual([
      stub.relayer,
      stub.relayer,
    ]);
  });

  it("does not share snapshots between concurrent POST requests", async () => {
    const responses = await Promise.all([POST(request(), ctx), POST(request(), ctx)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(4);
    expect(new Set(phaseLogs().map((entry) => entry.requestId)).size).toBe(2);
  });

  it("leaves GET and unscoped getters uncached", async () => {
    const response = await GET(new NextRequest("https://paiflow.test/allowance"), ctx);
    expect(response.status).toBe(200);
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(4);
    await simulateGetter(contract, "subscriber");
    await simulateGetter(contract, "subscriber");
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(6);
    expect(phaseLogs()).toEqual([]);
  });

  it.each([
    { latestLedger: 1000, entries: null },
    { latestLedger: 1000, entries: [] },
  ])(
    "fails closed on invalid/absent account evidence and reloads on the next request (%#)",
    async (response) => {
      stub.rpc._getLedgerEntries.mockResolvedValueOnce(response);
      const failed = await POST(request(), ctx);
      expect(failed.status).toBe(response.entries === null ? 502 : 402);
      expect(stub.rpc._getLedgerEntries).toHaveBeenCalledOnce();
      expect(stub.rpc.simulateTransaction).not.toHaveBeenCalled();
      expect(phaseLogs()).toContainEqual(
        expect.objectContaining({ phase: "total", outcome: "failure" }),
      );
      expect((await POST(request(), ctx)).status).toBe(200);
      expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(3);
    },
  );

  it("retains a rejected account read within the request, sanitizes logs, and does not poison the next request", async () => {
    const secret = "private-rpc-token-do-not-log";
    stub.rpc._getLedgerEntries.mockRejectedValueOnce(new Error(secret));
    await withAllowancePreparation(async () => {
      const initial = await Promise.allSettled([
        simulateGetter(contract, "subscriber"),
        simulateGetter(contract, "asset"),
      ]);
      expect(initial.every((result) => result.status === "rejected")).toBe(true);
      await expect(simulateGetter(contract, "is_cancelled")).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(stub.rpc._getLedgerEntries).toHaveBeenCalledOnce();
    });
    expect((await POST(request(), ctx)).status).toBe(200);
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(3);
    expect(
      JSON.stringify([
        stub.log.info.mock.calls,
        stub.log.warn.mock.calls,
        stub.log.error.mock.calls,
      ]),
    ).not.toContain(secret);
  });

  it("isolates cache entries by client and address, returning independent mutable accounts", async () => {
    const other = {
      _getLedgerEntries: vi.fn(async (key: xdr.LedgerKey) =>
        paymentAccountResponse(accountAddress(key), "456"),
      ),
    };
    await withAllowancePreparation(async () => {
      const [first, second] = await Promise.all([
        loadAllowanceReadAccount(stub.rpc, customer),
        loadAllowanceReadAccount(stub.rpc, customer),
      ]);
      first.incrementSequenceNumber();
      expect(second.sequenceNumber()).toBe("123");
      expect((await loadAllowanceReadAccount(stub.rpc, customer)).sequenceNumber()).toBe("123");
      expect((await loadAllowanceReadAccount(stub.rpc, stub.relayer)).accountId()).toBe(
        stub.relayer,
      );
      expect((await loadAllowanceReadAccount(other, customer)).sequenceNumber()).toBe("456");
      // The ordinary loader is never intercepted, even inside this scope.
      await loadPaymentAccount(stub.rpc, customer);
    });
    expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(3);
    expect(other._getLedgerEntries).toHaveBeenCalledOnce();
  });

  it("keeps a nested budget and refuses to expose preparation after exhaustion", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const simulate = stub.rpc.simulateTransaction.getMockImplementation()!;
    const sign = vi.spyOn(Transaction.prototype, "sign");
    let inheritedBudget: ReturnType<typeof interactiveRpcBudget>;
    stub.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      expect(interactiveRpcBudget()).toBe(inheritedBudget);
      if (getter(tx) === "approve") vi.setSystemTime(started + 501);
      return simulate(tx);
    });
    try {
      const response = await withInteractiveRpcBudget(async () => {
        inheritedBudget = interactiveRpcBudget();
        return POST(request(), ctx);
      }, 500);
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.data).toBeUndefined();
      expect(body.error.code).toBe("UPSTREAM_RPC");
      expect(phaseLogs()).toContainEqual(
        expect.objectContaining({
          phase: "total",
          outcome: "failure",
          category: "deadline",
          remainingRpcMs: 0,
        }),
      );
      expect(stub.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
      expect(stub.rpc.simulateTransaction).toHaveBeenCalledTimes(5);
      expect(sign).not.toHaveBeenCalled();
      expect(stub.rpc.sendTransaction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
