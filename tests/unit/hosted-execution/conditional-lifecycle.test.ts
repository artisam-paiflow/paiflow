import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  type Transaction,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import type { Deployment, PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  read: vi.fn(),
  observation: vi.fn(),
  refresh: vi.fn(),
  prepare: vi.fn(),
  account: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
  expired: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(m.client, key);
        return typeof value === "function" ? value.bind(m.client) : value;
      },
    },
  ),
}));
vi.mock("@/lib/stellar/conditional-execution-state", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/conditional-execution-state")>()),
  readConditionalExecutionState: m.read,
  readConditionalExecutionStateForReview: m.observation,
}));
vi.mock("@/lib/stellar/prepare-conditional-execution", () => ({
  prepareConditionalExecutionTransaction: m.prepare,
}));
vi.mock("@/lib/stellar/load-payment-account", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/load-payment-account")>()),
  loadPaymentAccount: m.account,
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: m.send, getTransaction: m.get }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/allowance-status", () => ({ allowanceHasExpired: m.expired }));
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { conditionalPreparedFixture } from "@/tests/fixtures/conditional-deploy";
import {
  ConditionalExecutionDiscoverySchema,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import {
  ConditionalExecutionIntentSchema,
  selectConditionalBranch,
  type ConditionalExecutionIntent,
} from "@/lib/flows/conditional-v2";
import { compileConditionalPipeline } from "@/lib/flows/conditional-v2-compiler";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import {
  executionV2Args,
  conditionalContractAddress,
  conditionalConstructorArgs,
} from "@/lib/stellar/conditional-v2-codec";
import { nodeBlueprint } from "@/lib/stellar/scval";
import {
  prepareConditionalHostedPayment,
  readConditionalHostedReceipt,
  submitConditionalHostedPayment,
  reconcileConditionalHostedPayment,
  setConditionalHostedVisibility,
} from "@/lib/hosted-execution/conditional-service";
import { createConditionalHostedOwnershipChallenge } from "@/lib/stellar/conditional-hosted-ownership";
import { requestKeyHash, hostedKeyHash, readHostedReceipt } from "@/lib/hosted-execution/service";
import { createConditionalExecutionIntent } from "@/lib/api/v1/conditional-execution-intent";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
const scratch = scratchDatabase();
const payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const key = "ab".repeat(32);
let d: Deployment, current: SupportedConditionalExecutionState;
function freshConditionalFixture() {
  const f = conditionalPreparedFixture(),
    salts = f.pipeline.map(() => randomBytes(32));
  const bindings = f.pipeline.map((node, index) => ({
    nodeId: node.nodeId,
    contractAddress: conditionalContractAddress(f.owner, salts[index]!, Networks.TESTNET),
    wasmHash: node.wasmHash,
    expectedRevision: "0",
  }));
  const compiled = compileConditionalPipeline(f.envelope.definition, bindings),
    envelope = ConditionalDeploymentEnvelopeSchema.parse({
      version: 2,
      generation: "conditional-v2",
      definition: compiled.definition,
      manifest: compiled.manifest,
      nodes: compiled.nodes,
    });
  const pipeline = f.pipeline.map((node, index) => ({
    ...node,
    contractAddress: bindings[index]!.contractAddress,
    salt: salts[index]!.toString("hex"),
    implementation: compiled.nodes[index]!.implementation,
  }));
  const tx = new TransactionBuilder(new Account(f.owner, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(f.factory).call(
        "deploy_pipeline",
        new Address(f.owner).toScVal(),
        xdr.ScVal.scvVec(
          compiled.nodes.map((node, index) =>
            nodeBlueprint(
              bindings[index]!.wasmHash,
              salts[index]!,
              conditionalConstructorArgs(node, compiled.manifest),
            ),
          ),
        ),
      ),
    )
    .setTimeout(180)
    .setSorobanData(new SorobanDataBuilder().setResourceFee("1000").build())
    .build();
  return { ...f, envelope, pipeline, xdr: tx.toXDR(), txHash: tx.hash().toString("hex") };
}
function payment() {
  return {
    from: payer.publicKey(),
    amount: "1000",
    arguments: { version: 2 as const, inputs: [] },
  };
}
function proof(recoveryKey = key, input = payment()) {
  const challenge = createConditionalHostedOwnershipChallenge(d.id, {
    recoveryKey,
    payment: input,
  });
  const tx = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET);
  tx.sign(payer);
  return tx.toXDR();
}
function unsigned(execution: ConditionalExecutionIntent) {
  return new TransactionBuilder(new Account(execution.payer, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(execution.rootContract).call("execute_v2", ...executionV2Args(execution)),
    )
    .setTimeout(180)
    .setSorobanData(new SorobanDataBuilder().setResourceFee("1000").build())
    .build()
    .toXDR();
}
beforeAll(async () => {
  m.client = await scratch.start();
});
afterAll(async () => {
  await scratch.stop();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  vi.resetAllMocks();
  m.expired.mockResolvedValue(false);
  const f = freshConditionalFixture(),
    owner = await db.user.create({
      data: { username: `conditional-hosted-${randomUUID()}`, passwordHash: "unused" },
    }),
    flow = await db.flow.create({
      data: {
        ownerId: owner.id,
        name: "private-contact-canary",
        templateKind: "ROUTER",
        graph: f.graph,
        parameters: { generation: "conditional-v2" },
      },
    });
  d = await db.deployment.create({
    data: {
      ownerId: owner.id,
      flowId: flow.id,
      network: "testnet",
      status: "CONFIRMED",
      confirmedAt: new Date(),
      sourceAccount: f.owner,
      unsignedXdr: f.xdr,
      preparedTxHash: f.txHash,
      idempotencyKey: `conditional-deploy:${randomUUID()}`,
      graphSnapshot: f.graph,
      paramsSnapshot: f.envelope,
      pipelineSnapshot: f.pipeline,
      contractAddress: f.pipeline[0]!.contractAddress,
      hostedExecutionEnabled: true,
    },
  });
  current = ConditionalExecutionDiscoverySchema.parse({
    version: 2,
    supported: true,
    deploymentId: d.id,
    network: "testnet",
    policyVersion: 2,
    confirmedLedger: 100,
    definition: f.envelope.definition,
    nodes: f.pipeline.map((n) => ({
      nodeId: n.nodeId,
      contractAddress: n.contractAddress,
      wasmHash: n.wasmHash,
      expectedRevision: "0",
    })),
    statuses: f.envelope.manifest.nodes.map(({ state }) => ({ state, obligationsStroops: "0" })),
  }) as SupportedConditionalExecutionState;
  m.account.mockResolvedValue(new Account(payer.publicKey(), "10"));
  m.read.mockImplementation(async (_d, options?: { finalRead?: () => Promise<void> }) => {
    await options?.finalRead?.();
    return structuredClone(current);
  });
  m.observation.mockImplementation(async (deployment, options) => ({
    current: await m.read(deployment, options),
    refresh: () => m.refresh(deployment),
  }));
  m.refresh.mockImplementation(async () => {
    const rows = await db.walletControlIntent.findMany({ where: { deploymentId: d.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hostedAccessHash).toBe(hostedKeyHash(key));
    return structuredClone(current);
  });
  m.prepare.mockImplementation(async (execution) => ({ xdr: unsigned(execution) }));
  m.get.mockResolvedValue({ status: "NOT_FOUND" });
  m.send.mockRejectedValue(new Error("response lost after send"));
});
it("admits concurrent exactkey preparations once with atomic capability and bothbranch bindings", async () => {
  const ownershipProofXdr = proof();
  const [a, b] = await Promise.all([
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment(), ownershipProofXdr }),
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment(), ownershipProofXdr }),
  ]);
  expect(a.prepared.intent).toBe(b.prepared.intent);
  expect(a.prepared.txHash).toBe(b.prepared.txHash);
  expect(a.prepared.execution.nodes).toHaveLength(current.nodes.length);
  expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(1);
  const row = await readConditionalHostedReceipt(d.id, key);
  expect(row.hostedAccessHash).toBe(hostedKeyHash(key));
  expect(row.hostedAccessHash).not.toBe(key);
  expect(m.send).not.toHaveBeenCalled();
  expect(JSON.stringify(a)).not.toContain("private-contact-canary");
});
it("cannot reserve victim payer before ownership and rejects invalid source/key proof", async () => {
  await expect(
    prepareConditionalHostedPayment(d, { recoveryKey: key, payment: payment() }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    prepareConditionalHostedPayment(d, {
      recoveryKey: "cd".repeat(32),
      payment: payment(),
      ownershipProofXdr: proof(),
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(0);
  expect(m.prepare).not.toHaveBeenCalled();
});
it("proof expires during slow simulation before durable admission", async () => {
  const p = proof(),
    now = Date.now();
  m.prepare.mockImplementationOnce(async (execution) => {
    vi.spyOn(Date, "now").mockReturnValue(now + 181000);
    return { xdr: unsigned(execution) };
  });
  await expect(
    prepareConditionalHostedPayment(d, {
      recoveryKey: key,
      payment: payment(),
      ownershipProofXdr: p,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(0);
});
it("optout racing simulation closes admission under the same deployment lock", async () => {
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => (reached = resolve)),
    held = new Promise<void>((resolve) => (release = resolve));
  m.prepare.mockImplementationOnce(async (execution) => {
    reached();
    await held;
    return { xdr: unsigned(execution) };
  });
  const work = prepareConditionalHostedPayment(d, {
    recoveryKey: key,
    payment: payment(),
    ownershipProofXdr: proof(),
  });
  await entered;
  await setConditionalHostedVisibility(d, d.ownerId, false, "127.0.0.1");
  release();
  await expect(work).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(0);
});
it("postcommit response loss preserves same receipt/key and optout permits receipt but not prepare retry", async () => {
  m.refresh.mockRejectedValueOnce(new Error("response lost after commit"));
  await expect(
    prepareConditionalHostedPayment(d, {
      recoveryKey: key,
      payment: payment(),
      ownershipProofXdr: proof(),
    }),
  ).rejects.toThrow();
  const row = await readConditionalHostedReceipt(d.id, key);
  const recovered = await prepareConditionalHostedPayment(d, {
    recoveryKey: key,
    payment: payment(),
  });
  expect(recovered.prepared.intent).toBe(row.id);
  expect(m.prepare).toHaveBeenCalledOnce();
  await setConditionalHostedVisibility(d, d.ownerId, false, "127.0.0.1");
  const disabled = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
  await expect(
    prepareConditionalHostedPayment(disabled, { recoveryKey: key, payment: payment() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await reconcileConditionalHostedPayment(disabled, key)).intent).toBe(row.id);
});
it.each([undefined, "cd".repeat(32)])(
  "existing samephysicalkey missing/wrong atomic marker %s is never repaired",
  async (marker) => {
    const execution = ConditionalExecutionIntentSchema.parse({
      version: 2,
      deploymentId: d.id,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
      rootContract: current.nodes[0]!.contractAddress,
      assetContract: current.definition.assetContract,
      payer: payer.publicKey(),
      amountStroops: "1000",
      nonce: "01".repeat(32),
      expiresAtLedger: 200,
      definition: current.definition,
      nodes: current.nodes,
      arguments: { version: 2, inputs: [] },
      ...selectConditionalBranch(current.definition, "1000"),
    });
    const saved = await createConditionalExecutionIntent({
      deployment: d,
      execution,
      unsignedXdr: unsigned(execution),
      preparationLedger: 100,
      artifacts: current.nodes.map(({ nodeId, contractAddress, wasmHash }) => ({
        nodeId,
        contractAddress,
        wasmHash,
      })),
      keyHash: requestKeyHash(key),
      requestDigest: executionRequestDigest({
        version: 2,
        deploymentId: d.id,
        network: d.network,
        input: payment(),
      }),
      ...(marker ? { hostedAccessHash: marker, assertAdmission: async () => {} } : {}),
    });
    await expect(readConditionalHostedReceipt(d.id, key)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      prepareConditionalHostedPayment(d, {
        recoveryKey: key,
        payment: payment(),
        ownershipProofXdr: proof(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await db.walletControlIntent.findUniqueOrThrow({ where: { id: saved.intent } }))
        .hostedAccessHash,
    ).toBe(marker ?? null);
  },
);
it("PREPARED firstsend optout refuses; postclaim unknown recovery preserves original with one send", async () => {
  const prepared = await prepareConditionalHostedPayment(d, {
      recoveryKey: key,
      payment: payment(),
      ownershipProofXdr: proof(),
    }),
    tx = TransactionBuilder.fromXDR(prepared.prepared.xdr, Networks.TESTNET) as Transaction;
  tx.sign(payer);
  await setConditionalHostedVisibility(d, d.ownerId, false, "127.0.0.1");
  await expect(
    submitConditionalHostedPayment(
      d,
      { recoveryKey: key, intent: prepared.prepared.intent, signedXdr: tx.toXDR() },
      "127.0.0.1",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(m.send).not.toHaveBeenCalled();
  await setConditionalHostedVisibility(d, d.ownerId, true, "127.0.0.1");
  await submitConditionalHostedPayment(
    d,
    { recoveryKey: key, intent: prepared.prepared.intent, signedXdr: tx.toXDR() },
    "127.0.0.1",
  );
  expect(m.send).toHaveBeenCalledOnce();
  const disabled = await db.deployment.update({
    where: { id: d.id },
    data: { hostedExecutionEnabled: false },
  });
  m.read.mockRejectedValue(new Error("current chain unavailable"));
  await submitConditionalHostedPayment(
    disabled,
    { recoveryKey: key, intent: prepared.prepared.intent, signedXdr: tx.toXDR() },
    "127.0.0.1",
  );
  expect(m.send).toHaveBeenCalledOnce();
  expect((await reconcileConditionalHostedPayment(disabled, key)).txHash).toBe(
    prepared.prepared.txHash,
  );
  await expect(readHostedReceipt(d.id, key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  m.expired.mockRejectedValueOnce(new AppError("UPSTREAM_RPC", "retention gap"));
  await expect(reconcileConditionalHostedPayment(disabled, key)).rejects.toMatchObject({
    code: "UPSTREAM_RPC",
  });
  expect((await readConditionalHostedReceipt(d.id, key)).txHash).toBe(prepared.prepared.txHash);
  expect(m.send).toHaveBeenCalledOnce();
});
it("stale inactive revision before firstsend preserves original and never sends", async () => {
  const prepared = await prepareConditionalHostedPayment(d, {
      recoveryKey: key,
      payment: payment(),
      ownershipProofXdr: proof(),
    }),
    tx = TransactionBuilder.fromXDR(prepared.prepared.xdr, Networks.TESTNET) as Transaction;
  tx.sign(payer);
  current.nodes.at(-1)!.expectedRevision = "1";
  await expect(
    submitConditionalHostedPayment(
      d,
      { recoveryKey: key, intent: prepared.prepared.intent, signedXdr: tx.toXDR() },
      "127.0.0.1",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(m.send).not.toHaveBeenCalled();
  expect((await readConditionalHostedReceipt(d.id, key)).txHash).toBe(prepared.prepared.txHash);
});
