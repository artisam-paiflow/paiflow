import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  read: vi.fn(),
  reconcile: vi.fn(),
  submit: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRelayerAddress: () => undefined,
  stellarRpcUrl: () => "https://rpc.invalid",
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(),
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/api/v1/control-intent", () => ({
  createControlIntent: m.create,
  readControlIntent: m.read,
  reconcileControlIntent: m.reconcile,
  parseControlTransaction: (value: string) => TransactionBuilder.fromXDR(value, Networks.TESTNET),
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: m.submit }));
vi.mock("@/lib/api/request-history/context", () => ({ linkApiTransaction: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { warn: m.warn } }));
import { readScheduleState } from "@/lib/stellar/schedule-state";
import { readStreamerConfig } from "@/lib/stellar/streamer-config";
import {
  prepareScheduleControl,
  submitScheduleControl,
  reconcileScheduleControl,
} from "@/lib/api/v1/schedule";
import { discoverFunding, prepareFunding, assertFundingEligible } from "@/lib/api/v1/funding";
import { sorobanRpc, STELLAR_HTTP_TIMEOUT_MS } from "@/lib/stellar/client";
import {
  interactiveRpcBudget,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { SimulationError } from "@/lib/stellar/sim-error";
import { paymentAccountResponse } from "./payment-account-fixture";

const wallet = Keypair.random().publicKey();
const other = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const id = "11111111-1111-4111-8111-111111111111";
const deployment = {
  id,
  status: "CONFIRMED",
  network: "testnet",
  sourceAccount: wallet,
  pipelineSnapshot: [{ nodeId: "schedule", templateKind: "STREAMER", contractAddress: contract }],
} as unknown as Deployment;
const fundingInput = { fromAddress: other, tokenContractAddress: asset, amountStroops: "10" };
let fault: string;
let delay: number;
let slowFirst: boolean;
let malformed: string;
let paused: boolean;
let negative: boolean;
let jumpBeforeIntent: boolean;
let simulationError: boolean;
let stateConfigReads: number;
let calls: string[];
let budgets: unknown[];
function configResponse(key: xdr.LedgerKey) {
  if (malformed === "null_entries") return { latestLedger: 1000, entries: null };
  if (malformed === "missing") return { latestLedger: 1000, entries: [] };
  const field = (name: string, value: string) =>
    new xdr.ScMapEntry({
      key: nativeToScVal([name], { type: ["symbol"] }),
      val: new Address(value).toScVal(),
    });
  const storage = [field("Admin", wallet), field("Asset", asset)];
  if (malformed === "duplicate") storage.push(field("Admin", other));
  const data = xdr.LedgerEntryData.contractData(
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
  );
  return {
    latestLedger: 1000,
    entries: [
      {
        key:
          malformed === "key"
            ? paymentAccountResponse(wallet).entries[0]!.key
            : key.toXDR("base64"),
        xdr: data.toXDR("base64"),
      },
    ],
  };
}
function prepare() {
  return prepareScheduleControl(deployment, "pause", { walletAddress: wallet });
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fault = "";
  delay = 0;
  slowFirst = false;
  malformed = "";
  paused = false;
  negative = false;
  jumpBeforeIntent = false;
  simulationError = false;
  stateConfigReads = 0;
  calls = [];
  budgets = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockImplementation(async () => {
    if (fault === "ledger")
      throw Object.assign(new Error("provider secret"), { code: "ECONNRESET" });
    return { sequence: 1000 } as Awaited<ReturnType<rpc.Server["getLatestLedger"]>>;
  });
  m.create.mockResolvedValue({
    intent: id,
    txHash: "a".repeat(64),
    expiresAt: "2026-10-20T12:00:00.000Z",
  });
  m.read.mockResolvedValue({
    nodeId: "schedule",
    contractAddress: contract,
    walletAddress: wallet,
  });
  m.reconcile.mockImplementation(async () => {
    expect(interactiveRpcBudget()).toBeDefined();
    return { id, txHash: "a".repeat(64), network: "testnet", state: "SUBMITTING" };
  });
  m.submit.mockImplementation(async (input) => {
    await input.assertEligible();
    // Durable claim/send is deliberately outside the expired eligibility context.
    expect(interactiveRpcBudget()).toBeUndefined();
    return { status: "UNKNOWN", txHash: "a".repeat(64), network: "testnet" };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string);
      budgets.push(interactiveRpcBudget());
      let stage = method;
      let fn = "";
      let key: xdr.LedgerKey | undefined;
      if (method === "getLedgerEntries") {
        key = xdr.LedgerKey.fromXDR(params.keys[0], "base64");
        stage = key.switch().name === "account" ? "account" : "config";
        if (stage === "config") stateConfigReads++;
      }
      if (method === "simulateTransaction") {
        const tx = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET);
        const op = tx.operations[0]!;
        if (op.type !== "invokeHostFunction") throw new Error("unexpected operation");
        fn = op.func.invokeContract().functionName().toString();
        stage = fn;
        expect(tx.signatures).toHaveLength(0);
      }
      calls.push(stage);
      if (delay || (slowFirst && calls.length === 1))
        await wait(slowFirst ? 11000 : delay, init.signal!);
      if (fault === stage || fault === "stall") {
        if (fault === "stall") await wait(100000, init.signal!);
        throw Object.assign(new Error("provider URL credentials and raw body"), {
          code: "ECONNRESET",
        });
      }
      let result: unknown;
      if (stage === "config") result = configResponse(key!);
      else if (stage === "account") {
        const address = Address.fromScAddress(
          xdr.ScAddress.scAddressTypeAccount(key!.account().accountId()),
        ).toString();
        result =
          malformed === "account"
            ? { latestLedger: 1000, entries: null }
            : paymentAccountResponse(address);
      } else if (method === "simulateTransaction") {
        if (simulationError && ["pause", "unpause", "retrieve_unvested", "top_up"].includes(fn))
          result = { latestLedger: 1000, error: "HostError: Error(Contract, #1)", events: [] };
        else {
          const value =
            fn === "is_paused"
              ? paused
              : fn === "pause_allowed" || fn === "retrieve_allowed"
                ? true
                : fn === "available"
                  ? negative
                    ? -9000000n
                    : 50n
                  : fn === "claimed"
                    ? 20n
                    : fn === "balance"
                      ? 100n
                      : undefined;
          result = {
            latestLedger: 1000,
            events: [],
            minResourceFee: "1000",
            transactionData: new SorobanDataBuilder().build().toXDR("base64"),
            results: [
              {
                auth: [],
                xdr: (value === undefined ? xdr.ScVal.scvVoid() : nativeToScVal(value)).toXDR(
                  "base64",
                ),
              },
            ],
          };
          if (jumpBeforeIntent && stateConfigReads === 2 && fn === "balance")
            vi.setSystemTime(Date.now() + 25001);
        }
      } else throw new Error(`Unexpected RPC mutation: ${method}`);
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Schedule interactive workflow through real SDK HTTP and builders", () => {
  it.each(["pause", "resume", "retrieve"] as const)(
    "prepares exact unsigned %s controls after live validation",
    async (action) => {
      paused = action !== "pause";
      const prepared = await prepareScheduleControl(deployment, action, { walletAddress: wallet });
      expect(prepared).toMatchObject({ action, walletAddress: wallet, contractAddress: contract });
      const tx = TransactionBuilder.fromXDR(prepared.unsignedXdr, Networks.TESTNET);
      expect(tx.signatures).toHaveLength(0);
      if (!(tx instanceof Transaction)) throw new Error("unexpected fee bump");
      expect(tx.source).toBe(wallet);
      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0]!;
      if (op.type !== "invokeHostFunction") throw new Error("unexpected operation");
      expect(op.func.invokeContract().functionName().toString()).toBe(
        { pause: "pause", resume: "unpause", retrieve: "retrieve_unvested" }[action],
      );
      if (action === "retrieve")
        expect(prepared).toMatchObject({
          recipient: wallet,
          estimatedAmountStroops: "50",
          tokenContractAddress: asset,
        });
    },
  );

  it("allows an eleven-second configuration read and shares one deadline through preparation", async () => {
    slowFirst = true;
    const promise = prepare();
    await vi.advanceTimersByTimeAsync(11001);
    await expect(promise).resolves.toMatchObject({ action: "pause", walletAddress: wallet });
    expect(budgets.length).toBeGreaterThan(10);
    expect(new Set(budgets).size).toBe(1);
    expect(budgets[0]).toBeDefined();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(sorobanRpc().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
  });
  it("bounds all read groups to twenty-five seconds rather than restarting per RPC", async () => {
    delay = 6000;
    const result = prepare();
    const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
    await vi.advanceTimersByTimeAsync(25000);
    await rejected;
    expect(m.create).not.toHaveBeenCalled();
  });
  it("checks expiry after the final eligibility read before reserving an intent", async () => {
    jumpBeforeIntent = true;
    await expect(prepare()).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([
    "config",
    "account",
    "is_paused",
    "pause_allowed",
    "retrieve_allowed",
    "available",
    "claimed",
    "balance",
    "pause",
    "ledger",
  ])("sanitizes %s transport failure without reserving an intent", async (stage) => {
    fault = stage;
    await expect(prepare()).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
    expect(m.create).not.toHaveBeenCalled();
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain("provider URL");
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain("raw body");
  });
  it.each(["null_entries", "missing", "duplicate", "key", "account"])(
    "fails closed on %s config/account response",
    async (shape) => {
      malformed = shape;
      await expect(prepare()).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(m.create).not.toHaveBeenCalled();
      expect(m.warn).toHaveBeenCalled();
    },
  );
  it("distinguishes missing entries from malformed upstream responses in safe diagnostics", async () => {
    malformed = "missing";
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(m.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "missing_entry" }),
      expect.any(String),
    );
    malformed = "null_entries";
    await expect(readStreamerConfig(contract)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(m.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "invalid_response" }),
      expect.any(String),
    );
  });
  it("retains genuine contract simulation errors", async () => {
    simulationError = true;
    await expect(prepare()).rejects.toBeInstanceOf(SimulationError);
    await expect(prepareFunding(deployment, fundingInput)).rejects.toBeInstanceOf(SimulationError);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["config", "account", "top_up", "ledger"])(
    "funding %s failure creates no intent and keeps provider text private",
    async (stage) => {
      fault = stage;
      await expect(prepareFunding(deployment, fundingInput)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(m.create).not.toHaveBeenCalled();
      expect(JSON.stringify(m.warn.mock.calls)).not.toContain("provider URL");
    },
  );
  it("keeps verified-controller authorization separate from consent to fund", async () => {
    await expect(
      prepareScheduleControl(deployment, "pause", { walletAddress: other }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prepareFunding(deployment, fundingInput)).resolves.toMatchObject({
      fromAddress: other,
      action: "schedule.fund",
    });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ walletAddress: other }));
  });
  it("does not clamp the observed negative contract value or authorize retrieval", async () => {
    negative = true;
    paused = true;
    await expect(readScheduleState(contract, wallet)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    await expect(
      prepareScheduleControl(deployment, "retrieve", { walletAddress: wallet }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(calls).not.toContain("retrieve_unvested");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("budgets funding discovery, preparation and pre-send eligibility", async () => {
    await expect(discoverFunding(deployment)).resolves.toMatchObject({
      nodes: [expect.objectContaining({ authorization: "funding_wallet" })],
    });
    await prepareFunding(deployment, fundingInput);
    await assertFundingEligible(deployment, id, "schedule.fund");
    expect(budgets.every(Boolean)).toBe(true);
  });
  it("shares a caller's existing deadline rather than opening a new allowance", async () => {
    await withInteractiveRpcBudget(async () => {
      const owner = interactiveRpcBudget();
      await discoverFunding(deployment);
      await readScheduleState(contract, wallet);
      expect(budgets.every((b) => b === owner)).toBe(true);
    });
  });
  it("closes eligibility budget before original-hash submission/finality recovery", async () => {
    await expect(
      submitScheduleControl({
        deployment,
        tokenId: id,
        action: "pause",
        intent: id,
        signedXdr: "signed",
        ip: "127.0.0.1",
      }),
    ).resolves.toMatchObject({ status: "UNKNOWN", txHash: "a".repeat(64) });
    expect(budgets.every(Boolean)).toBe(true);
    await expect(reconcileScheduleControl(deployment, "pause", id)).resolves.toMatchObject({
      state: "SUBMITTING",
      replacementAllowed: false,
    });
  });
});
