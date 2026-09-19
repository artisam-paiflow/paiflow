/**
 * #468 integration: prepare → sign the returned XDR with a test key → submit.
 *
 * Only the RPC transport is mocked. The deposit is built by the real
 * `prepareTriggerTx` / `prepareDepositInvocation` and assembled by the SDK, so
 * the submit route's envelope assertion runs against a genuinely signed
 * envelope of exactly the shape a partner will post.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

const { mockDb, mockRpc, mockBuildHint } = vi.hoisted(() => ({
  mockDb: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  mockRpc: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    getTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  },
  mockBuildHint: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/stellar/client")>()),
  sorobanRpc: () => mockRpc,
}));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({ buildPipelineErrorHint: mockBuildHint }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: vi.fn(async () => 1) }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  wasTxConfirmedFor: vi.fn(async () => false),
  wasTxSubmittedFor: vi.fn(async () => true),
}));

import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { audit } from "@/lib/audit";
import {
  DEPLOYMENT_ID,
  OTHER_CONTRACT,
  ROUTER,
  TRIGGER,
  ctx,
  newToken,
  request,
  tokenRow,
} from "./execute-fixtures";

const PREPARE_PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/execute`;
const partner = Keypair.random();
let token: ReturnType<typeof newToken>;

async function prepareDeposit(): Promise<string> {
  const res = await prepare(
    request(PREPARE_PATH, {
      token: token.plaintext,
      body: { amount: "10000000", from: partner.publicKey() },
    }),
    ctx(),
  );
  expect(res.status).toBe(200);
  return (await res.json()).data.xdr;
}

function sign(unsigned: string): Transaction {
  const tx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET) as Transaction;
  tx.sign(partner);
  return tx;
}

function postSigned(signedXdr: string) {
  return submit(
    request(`${PREPARE_PATH}/submit`, { token: token.plaintext, body: { signedXdr } }),
    ctx(),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  token = newToken();
  mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow(token));
  mockDb.deploymentApiToken.update.mockResolvedValue({});
  mockBuildHint.mockResolvedValue({ addressMap: { [ROUTER]: "soroswap_router" } });

  const { Account } = await import("@stellar/stellar-sdk");
  mockRpc.getAccount.mockImplementation(async (a: string) => new Account(a, "41"));
  mockRpc.simulateTransaction.mockResolvedValue({
    id: "sim",
    latestLedger: 1000,
    minResourceFee: "5000",
    transactionData: new SorobanDataBuilder().build().toXDR("base64"),
    results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
  });
});

describe("prepare → sign → submit", () => {
  it("lands SUCCESS for the envelope prepare built, signed by the partner", async () => {
    const signed = sign(await prepareDeposit());
    const txHash = signed.hash().toString("hex");
    mockRpc.getTransaction
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 51 });
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

    const res = await postSigned(signed.toXDR());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { txHash, status: "SUCCESS", ledger: 51 } });

    const sent = mockRpc.sendTransaction.mock.calls[0]![0] as Transaction;
    expect(sent.hash().toString("hex")).toBe(txHash);
    expect(sent.signatures).toHaveLength(1);
    expect(sent.source).toBe(partner.publicKey());
    expect(mockBuildHint).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls.map(([a]) => a.action)).toEqual([
      "API_EXECUTE_PREPARED",
      "API_EXECUTE_SUBMITTED",
      "API_EXECUTE_CONFIRMED",
    ]);
  });

  it("refuses the same signed deposit re-pointed at another contract", async () => {
    const envelope = xdr.TransactionEnvelope.fromXDR(await prepareDeposit(), "base64");
    envelope
      .v1()
      .tx()
      .operations()[0]!
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract()
      .contractAddress(Address.fromString(OTHER_CONTRACT).toScAddress());
    const tampered = sign(envelope.toXDR("base64"));

    const res = await postSigned(tampered.toXDR());

    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("trigger contract");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("prepares against the trigger at the head of the snapshot", async () => {
    const tx = sign(await prepareDeposit());
    const op = tx.operations[0] as { func: xdr.HostFunction };
    const call = op.func.invokeContract();
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(TRIGGER);
    expect(call.functionName().toString()).toBe("deposit");
  });

  it("a simulation revert builds the hint lazily and answers 422 with the friendly text", async () => {
    mockRpc.simulateTransaction.mockResolvedValue({
      id: "sim",
      latestLedger: 1000,
      error: `HostError: Error(Contract, #507)\nEvent log (newest first):\n 0: [Diagnostic Event] contract:${ROUTER}, topics:[error, Error(Contract, #507)]`,
      events: [],
    });

    const res = await prepare(
      request(PREPARE_PATH, {
        token: token.plaintext,
        body: { amount: "10000000", from: partner.publicKey() },
      }),
      ctx(),
    );

    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain(
      "Soroswap would return less than the minimum",
    );
    expect(mockBuildHint).toHaveBeenCalledTimes(1);
  });
});
