import { createHash } from "node:crypto";
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  SorobanDataBuilder,
} from "@stellar/stellar-sdk";
import type { Deployment, WalletControlIntent } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  db: {
    deployment: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    walletControlIntent: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  read: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
  lock: vi.fn(),
  work: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/stellar/conditional-execution-state", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/conditional-execution-state")>()),
  readConditionalExecutionState: m.read,
}));
vi.mock("@/lib/api/v1/conditional-execution-payments", () => ({
  prepareConditionalExecutionPayment: m.prepare,
  submitConditionalExecutionPayment: m.submit,
}));
vi.mock("@/lib/api/v1/control-intent", async (original) => ({
  ...(await original<typeof import("@/lib/api/v1/control-intent")>()),
  reconcileControlIntent: m.reconcile,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  lockDeployment: m.lock,
  withDeploymentWork: m.work,
}));
import {
  conditionalPreparedFixture,
  conditionalDeploySigner,
} from "@/tests/fixtures/conditional-deploy";
import {
  ConditionalExecutionIntentSchema,
  selectConditionalBranch,
} from "@/lib/flows/conditional-v2";
import { ConditionalExecutionDiscoverySchema } from "@/lib/api/v1/conditional-execution-schema";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalHostedDeployment,
  readConditionalHostedState,
  readConditionalHostedReceipt,
  prepareConditionalHostedPayment,
  submitConditionalHostedPayment,
  reconcileConditionalHostedPayment,
  setConditionalHostedVisibility,
  conditionalHostedPublicError,
} from "@/lib/hosted-execution/conditional-service";
import { hostedKeyHash, readHostedReceipt, requestKeyHash } from "@/lib/hosted-execution/service";
import { createConditionalHostedOwnershipChallenge } from "@/lib/stellar/conditional-hosted-ownership";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import { AppError } from "@/lib/errors";
import { preparation, payment as v1payment } from "./fixtures";
const key = "ab".repeat(32);
let d: Deployment,
  row: WalletControlIntent,
  current: ReturnType<typeof ConditionalExecutionDiscoverySchema.parse>,
  prepared: {
    intent: string;
    txHash: string;
    walletAddress: string;
    xdr: string;
    expiresAt: string;
    network: "testnet";
    networkPassphrase: string;
    execution: ReturnType<typeof ConditionalExecutionIntentSchema.parse>;
  };
beforeEach(() => {
  vi.resetAllMocks();
  const f = conditionalPreparedFixture(),
    nodes = f.pipeline.map((n) => ({
      nodeId: n.nodeId,
      contractAddress: n.contractAddress,
      wasmHash: n.wasmHash,
      expectedRevision: "0",
    }));
  d = {
    id: f.deploymentId,
    ownerId: "owner",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    network: "testnet",
    hostedExecutionEnabled: true,
    templateVersionId: null,
    sourceAccount: f.owner,
    unsignedXdr: f.xdr,
    preparedTxHash: f.txHash,
    graphSnapshot: f.graph,
    paramsSnapshot: f.envelope,
    pipelineSnapshot: f.pipeline,
    webhookSecret: "private-canary",
  } as unknown as Deployment;
  current = ConditionalExecutionDiscoverySchema.parse({
    version: 2,
    supported: true,
    deploymentId: d.id,
    network: "testnet",
    policyVersion: 2,
    confirmedLedger: 100,
    definition: f.envelope.definition,
    nodes,
    statuses: f.envelope.manifest.nodes.map(({ state }) => ({ state, obligationsStroops: "0" })),
  });
  const execution = ConditionalExecutionIntentSchema.parse({
    version: 2,
    deploymentId: d.id,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: nodes[0]!.contractAddress,
    assetContract: f.envelope.definition.assetContract,
    payer: f.owner,
    amountStroops: "1000",
    nonce: "01".repeat(32),
    expiresAtLedger: 200,
    definition: f.envelope.definition,
    nodes,
    arguments: { version: 2, inputs: [] },
    ...selectConditionalBranch(f.envelope.definition, "1000"),
  });
  const tx = new TransactionBuilder(new Account(f.owner, "10"), {
    fee: "1100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(execution.rootContract).call("execute_v2", ...executionV2Args(execution)),
    )
    .setTimeout(180)
    .setSorobanData(new SorobanDataBuilder().setResourceFee("1000").build())
    .build();
  prepared = {
    intent: "22222222-2222-4222-8222-222222222222",
    txHash: tx.hash().toString("hex"),
    walletAddress: f.owner,
    xdr: tx.toXDR(),
    expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    execution,
  };
  row = {
    id: prepared.intent,
    deploymentId: d.id,
    action: "payment.execute",
    network: "testnet",
    hostedAccessHash: hostedKeyHash(key),
    idempotencyKeyHash: requestKeyHash(key),
    requestDigest: executionRequestDigest({
      version: 2,
      deploymentId: d.id,
      network: d.network,
      input: payment(),
    }),
    walletAddress: f.owner,
    state: "PREPARED",
    maxTime: tx.timeBounds!.maxTime,
    txHash: prepared.txHash,
    executionIntent: execution,
  } as unknown as WalletControlIntent;
  m.db.deployment.findFirst.mockImplementation(async () => d);
  m.db.deployment.findUnique.mockImplementation(async () => ({
    hostedExecutionEnabled: d.hostedExecutionEnabled,
  }));
  m.db.walletControlIntent.findFirst.mockImplementation(async () => row);
  m.db.$transaction.mockImplementation(async (callback) => callback(m.db));
  m.lock.mockResolvedValue({ serviceState: "ACTIVE" });
  m.work.mockImplementation(async (_id, _kind, callback) => callback());
  m.read.mockImplementation(async () => current);
  m.prepare.mockImplementation(async () => prepared);
  m.submit.mockResolvedValue({
    txHash: row.txHash,
    status: "UNKNOWN",
    events: [{ email: "private-canary" }],
    diagnostics: "private-canary",
  });
  m.reconcile.mockImplementation(async () => row);
});
function payment() {
  return { amount: "1000", from: d.sourceAccount!, arguments: { version: 2 as const, inputs: [] } };
}
it("requires atomic marker and strict saved generation, including retained v1 fallback only", async () => {
  expect(await readConditionalHostedReceipt(d.id, key)).toBe(row);
  await expect(readHostedReceipt(d.id, key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  row.hostedAccessHash = null;
  await expect(readConditionalHostedReceipt(d.id, key)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  row.executionIntent = preparation(v1payment).prepared
    .execution as unknown as WalletControlIntent["executionIntent"];
  expect(await readHostedReceipt(d.id, key)).toBe(row);
  row.hostedAccessHash = "";
  await expect(readHostedReceipt(d.id, key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  row.hostedAccessHash = null;
  row.executionIntent = null;
  await expect(readHostedReceipt(d.id, key)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("authenticates capability before interpreting hostile generation or revealing identities", async () => {
  let touched = false;
  row.hostedAccessHash = hostedKeyHash("cd".repeat(32));
  row.executionIntent = Object.defineProperty({}, "version", {
    get() {
      touched = true;
      throw new Error("private-canary");
    },
  });
  await expect(readConditionalHostedReceipt(d.id, key)).rejects.toMatchObject({
    code: "NOT_FOUND",
    fields: undefined,
  });
  expect(touched).toBe(false);
  row.hostedAccessHash = null;
  row.idempotencyKeyHash = requestKeyHash("cd".repeat(32));
  await expect(readHostedReceipt(d.id, key)).rejects.toMatchObject({
    code: "NOT_FOUND",
    fields: undefined,
  });
  expect(touched).toBe(false);
});
it("rechecks saved metadata and actual fenced current capability for live state; never projects private fields", async () => {
  const state = await readConditionalHostedState(d);
  expect(state.supported).toBe(true);
  expect(JSON.stringify(state)).not.toContain("private-canary");
  m.read.mockResolvedValue({
    version: 2,
    supported: false,
    deploymentId: d.id,
    network: "testnet",
    policyVersion: 0,
    reason: "private-canary",
  });
  await expect(readConditionalHostedState(d)).rejects.toMatchObject({ code: "NOT_FOUND" });
  d.graphSnapshot = { nodes: [], edges: [] };
  await expect(conditionalHostedDeployment(d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("fresh prepare demands proof before common admission and rechecks proof under admission", async () => {
  m.db.walletControlIntent.findFirst.mockResolvedValueOnce(null);
  await expect(
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment() }),
  ).rejects.toMatchObject({
    fields: { ownershipProofXdr: ["A current wallet ownership signature is required"] },
  });
  expect(m.prepare).not.toHaveBeenCalled();
  const challenge = createConditionalHostedOwnershipChallenge(d.id, {
      recoveryKey: key,
      payment: payment(),
    }),
    tx = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET);
  tx.sign(conditionalDeploySigner());
  m.db.walletControlIntent.findFirst.mockResolvedValueOnce(null);
  m.prepare.mockImplementationOnce(async (_d, _p, _k, admission) => {
    await admission(m.db);
    return prepared;
  });
  await expect(
    prepareConditionalHostedPayment(d, {
      recoveryKey: key,
      payment: payment(),
      ownershipProofXdr: tx.toXDR(),
    }),
  ).resolves.toMatchObject({ version: 2 });
  expect(m.prepare.mock.calls.at(-1)![4]).toBe(hostedKeyHash(key));
});
it("does not repair marker when common idempotency returns a missing-marker race winner", async () => {
  m.prepare.mockImplementation(async () => {
    row.hostedAccessHash = null;
    return prepared;
  });
  await expect(
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(row.hostedAccessHash).toBeNull();
});
it("prepare retries remain visibility gated and stale inactive evidence preserves original", async () => {
  d.hostedExecutionEnabled = false;
  await expect(
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  d.hostedExecutionEnabled = true;
  if (current.supported) current.nodes.at(-1)!.expectedRevision = "1";
  await expect(
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment() }),
  ).rejects.toThrow();
  expect(row.id).toBe(prepared.intent);
  expect(m.submit).not.toHaveBeenCalled();
});
it("postclaim recovery skips visibility/current chain while submit returns only public status", async () => {
  d.hostedExecutionEnabled = false;
  row.state = "SUBMITTING";
  m.read.mockRejectedValue(new Error("private-canary"));
  const result = await submitConditionalHostedPayment(
    d,
    { recoveryKey: key, intent: row.id, signedXdr: "signed-placeholder" },
    "127.0.0.1",
  );
  expect(result).toEqual({ version: 2, txHash: row.txHash, status: "UNKNOWN" });
  expect(await reconcileConditionalHostedPayment(d, key)).toMatchObject({
    version: 2,
    intent: row.id,
  });
  expect(m.read).not.toHaveBeenCalled();
  d.serviceState = "RETIRED";
  m.reconcile.mockClear();
  await expect(reconcileConditionalHostedPayment(d, key)).resolves.toMatchObject({
    intent: row.id,
  });
  expect(m.reconcile).not.toHaveBeenCalled();
});
it("opt-out needs strict saved generation and owner but no RPC; enabling needs live capability", async () => {
  m.read.mockRejectedValue(new Error("RPC down"));
  await expect(setConditionalHostedVisibility(d, d.ownerId, false, "127.0.0.1")).resolves.toEqual({
    enabled: false,
  });
  expect(m.read).not.toHaveBeenCalled();
  await expect(setConditionalHostedVisibility(d, d.ownerId, true, "127.0.0.1")).rejects.toThrow();
  expect(m.db.auditLog.create).toHaveBeenCalledOnce();
  await expect(
    setConditionalHostedVisibility(d, "other", false, "127.0.0.1"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("public errors preserve code/status/retry and only exact fixed ownership field, never arbitrary canaries", () => {
  for (const code of [
    "VALIDATION",
    "CONFLICT",
    "UPSTREAM_RPC",
    "INSUFFICIENT_FUNDS",
    "NOT_FOUND",
    "INTERNAL",
    "RATE_LIMITED",
  ] as const) {
    const result = conditionalHostedPublicError(
      new AppError(
        code,
        "private-canary",
        { intent: ["private-canary"], email: ["private-canary"] },
        "private-canary",
        5,
      ),
    );
    expect(result.code).toBe(code);
    expect(result.retryAfterSeconds).toBe(5);
    expect(JSON.stringify(result)).not.toContain("private-canary");
    expect(result.message).not.toContain("private-canary");
    expect(result.fields).toBeUndefined();
    expect(result.details).toBeUndefined();
  }
  expect(
    conditionalHostedPublicError(
      new AppError(
        "VALIDATION",
        "Verify ownership of the payer wallet before preparing this payment",
        { ownershipProofXdr: ["A current wallet ownership signature is required"] },
      ),
    ),
  ).toMatchObject({
    fields: { ownershipProofXdr: ["A current wallet ownership signature is required"] },
  });
});
