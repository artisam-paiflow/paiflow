import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  flow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarHorizonUrl: () => "https://horizon.invalid",
  stellarRelayerAddress: () => undefined,
}));
vi.mock("@/lib/db", () => ({
  db: {
    flow: { findFirst: mocks.flow },
    deployment: { create: mocks.create, update: mocks.update },
  },
}));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ id: "user" }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/log", () => ({ log: { warn: mocks.warn, error: mocks.error } }));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(),
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: async () => StrKey.encodeContract(Buffer.alloc(32, 1)),
  getWasmHashes: async () =>
    new Map(["DEPOSIT_TRIGGER", "PAYER"].map((kind) => [kind, "a".repeat(64)])),
}));
import { POST } from "@/app/api/deployments/prepare/route";
import { horizon, sorobanRpc } from "@/lib/stellar/client";
import {
  interactiveRpcBudget,
  remainingInteractiveRpcMs,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { paymentAccountResponse } from "./payment-account-fixture";

const wallet = Keypair.random().publicKey();
const flowId = "11111111-1111-4111-8111-111111111111";
const graph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "p",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: wallet,
        fullAmount: true,
        mode: "fixed",
        amountStroops: "100",
      },
    },
  ],
  edges: [{ id: "tp", source: "t", target: "p" }],
};
const simulation = () => ({
  latestLedger: 1000,
  minResourceFee: "1000",
  transactionData: new SorobanDataBuilder().build().toXDR("base64"),
  results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
  events: [],
});
type Stage = "funding" | "account" | "simulation";
let calls: Stage[];
let handle: (stage: Stage, init: RequestInit) => Promise<Response | undefined>;
function stalled(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) =>
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }),
  );
}
const request = () =>
  POST({ json: async () => ({ flowId, sourceAccount: wallet }) } as NextRequest);
function noPreparation() {
  expect(
    mocks.update.mock.calls.every(
      ([arg]) => arg.data.unsignedXdr === undefined && arg.data.deployTxHash === undefined,
    ),
  ).toBe(true);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(calls.every((stage) => ["funding", "account", "simulation"].includes(stage))).toBe(true);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  calls = [];
  handle = async () => undefined;
  mocks.flow.mockResolvedValue({ id: flowId, graph });
  mocks.create.mockResolvedValue({ id: "deployment" });
  mocks.update.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit) => {
      const funding = String(input).startsWith("https://horizon.invalid");
      const method = funding ? undefined : JSON.parse(init.body as string).method;
      if (!funding && !["getLedgerEntries", "simulateTransaction"].includes(method))
        throw new Error(`Unexpected mutation ${method}`);
      const stage: Stage = funding
        ? "funding"
        : method === "getLedgerEntries"
          ? "account"
          : "simulation";
      calls.push(stage);
      const custom = await handle(stage, init);
      if (custom) return custom;
      return funding
        ? Response.json({
            account_id: wallet,
            sequence: "41",
            balances: [{ asset_type: "native", balance: "100.0000000" }],
          })
        : Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: stage === "account" ? paymentAccountResponse(wallet) : simulation(),
          });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each<Stage>(["funding", "account", "simulation"])(
  "aborts stalled %s at 25 seconds, sanitizes 502 and persists no preparation",
  async (target) => {
    handle = async (stage, init) => (stage === target ? stalled(init) : undefined);
    const result = request();
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await result;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "UPSTREAM_RPC", message: expect.stringContaining("try preparing again") },
    });
    noPreparation();
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: target,
        category: "deadline",
        ...(target === "funding" ? {} : { deploymentId: "deployment" }),
      }),
      expect.any(String),
    );
    expect(mocks.create).toHaveBeenCalledTimes(target === "funding" ? 0 : 1);
  },
);

it.each<Stage>(["funding", "account", "simulation"])(
  "sanitizes a %s transport failure and permits one explicit unsigned retry",
  async (target) => {
    handle = async (stage) => {
      if (stage === target)
        throw new TypeError("fetch failed", { cause: new Error("private upstream payload") });
      return undefined;
    };
    const failed = await request();
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("private upstream");
    noPreparation();
    handle = async () => undefined;
    const retried = await request();
    expect(retried.status).toBe(200);
    const result = await retried.json();
    expect(
      TransactionBuilder.fromXDR(result.data.xdr, "Test SDF Network ; September 2015").signatures,
    ).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledOnce();
  },
);

it("shares one deadline across Horizon, DB bookkeeping, account and simulation, with success beyond ten seconds", async () => {
  const budgets: unknown[] = [];
  const remaining: number[] = [];
  handle = async () => {
    budgets.push(interactiveRpcBudget());
    remaining.push(remainingInteractiveRpcMs());
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    return undefined;
  };
  const result = request();
  await vi.advanceTimersByTimeAsync(18_000);
  expect((await result).status).toBe(200);
  expect(remaining).toEqual([25_000, 19_000, 13_000]);
  expect(budgets.every((budget) => budget !== undefined && budget === budgets[0])).toBe(true);
  expect(horizon().httpClient.defaults.timeout).toBe(10_000);
  expect(sorobanRpc().httpClient.defaults.timeout).toBe(10_000);
});

it("allows a single Horizon funding response beyond ten seconds without changing concurrent background defaults", async () => {
  const shared = horizon();
  handle = async (stage, init) => {
    if (stage === "funding") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 16_000);
        init.signal!.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(init.signal!.reason);
          },
          { once: true },
        );
      });
    }
    return undefined;
  };
  const foreground = request();
  const background = expect(shared.loadAccount(wallet)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(16_000);
  await background;
  expect((await foreground).status).toBe(200);
  expect(shared.httpClient.defaults.timeout).toBe(10_000);
});

it("does not reset the budget after funding or nested preparation", async () => {
  handle = async (stage, init) => {
    if (stage === "funding") await new Promise((resolve) => setTimeout(resolve, 16_000));
    if (stage === "simulation") return stalled(init);
    return undefined;
  };
  const result = withInteractiveRpcBudget(request);
  await vi.advanceTimersByTimeAsync(25_000);
  expect((await result).status).toBe(502);
  expect(calls).toEqual(["funding", "account", "simulation"]);
  noPreparation();
});

it("does not dispatch account lookup after durable creation consumes the deadline", async () => {
  mocks.create.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    return { id: "deployment" };
  });
  const result = request();
  await vi.advanceTimersByTimeAsync(25_000);
  expect((await result).status).toBe(502);
  expect(calls).toEqual(["funding"]);
  noPreparation();
});

it("does not persist unsigned XDR when simulation returns after the deadline", async () => {
  handle = async (stage) => {
    if (stage === "simulation") vi.setSystemTime(Date.now() + 25_000);
    return undefined;
  };
  expect((await request()).status).toBe(502);
  noPreparation();
});

it.each(["funding", "account"] as const)(
  "preserves genuine missing-account funding guidance at %s",
  async (target) => {
    handle = async (stage) =>
      stage !== target
        ? undefined
        : target === "funding"
          ? Response.json({ title: "Resource Missing", status: 404 }, { status: 404 })
          : Response.json({ jsonrpc: "2.0", id: 1, result: { latestLedger: 1000, entries: [] } });
    const response = await request();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: { code: "INSUFFICIENT_FUNDS" } });
    noPreparation();
  },
);

it("preserves actual insufficient funding", async () => {
  handle = async (stage) =>
    stage === "funding"
      ? Response.json({
          account_id: wallet,
          sequence: "1",
          balances: [{ asset_type: "native", balance: "1.0000000" }],
        })
      : undefined;
  expect((await request()).status).toBe(402);
  noPreparation();
});

it("preserves a real contract rejection and diagnostic details", async () => {
  handle = async (stage) =>
    stage === "simulation"
      ? Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { error: "Error(Contract, #1)", latestLedger: 1000, events: [] },
        })
      : undefined;
  const response = await request();
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    error: { details: expect.stringContaining("Error(Contract, #1)") },
  });
  noPreparation();
  expect(mocks.warn).not.toHaveBeenCalled();
});

it.each(["create", "update", "audit"] as const)(
  "does not relabel %s database/audit errors as RPC failures",
  async (operation) => {
    mocks[operation].mockRejectedValueOnce(
      Object.assign(new Error("database offline"), { code: "P1001" }),
    );
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(mocks.warn).not.toHaveBeenCalled();
  },
);

it("does not relabel a simulation programming error as a network failure", async () => {
  handle = async (stage) => {
    if (stage === "simulation") throw new TypeError("unexpected implementation failure");
    return undefined;
  };
  expect((await request()).status).toBe(500);
  noPreparation();
  expect(mocks.warn).not.toHaveBeenCalled();
});

it.each([429, 503])(
  "sanitizes real SDK HTTP %s errors at funding and simulation",
  async (status) => {
    for (const target of ["funding", "simulation"] as const) {
      handle = async (stage) =>
        stage === target
          ? Response.json({ status, detail: "private provider body" }, { status })
          : undefined;
      const response = await request();
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("private provider body");
      noPreparation();
    }
  },
);

it("classifies SDK bounded-adapter timeout text without exposing its raw diagnostics", async () => {
  const result = withInteractiveRpcBudget(async () => {
    // SDK16 selects its bounded adapter when maxContentLength is configured.
    horizon().httpClient.defaults.maxContentLength = 1_000_000;
    handle = async (stage, init) => (stage === "funding" ? stalled(init) : undefined);
    return request();
  });
  await vi.advanceTimersByTimeAsync(25_000);
  expect((await result).status).toBe(502);
  noPreparation();
});

it("treats a malformed account ledger response as upstream, never as unfunded", async () => {
  handle = async (stage) =>
    stage === "account"
      ? Response.json({ jsonrpc: "2.0", id: 1, result: { latestLedger: 1000, entries: null } })
      : undefined;
  const response = await request();
  expect(response.status).toBe(502);
  noPreparation();
});

it("classifies bounded-adapter plain timeout before the aggregate deadline expires", async () => {
  const result = withInteractiveRpcBudget(async () => {
    const client = horizon().httpClient;
    client.defaults.maxContentLength = 1_000_000;
    client.interceptors.request.use((config) => ({ ...config, timeout: 1_000 }));
    handle = async (stage, init) => (stage === "funding" ? stalled(init) : undefined);
    const response = await request();
    expect(remainingInteractiveRpcMs()).toBe(24_000);
    return response;
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await result).status).toBe(502);
  expect(mocks.warn).toHaveBeenCalledWith(
    expect.objectContaining({ stage: "funding", category: "upstream" }),
    expect.any(String),
  );
  noPreparation();
});
