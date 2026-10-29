import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import type { NextRequest } from "next/server";
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  relayerAddress: vi.fn(),
  latest: vi.fn(),
  createIntent: vi.fn(),
  deployment: vi.fn(),
  audit: vi.fn(),
  charge: vi.fn(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarRelayerAddress: () => mocks.relayerAddress(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findFirst: mocks.deployment },
    auditLog: { create: mocks.audit },
    subscriptionCharge: { create: mocks.charge },
  },
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(),
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "127.0.0.1",
  enforceRateLimit: async () => undefined,
}));
vi.mock("@/lib/subscription/state", () => ({ readSubscriptionState: mocks.state }));
vi.mock("@/lib/api/v1/control-intent", () => ({
  createControlIntent: mocks.createIntent,
  readControlIntent: vi.fn(),
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: vi.fn() }));
vi.mock("@/lib/api/request-history/context", () => ({ linkApiTransaction: vi.fn() }));
import { prepareSubscriptionControl } from "@/lib/api/v1/subscription-controls";
import { POST as ownerReactivate } from "@/app/api/deployments/[id]/subscription-subscribe/route";
import { POST as ownerCancel } from "@/app/api/deployments/[id]/subscription-unsubscribe/route";
import { AppError } from "@/lib/errors";
import { sorobanRpc, STELLAR_HTTP_TIMEOUT_MS } from "@/lib/stellar/client";
import {
  interactiveRpcBudget,
  remainingInteractiveRpcMs,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { SimulationError } from "@/lib/stellar/sim-error";
import { paymentAccountResponse } from "./payment-account-fixture";
const wallet = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "CONFIRMED",
  network: "testnet",
  webhookSecret: null,
  flow: { templateKind: "SUBSCRIPTION" },
  pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: contract }],
  graphSnapshot: {
    nodes: [
      {
        id: "sub",
        type: "subscription",
        config: {
          subscriber: wallet,
          asset: { kind: "native" },
          amountPerPeriodStroops: "100",
        },
      },
    ],
    edges: [],
  },
} as unknown as Deployment;
const state = {
  subscriber: wallet,
  isCancelled: true,
  network: "testnet",
  templateKind: "SUBSCRIPTION",
  contractAddress: contract,
  tokenContractAddress: asset,
};
const success = () => ({
  latestLedger: 1000,
  minResourceFee: "1000",
  transactionData: new SorobanDataBuilder().build().toXDR("base64"),
  results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
  events: [],
});
type RpcCall = {
  method: string;
  params?: unknown;
};
function rpcFetch(handle: (call: RpcCall, init: RequestInit) => Promise<unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const result = await handle(JSON.parse(init.body as string), init);
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
}
function normal(call: RpcCall) {
  if (call.method === "getLatestLedger") return { sequence: 1000 };
  if (call.method === "getLedgerEntries") return paymentAccountResponse(wallet);
  if (call.method === "simulateTransaction") return success();
  throw new Error(`Unexpected RPC mutation: ${call.method}`);
}
function stalled(init: RequestInit) {
  return new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });
}
function prepare() {
  return prepareSubscriptionControl(deployment, "subscription.reactivate", wallet);
}
function unchanged() {
  expect(mocks.createIntent).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.charge).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockImplementation(async () => {
    await mocks.latest();
    return { sequence: 1000 } as Awaited<ReturnType<rpc.Server["getLatestLedger"]>>;
  });
  mocks.latest.mockResolvedValue(undefined);
  mocks.relayerAddress.mockReturnValue(undefined);
  mocks.state.mockResolvedValue(state);
  mocks.deployment.mockResolvedValue(deployment);
  mocks.createIntent.mockResolvedValue({ intent: "intent", txHash: "a".repeat(64) });
  rpcFetch(async (call) => normal(call));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("Subscription preparation through the real SDK client and builders", () => {
  it.each(["getLedgerEntries", "simulateTransaction"])(
    "classifies a %s timeout as upstream without reserving an intent or changing billing",
    async (method) => {
      rpcFetch(async (call, init) => (call.method === method ? stalled(init) : normal(call)));
      const result = prepare();
      const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
      await vi.advanceTimersByTimeAsync(25000);
      await rejected;
      unchanged();
      const calls = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(call[1]!.body as string));
      expect(calls.filter((call) => call.method === method)).toHaveLength(1);
      expect(
        calls.every((call) =>
          ["getLatestLedger", "getLedgerEntries", "simulateTransaction"].includes(call.method),
        ),
      ).toBe(true);
    },
  );
  it("uses one deadline for eligibility, ledger, account, simulation and final eligibility", async () => {
    const budgets: unknown[] = [];
    const remaining: number[] = [];
    const observe = () => {
      budgets.push(interactiveRpcBudget());
      remaining.push(remainingInteractiveRpcMs());
      vi.setSystemTime(Date.now() + 4000);
    };
    mocks.latest.mockImplementation(async () => observe());
    mocks.state.mockImplementation(async () => {
      observe();
      return state;
    });
    rpcFetch(async (call) => {
      observe();
      return normal(call);
    });
    await expect(prepare()).resolves.toMatchObject({ action: "subscription.reactivate" });
    expect(remaining).toEqual([25000, 21000, 17000, 13000, 9000]);
    expect(budgets.every((budget) => budget === budgets[0] && budget !== undefined)).toBe(true);
    expect(mocks.createIntent).toHaveBeenCalledOnce();
    expect(sorobanRpc().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
    expect(STELLAR_HTTP_TIMEOUT_MS).toBe(10000);
  });
  it("does not reserve an intent after final eligibility consumes the remaining budget", async () => {
    mocks.state
      .mockImplementationOnce(async () => state)
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 25000);
        return state;
      });
    await expect(prepare()).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
    unchanged();
  });
  it("does not give nested preparation another 25 seconds", async () => {
    rpcFetch(async (call, init) =>
      call.method === "simulateTransaction" ? stalled(init) : normal(call),
    );
    const result = withInteractiveRpcBudget(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return prepare();
    });
    const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await vi.advanceTimersByTimeAsync(25000);
    await rejected;
    unchanged();
  });
  it("preserves a genuine contract simulation failure and its diagnostic details", async () => {
    rpcFetch(async (call) =>
      call.method === "simulateTransaction"
        ? { latestLedger: 1000, error: "Error(Contract, #5)" }
        : normal(call),
    );
    const error = await prepare().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SimulationError);
    expect(error).toMatchObject({
      code: "UPSTREAM_RPC",
      details: expect.stringContaining("Error(Contract, #5)"),
    });
    expect(String(error)).not.toContain("could not simulate this subscription control");
    unchanged();
  });
  it.each(["FORBIDDEN", "CONFLICT", "VALIDATION"] as const)(
    "preserves %s eligibility refusals",
    async (code) => {
      const error = new AppError(code, "Existing refusal");
      mocks.state.mockRejectedValueOnce(error);
      await expect(prepare()).rejects.toBe(error);
      unchanged();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["initial", "getLedgerEntries", 1],
    ["initial", "simulateTransaction", 1],
    ["post-simulation", "getLedgerEntries", 2],
    ["post-simulation", "simulateTransaction", 2],
  ] as const)(
    "classifies %s eligibility %s timeouts without a false unfunded-account refusal",
    async (_stage, method, stateRead) => {
      // Exercise the real state resolver and its opt-in relayer readers, not builder mocks.
      const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
        "@/lib/subscription/state",
      );
      sorobanRpc(); // Initialize without relayer startup work before enabling the read source.
      mocks.relayerAddress.mockReturnValue(wallet);
      mocks.state.mockImplementation(real.readSubscriptionState);
      rpcFetch(async (call, init) => {
        if (call.method === method && mocks.state.mock.calls.length === stateRead)
          return stalled(init);
        if (call.method !== "simulateTransaction") return normal(call);
        const tx = TransactionBuilder.fromXDR(
          (
            call.params as {
              transaction: string;
            }
          ).transaction,
          Networks.TESTNET,
        );
        if (!(tx instanceof Transaction)) throw new Error("Unexpected fee-bump transaction");
        const operation = tx.operations[0]!;
        if (operation.type !== "invokeHostFunction")
          throw new Error("Unexpected transaction operation");
        const fn = operation.func.invokeContract().functionName().toString();
        const retval =
          fn === "subscriber"
            ? new Address(wallet).toScVal()
            : fn === "asset"
              ? new Address(asset).toScVal()
              : fn === "is_cancelled"
                ? xdr.ScVal.scvBool(true)
                : xdr.ScVal.scvVoid();
        return { ...success(), results: [{ auth: [], xdr: retval.toXDR("base64") }] };
      });
      const result = prepare();
      const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
      await vi.advanceTimersByTimeAsync(25000);
      await rejected;
      expect(mocks.state).toHaveBeenCalledTimes(stateRead);
      expect(mocks.state).toHaveBeenCalledWith(deployment.id, {
        snapshotOnly: true,
        classifyRpcFailures: true,
      });
      unchanged();
    },
  );
  it("preserves genuinely absent eligibility read-source classification", async () => {
    const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
      "@/lib/subscription/state",
    );
    sorobanRpc();
    mocks.relayerAddress.mockReturnValue(wallet);
    mocks.state.mockImplementation(real.readSubscriptionState);
    rpcFetch(async () => ({ latestLedger: 1000, entries: [] }));
    await expect(prepare()).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 402 });
    unchanged();
  });
  it.each([
    ["subscriber", xdr.ScVal.scvVoid(), "VALIDATION"],
    ["subscriber", xdr.ScVal.scvU32(1), "UPSTREAM_RPC"],
    ["subscriber", xdr.ScVal.scvString("invalid-address"), "UPSTREAM_RPC"],
    ["asset", new Address(wallet).toScVal(), "UPSTREAM_RPC"],
    ["is_cancelled", xdr.ScVal.scvString("true"), "UPSTREAM_RPC"],
  ] as const)(
    "validates opt-in %s getter results without reserving an intent",
    async (getter, invalidValue, code) => {
      const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
        "@/lib/subscription/state",
      );
      sorobanRpc();
      mocks.relayerAddress.mockReturnValue(wallet);
      mocks.state.mockImplementation(real.readSubscriptionState);
      rpcFetch(async (call) => {
        if (call.method !== "simulateTransaction") return normal(call);
        const tx = TransactionBuilder.fromXDR(
          (
            call.params as {
              transaction: string;
            }
          ).transaction,
          Networks.TESTNET,
        );
        if (!(tx instanceof Transaction)) throw new Error("Unexpected fee-bump transaction");
        const operation = tx.operations[0]!;
        if (operation.type !== "invokeHostFunction")
          throw new Error("Unexpected transaction operation");
        const fn = operation.func.invokeContract().functionName().toString();
        const retval =
          fn === getter
            ? invalidValue
            : fn === "subscriber"
              ? new Address(wallet).toScVal()
              : fn === "asset"
                ? new Address(asset).toScVal()
                : xdr.ScVal.scvBool(true);
        return { ...success(), results: [{ auth: [], xdr: retval.toXDR("base64") }] };
      });
      await expect(prepare()).rejects.toMatchObject({ code });
      unchanged();
    },
  );
  it("does not misclassify a durable intent storage error as an RPC failure", async () => {
    const error = new Error("intent storage failed");
    mocks.createIntent.mockRejectedValueOnce(error);
    await expect(prepare()).rejects.toBe(error);
    expect(mocks.createIntent).toHaveBeenCalledOnce();
  });
  it.each([
    ["cancel", ownerCancel],
    ["reactivate", ownerReactivate],
  ] as const)(
    "gives the participant %s preparation the same aggregate RPC budget",
    async (_name, handler) => {
      const budgets: unknown[] = [];
      rpcFetch(async (call) => {
        budgets.push(interactiveRpcBudget());
        expect(remainingInteractiveRpcMs()).toBe(budgets.length === 1 ? 25000 : 9000);
        if (budgets.length === 1) vi.setSystemTime(Date.now() + 16000);
        return normal(call);
      });
      const response = await handler(
        new Request("https://paiflow.test/subscription-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userAddress: wallet }),
        }) as NextRequest,
        { params: Promise.resolve({ id: deployment.id }) },
      );
      expect(response.status).toBe(200);
      expect(budgets).toHaveLength(2);
      expect(budgets[0]).toBeDefined();
      expect(budgets[1]).toBe(budgets[0]);
      expect(sorobanRpc().httpClient.defaults.timeout).toBe(10000);
    },
  );
});
describe("Subscription already-active guard through real SDK diagnostics", () => {
  function event(
    origin: string | undefined,
    topics: xdr.ScVal[],
    data = xdr.ScVal.scvVoid(),
    successful = false,
  ) {
    return new xdr.DiagnosticEvent({
      inSuccessfulContractCall: successful,
      event: new xdr.ContractEvent({
        ext: new xdr.ExtensionPoint(0),
        contractId: origin ? (StrKey.decodeContract(origin) as unknown as xdr.Hash) : null,
        type: xdr.ContractEventType.diagnostic(),
        body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
      }),
    }).toXDR("base64");
  }
  const guardTopics = (code = 7) => [
    xdr.ScVal.scvSymbol("error"),
    xdr.ScVal.scvError(xdr.ScError.sceContract(code)),
  ];
  const rootCall = (
    target = contract,
    method = "subscribe",
    data = xdr.ScVal.scvVoid(),
    successful = false,
    origin?: string,
  ) =>
    event(
      origin,
      [
        xdr.ScVal.scvSymbol("fn_call"),
        xdr.ScVal.scvBytes(StrKey.decodeContract(target)),
        xdr.ScVal.scvSymbol(method),
      ],
      data,
      successful,
    );
  function refusal(
    events = [rootCall(), event(contract, guardTopics()), event(contract, guardTopics())],
    code = 7,
  ) {
    return {
      latestLedger: 1000,
      error:
        `HostError: Error(Contract, #${code})\nEvent log (newest first):\n` +
        `0: [Diagnostic Event] contract:${contract}, topics:[error, Error(Contract, #${code})]\n` +
        `1: [Diagnostic Event] topics:[fn_call, ${contract}, subscribe], data:Void`,
      events,
    };
  }
  const serve = (simulation: unknown) =>
    rpcFetch(async (call) => (call.method === "simulateTransaction" ? simulation : normal(call)));
  const participant = (address = wallet) =>
    ownerReactivate(
      new Request("https://paiflow.test/subscription-subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      }) as NextRequest,
      { params: Promise.resolve({ id: deployment.id }) },
    );
  it("returns participant409 for verified target subscribe error7 without producing XDR", async () => {
    serve(refusal());
    const response = await participant();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "CONFLICT",
      message: "Subscription is already active",
    });
    expect(body.error.details).toContain("HostError: Error(Contract, #7)");
    expect(body.data).toBeUndefined();
    unchanged();
  });
  it("accepts a corroborated root target encoded as a contract address", async () => {
    serve(
      refusal([
        event(undefined, [
          xdr.ScVal.scvSymbol("fn_call"),
          new Address(contract).toScVal(),
          xdr.ScVal.scvSymbol("subscribe"),
        ]),
        event(contract, guardTopics()),
      ]),
    );
    expect((await participant()).status).toBe(409);
    unchanged();
  });
  it.each(["SUBSCRIPTION"])(
    "classifies a %s state race after the SDK cancelled precheck without reserving intent",
    async (kind) => {
      const selected = {
        ...deployment,
        pipelineSnapshot: [{ nodeId: "sub", templateKind: kind, contractAddress: contract }],
      };
      mocks.state.mockResolvedValue({ ...state, templateKind: kind });
      serve(refusal());
      await expect(
        prepareSubscriptionControl(selected, "subscription.reactivate", wallet),
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
      expect(mocks.state).toHaveBeenCalledOnce();
      unchanged();
    },
  );
  it.each(["SUBSCRIPTION"])(
    "preserves valid %s preparation and simulated source/network/method",
    async (kind) => {
      const selected = {
        ...deployment,
        pipelineSnapshot: [{ nodeId: "sub", templateKind: kind, contractAddress: contract }],
      };
      mocks.state.mockResolvedValue({ ...state, templateKind: kind });
      const result = await prepareSubscriptionControl(selected, "subscription.reactivate", wallet);
      const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET) as Transaction;
      expect(tx.source).toBe(wallet);
      expect(tx.operations).toHaveLength(1);
      const operation = tx.operations[0]!;
      expect(operation.type).toBe("invokeHostFunction");
      if (operation.type !== "invokeHostFunction") throw new Error("Unexpected operation");
      expect(operation.func.invokeContract().functionName().toString()).toBe("subscribe");
      expect(operation.func.invokeContract().args()).toHaveLength(0);
      expect(result.networkPassphrase).toBe(Networks.TESTNET);
      expect(mocks.createIntent).toHaveBeenCalledOnce();
      expect(mocks.audit).not.toHaveBeenCalled();
      expect(mocks.charge).not.toHaveBeenCalled();
    },
  );
  it("preserves the SDK active precheck409 without any builder RPC", async () => {
    mocks.state.mockResolvedValue({ ...state, isCancelled: false });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(fetch).not.toHaveBeenCalled();
    unchanged();
  });
  it("preserves participant success and wrong-wallet422 before RPC", async () => {
    expect((await participant(Keypair.random().publicKey())).status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
    expect((await participant()).status).toBe(200);
    unchanged();
  });
  it("preserves a real transport failure502 without exposing provider details", async () => {
    rpcFetch(async (call) => {
      if (call.method === "simulateTransaction") throw new Error("private provider failure");
      return normal(call);
    });
    const response = await participant();
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private provider failure");
    unchanged();
  });
  it.each([
    ["no diagnostics", () => refusal([])],
    [
      "malformed diagnostic marker",
      () =>
        refusal([
          rootCall(),
          event(undefined, [xdr.ScVal.scvU32(7)]),
          event(contract, guardTopics()),
        ]),
    ],
    ["missing root call", () => refusal([event(contract, guardTopics())])],
    ["wrong root target", () => refusal([rootCall(asset), event(contract, guardTopics())])],
    [
      "wrong method",
      () => refusal([rootCall(contract, "unsubscribe"), event(contract, guardTopics())]),
    ],
    [
      "nonempty args",
      () =>
        refusal([
          rootCall(contract, "subscribe", xdr.ScVal.scvVec([xdr.ScVal.scvU32(1)])),
          event(contract, guardTopics()),
        ]),
    ],
    [
      "unfamiliar empty vector args",
      () =>
        refusal([
          rootCall(contract, "subscribe", xdr.ScVal.scvVec([])),
          event(contract, guardTopics()),
        ]),
    ],
    [
      "successful-only root call",
      () =>
        refusal([
          rootCall(contract, "subscribe", xdr.ScVal.scvVoid(), true),
          event(contract, guardTopics()),
        ]),
    ],
    [
      "successful-only guard",
      () => refusal([rootCall(), event(contract, guardTopics(), xdr.ScVal.scvVoid(), true)]),
    ],
    ["unrelated origin", () => refusal([rootCall(), event(asset, guardTopics())])],
    [
      "nested propagated guard",
      () => refusal([rootCall(), event(asset, guardTopics()), event(contract, guardTopics())]),
    ],
    [
      "nested call with omitted nested error",
      () =>
        refusal([
          rootCall(),
          rootCall(asset, "transfer", xdr.ScVal.scvVoid(), false, contract),
          event(contract, guardTopics()),
        ]),
    ],
    [
      "anonymous error",
      () => refusal([rootCall(), event(undefined, guardTopics()), event(contract, guardTopics())]),
    ],
    ["top-level code mismatch", () => refusal(undefined, 5)],
    ["target code mismatch", () => refusal([rootCall(), event(contract, guardTopics(5))])],
    [
      "non-contract error",
      () =>
        refusal([
          rootCall(),
          event(contract, [
            xdr.ScVal.scvSymbol("error"),
            xdr.ScVal.scvError(xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction())),
          ]),
        ]),
    ],
    [
      "malformed error topic",
      () =>
        refusal([rootCall(), event(contract, [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvU32(7)])]),
    ],
    [
      "duplicate root calls",
      () => refusal([rootCall(), rootCall(), event(contract, guardTopics())]),
    ],
    ["malformed encoded diagnostics", () => refusal(["invalid-base64"])],
    ["malformed diagnostic collection", () => ({ ...refusal(), events: {} })],
    ["bare numeric string", () => ({ ...refusal(), error: "Error(Contract, #7)" })],
  ] as const)("retains upstream502 for %s", async (_name, simulation) => {
    serve(simulation());
    const response = await participant();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("UPSTREAM_RPC");
    unchanged();
  });
  it("does not classify subscribe diagnostics on the unsubscribe builder", async () => {
    serve(refusal());
    const response = await ownerCancel(
      new Request("https://paiflow.test/subscription-unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userAddress: wallet }),
      }) as NextRequest,
      { params: Promise.resolve({ id: deployment.id }) },
    );
    expect(response.status).toBe(502);
    unchanged();
  });
});
