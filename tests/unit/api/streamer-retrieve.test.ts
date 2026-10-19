import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  server: { _getLedgerEntries: vi.fn(), simulateTransaction: vi.fn(), sendTransaction: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mocks.server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));

import { POST } from "@/app/api/deployments/[id]/invoke/route";
import { AppError } from "@/lib/errors";
import { paymentAccountResponse } from "../stellar/payment-account-fixture";

const streamer = StrKey.encodeContract(Buffer.alloc(32, 1));
const nested = StrKey.encodeContract(Buffer.alloc(32, 2));
const user = Keypair.random().publicKey();
const deploymentId = "11111111-1111-4111-8111-111111111111";
const pauseFirst = "The stream must be paused before unvested funds can be retrieved.";

function frame(contract: string | null, code = 10, successful = false) {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: successful,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: contract ? (StrKey.decodeContract(contract) as unknown as xdr.Hash) : null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
          data: xdr.ScVal.scvString("failing with contract error"),
        }),
      ),
    }),
  });
}

function failure(events = [frame(streamer)], error = "HostError: Error(Contract, #10)") {
  return { _parsed: true, id: "1", latestLedger: 1, events, error };
}

function malformedFrame() {
  const diagnostic = frame(streamer);
  diagnostic
    .event()
    .body()
    .v0()
    .topics([xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvVoid()]);
  return diagnostic;
}

function call(method = "retrieve_unvested") {
  const req = new Request(`https://paiflow.test/api/deployments/${deploymentId}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, contractAddress: streamer, userAddress: user }),
  }) as NextRequest;
  return POST(req, { params: Promise.resolve({ id: deploymentId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue({
    pipelineSnapshot: [{ templateKind: "STREAMER", contractAddress: streamer }],
    flow: {
      graph: {
        nodes: [
          {
            id: "schedule",
            type: "on_schedule",
            config: { retrieveAllowed: true, pauseAllowed: true },
          },
        ],
        edges: [],
      },
    },
  });
  mocks.server._getLedgerEntries.mockResolvedValue(paymentAccountResponse(user, "1"));
  mocks.server.simulateTransaction.mockResolvedValue(failure());
});

describe("Schedule retrieve preparation (#882)", () => {
  it("serializes the target Streamer's unpaused refusal as 409 with details, without signing or submitting", async () => {
    mocks.server.simulateTransaction.mockResolvedValue(failure([frame(streamer), frame(streamer)]));
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      code: "CONFLICT",
      message: pauseFirst,
      details: "Soroban simulate failed: HostError: Error(Contract, #10)",
    });
    const tx = mocks.server.simulateTransaction.mock.calls[0]![0];
    expect(tx.operations[0].func.invokeContract().functionName().toString()).toBe(
      "retrieve_unvested",
    );
    expect(tx.signatures).toHaveLength(0);
    expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.server.sendTransaction).not.toHaveBeenCalled();
  });

  it("prepares unsigned XDR when a paused Streamer's retrieval simulation succeeds", async () => {
    mocks.server.simulateTransaction.mockResolvedValue({
      _parsed: true,
      id: "1",
      latestLedger: 1,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: "1000",
      result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    });
    const response = await call();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const tx = TransactionBuilder.fromXDR(data.xdr, data.networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    expect(tx.signatures).toHaveLength(0);
    expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.server.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["unrelated Streamer error", failure([frame(streamer, 11)], "HostError: Error(Contract, #11)")],
    ["unknown error", failure([frame(streamer, 99)], "HostError: Error(Contract, #99)")],
    ["nested error 10 propagated through Streamer", failure([frame(streamer), frame(nested)])],
    ["nested error in reverse event order", failure([frame(nested), frame(streamer)])],
    ["another contract's error 10", failure([frame(nested)])],
    ["addressless origin", failure([frame(streamer), frame(null)])],
    ["malformed error topic", failure([frame(streamer), malformedFrame()])],
    ["contradictory diagnostic code", failure([frame(streamer, 9)])],
    ["code-only error without diagnostics", failure([])],
    ["successful call diagnostics only", failure([frame(streamer, 10, true)])],
    ["contradictory top-level error", failure([frame(streamer)], "HostError: Error(Contract, #9)")],
    ["host authorization error", failure([], "HostError: Error(Auth, InvalidAction)")],
  ])("keeps %s classified as upstream", async (_name, sim) => {
    mocks.server.simulateTransaction.mockResolvedValue(sim);
    const response = await call();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("UPSTREAM_RPC");
    expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.server.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(["_getLedgerEntries", "simulateTransaction"] as const)(
    "maps rejected %s RPC to 502, excluding provider text",
    async (operation) => {
      mocks.server[operation].mockRejectedValue(new Error("socket hang up provider-secret"));
      const response = await call();
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error.code).toBe("UPSTREAM_RPC");
      expect(JSON.stringify(body)).not.toContain("provider-secret");
      if (operation === "_getLedgerEntries")
        expect(mocks.server.simulateTransaction).not.toHaveBeenCalled();
      else expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves an existing structured RPC error", async () => {
    mocks.server.simulateTransaction.mockRejectedValue(
      new AppError("RATE_LIMITED", "Retry later", undefined, undefined, 7),
    );
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it.each(["pause", "unpause"])("does not change %s simulation classification", async (method) => {
    const response = await call(method);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("UPSTREAM_RPC");
    expect(mocks.server.simulateTransaction).toHaveBeenCalledTimes(1);
  });
});
