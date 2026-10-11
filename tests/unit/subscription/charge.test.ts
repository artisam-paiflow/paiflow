// This suite isolates charge diagnostics; real admission is covered in retirement.test.ts.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  session: vi.fn(),
  server: { getAccount: vi.fn(), simulateTransaction: vi.fn() },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.deployment } } }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mocks.server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { POST } from "@/app/api/deployments/[id]/subscription-charge/route";
import { prepareSubscriptionChargeInvocation } from "@/lib/stellar/invoke";
import { subscriptionChargeFailure } from "@/lib/stellar/subscription-charge-error";
import { rpc } from "@stellar/stellar-sdk";
import { SimulationError } from "@/lib/stellar/sim-error";

const subscriber = Keypair.random().publicKey();
const subscription = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const otherContract = StrKey.encodeContract(Buffer.alloc(32, 3));
const address = (value: string) => new Address(value).toScVal();
const amount = (value: bigint) => nativeToScVal(value, { type: "i128" });
function diagnostic(contract: string, topics: xdr.ScVal[], data: xdr.ScVal) {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: StrKey.decodeContract(contract) as unknown as xdr.Hash,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
    }),
  });
}
function allowanceFailure(available = 0n) {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 1,
    // Classification must use structured events, not a string diagnostic dump.
    error: "HostError: Error(Contract, #9)",
    events: [
      diagnostic(
        subscription,
        [
          xdr.ScVal.scvSymbol("fn_call"),
          xdr.ScVal.scvBytes(StrKey.decodeContract(asset)),
          xdr.ScVal.scvSymbol("transfer_from"),
        ],
        xdr.ScVal.scvVec([
          address(subscription),
          address(subscriber),
          address(subscription),
          amount(10000000n),
        ]),
      ),
      diagnostic(
        asset,
        [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(9))],
        xdr.ScVal.scvVec([
          xdr.ScVal.scvString("not enough allowance to spend"),
          amount(available),
          amount(10000000n),
        ]),
      ),
    ],
  };
}
async function charge() {
  return POST(
    new NextRequest("http://localhost/api/deployments/test/subscription-charge", {
      method: "POST",
      body: JSON.stringify({ userAddress: subscriber }),
    }),
    { params: Promise.resolve({ id: "test" }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "owner" });
  mocks.deployment.mockResolvedValue({
    sourceAccount: subscriber,
    flow: { templateKind: "SUBSCRIPTION" },
    pipelineSnapshot: [{ contractAddress: subscription, templateKind: "SUBSCRIPTION" }],
  });
  mocks.server.getAccount.mockResolvedValue(new Account(subscriber, "1"));
});

describe("standard Subscription charge errors", () => {
  it("still prepares the charge after a successful simulation", async () => {
    mocks.server.simulateTransaction.mockResolvedValue({
      _parsed: true,
      id: "1",
      latestLedger: 1,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: "1000",
      result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    });
    const response = await charge();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const tx = TransactionBuilder.fromXDR(data.xdr, data.networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it.each([0n, 5000000n])(
    "returns 422 for insufficient allowance of %s stroops",
    async (available) => {
      mocks.server.simulateTransaction.mockResolvedValue(allowanceFailure(available));
      const response = await charge();
      expect(response.status).toBe(422);
      const { error } = await response.json();
      expect(error).toMatchObject({
        code: "VALIDATION",
        message:
          "Subscription allowance is insufficient for this charge. Ask the configured subscriber to approve more allowance.",
      });
      expect(error.details).toContain("HostError: Error(Contract, #9)");
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it("does not classify a nested failure propagated through the subscription frame", async () => {
    const topics = [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(4))];
    mocks.server.simulateTransaction.mockResolvedValue({
      ...allowanceFailure(),
      error: "HostError: Error(Contract, #4)",
      events: [
        diagnostic(subscription, topics, xdr.ScVal.scvString("contract call failed")),
        diagnostic(otherContract, topics, xdr.ScVal.scvString("recipient rejected payment")),
      ],
    });
    expect((await charge()).status).toBe(502);
  });
  it.each([
    [4, "cancelled"],
    [5, "isn't due"],
  ])("returns conflict for subscription-owned charge guard #%s", async (code, message) => {
    mocks.server.simulateTransaction.mockResolvedValue({
      ...allowanceFailure(),
      error: `HostError: Error(Contract, #${code})\nDebug log (newest first):`,
      events: [
        diagnostic(
          subscription,
          [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
          xdr.ScVal.scvString("contract guard"),
        ),
      ],
    });
    const response = await charge();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(message),
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([4, 5])(
    "does not attribute nested contract guard #%s to the subscription",
    async (code) => {
      mocks.server.simulateTransaction.mockResolvedValue({
        ...allowanceFailure(),
        error: `HostError: Error(Contract, #${code})`,
        events: [
          diagnostic(
            otherContract,
            [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
            xdr.ScVal.scvString("contract guard"),
          ),
        ],
      });
      expect((await charge()).status).toBe(502);
    },
  );
  it.each([
    [4, "cancelled"],
    [5, "isn't due"],
    [6, "ended"],
    [2, "isn't authorized"],
  ])("preserves subscription error #%s", async (code, message) => {
    mocks.server.simulateTransaction.mockResolvedValue({
      ...allowanceFailure(),
      events: [],
      error: `HostError: Error(Contract, #${code})`,
    });
    const response = await charge();
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain(message);
  });
  it.each([
    "bare",
    "wrong-origin",
    "wrong-caller",
    "balance",
    "malformed",
    "short-target",
    "enough-allowance",
  ])("does not mislabel %s as subscriber allowance", async (kind) => {
    const sim = allowanceFailure();
    if (kind === "bare") sim.events = [];
    if (kind === "wrong-origin")
      sim.events[1]!.event().contractId(
        StrKey.decodeContract(otherContract) as unknown as xdr.Hash,
      );
    if (kind === "wrong-caller")
      sim.events[0]!.event().contractId(
        StrKey.decodeContract(otherContract) as unknown as xdr.Hash,
      );
    if (kind === "balance")
      sim.events[1]!.event()
        .body()
        .v0()
        .data(
          xdr.ScVal.scvVec([
            xdr.ScVal.scvString("insufficient balance"),
            amount(0n),
            amount(10000000n),
          ]),
        );
    if (kind === "malformed")
      sim.events[1]!.event().body().v0().data(xdr.ScVal.scvString("not enough allowance to spend"));
    if (kind === "short-target")
      sim.events[0]!.event()
        .body()
        .v0()
        .topics([
          xdr.ScVal.scvSymbol("fn_call"),
          xdr.ScVal.scvBytes(Buffer.alloc(31)),
          xdr.ScVal.scvSymbol("transfer_from"),
        ]);
    if (kind === "enough-allowance") sim.events = allowanceFailure(10000000n).events;
    mocks.server.simulateTransaction.mockResolvedValue(sim);
    const response = await charge();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("UPSTREAM_RPC");
  });
  it("preserves the existing helper behavior for Payroll and Dev callers", async () => {
    mocks.server.simulateTransaction.mockResolvedValue(allowanceFailure());
    await expect(
      prepareSubscriptionChargeInvocation({
        contractAddress: subscription,
        adminAddress: subscriber,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
  });
  it("does not classify a thrown RPC failure as insufficient allowance", async () => {
    const rpcFailure = new Error("RPC connection unavailable");
    mocks.server.simulateTransaction.mockRejectedValue(rpcFailure);
    await expect(
      prepareSubscriptionChargeInvocation({
        contractAddress: subscription,
        adminAddress: subscriber,
        classifyInsufficientAllowance: true,
      }),
    ).rejects.toBe(rpcFailure);
    expect(rpcFailure).not.toBeInstanceOf(SimulationError);
  });
});

// Public diagnostic events captured from an actual testnet simulation. No envelope.
const liveDiagnosticEvents = [
  "AAAAAAAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAgfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAAPAAAABmNoYXJnZQAAAAAAAQ==",
  "AAAAAAAAAAAAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAACAAAAAAAAAAMAAAAPAAAAB2ZuX2NhbGwAAAAADQAAACDXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAA8AAAANdHJhbnNmZXJfZnJvbQAAAAAAABAAAAABAAAABAAAABIAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAASAAAAAAAAAACMeE/HIJL+POJRCCSjS9NnsrBCa8RzZgTbVazh0opAJAAAABIAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAAKAAAAAAAAAAAAAAAAAJiWgA==",
  "AAAAAAAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAACAAAAAAAAAAIAAAAPAAAABWVycm9yAAAAAAAAAgAAAAAAAAAJAAAAEAAAAAEAAAADAAAADgAAAB1ub3QgZW5vdWdoIGFsbG93YW5jZSB0byBzcGVuZAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAAACYloA=",
  "AAAAAAAAAAAAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAACAAAAAAAAAAIAAAAPAAAABWVycm9yAAAAAAAAAgAAAAAAAAAJAAAAEAAAAAEAAAADAAAADgAAABRjb250cmFjdCBjYWxsIGZhaWxlZAAAAA8AAAANdHJhbnNmZXJfZnJvbQAAAAAAABAAAAABAAAABAAAABIAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAASAAAAAAAAAACMeE/HIJL+POJRCCSjS9NnsrBCa8RzZgTbVazh0opAJAAAABIAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAAKAAAAAAAAAAAAAAAAAJiWgA==",
  "AAAAAAAAAAAAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAACAAAAAAAAAAIAAAAPAAAABWVycm9yAAAAAAAAAgAAAAAAAAAJAAAADgAAAEBlc2NhbGF0aW5nIGVycm9yIHRvIFZNIHRyYXAgZnJvbSBmYWlsZWQgaG9zdCBmdW5jdGlvbiBjYWxsOiBjYWxs",
  "AAAAAAAAAAAAAAABfWpHpZxotLQoo1Lq2gAt7XECqJ6WkCvPhdELwOiPIXUAAAACAAAAAAAAAAEAAAAPAAAAA2xvZwAAAAAQAAAAAQAAAAMAAAAOAAAAHlZNIGNhbGwgdHJhcHBlZCB3aXRoIEhvc3RFcnJvcgAAAAAADwAAAAZjaGFyZ2UAAAAAAAIAAAAAAAAACQ==",
];

it("classifies captured testnet RPC diagnostics", () => {
  const sim = {
    _parsed: true,
    id: "live",
    latestLedger: 5084472,
    error: "HostError: Error(Contract, #9)",
    events: liveDiagnosticEvents.map((value) => xdr.DiagnosticEvent.fromXDR(value, "base64")),
  } as rpc.Api.SimulateTransactionErrorResponse;
  const failure = subscriptionChargeFailure(
    sim,
    "CB6WUR5FTRULJNBIUNJOVWQAFXWXCAVIT2LJAK6PQXIQXQHIR4QXLFZR",
  );
  expect(failure).toMatchObject({ code: "VALIDATION", status: 422 });
});
