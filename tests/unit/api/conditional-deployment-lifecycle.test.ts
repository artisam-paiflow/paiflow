import { randomUUID } from "node:crypto";
import type { Deployment, PrismaClient } from "@prisma/client";
import { Account, SorobanDataBuilder, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  session: vi.fn(),
  hashes: vi.fn(),
  factory: vi.fn(),
  load: vi.fn(),
  simulate: vi.fn(),
  send: vi.fn(),
  warnings: vi.fn(),
  error: vi.fn(),
  audit: vi.fn(),
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
vi.mock("@/lib/prisma", () => ({
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
vi.mock("@/lib/auth", () => ({ requireSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn() }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: vi.fn() }));
vi.mock("@/lib/stellar/conditional-artifact-config", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/conditional-artifact-config")>()),
  getConditionalWasmHashes: m.hashes,
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHashes: m.hashes, getFactoryAddress: m.factory }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ simulateTransaction: m.simulate }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: m.load }));
vi.mock("@/lib/stellar/deploy", () => ({
  checkAccountFunding: vi.fn(),
  preparePipelineDeployTx: vi.fn(),
  submitDeployTx: m.send,
}));
vi.mock("@/lib/stellar/trustline-check", () => ({ checkPayoutTrustlines: m.warnings }));
vi.mock("@/lib/log", () => ({ log: { error: m.error, warn: vi.fn(), info: vi.fn() } }));
import {
  configureConditionalArtifacts,
  conditionalArtifactSetDigest,
  readConditionalArtifactSet,
} from "@/lib/stellar/conditional-artifact-config";
import { db } from "@/lib/db";
import { POST } from "@/app/api/deployments/prepare/route";
import { submitOwnedDeployment } from "@/lib/deployments/submit";
import { verifyConditionalDeploymentOriginal } from "@/lib/stellar/prepare-conditional-deploy";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import {
  conditionalDeployCanvas,
  conditionalDeploySigner,
  conditionalPreparedFixture,
} from "@/tests/fixtures/conditional-deploy";
const scratch = scratchDatabase();
let flowId: string;
let preparationKey: string;
let user: { id: string; role: "USER" };
beforeAll(async () => {
  m.client = await scratch.start();
});
afterAll(async () => {
  await scratch.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  m.audit.mockResolvedValue(undefined);
  preparationKey = randomUUID();
  const config = {
    enabled: true,
    receiveWasmHash: CONDITIONAL_V2_WASM_HASHES.DEPOSIT_TRIGGER,
    payerWasmHash: CONDITIONAL_V2_WASM_HASHES.PAYER,
    splitterWasmHash: CONDITIONAL_V2_WASM_HASHES.SPLITTER,
    routerWasmHash: CONDITIONAL_V2_WASM_HASHES.ROUTER,
  };
  await db.conditionalArtifactSet.upsert({
    where: { network_version: { network: "testnet", version: 2 } },
    create: { network: "testnet", version: 2, ...config },
    update: config,
  });
  const owner = await db.user.create({
    data: { username: `conditional-deploy-${randomUUID()}`, passwordHash: "unused" },
  });
  user = { id: owner.id, role: "USER" };
  const flow = await db.flow.create({
    data: {
      ownerId: owner.id,
      name: "Conditional deployment",
      templateKind: "ROUTER",
      graph: conditionalDeployCanvas().graph,
      parameters: { generation: "conditional-v2" },
    },
  });
  flowId = flow.id;
  m.session.mockResolvedValue(user);
  m.factory.mockResolvedValue(conditionalPreparedFixture().factory);
  m.hashes.mockResolvedValue(new Map(Object.entries(CONDITIONAL_V2_WASM_HASHES)));
  m.load.mockImplementation(async (_s: unknown, address: string) => new Account(address, "10"));
  m.simulate.mockResolvedValue({
    _parsed: true,
    id: "1",
    latestLedger: 100,
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    events: [],
  });
  m.warnings.mockResolvedValue([]);
  m.send.mockImplementation(async (signed: string) => ({
    status: "SUBMITTED",
    txHash: TransactionBuilder.fromXDR(signed, "Test SDF Network ; September 2015")
      .hash()
      .toString("hex"),
  }));
});
async function prepare() {
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(
    response.status,
    m.error.mock.calls.map(([entry]) => entry.err?.message ?? JSON.stringify(entry)).join("\n"),
  ).toBe(200);
  return (await response.json()).data as {
    deploymentId: string;
    conditionalReview: { txHash: string };
    xdr: string;
  };
}
async function saved(id: string) {
  return db.deployment.findUniqueOrThrow({
    where: { id },
    include: { flow: { select: { templateKind: true } } },
  });
}
function request(xdr: string) {
  return {
    json: async () => ({ signedXdr: xdr }),
    headers: new Headers(),
  } as unknown as NextRequest;
}
it("persists taggedcanvas,compiled initialevidence,hexsalts and exactoriginal before returning review", async () => {
  const prepared = await prepare();
  const d = await saved(prepared.deploymentId);
  expect(d.status).toBe("PENDING_SIGNATURE");
  expect(d.preparedTxHash).toBe(prepared.conditionalReview.txHash);
  expect(verifyConditionalDeploymentOriginal(d).conditionalReview.txHash).toBe(d.preparedTxHash);
  expect(m.warnings.mock.calls[0]![0]).toHaveLength(3);
  expect(m.warnings.mock.calls[0]![0].at(-1).address).toBe(d.sourceAccount);
});
it("racing submissions claim one original and retain fullinitialevidence", async () => {
  const prepared = await prepare();
  const tx = TransactionBuilder.fromXDR(prepared.xdr, "Test SDF Network ; September 2015");
  tx.sign(conditionalDeploySigner());
  const original = await saved(prepared.deploymentId);
  const results = await Promise.allSettled([
    submitOwnedDeployment(request(tx.toXDR()), prepared.deploymentId, user),
    submitOwnedDeployment(request(tx.toXDR()), prepared.deploymentId, user),
  ]);
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(m.send).toHaveBeenCalledTimes(1);
  const after = await saved(prepared.deploymentId);
  expect(after.status).toBe("SUBMITTED");
  expect(after.deployTxHash).toBe(original.preparedTxHash);
  expect(after.paramsSnapshot).toEqual(original.paramsSnapshot);
  expect(after.pipelineSnapshot).toEqual(original.pipelineSnapshot);
  expect(await db.signedTransaction.count({ where: { deploymentId: original.id } })).toBe(1);
});
it("factoryrotation refuses firstsend without replacing or clearing original", async () => {
  const prepared = await prepare();
  const tx = TransactionBuilder.fromXDR(prepared.xdr, "Test SDF Network ; September 2015");
  tx.sign(conditionalDeploySigner());
  m.factory.mockResolvedValue(conditionalPreparedFixture().pipeline[0]!.contractAddress);
  await expect(
    submitOwnedDeployment(request(tx.toXDR()), prepared.deploymentId, user),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(m.send).not.toHaveBeenCalled();
  expect((await saved(prepared.deploymentId)).preparedTxHash).toBe(
    prepared.conditionalReview.txHash,
  );
});
it("advisoryfailure still returns same durableoriginal and explicitunknown warning", async () => {
  m.warnings.mockRejectedValue(new Error("Horizon unavailable"));
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(
    data.trustlineChecks.every((check: { status: string }) => check.status === "unknown"),
  ).toBe(true);
  expect((await saved(data.deploymentId)).preparedTxHash).toBe(data.conditionalReview.txHash);
});
it("unavailableartifacts refuse before deploymentfinancialevidence or source lookup", async () => {
  m.hashes.mockResolvedValue(new Map());
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(422);
  expect(await db.deployment.count({ where: { flowId } })).toBe(0);
  expect(m.load).not.toHaveBeenCalled();
});
it("samekey concurrent preparation publishes one admitted original and never a loser body", async () => {
  const [left, right] = await Promise.all([prepare(), prepare()]);
  expect(left.deploymentId).toBe(right.deploymentId);
  expect(left.xdr).toBe(right.xdr);
  expect(left.conditionalReview.txHash).toBe(right.conditionalReview.txHash);
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
  expect(m.send).not.toHaveBeenCalled();
});
it("lost response retry recovers original before changed draft and unavailable registry", async () => {
  const admitted = await prepare();
  await db.flow.update({ where: { id: flowId }, data: { graph: { nodes: [], edges: [] } } });
  m.hashes.mockRejectedValue(new Error("registry unavailable"));
  m.factory.mockRejectedValue(new Error("factory unavailable"));
  const recovered = await prepare();
  expect(recovered.deploymentId).toBe(admitted.deploymentId);
  expect(recovered.xdr).toBe(admitted.xdr);
  expect(recovered.conditionalReview).toEqual(admitted.conditionalReview);
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
});
it("crash before admission retains samekey without a partial deployment; retry admits once", async () => {
  m.simulate.mockRejectedValueOnce(new Error("simulation interrupted"));
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(500);
  expect(await db.deployment.count({ where: { flowId } })).toBe(0);
  await prepare();
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
});
it("crash after admission recovers retained original without a replacement", async () => {
  m.audit.mockRejectedValueOnce(new Error("response interrupted after durable admission"));
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(500);
  const original = await db.deployment.findFirstOrThrow({ where: { flowId } });
  const recovered = await prepare();
  expect(recovered.deploymentId).toBe(original.id);
  expect(recovered.conditionalReview.txHash).toBe(original.preparedTxHash);
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
});
it("samekey request substitution refuses and explicit mixedgeneration never enters legacy", async () => {
  const admitted = await prepare();
  const other = conditionalDeployCanvas().payer;
  const response = await POST({
    json: async () => ({ version: 2, flowId, sourceAccount: other, preparationKey }),
  } as unknown as NextRequest);
  expect(response.status).toBe(409);
  const mixed = await POST({
    json: async () => ({
      version: 1,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(mixed.status).toBe(422);
  expect((await saved(admitted.deploymentId)).preparedTxHash).toBe(
    admitted.conditionalReview.txHash,
  );
});
it("owned legacy key collision conflicts without conversion or unsigned disclosure", async () => {
  const row = await db.deployment.create({
    data: {
      flowId,
      ownerId: user.id,
      network: "testnet",
      sourceAccount: conditionalDeploySigner().publicKey(),
      status: "PENDING_SIGNATURE",
      graphSnapshot: { nodes: [], edges: [] },
      paramsSnapshot: [],
      idempotencyKey: `conditional-deploy:${preparationKey}`,
      unsignedXdr: "retained-legacy-unsigned",
    },
  });
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.fields.deploymentId).toEqual([row.id]);
  expect(JSON.stringify(body)).not.toContain("retained-legacy-unsigned");
  expect(m.load).not.toHaveBeenCalled();
  expect((await saved(row.id)).paramsSnapshot).toEqual([]);
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
});
it("explicit conditional key on an ordinary legacy flow refuses before legacy preparation", async () => {
  await db.flow.update({ where: { id: flowId }, data: { graph: { nodes: [], edges: [] } } });
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(422);
  expect(await db.deployment.count({ where: { flowId } })).toBe(0);
  expect(m.load).not.toHaveBeenCalled();
});
it("owned template prefixkey collision retains the template original and never returns its unsigned payload", async () => {
  const template = await db.flowTemplate.create({
    data: { ownerId: user.id, name: "Retained template", draft: {} },
  });
  const version = await db.flowTemplateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      definition: {},
      network: "testnet",
      artifacts: {},
      contentHash: "ab".repeat(32),
    },
  });
  const row = await db.deployment.create({
    data: {
      flowId,
      ownerId: user.id,
      network: "testnet",
      sourceAccount: conditionalDeploySigner().publicKey(),
      status: "PENDING_SIGNATURE",
      graphSnapshot: {},
      paramsSnapshot: [],
      templateVersionId: version.id,
      instanceSnapshot: { version: 1 },
      instanceRequestDigest: "cd".repeat(32),
      preparedTxHash: "ef".repeat(32),
      idempotencyKey: `conditional-deploy:${preparationKey}`,
      unsignedXdr: "retained-template-unsigned",
    },
  });
  const response = await POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.fields.deploymentId).toEqual([row.id]);
  expect(JSON.stringify(body)).not.toContain("retained-template-unsigned");
  expect(m.load).not.toHaveBeenCalled();
  expect((await saved(row.id)).templateVersionId).toBe(version.id);
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
});
it("operator disable during fresh simulation prevents a late new admission under the shared config lock", async () => {
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => (entered = resolve)),
    held = new Promise<void>((resolve) => (release = resolve)),
    simulation = m.simulate.getMockImplementation()!;
  m.simulate.mockImplementationOnce(async (...args) => {
    entered();
    await held;
    return simulation(...args);
  });
  const pending = POST({
    json: async () => ({
      version: 2,
      flowId,
      sourceAccount: conditionalDeploySigner().publicKey(),
      preparationKey,
    }),
  } as unknown as NextRequest);
  await reached;
  await configureConditionalArtifacts(
    {
      network: "testnet",
      enabled: false,
      expectedCurrentDigest: conditionalArtifactSetDigest(
        await readConditionalArtifactSet("testnet"),
      ),
    },
    true,
  );
  release();
  const response = await pending;
  expect(response.status).toBe(422);
  expect(await db.deployment.count({ where: { flowId } })).toBe(0);
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
it("a raced admitted winner is returned before the disabled check without a second original or audit", async () => {
  let firstEntered!: () => void,
    secondEntered!: () => void,
    releaseFirst!: () => void,
    releaseSecond!: () => void;
  const firstReady = new Promise<void>((resolve) => (firstEntered = resolve)),
    secondReady = new Promise<void>((resolve) => (secondEntered = resolve)),
    firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve)),
    secondHeld = new Promise<void>((resolve) => (releaseSecond = resolve)),
    simulation = m.simulate.getMockImplementation()!;
  let call = 0;
  m.simulate.mockImplementation(async (...args) => {
    if (++call === 1) {
      firstEntered();
      await firstHeld;
    } else {
      secondEntered();
      await secondHeld;
    }
    return simulation(...args);
  });
  const a = prepare(),
    b = prepare();
  await Promise.all([firstReady, secondReady]);
  releaseFirst();
  const winner = await Promise.race([a, b]);
  await configureConditionalArtifacts(
    {
      network: "testnet",
      enabled: false,
      expectedCurrentDigest: conditionalArtifactSetDigest(
        await readConditionalArtifactSet("testnet"),
      ),
    },
    true,
  );
  releaseSecond();
  for (const recovered of await Promise.all([a, b])) {
    expect(recovered.deploymentId).toBe(winner.deploymentId);
    expect(recovered.xdr).toBe(winner.xdr);
    expect(recovered.conditionalReview.txHash).toBe(winner.conditionalReview.txHash);
  }
  expect(await db.deployment.count({ where: { flowId } })).toBe(1);
  expect(m.audit).toHaveBeenCalledOnce();
  expect(m.send).not.toHaveBeenCalled();
});
