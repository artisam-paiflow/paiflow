import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const m = vi.hoisted(() => ({
  deployment: vi.fn(),
  intent: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  signed: vi.fn(),
  beforeSend: vi.fn(),
  status: vi.fn(),
  outcome: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findFirst: m.deployment },
    walletControlIntent: { findFirst: m.intent, updateMany: m.update },
    $transaction: async (work: (client: unknown) => Promise<unknown>) =>
      work({ walletControlIntent: { updateMany: m.update }, auditLog: { create: m.audit } }),
  },
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRelayerAddress: () => relayer,
  stellarRpcUrl: () => "https://rpc.invalid",
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: m.beforeSend,
  observeServiceTransaction: vi.fn(),
  lockDeployment: m.lock,
  withDeploymentWork: async (_id: string, _kind: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(),
  recordTransactionOutcome: m.outcome,
}));
vi.mock("@/lib/signed-tx", () => ({
  signedTransactionRow: () => ({}),
  insertSignedTransaction: m.signed,
}));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: m.status }));
vi.mock("@/lib/api/request-history/context", () => ({ linkApiTransaction: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1" }));
import {
  submitSubscriptionControl,
  reconcileSubscriptionControl,
} from "@/lib/api/v1/subscription-controls";
import { subscriptionAllowanceState } from "@/lib/subscription/state";
import { interactiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { errorResponse } from "@/lib/errors";
import { paymentAccountResponse } from "./payment-account-fixture";

const relayer = Keypair.random().publicKey();
const wallet = Keypair.random();
const other = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const id = "11111111-1111-4111-8111-111111111111";
const deployment = {
  id,
  status: "CONFIRMED",
  network: "testnet",
  flow: { name: "Club", templateKind: "SUBSCRIPTION" },
  pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: contract }],
  graphSnapshot: {
    nodes: [
      {
        id: "sub",
        type: "subscription",
        config: {
          subscriber: wallet.publicKey(),
          asset: { kind: "native" },
          amountPerPeriodStroops: "100",
        },
      },
    ],
    edges: [],
  },
} as unknown as Deployment;
let fail: string;
let malformed: boolean;
let missing: boolean;
let subscriber: string;
let cancelled: boolean;
let delay: number;
let methods: string[];
let tx: ReturnType<TransactionBuilder["build"]>;
let intent: Record<string, unknown>;
let budgets: unknown[];
let allowanceLookup: boolean;
let clockJump: boolean;
function submit() {
  return submitSubscriptionControl({
    deployment,
    action: "subscription.reactivate",
    intent: id,
    signedXdr: tx.toXDR(),
    tokenId: id,
    req: new Request("https://paiflow.test/subscription/submit"),
  });
}
function reconcile() {
  return reconcileSubscriptionControl(id, id, "subscription.reactivate");
}
async function status(work: () => Promise<unknown>) {
  try {
    await work();
    return 200;
  } catch (error) {
    return errorResponse(error).status;
  }
}
function noClaim() {
  expect(m.update).not.toHaveBeenCalled();
  expect(m.signed).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  expect(methods).not.toContain("sendTransaction");
}
beforeEach(() => {
  vi.clearAllMocks();
  clockJump = false;
  fail = "";
  malformed = false;
  missing = false;
  allowanceLookup = false;
  subscriber = wallet.publicKey();
  cancelled = true;
  delay = 0;
  methods = [];
  budgets = [];
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException("deadline", "TimeoutError")), ms);
    return c.signal;
  });
  tx = new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call("subscribe"))
    .setTimeout(180)
    .build();
  tx.sign(wallet);
  intent = {
    id,
    deploymentId: id,
    network: "testnet",
    action: "subscription.reactivate",
    state: "PREPARED",
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds!.maxTime,
    preparationLedger: 90,
    walletAddress: wallet.publicKey(),
    nodeId: "sub",
    contractAddress: contract,
  };
  m.deployment.mockResolvedValue(deployment);
  m.intent.mockImplementation(async () => intent);
  m.lock.mockResolvedValue({ serviceState: "ACTIVE" });
  m.update.mockImplementation(async () => {
    intent.state = "SUBMITTING";
    return { count: 1 };
  });
  m.status.mockResolvedValue({ status: "UNKNOWN", txHash: intent.txHash, network: "testnet" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string);
      methods.push(method);
      budgets.push(interactiveRpcBudget());
      let fn = "";
      if (method === "simulateTransaction") {
        const op = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET).operations[0]!;
        if (op.type !== "invokeHostFunction") throw new Error("unexpected operation");
        fn = op.func.invokeContract().functionName().toString();
      }
      if (delay)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          init.signal!.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(init.signal!.reason);
            },
            { once: true },
          );
        });
      if (
        fail === method ||
        (fail !== "" && fail === fn) ||
        (fail === "allowance-account" && method === "getLedgerEntries" && allowanceLookup)
      )
        throw Object.assign(new Error("secret provider URL/body"), { code: "ECONNRESET" });
      if (fail === "stall" || (fail === "stall-latest" && method === "getLatestLedger"))
        return new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        });
      let result: unknown;
      if (method === "getLedgerEntries")
        result = malformed
          ? { latestLedger: 1000, entries: null }
          : missing
            ? { latestLedger: 1000, entries: [] }
            : paymentAccountResponse(relayer);
      else if (method === "sendTransaction")
        result = {
          status: "PENDING",
          hash: intent.txHash,
          latestLedger: 1000,
          latestLedgerCloseTime: "1000",
        };
      else if (method === "getTransaction")
        result = {
          status: "NOT_FOUND",
          latestLedger: 100,
          oldestLedger: 80,
          latestLedgerCloseTime: "1001",
          oldestLedgerCloseTime: "800",
        };
      else if (method === "getLatestLedger") result = { sequence: 100 };
      else {
        if (fn === "is_cancelled") {
          allowanceLookup = true;
          if (clockJump) vi.setSystemTime(Date.now() + 25_001);
        }
        const value =
          fn === "subscriber"
            ? new Address(subscriber).toScVal()
            : fn === "asset"
              ? new Address(asset).toScVal()
              : fn === "allowance"
                ? nativeToScVal(5n, { type: "i128" })
                : nativeToScVal(cancelled);
        result = {
          latestLedger: 1000,
          events: [],
          results: [{ auth: [], xdr: value.toXDR("base64") }],
        };
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Subscription interactive reads through the real SDK HTTP client", () => {
  it.each([
    "getLedgerEntries",
    "subscriber",
    "asset",
    "is_cancelled",
    "allowance",
    "allowance-account",
  ])("state %s transport failure returns sanitized502", async (fault) => {
    fail = fault;
    try {
      await subscriptionAllowanceState(id);
      throw new Error("expected failure");
    } catch (error) {
      const response = errorResponse(error);
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    }
    noClaim();
  });
  it.each(["getLedgerEntries", "subscriber", "asset", "is_cancelled"])(
    "submit %s transport failure preserves PREPARED without claim/send",
    async (fault) => {
      fail = fault;
      expect(await status(submit)).toBe(502);
      expect(intent.state).toBe("PREPARED");
      noClaim();
    },
  );
  it.each(["state", "submit"])(
    "malformed null account entries are502 rather than false402 during %s",
    async (path) => {
      malformed = true;
      expect(await status(path === "state" ? () => subscriptionAllowanceState(id) : submit)).toBe(
        502,
      );
      noClaim();
    },
  );
  it.each(["state", "submit"])(
    "successful empty account response preserves genuine402 during %s",
    async (path) => {
      missing = true;
      expect(await status(path === "state" ? () => subscriptionAllowanceState(id) : submit)).toBe(
        402,
      );
      noClaim();
    },
  );
  it.each(["state", "submit", "reconcile"])(
    "%s exhausts one25second deadline without releasing or claiming intent",
    async (path) => {
      fail = "stall";
      const result = status(
        path === "state"
          ? () => subscriptionAllowanceState(id)
          : path === "submit"
            ? submit
            : reconcile,
      );
      await vi.advanceTimersByTimeAsync(24_999);
      noClaim();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(502);
      expect(intent.state).toBe("PREPARED");
      noClaim();
    },
  );
  it("state shares one deadline across configuration and allowance, allowing healthy work beyond10seconds", async () => {
    delay = 3000;
    const result = subscriptionAllowanceState(id);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toMatchObject({ allowance: "5" });
    expect(budgets).toHaveLength(8);
    expect(new Set(budgets).size).toBe(1);
    expect(budgets[0]).toBeDefined();
    noClaim();
  });
  it("state allowance exhausts the original aggregate deadline after healthy configuration reads", async () => {
    delay = 7000;
    const result = status(() => subscriptionAllowanceState(id));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toBe(502);
    expect(methods.filter((method) => method === "simulateTransaction")).toHaveLength(4);
    expect(new Set(budgets).size).toBe(1);
    noClaim();
  });
  it("refuses a durable submission claim if successful eligibility consumes the deadline", async () => {
    clockJump = true;
    expect(await status(submit)).toBe(502);
    expect(intent.state).toBe("PREPARED");
    noClaim();
  });
  it("reconcile shares its original deadline across partial history reads", async () => {
    delay = 7000;
    fail = "stall-latest";
    const result = status(reconcile);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toBe(502);
    expect(methods.filter((method) => method === "getTransaction")).toHaveLength(2);
    expect(methods).toContain("getLatestLedger");
    expect(new Set(budgets).size).toBe(1);
    noClaim();
  });
  it("closes pre-send budget before durable claim and send, and samehash retries never send again", async () => {
    m.beforeSend.mockImplementation(async () => {
      expect(interactiveRpcBudget()).toBeUndefined();
    });
    expect((await submit()).status).toBe("PENDING");
    expect(methods.filter((method) => method === "sendTransaction")).toHaveLength(1);
    expect(budgets.at(-1)).toBeUndefined();
    methods = [];
    fail = "getLedgerEntries";
    expect((await submit()).status).toBe("UNKNOWN");
    expect(methods).toEqual([]);
  });
  it("send uncertainty retains SUBMITTING and original hash without rebroadcast", async () => {
    fail = "sendTransaction";
    expect(await submit()).toMatchObject({ status: "UNKNOWN", txHash: intent.txHash });
    expect(intent.state).toBe("SUBMITTING");
    methods = [];
    expect((await submit()).status).toBe("UNKNOWN");
    expect(methods).toEqual([]);
  });
  it.each([
    ["subscriber", 403],
    ["cancelled", 409],
  ] as const)(
    "preserves real %s eligibility rejection before durable claim",
    async (kind, expected) => {
      if (kind === "subscriber") subscriber = other;
      else cancelled = false;
      expect(await status(submit)).toBe(expected);
      noClaim();
    },
  );
  it("reconciliation history failure retains reservation after partial evidence reads", async () => {
    fail = "getLatestLedger";
    expect(await status(reconcile)).toBe(502);
    expect(methods.filter((method) => method === "getTransaction")).toHaveLength(2);
    expect(new Set(budgets).size).toBe(1);
    noClaim();
  });
});
