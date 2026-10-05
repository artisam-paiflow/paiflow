import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
const { holder, db, rpc, prepare } = vi.hoisted(() => ({
  holder: { client: null as Redis | null },
  db: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  rpc: {
    getTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getLatestLedger: vi.fn(),
    getLedgers: vi.fn(),
  },
  prepare: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: () => holder.client }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), wasTxConfirmedFor: vi.fn(async () => false) }));
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: vi.fn() }));
vi.mock("@/lib/analytics/outcomes", () => ({
  recordTransactionOutcome: vi.fn(async () => false),
  beginTransactionSubmission: vi.fn(async () => undefined),
  transactionObservation: vi.fn(async () => undefined),
}));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: vi.fn(async () => 1) }));
vi.mock("@/lib/api/v1/payouts", () => ({ preparePayout: prepare }));
import { acquirePayoutLease } from "@/lib/api/v1/payout-lease";
import { POST as submit } from "@/app/api/v1/deployments/[id]/payouts/submit/route";
import { POST as prepareRoute } from "@/app/api/v1/deployments/[id]/payouts/route";
import { audit } from "@/lib/audit";
import { newToken, request, signedEnvelope, tokenRow, TRIGGER } from "./execute-fixtures";
const client = new Redis("redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
let id = "";
let token = newToken();
let signed = "";
const leases: Array<Awaited<ReturnType<typeof acquirePayoutLease>>> = [];
function parsed(xdr: string) {
  return TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
}
function call(xdr = signed, query = "?wait=false", auth = token.plaintext) {
  return submit(
    request(`/api/v1/deployments/${id}/payouts/submit${query}`, {
      token: auth,
      body: { signedXdr: xdr },
    }),
    { params: Promise.resolve({ id }) },
  );
}
async function bind() {
  const l = await acquirePayoutLease(id, token.id);
  leases.push(l);
  await l.ready({
    txHash: parsed(signed).hash().toString("hex"),
    maxTime: parsed(signed).timeBounds!.maxTime,
  });
  await l.close();
}
beforeAll(async () => {
  await client.connect();
  holder.client = client;
});
afterAll(async () => {
  await client.quit();
});
beforeEach(async () => {
  vi.clearAllMocks();
  id = randomUUID();
  token = newToken();
  signed = signedEnvelope();
  holder.client = client;
  const row = tokenRow(token, {
    id,
    network: "testnet",
    pipelineSnapshot: [{ nodeId: "t", templateKind: "DEPOSIT_TRIGGER", contractAddress: TRIGGER }],
  });
  row.deploymentId = id;
  db.deploymentApiToken.findUnique.mockResolvedValue(row);
  db.deploymentApiToken.update.mockResolvedValue({});
  rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  rpc.sendTransaction.mockResolvedValue({
    status: "PENDING",
    hash: parsed(signed).hash().toString("hex"),
  });
  rpc.getLatestLedger.mockResolvedValue({ sequence: 42 });
  rpc.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 42, ledgerCloseTime: "1" }] });
  await bind();
});
afterEach(async () => {
  for (const l of leases.splice(0)) await l.close();
  const keys = await client.keys(`v1:payout:${id}*`);
  if (keys.length) await client.del(...keys);
});
describe("payout API binding and submission", () => {
  it("keeps protection on PENDING and releases on a confirmed retry", async () => {
    expect((await (await call()).json()).data.status).toBe("PENDING");
    expect(await client.get(`v1:payout:${id}`)).not.toBeNull();
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 100 });
    expect((await (await call()).json()).data.status).toBe("SUCCESS");
    expect(await client.get(`v1:payout:${id}`)).toBeNull();
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls.map(([a]) => a.action)).toContain("API_PAYOUT_CONFIRMED");
  });
  it("an older final retry leaves a newer lease intact", async () => {
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 100 });
    const next = await acquirePayoutLease(id, "new-token");
    leases.push(next);
    expect((await (await call()).json()).data.status).toBe("SUCCESS");
    expect(JSON.parse((await client.get(`v1:payout:${id}`))!).owner).toBe(next.record.owner);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("refuses another valid deposit hash without submitting it", async () => {
    const res = await call(signedEnvelope());
    expect(res.status).toBe(422);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["amount", "time", "auth"])(
    "refuses tampered %s in the exact prepared envelope",
    async (part) => {
      const env = parsed(signed).toEnvelope();
      const tx = env.v1().tx();
      if (part === "amount")
        tx
          .operations()[0]!
          .body()
          .invokeHostFunctionOp()
          .hostFunction()
          .invokeContract()
          .args()[1] = nativeToScVal(10000001n, { type: "i128" });
      if (part === "time")
        tx.cond()
          .timeBounds()!
          .maxTime(
            xdr.Uint64.fromString((BigInt(parsed(signed).timeBounds!.maxTime) + 1n).toString()),
          );
      if (part === "auth") {
        const op = tx.operations()[0]!.body().invokeHostFunctionOp();
        op.auth([
          new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: new xdr.SorobanAuthorizedInvocation({
              function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                op.hostFunction().invokeContract(),
              ),
              subInvocations: [],
            }),
          }),
        ]);
      }
      const altered = env.toXDR("base64");
      expect(parsed(altered).hash().toString("hex")).not.toBe(
        parsed(signed).hash().toString("hex"),
      );
      expect((await call(altered)).status).toBe(422);
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
    },
  );
  it("requires the original API token even when another token is valid for the deployment", async () => {
    const other = newToken();
    const row = tokenRow(other, {
      id,
      network: "testnet",
      pipelineSnapshot: [
        { nodeId: "t", templateKind: "DEPOSIT_TRIGGER", contractAddress: TRIGGER },
      ],
    });
    row.deploymentId = id;
    db.deploymentApiToken.findUnique.mockResolvedValue(row);
    expect((await call(signed, "?wait=false", other.plaintext)).status).toBe(422);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("retains protection on uncertain send failures", async () => {
    rpc.sendTransaction.mockRejectedValue(new Error("timeout after send"));
    expect((await call()).status).toBe(502);
    expect(await client.get(`v1:payout:${id}`)).not.toBeNull();
  });
  it("retains protection when the network is busy", async () => {
    rpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER" });
    expect((await call()).status).toBe(502);
    expect(await client.get(`v1:payout:${id}`)).not.toBeNull();
  });
  it("releases confirmed failure", async () => {
    rpc.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 100 });
    expect((await (await call()).json()).data.status).toBe("FAILED");
    expect(await client.get(`v1:payout:${id}`)).toBeNull();
  });
  it("closes unauthenticated requests before preparation", async () => {
    const res = await prepareRoute(request(`/api/v1/deployments/${id}/payouts`, { body: {} }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("parses payout requests before preparing", async () => {
    const res = await prepareRoute(
      request(`/api/v1/deployments/${id}/payouts`, {
        token: token.plaintext,
        body: { from: "invalid", recipient: "invalid", amount: "1.1" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(422);
    expect(prepare).not.toHaveBeenCalled();
  });
});
