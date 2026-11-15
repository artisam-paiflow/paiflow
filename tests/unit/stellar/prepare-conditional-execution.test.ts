import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarRelayerAddress: () => undefined,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(),
  observeServiceTransaction: vi.fn(),
}));
const logging = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: logging }));

import { prepareConditionalExecutionTransaction as prepareExecutionTransaction } from "@/lib/stellar/prepare-conditional-execution";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { paymentAccountResponse } from "./payment-account-fixture";
import { conditionalAcceptanceIntent } from "@/tests/fixtures/conditional-v2-acceptance";

const execution = conditionalAcceptanceIntent();
const simulation = () => ({
  id: "1",
  latestLedger: 100,
  minResourceFee: "1000",
  transactionData: new SorobanDataBuilder().setResourceFee("1000").build().toXDR("base64"),
  results: [{ xdr: xdr.ScVal.scvVoid().toXDR("base64"), auth: [] }],
  events: [],
});

function serve(accountMs: number, simulationMs: number) {
  const fetch = vi.fn((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { method: string };
    const account = body.method === "getLedgerEntries";
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve(
            Response.json({
              jsonrpc: "2.0",
              id: 1,
              result: account ? paymentAccountResponse(execution.payer, "22") : simulation(),
            }),
          ),
        account ? accountMs : simulationMs,
      );
      init?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        },
        { once: true },
      );
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("conditional payment preparation with the real SDK HTTP deadline", () => {
  it("loads the payer, simulates and assembles the exact payer source with finite expiry", async () => {
    const fetch = serve(5_000, 7_000);
    const result = withInteractiveRpcBudget(() => prepareExecutionTransaction(execution));
    await vi.advanceTimersByTimeAsync(12_000);
    const tx = TransactionBuilder.fromXDR((await result).xdr, Networks.TESTNET);
    if (!(tx instanceof Transaction)) throw new Error("Expected a transaction envelope");
    expect(tx.source).toBe(execution.payer);
    const operation = tx.operations[0]!;
    if (operation.type !== "invokeHostFunction") throw new Error("Contract call expected");
    const invocation = operation.func.invokeContract();
    expect(invocation.functionName().toString()).toBe("execute_v2");
    expect(invocation.args().map((arg) => arg.toXDR("hex"))).toEqual(
      executionV2Args(execution).map((arg) => arg.toXDR("hex")),
    );
    expect(invocation.args()).toHaveLength(8);
    expect(tx.signatures).toHaveLength(0);
    expect(tx.sequence).toBe("23");
    expect(tx.fee).toBe("1100");
    expect(Number(tx.timeBounds!.maxTime)).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logging.info).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "payment.account", elapsedMs: 5_000 }),
      expect.any(String),
    );
    expect(logging.info).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "payment.simulation", elapsedMs: 7_000 }),
      expect.any(String),
    );
  });
  it("reuses the prefetched payer sequence and never loads a second account", async () => {
    const fetch = serve(50_000, 7_000);
    const result = withInteractiveRpcBudget(() =>
      prepareExecutionTransaction(execution, new Account(execution.payer, "30")),
    );
    await vi.advanceTimersByTimeAsync(7_000);
    const tx = TransactionBuilder.fromXDR((await result).xdr, Networks.TESTNET);
    if (!(tx instanceof Transaction)) throw new Error("Expected a transaction envelope");
    expect(tx.sequence).toBe("31");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logging.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ phase: "payment.account" }),
      expect.any(String),
    );
  });
  it("rejects a prefetched account for another payer before any RPC", async () => {
    const fetch = serve(0, 0);
    await expect(
      prepareExecutionTransaction(execution, new Account(Keypair.random().publicKey(), "30")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["account", "simulation"] as const)(
    "classifies a %s deadline without exposing RPC payloads",
    async (phase) => {
      const fetch = serve(phase === "account" ? 50_000 : 8_000, 50_000);
      const result = withInteractiveRpcBudget(() => prepareExecutionTransaction(execution));
      const refused = expect(result).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(25_000);
      await refused;
      expect(fetch).toHaveBeenCalledTimes(phase === "account" ? 1 : 2);
      expect(logging.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: `payment.${phase}`,
          outcome: "failure",
          category: "deadline",
          remainingRpcMs: 0,
        }),
        expect.any(String),
      );
      const fields = logging.warn.mock.calls[0]![0];
      expect(Object.keys(fields).sort()).toEqual([
        "attempt",
        "category",
        "deploymentId",
        "elapsedMs",
        "outcome",
        "phase",
        "remainingRpcMs",
      ]);
    },
  );
});
