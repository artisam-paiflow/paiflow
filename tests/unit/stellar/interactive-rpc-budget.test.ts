import { Account, Asset, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarRelayerAddress: () => undefined,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));

import { beforeServiceSubmission } from "@/lib/deployments/service-work";
import { sorobanRpc, STELLAR_HTTP_TIMEOUT_MS } from "@/lib/stellar/client";
import {
  interactiveRpcBudget,
  remainingInteractiveRpcMs,
  withIndependentEventRpcBudget,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";

function delayedHealth(ms: number, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ result: { status: "healthy" } })), ms);
    init?.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      },
      { once: true },
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Exercise the real SDK HTTP client's cancellation with a controlled clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("interactive RPC operation budget", () => {
  it("allows a16-second HTTP response without extending the shared background timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => delayedHealth(16_000, init)),
    );
    const result = withInteractiveRpcBudget(() => sorobanRpc().getHealth());
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(result).resolves.toEqual({ status: "healthy" });
    expect(sorobanRpc().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
  });

  it("cancels a second HTTP call at the operation deadline, using only the remaining9 seconds", async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url, init: RequestInit) => {
      signals.push(init.signal!);
      return delayedHealth(fetch.mock.calls.length === 1 ? 16_000 : 50_000, init);
    });
    vi.stubGlobal("fetch", fetch);
    const start = Date.now();
    const result = withInteractiveRpcBudget(async () => {
      await sorobanRpc().getHealth();
      expect(remainingInteractiveRpcMs()).toBe(9_000);
      return sorobanRpc().getHealth();
    });
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(Date.now() - start).toBe(25_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("does not dispatch another HTTP request after bookkeeping consumed the budget", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = withInteractiveRpcBudget(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      return sorobanRpc().getHealth();
    });
    const rejected = expect(result).rejects.toThrow(/budget exhausted/);
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(fetch).not.toHaveBeenCalled();
  });

  it("isolates concurrent interactive and cron clients without mutating shared defaults", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => delayedHealth(16_000, init)),
    );
    const shared = sorobanRpc();
    let interactive: unknown;
    const foreground = withInteractiveRpcBudget(() => {
      interactive = sorobanRpc();
      return sorobanRpc().getHealth();
    });
    const background = expect(shared.getHealth()).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await background;
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(foreground).resolves.toEqual({ status: "healthy" });
    expect(interactive).not.toBe(shared);
    expect(shared.httpClient.defaults.timeout).toBe(10_000);
  });

  it("finishes durable admission after expiry but sends no bytes once the budget is gone", async () => {
    const source = "GAFKWKNKHQANHIDR4RE45FGDOUF352NYVKIYN7OGD2PQAAPQ7RPYFD2I";
    const tx = new TransactionBuilder(new Account(source, "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: source, asset: Asset.native(), amount: "1" }))
      .setTimeout(180)
      .build();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(beforeServiceSubmission).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 26_000));
    });
    const result = withInteractiveRpcBudget(() => sorobanRpc().sendTransaction(tx));
    const rejected = expect(result).rejects.toThrow(/budget exhausted/);
    await vi.advanceTimersByTimeAsync(26_000);
    await rejected;
    expect(beforeServiceSubmission).toHaveBeenCalledWith(tx.hash().toString("hex"), "rpc");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps concurrent interactive callers' clients and deadlines separate", async () => {
    const clients: unknown[] = [];
    const fetch = vi.fn((_url, init: RequestInit) =>
      delayedHealth(fetch.mock.calls.length === 1 ? 50_000 : 16_000, init),
    );
    vi.stubGlobal("fetch", fetch);
    const first = withInteractiveRpcBudget(() => {
      clients.push(sorobanRpc());
      return sorobanRpc().getHealth();
    });
    const failedFirst = expect(first).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    const second = withInteractiveRpcBudget(() => {
      clients.push(sorobanRpc());
      return sorobanRpc().getHealth();
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await failedFirst;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(second).resolves.toEqual({ status: "healthy" });
    expect(clients[0]).not.toBe(clients[1]);
  });

  it("does not give an event worker a fresh25 seconds after earlier RPC work", async () => {
    let event!: Promise<unknown>;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => delayedHealth(16_000, init)),
    );
    await withInteractiveRpcBudget(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      event = withIndependentEventRpcBudget(() => sorobanRpc().getHealth());
    });
    const rejected = expect(event).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
  });

  it("does not reset a nested operation deadline", async () => {
    await withInteractiveRpcBudget(async () => {
      const budget = interactiveRpcBudget();
      await vi.advanceTimersByTimeAsync(10_000);
      await withInteractiveRpcBudget(async () => {
        expect(interactiveRpcBudget()).toBe(budget);
        expect(remainingInteractiveRpcMs()).toBe(15_000);
      });
    });
  });

  it("gives a shared event worker an explicit independent lifetime capped by the original deadline", async () => {
    let event!: Promise<unknown>;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => delayedHealth(16_000, init)),
    );
    await withInteractiveRpcBudget(async () => {
      const parent = interactiveRpcBudget();
      event = withIndependentEventRpcBudget(async () => {
        expect(interactiveRpcBudget()).not.toBe(parent);
        return sorobanRpc().getHealth();
      });
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(event).resolves.toEqual({ status: "healthy" });
  });
});
