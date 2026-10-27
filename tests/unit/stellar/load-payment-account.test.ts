import { Account, Keypair, xdr } from "@stellar/stellar-sdk";
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

import { prepareFailure } from "@/lib/api/v1/prepare-error";
import { sorobanRpc } from "@/lib/stellar/client";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { loadPaymentAccount, MissingPaymentAccountError } from "@/lib/stellar/load-payment-account";
import {
  prepareDepositInvocation,
  prepareDistributeInvocation,
  prepareStreamerTopUpInvocation,
  prepareWebhookDepositInvocation,
} from "@/lib/stellar/invoke";
import { paymentAccountResponse } from "./payment-account-fixture";

const source = "GAFKWKNKHQANHIDR4RE45FGDOUF352NYVKIYN7OGD2PQAAPQ7RPYFD2I";
const other = "GAYH6I4D6FQARJTZ4275YVFOBWBTIM6HHA6E3ZFKB5QTWN3LTN4WXOLJ";
const contract = "CABJVPT4T6DZ7D2U2YRFALPXJQ5YJC56UCDZGLUMELWREC74OPMDYFN4";

function rpcResult(result: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result })),
  );
}
function load() {
  return loadPaymentAccount(sorobanRpc(), source);
}
function stalledFetch(_url: unknown, options?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), {
      once: true,
    });
  });
}
beforeEach(() => {
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

describe("payment account lookup through the real SDK HTTP client", () => {
  it("preserves a funded account's exact string sequence beyond Number.MAX_SAFE_INTEGER", async () => {
    rpcResult(paymentAccountResponse(source, "9007199254740993"));
    const account = await load();
    expect(account).toBeInstanceOf(Account);
    expect(account.accountId()).toBe(source);
    expect(account.sequenceNumber()).toBe("9007199254740993");
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.method).toBe("getLedgerEntries");
    expect(body.params.keys).toHaveLength(1);
    expect(
      xdr.LedgerKey.fromXDR(body.params.keys[0], "base64").account().accountId().ed25519(),
    ).toEqual(Keypair.fromPublicKey(source).rawPublicKey());
  });

  it.each([{ latestLedger: 1000, entries: [] }, { latestLedger: 1000 }])(
    "only successful empty or omitted entries prove absence: %j",
    async (result) => {
      rpcResult(result);
      const error = await load().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(MissingPaymentAccountError);
      expect(prepareFailure(error)).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
      expect(prepareFailure(error).message).toContain("must be a funded account");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    undefined,
    null,
    {},
    { entries: [] },
    { latestLedger: "1000", entries: [] },
    { latestLedger: 0, entries: [] },
    { latestLedger: 1.5, entries: [] },
    { latestLedger: 0x1_0000_0000, entries: [] },
    { latestLedger: 1000, entries: null },
    { latestLedger: 1000, entries: {} },
    { latestLedger: 1000, entries: [null] },
    { latestLedger: 1000, entries: [{}] },
    { latestLedger: 1000, entries: [{ key: "invalid", xdr: "PRIVATE_BAD_XDR" }] },
    {
      latestLedger: 1000,
      entries: [{ key: paymentAccountResponse(source).entries[0]!.key, xdr: "PRIVATE_BAD_XDR" }],
    },
    {
      latestLedger: 1000,
      entries: [
        ...paymentAccountResponse(source).entries,
        ...paymentAccountResponse(source).entries,
      ],
    },
  ])("malformed RPC result is upstream failure, never account absence: %j", async (result) => {
    rpcResult(result);
    const error = await load().catch((error: unknown) => error);
    expect(error).not.toBeInstanceOf(MissingPaymentAccountError);
    expect(error).toMatchObject({ code: "UPSTREAM_RPC" });
    expect(String(error)).not.toContain("PRIVATE_BAD_XDR");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unrelated keys, account identities, entry types and invalid sequences", async () => {
    const valid = paymentAccountResponse(source);
    const different = paymentAccountResponse(other);
    const data = xdr.LedgerEntryData.data(
      new xdr.DataEntry({
        accountId: Keypair.fromPublicKey(source).xdrPublicKey(),
        dataName: "wrong-type",
        dataValue: Buffer.alloc(0),
        ext: new xdr.DataEntryExt(0),
      }),
    ).toXDR("base64");
    for (const entry of [
      different.entries[0],
      { ...valid.entries[0], xdr: different.entries[0]!.xdr },
      { ...valid.entries[0], xdr: data },
      paymentAccountResponse(source, "-1").entries[0],
    ]) {
      rpcResult({ latestLedger: 1000, entries: [entry] });
      await expect(load()).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["ECONNABORTED", "ECONNRESET", "ERR_CANCELED"])(
    "does not translate transport %s into account absence or expose its HTTP config",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw Object.assign(new Error("PRIVATE_DIAGNOSTICS"), {
            code,
            config: { data: "PRIVATE_BODY" },
          });
        }),
      );
      const error = await load().catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "UPSTREAM_RPC" });
      expect(String(error)).not.toContain("PRIVATE_");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    () => Response.json({ error: "PRIVATE_ERROR" }, { status: 500 }),
    () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "PRIVATE_RPC_ERROR" },
      }),
    () => new Response("PRIVATE_INVALID_JSON"),
  ])(
    "HTTP, JSON-RPC and invalid JSON failures remain sanitized upstream errors",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response()),
      );
      const error = await load().catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "UPSTREAM_RPC" });
      expect(String(error)).not.toContain("PRIVATE_");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("turns the standalone ten-second HTTP timeout into an upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn(stalledFetch));
    const result = load();
    const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses only the five seconds left in an interactive budget, without retrying", async () => {
    vi.stubGlobal("fetch", vi.fn(stalledFetch));
    const start = Date.now();
    const result = withInteractiveRpcBudget(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return load();
    });
    const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await vi.advanceTimersByTimeAsync(25000);
    await rejected;
    expect(Date.now() - start).toBe(25000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("can load a genuine funded response after 16 seconds within PR1's shared budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(Response.json({ result: paymentAccountResponse(source) })),
              16000,
            );
          }),
      ),
    );
    const result = withInteractiveRpcBudget(load);
    await vi.advanceTimersByTimeAsync(16000);
    expect((await result).sequenceNumber()).toBe("41");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("customer payment preparation paths", () => {
  const options = {
    contractAddress: contract,
    amount: "100",
    invokerAddress: source,
    from: source,
  };
  for (const [name, prepare] of [
    ["deposit", prepareDepositInvocation],
    ["legacy distribute", prepareDistributeInvocation],
    ["webhook deposit", prepareWebhookDepositInvocation],
    ["schedule top-up", prepareStreamerTopUpInvocation],
  ] as const) {
    it(`${name} preserves a proven missing-account error before any simulation`, async () => {
      rpcResult({ latestLedger: 1000, entries: [] });
      await expect(prepare(options)).rejects.toBeInstanceOf(MissingPaymentAccountError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it(`${name} reports transport failure as upstream without simulation or retry`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Account not found: misleading SDK error");
        }),
      );
      await expect(prepare(options)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
});
