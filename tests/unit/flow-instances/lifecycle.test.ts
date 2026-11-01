import { hashApiToken } from "@/lib/auth/api-token";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  Account,
  Asset,
  scValToNative,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scratchDatabase } from "@/tests/helpers/scratch-database";

const mocks = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  session: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
  entries: vi.fn(),
  simulate: vi.fn(),
  account: vi.fn(),
  latest: vi.fn(),
  ledgers: vi.fn(),
  factoryHash: "b".repeat(64),
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(mocks.client, key);
        return typeof value === "function" ? value.bind(mocks.client) : value;
      },
    },
  ),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    getLedgerEntries: mocks.entries,
    simulateTransaction: mocks.simulate,
    sendTransaction: mocks.send,
    getTransaction: mocks.get,
    getLatestLedger: mocks.latest,
    getLedgers: mocks.ledgers,
  }),
  horizon: () => ({
    loadAccount: async () => ({ balances: [{ asset_type: "native", balance: "1000" }] }),
  }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({
  loadPaymentAccount: mocks.account,
  MissingPaymentAccountError: class extends Error {},
}));
vi.mock("@/lib/redis", () => ({ redis: () => null, eventChannel: (id: string) => id }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: async () => undefined }));
vi.mock("@/lib/analytics/outbox", () => ({
  enqueueAnalytics: async () => undefined,
  deliverOutbox: async () => undefined,
}));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: async () => undefined }));
import {
  createFlowTemplate,
  publishFlowTemplate,
  retireFlowTemplate,
} from "@/lib/flow-templates/service";
import {
  createDeveloperToken,
  updateDeveloperToken,
  revokeDeveloperToken,
} from "@/lib/developer-tokens/service";
import { InstancePrepareSchema, InstanceSnapshotSchema } from "@/lib/flow-instances/schema";
import {
  prepareTemplateInstance,
  getOwnedInstance,
  reconcileTemplateInstance,
  submitTemplateInstance,
  listTemplateInstances,
} from "@/lib/flow-instances/service";
import {
  beforeServiceSubmission,
  observeServiceTransaction,
  withDeploymentWork,
} from "@/lib/deployments/service-work";
import { POST as apiPrepare } from "@/app/api/v1/flow-templates/[id]/versions/[versionId]/instances/prepare/route";
import { GET as apiList } from "@/app/api/v1/flow-templates/[id]/instances/route";
import { POST as apiSubmit } from "@/app/api/v1/flow-templates/[id]/instances/[instanceId]/submit/route";
import { GET as apiState } from "@/app/api/v1/flow-templates/[id]/instances/[instanceId]/route";
import { GET as apiEvents } from "@/app/api/v1/flow-templates/[id]/instances/[instanceId]/events/route";
import { POST as ownerPrepare } from "@/app/api/flow-templates/[id]/versions/[versionId]/instances/prepare/route";
import { POST as ordinarySubmit } from "@/app/api/deployments/[id]/submit/route";
import { GET as ownerReview } from "@/app/api/flow-templates/[id]/instances/[instanceId]/review/route";

const scratch = scratchDatabase();
const payer = Keypair.random(),
  otherPayer = Keypair.random();
const recipient = Keypair.random().publicKey(),
  otherRecipient = Keypair.random().publicKey();
const factory = StrKey.encodeContract(Buffer.alloc(32, 44));
const req = (method: string, body?: unknown, token?: string, suffix = "") =>
  new NextRequest(`http://localhost/api/v1/flow-templates${suffix}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string, versionId?: string, instanceId?: string) => ({
  params: Promise.resolve({ id, versionId, instanceId }),
});
function codeEntry(key: xdr.LedgerKey) {
  if (key.switch().name === "contractCode")
    return {
      key,
      val: xdr.LedgerEntryData.contractCode(
        new xdr.ContractCodeEntry({
          ext: new xdr.ContractCodeEntryExt(0),
          hash: key.contractCode().hash(),
          code: Buffer.from([0]),
        }),
      ),
      lastModifiedLedgerSeq: 1,
    };
  return {
    key,
    val: xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({
        ext: new xdr.ExtensionPoint(0),
        contract: new Address(factory).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
        val: xdr.ScVal.scvContractInstance(
          new xdr.ScContractInstance({
            executable: xdr.ContractExecutable.contractExecutableWasm(
              Buffer.from(mocks.factoryHash, "hex"),
            ),
            storage: [],
          }),
        ),
      }),
    ),
    lastModifiedLedgerSeq: 1,
  };
}
beforeAll(async () => {
  mocks.client = await scratch.start();
}, 120000);
afterAll(async () => {
  await scratch.stop();
}, 30000);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.factoryHash = "b".repeat(64);
  mocks.entries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 100,
    entries: keys.map(codeEntry),
  }));
  mocks.account.mockImplementation(async (_server, address: string) => new Account(address, "10"));
  mocks.simulate.mockImplementation(async (tx: Transaction) => ({
    _parsed: true,
    id: "synthetic",
    latestLedger: 100,
    events: [],
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  }));
  mocks.send.mockImplementation(async (tx: Transaction) => {
    const hash = tx.hash().toString("hex");
    await beforeServiceSubmission(hash, "rpc");
    return { hash, status: "PENDING" };
  });
  mocks.get.mockImplementation(async (hash: string) => {
    const d = await mocks.client.deployment.findFirst({ where: { deployTxHash: hash } });
    if (!d) return { status: "NOT_FOUND" };
    const nodes = d.pipelineSnapshot as Array<{ contractAddress: string }>;
    await observeServiceTransaction(hash, "SUCCESS", 101);
    return {
      status: "SUCCESS",
      ledger: 101,
      returnValue: xdr.ScVal.scvVec(
        nodes.map((node) => new Address(node.contractAddress).toScVal()),
      ),
    };
  });
});
async function fixture(
  options: {
    expiresAt?: string;
    agreement?: "schedule" | "subscription";
    constantRecipient?: boolean;
  } = {},
) {
  const owner = await mocks.client.user.create({ data: { username: `instance-${randomUUID()}` } });
  const other = await mocks.client.user.create({ data: { username: `instance-${randomUUID()}` } });
  const actor = { id: owner.id, role: owner.role };
  mocks.session.mockResolvedValue(actor);
  for (const kind of ["DEPOSIT_TRIGGER", "PAYER", "STREAMER", "SUBSCRIPTION"] as const)
    await mocks.client.contractTemplate.upsert({
      where: { kind_network: { kind, network: "testnet" } },
      create: { kind, network: "testnet", wasmHash: "a".repeat(64), abiJson: {} },
      update: { wasmHash: "a".repeat(64), abiJson: {} },
    });
  await mocks.client.factoryDeployment.upsert({
    where: { network: "testnet" },
    create: { network: "testnet", address: factory, wasmHash: "b".repeat(64) },
    update: { address: factory, wasmHash: "b".repeat(64) },
  });
  const template = await createFlowTemplate(
    owner.id,
    {
      name: "Private agreement",
      definition: {
        schemaVersion: 1,
        graph: {
          nodes: [
            options.agreement === "schedule"
              ? {
                  id: "root",
                  type: "on_schedule",
                  config: {
                    startsAt: "2026-01-01T00:00:00Z",
                    intervalAmount: 1,
                    intervalUnit: "day",
                    occurrences: 2,
                  },
                }
              : options.agreement === "subscription"
                ? {
                    id: "root",
                    type: "subscription",
                    config: {
                      asset: { kind: "native" },
                      subscriber: payer.publicKey(),
                      amountPerPeriodStroops: "100",
                      intervalAmount: 1,
                      intervalUnit: "day",
                      occurrences: 2,
                    },
                  }
                : { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
            {
              id: "pay",
              type: "pay",
              config: {
                asset: { kind: "native" },
                recipient,
                fullAmount: false,
                mode: "fixed",
                amountStroops: "100",
              },
            },
          ],
          edges: [{ id: "edge", source: "root", target: "pay" }],
        },
        inputs: options.constantRecipient
          ? []
          : [
              {
                inputId: "recipient",
                label: "Recipient",
                type: "wallet",
                target: { nodeId: "pay", field: "recipient" },
              },
            ],
      },
    },
    req("POST"),
  );
  const version = await publishFlowTemplate(
    owner.id,
    template.id,
    { expectedRevision: 1, expiresAt: options.expiresAt },
    req("POST"),
  );
  const input = InstancePrepareSchema.parse({
    sourceAccount: payer.publicKey(),
    bindings: {
      version: 1,
      templateVersionId: version.id,
      values: options.constantRecipient
        ? []
        : [{ inputId: "recipient", value: { type: "wallet", value: otherRecipient } }],
    },
    idempotencyKey: randomUUID(),
  });
  return { owner, other, actor, template, version, input };
}
function signed(value: string, key = payer, network = Networks.TESTNET) {
  const tx = TransactionBuilder.fromXDR(value, network) as Transaction;
  tx.sign(key);
  return tx.toXDR();
}

describe("private template instance durable lifecycle", () => {
  it("keeps authoritative initial review private, version-scoped and readable after version retirement", async () => {
    const f = await fixture();
    const first = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    await retireFlowTemplate(f.owner.id, f.template.id, req("POST"), f.version.id);
    const context = {
      params: Promise.resolve({ id: f.template.id, instanceId: first.deploymentId }),
    };
    const response = await ownerReview(req("GET"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = (await response.json()).data;
    expect(data.receipt).toEqual(first);
    expect(data.bindings).toEqual(f.input.bindings);
    expect(data.graph.nodes[1].config.recipient).toBe(otherRecipient);
    expect(data.artifacts.factoryAddress).toBe(factory);
    expect(data.contentHash).toBe(f.version.contentHash);
    const recorded = await mocks.client.deployment.findUniqueOrThrow({
      where: { id: first.deploymentId },
    });
    expect(data.compiledTerms).toEqual(recorded.paramsSnapshot);
    mocks.session.mockResolvedValue({ id: f.other.id, role: f.other.role });
    expect((await ownerReview(req("GET"), context)).status).toBe(404);
    mocks.session.mockResolvedValue({ ...f.actor, role: "SANDBOX" });
    expect((await ownerReview(req("GET"), context)).status).toBe(403);
    mocks.session.mockResolvedValue(f.actor);
    const another = await fixture();
    mocks.session.mockResolvedValue(f.actor);
    expect(
      (
        await ownerReview(req("GET"), {
          params: Promise.resolve({ id: another.template.id, instanceId: first.deploymentId }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ownerReview(req("GET"), {
          params: Promise.resolve({ id: f.template.id, instanceId: "not-an-id" }),
        })
      ).status,
    ).toBe(404);
  });
  it.each(["schedule", "subscription"] as const)(
    "reviews persisted %s dates and full undeclared constant recipients unchanged after reload",
    async (agreement) => {
      const f = await fixture({ agreement, constantRecipient: true });
      const before = Math.floor(Date.now() / 1000);
      const first = await prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        f.input,
        req("POST"),
      );
      const row = await mocks.client.deployment.findUniqueOrThrow({
        where: { id: first.deploymentId },
      });
      const params = row.paramsSnapshot as Array<{
        params: {
          kind: string;
          startTs?: number;
          endTs?: number;
          intervalSeconds?: number;
          recipients?: Array<{ address: string }>;
          recipient?: string;
        };
      }>;
      const timed = params.find((n) =>
        ["streamer", "subscription_trigger"].includes(n.params.kind),
      )!.params;
      expect(timed.startTs).toBeGreaterThanOrEqual(before);
      expect(timed.startTs).not.toBe(Date.parse("2026-01-01T00:00:00Z") / 1000);
      expect(timed.intervalSeconds).toBe(86400);
      expect(timed.endTs).toBe(timed.startTs! + 172800);
      const context = {
        params: Promise.resolve({ id: f.template.id, instanceId: first.deploymentId }),
      };
      const firstReview = (await (await ownerReview(req("GET"), context)).json()).data;
      const expectedTerms = (row.paramsSnapshot as Array<{ params: { kind: string } }>).map(
        (node) =>
          node.params.kind === "subscription_trigger"
            ? { ...node, params: { ...node.params, relayer: payer.publicKey() } }
            : node,
      );
      expect(firstReview.compiledTerms).toEqual(expectedTerms);
      expect(firstReview.bindings.values).toEqual([]);
      expect(JSON.stringify(firstReview.compiledTerms)).toContain(recipient);
      await retireFlowTemplate(f.owner.id, f.template.id, req("POST"), f.version.id);
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 86400 * 1000);
      try {
        const reloaded = await ownerReview(req("GET"), context);
        expect(reloaded.status).toBe(200);
        expect((await reloaded.json()).data.compiledTerms).toEqual(firstReview.compiledTerms);
        mocks.session.mockResolvedValue({ id: f.other.id, role: f.other.role });
        expect((await ownerReview(req("GET"), context)).status).toBe(404);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("pins an owned version, exact bindings, artifacts and developer factory admin; repeats one identity", async () => {
    const f = await fixture();
    const first = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    expect(first.status).toBe("PENDING_SIGNATURE");
    expect(first.sourceAccount).toBe(payer.publicKey());
    const tx = TransactionBuilder.fromXDR(first.prepared!.xdr, Networks.TESTNET) as Transaction;
    expect(tx.source).toBe(payer.publicKey());
    expect(tx.signatures).toHaveLength(0);
    const operation = tx.operations[0];
    expect(operation?.type).toBe("invokeHostFunction");
    if (operation?.type !== "invokeHostFunction") throw new Error("fixture");
    expect(
      Address.fromScAddress(operation.func.invokeContract().contractAddress()).toString(),
    ).toBe(factory);
    expect(Address.fromScVal(operation.func.invokeContract().args()[0]!).toString()).toBe(
      payer.publicKey(),
    );
    const invocation = operation.func.invokeContract();
    expect(invocation.functionName().toString()).toBe("deploy_pipeline");
    expect(invocation.args()).toHaveLength(2);
    const blueprints = invocation.args()[1]!.vec()!;
    expect(blueprints).toHaveLength(2);
    const native = Asset.native().contractId(Networks.TESTNET);
    const rootAddress = first.pipeline.find((node) => node.nodeId === "root")!.contractAddress;
    const payAddress = first.pipeline.find((node) => node.nodeId === "pay")!.contractAddress;
    const expected = [
      [payer.publicKey(), native, [{ address: payAddress, data: "" }]],
      [payer.publicKey(), native, otherRecipient, 100n, 0, [], rootAddress],
    ];
    for (const [index, blueprint] of blueprints.entries()) {
      const fields = new Map(
        blueprint.map()!.map((entry) => [entry.key().sym().toString(), entry.val()]),
      );
      expect([...fields.keys()].sort()).toEqual(["constructor_args", "salt", "wasm_hash"]);
      expect(fields.get("wasm_hash")!.bytes().toString("hex")).toBe("a".repeat(64));
      expect(fields.get("salt")!.bytes()).toHaveLength(32);
      expect(fields.get("constructor_args")!.vec()!.map(scValToNative)).toEqual(expected[index]);
    }
    const saved = await getOwnedInstance(f.owner.id, f.template.id, first.deploymentId);
    expect(InstanceSnapshotSchema.parse(saved.instanceSnapshot).bindings).toEqual(f.input.bindings);
    expect(saved.instanceRequestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
        .prepared,
    ).toEqual(first.prepared);
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
    expect(mocks.simulate).toHaveBeenCalledTimes(1);
  });
  it("serializes concurrent same-key preparations without another deployment or transaction", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")),
      prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")),
    ]);
    expect(a.deploymentId).toBe(b.deploymentId);
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
    expect(mocks.simulate).toHaveBeenCalledTimes(1);
  });
  it("conflicts on same-key changed bindings, version, template or source without extra rows", async () => {
    const f = await fixture();
    await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST"));
    for (const input of [
      { ...f.input, sourceAccount: otherPayer.publicKey() },
      { ...f.input, bindings: { ...f.input.bindings, values: [] } },
    ])
      await expect(
        prepareTemplateInstance(f.actor, f.template.id, f.version.id, input, req("POST")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    const version = await publishFlowTemplate(
      f.owner.id,
      f.template.id,
      { expectedRevision: 1 },
      req("POST"),
    );
    await expect(
      prepareTemplateInstance(
        f.actor,
        f.template.id,
        version.id,
        { ...f.input, bindings: { ...f.input.bindings, templateVersionId: version.id } },
        req("POST"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await fixture();
    await expect(
      prepareTemplateInstance(f.actor, other.template.id, other.version.id, f.input, req("POST")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
  });
  it("keeps admitted pins through retirement and cutover; new admissions fail", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    await retireFlowTemplate(f.owner.id, f.template.id, req("POST"), f.version.id);
    await mocks.client.factoryDeployment.update({
      where: { network: "testnet" },
      data: { address: StrKey.encodeContract(Buffer.alloc(32, 55)) },
    });
    expect(
      (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
        .prepared,
    ).toEqual(state.prepared);
    await expect(
      prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        { ...f.input, idempotencyKey: randomUUID(), sourceAccount: otherPayer.publicKey() },
        req("POST"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("never builds from a changed current factory after version admission", async () => {
    const f = await fixture();
    mocks.entries.mockImplementationOnce(async (...keys: xdr.LedgerKey[]) => {
      await mocks.client.factoryDeployment.update({
        where: { network: "testnet" },
        data: { address: StrKey.encodeContract(Buffer.alloc(32, 56)) },
      });
      return { latestLedger: 100, entries: keys.map(codeEntry) };
    });
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const tx = TransactionBuilder.fromXDR(state.prepared!.xdr, Networks.TESTNET) as Transaction;
    if (tx.operations[0]?.type !== "invokeHostFunction") throw new Error("fixture");
    expect(
      Address.fromScAddress(tx.operations[0].func.invokeContract().contractAddress()).toString(),
    ).toBe(factory);
  });
  it("rejects unavailable factory executable evidence before wallet preparation", async () => {
    const f = await fixture();
    mocks.factoryHash = "c".repeat(64);
    await expect(
      prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await mocks.client.deployment.findFirstOrThrow({ where: { ownerId: f.owner.id } });
    expect(row.status).toBe("FAILED");
    expect(row.unsignedXdr).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("submits the exact developer signature once and confirms the proven complete factory result", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const result = await submitTemplateInstance(
      f.actor,
      f.template.id,
      state.deploymentId,
      req("POST", { signedXdr: signed(state.prepared!.xdr) }),
    );
    expect(result).toMatchObject({ status: "CONFIRMED", deploymentId: state.deploymentId });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      await mocks.client.serviceTransaction.count({
        where: { work: { deploymentId: state.deploymentId } },
      }),
    ).toBe(1);
    await submitTemplateInstance(
      f.actor,
      f.template.id,
      state.deploymentId,
      req("POST", { signedXdr: signed(state.prepared!.xdr) }),
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const signedRow = await mocks.client.signedTransaction.findUniqueOrThrow({
      where: { txHash: state.txHash! },
    });
    expect(signedRow.signedBySource).toBe(true);
    expect(signedRow.userId).toBe(f.owner.id);
  });
  it.each(["unsigned", "wrong-key", "wrong-network", "tampered"])(
    "refuses %s envelopes before send, including the ordinary owner submit alias",
    async (kind) => {
      const f = await fixture();
      const state = await prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        f.input,
        req("POST"),
      );
      let value = state.prepared!.xdr;
      if (kind === "wrong-key") value = signed(value, otherPayer);
      if (kind === "wrong-network") value = signed(value, payer, Networks.PUBLIC);
      if (kind === "tampered") {
        const tx = TransactionBuilder.fromXDR(value, Networks.TESTNET) as Transaction;
        value = signed(TransactionBuilder.cloneFrom(tx, { fee: "9999" }).build().toXDR());
      }
      const response = await ordinarySubmit(req("POST", { signedXdr: value }), {
        params: Promise.resolve({ id: state.deploymentId }),
      });
      expect(response.status).toBe(422);
      expect(mocks.send).not.toHaveBeenCalled();
      expect((await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId)).status).toBe(
        "PENDING_SIGNATURE",
      );
    },
  );
  it("retains submitted unknown finality without another prepare or send and reconciles later", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    mocks.send.mockImplementationOnce(async (tx: Transaction) => {
      await beforeServiceSubmission(tx.hash().toString("hex"), "rpc");
      throw new Error("lost acknowledgement");
    });
    expect(
      await submitTemplateInstance(
        f.actor,
        f.template.id,
        state.deploymentId,
        req("POST", { signedXdr: signed(state.prepared!.xdr) }),
      ),
    ).toMatchObject({ status: "SUBMITTED", txHash: state.txHash });
    expect(
      (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
        .status,
    ).toBe("SUBMITTED");
    expect(mocks.simulate).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
    ).toBe("CONFIRMED");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("keeps source admission owner-scoped and independent instance addresses/state", async () => {
    const a = await fixture(),
      b = await fixture();
    const first = await prepareTemplateInstance(
      a.actor,
      a.template.id,
      a.version.id,
      a.input,
      req("POST"),
    );
    const second = await prepareTemplateInstance(
      b.actor,
      b.template.id,
      b.version.id,
      b.input,
      req("POST"),
    );
    expect(first.pipeline.map((n) => n.contractAddress)).not.toEqual(
      second.pipeline.map((n) => n.contractAddress),
    );
    expect(first.sourceAccount).toBe(second.sourceAccount);
    await expect(
      getOwnedInstance(a.owner.id, b.template.id, second.deploymentId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await listTemplateInstances(a.owner.id, a.template.id, { limit: 20 })).items.map(
        (i) => i.deploymentId,
      ),
    ).toEqual([first.deploymentId]);
  });
  it("admits at most ten concurrent pending instances for one owner", async () => {
    const f = await fixture();
    let entered = 0;
    let release!: () => void;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atLimit = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const normal = mocks.simulate.getMockImplementation()!;
    mocks.simulate.mockImplementation(async (tx: Transaction) => {
      if (++entered === 10) ready();
      await barrier;
      return normal(tx);
    });
    const pending = Array.from({ length: 10 }, () =>
      prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        { ...f.input, sourceAccount: Keypair.random().publicKey(), idempotencyKey: randomUUID() },
        req("POST"),
      ),
    );
    try {
      await atLimit;
      await expect(
        prepareTemplateInstance(
          f.actor,
          f.template.id,
          f.version.id,
          { ...f.input, sourceAccount: otherPayer.publicKey(), idempotencyKey: randomUUID() },
          req("POST"),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(10);
    } finally {
      release();
      await Promise.all(pending);
    }
  }, 15000);
  it("preserves immutable admission, constructor and transaction evidence in PostgreSQL", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    for (const data of [
      { sourceAccount: otherPayer.publicKey() },
      { instanceSnapshot: {} },
      { graphSnapshot: {} },
      { paramsSnapshot: [] },
      { unsignedXdr: "tampered" },
      { pipelineSnapshot: [] },
    ])
      await expect(
        mocks.client.deployment.update({ where: { id: state.deploymentId }, data }),
      ).rejects.toThrow(/immutable/);
  });
  it("bounds the exact transaction by version expiry; elapsed time without coverage never releases it", async () => {
    const expiry = Date.now() + 45000;
    const f = await fixture({ expiresAt: new Date(expiry).toISOString() });
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    expect(Date.parse(state.prepared!.expiresAt)).toBe(Math.floor(expiry / 1000) * 1000);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiry + 10000);
    try {
      await expect(
        submitTemplateInstance(
          f.actor,
          f.template.id,
          state.deploymentId,
          req("POST", { signedXdr: signed(state.prepared!.xdr) }),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
      expect(
        (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
      ).toBe("PENDING_SIGNATURE");
      expect(
        (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
          .prepared?.txHash,
      ).toBe(state.txHash);
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it("marks an expired preparation failed only after full non-inclusion and closed-ledger proof", async () => {
    const expiry = Date.now() + 45000;
    const f = await fixture({ expiresAt: new Date(expiry).toISOString() });
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const saved = await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiry + 10000);
    mocks.get.mockResolvedValue({
      status: "NOT_FOUND",
      oldestLedger: 1,
      oldestLedgerCloseTime: Math.floor(saved.createdAt.getTime() / 1000) - 1,
      latestLedger: 2000,
    });
    mocks.latest.mockResolvedValue({ sequence: 2000 });
    mocks.ledgers.mockResolvedValue({
      ledgers: [{ sequence: 2000, ledgerCloseTime: String(Math.floor((expiry + 10000) / 1000)) }],
    });
    try {
      expect(
        (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
      ).toBe("FAILED");
      expect(
        (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
          .status,
      ).toBe("FAILED");
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it("allows admitted submission after version retirement, but refuses first send during deployment retirement", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    await retireFlowTemplate(f.owner.id, f.template.id, req("POST"), f.version.id);
    expect(
      await submitTemplateInstance(
        f.actor,
        f.template.id,
        state.deploymentId,
        req("POST", { signedXdr: signed(state.prepared!.xdr) }),
      ),
    ).toMatchObject({ status: "CONFIRMED" });
    const other = await fixture();
    const pending = await prepareTemplateInstance(
      other.actor,
      other.template.id,
      other.version.id,
      other.input,
      req("POST"),
    );
    await mocks.client.deployment.update({
      where: { id: pending.deploymentId },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await expect(
      submitTemplateInstance(
        other.actor,
        other.template.id,
        pending.deploymentId,
        req("POST", { signedXdr: signed(pending.prepared!.xdr) }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("reconciles submitted work through RETIRING without resubmission", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    mocks.send.mockImplementationOnce(async (tx: Transaction) => {
      await beforeServiceSubmission(tx.hash().toString("hex"), "rpc");
      throw new Error("lost ack");
    });
    await submitTemplateInstance(
      f.actor,
      f.template.id,
      state.deploymentId,
      req("POST", { signedXdr: signed(state.prepared!.xdr) }),
    );
    await mocks.client.deployment.update({
      where: { id: state.deploymentId },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
    ).toBe("CONFIRMED");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("retains unknown status when the factory result does not prove every address", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    mocks.get.mockResolvedValue({
      status: "SUCCESS",
      ledger: 101,
      returnValue: xdr.ScVal.scvVec([new Address(factory).toScVal()]),
    });
    await expect(
      submitTemplateInstance(
        f.actor,
        f.template.id,
        state.deploymentId,
        req("POST", { signedXdr: signed(state.prepared!.xdr) }),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect((await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId)).status).toBe(
      "SUBMITTED",
    );
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
    ).toBe("SUBMITTED");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("reconciles exact developer-direct broadcast after template retirement without forged attribution", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const observed = TransactionBuilder.fromXDR(
      signed(state.prepared!.xdr),
      Networks.TESTNET,
    ) as Transaction;
    await retireFlowTemplate(f.owner.id, f.template.id, req("POST"), f.version.id);
    mocks.get.mockResolvedValue({
      status: "SUCCESS",
      ledger: 123,
      envelopeXdr: observed.toEnvelope(),
      returnValue: xdr.ScVal.scvVec(
        state.pipeline.map((node) => new Address(node.contractAddress).toScVal()),
      ),
    });
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
    ).toBe("CONFIRMED");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      await mocks.client.signedTransaction.count({ where: { deploymentId: state.deploymentId } }),
    ).toBe(0);
    expect(
      await mocks.client.auditLog.count({
        where: { userId: f.owner.id, action: "DEPLOY_CONFIRM" },
      }),
    ).toBe(1);
  });
  it("records proven direct-broadcast failure without submission or replacement", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const observed = TransactionBuilder.fromXDR(
      signed(state.prepared!.xdr),
      Networks.TESTNET,
    ) as Transaction;
    mocks.get.mockResolvedValue({
      status: "FAILED",
      ledger: 123,
      envelopeXdr: observed.toEnvelope(),
    });
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId)).status,
    ).toBe("FAILED");
    expect(
      (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
        .status,
    ).toBe("FAILED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    "wrong-network",
    "wrong-key",
    "tampered",
    "partial-result",
    "missing-envelope",
    "unknown",
  ])("does not confirm unsupported direct-broadcast proof: %s", async (kind) => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    let observed = TransactionBuilder.fromXDR(
      signed(
        state.prepared!.xdr,
        kind === "wrong-key" ? otherPayer : payer,
        kind === "wrong-network" ? Networks.PUBLIC : Networks.TESTNET,
      ),
      Networks.TESTNET,
    ) as Transaction;
    if (kind === "tampered") {
      observed = TransactionBuilder.cloneFrom(observed, { fee: "9999" }).build();
      observed.sign(payer);
    }
    mocks.get.mockResolvedValue(
      kind === "unknown"
        ? { status: "NOT_FOUND" }
        : {
            status: "SUCCESS",
            ledger: 123,
            ...(kind === "missing-envelope" ? {} : { envelopeXdr: observed.toEnvelope() }),
            returnValue: xdr.ScVal.scvVec(
              (kind === "partial-result" ? state.pipeline.slice(0, 1) : state.pipeline).map(
                (node) => new Address(node.contractAddress).toScVal(),
              ),
            ),
          },
    );
    const current = await reconcileTemplateInstance(f.owner.id, f.template.id, state.deploymentId);
    expect(current.status).toBe("PENDING_SIGNATURE");
    expect(current.txHash).toBe(state.txHash);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      await mocks.client.signedTransaction.count({ where: { deploymentId: state.deploymentId } }),
    ).toBe(0);
  });
  it("blocks new admission after registry cutover while preserving prior prepared bytes", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    await mocks.client.contractTemplate.updateMany({
      where: { network: "testnet" },
      data: { wasmHash: "c".repeat(64) },
    });
    await expect(
      prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        { ...f.input, sourceAccount: otherPayer.publicKey(), idempotencyKey: randomUUID() },
        req("POST"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
        .prepared?.xdr,
    ).toBe(state.prepared!.xdr);
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
  });
  it.each(["inactive", "sandbox"])(
    "ordinary submit alias rechecks %s owner at first-send admission",
    async (mode) => {
      const f = await fixture();
      const state = await prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        f.input,
        req("POST"),
      );
      await mocks.client.user.update({
        where: { id: f.owner.id },
        data: mode === "inactive" ? { isActive: false } : { role: "SANDBOX" },
      });
      const response = await ordinarySubmit(
        req("POST", { signedXdr: signed(state.prepared!.xdr) }),
        { params: Promise.resolve({ id: state.deploymentId }) },
      );
      expect(response.status).toBe(403);
      expect(mocks.send).not.toHaveBeenCalled();
      expect((await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId)).status).toBe(
        "PENDING_SIGNATURE",
      );
    },
  );
});

describe("explicit private-template credentials and owner API", () => {
  it("requires explicit template grants; deployment-only pfd and pfk gain no access", async () => {
    const f = await fixture();
    const token = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [], templateIds: [f.template.id], permission: "READ_OPERATE" },
      req("POST"),
    );
    const allowed = await apiPrepare(
      req("POST", f.input, token.token),
      ctx(f.template.id, f.version.id),
    );
    expect(allowed.status).toBe(200);
    const state = (await allowed.json()).data as { deploymentId: string };
    const detailed = await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId);
    await apiSubmit(
      req("POST", { signedXdr: signed(detailed.unsignedXdr!) }, token.token),
      ctx(f.template.id, undefined, state.deploymentId),
    );
    const deploymentOnly = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [state.deploymentId], permission: "READ_OPERATE" },
      req("POST"),
    );
    expect(
      (await apiList(req("GET", undefined, deploymentOnly.token), ctx(f.template.id))).status,
    ).toBe(401);
    const legacyRaw = `pfk_${"d".repeat(64)}`;
    await mocks.client.deploymentApiToken.create({
      data: {
        deploymentId: state.deploymentId,
        createdById: f.owner.id,
        tokenHash: hashApiToken(legacyRaw),
        tokenPrefix: legacyRaw.slice(0, 12),
      },
    });
    expect((await apiList(req("GET", undefined, legacyRaw), ctx(f.template.id))).status).toBe(401);
    expect(
      (
        await apiState(
          req("GET", undefined, token.token),
          ctx(f.template.id, undefined, state.deploymentId),
        )
      ).status,
    ).toBe(200);
    const missing = await createDeveloperToken(
      f.other.id,
      { deploymentIds: [], templateIds: [], permission: "READ_OPERATE" },
      req("POST"),
    ).catch(() => null);
    expect(missing).toBeNull();
    const stranger = await fixture();
    const otherToken = await createDeveloperToken(
      stranger.owner.id,
      { deploymentIds: [], templateIds: [stranger.template.id], permission: "READ_OPERATE" },
      req("POST"),
    );
    expect(
      (await apiList(req("GET", undefined, otherToken.token), ctx(f.template.id))).status,
    ).toBe(401);
    await updateDeveloperToken(f.owner.id, token.id, [], req("PATCH"), []);
    expect((await apiList(req("GET", undefined, token.token), ctx(f.template.id))).status).toBe(
      401,
    );
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
  });
  it("READ_ONLY can read selected instance history but cannot prepare or submit", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const token = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [], templateIds: [f.template.id], permission: "READ_ONLY" },
      req("POST"),
    );
    expect((await apiList(req("GET", undefined, token.token), ctx(f.template.id))).status).toBe(
      200,
    );
    expect(
      (
        await apiEvents(
          req("GET", undefined, token.token),
          ctx(f.template.id, undefined, state.deploymentId),
        )
      ).status,
    ).toBe(200);
    expect(
      (await apiPrepare(req("POST", f.input, token.token), ctx(f.template.id, f.version.id)))
        .status,
    ).toBe(403);
    expect(
      (
        await apiSubmit(
          req("POST", { signedXdr: signed(state.prepared!.xdr) }, token.token),
          ctx(f.template.id, undefined, state.deploymentId),
        )
      ).status,
    ).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("owner endpoints reject sandbox and strict unknown preparation fields", async () => {
    const f = await fixture();
    mocks.session.mockResolvedValue({ ...f.actor, role: "SANDBOX" });
    expect(
      (await ownerPrepare(req("POST", f.input), ctx(f.template.id, f.version.id))).status,
    ).toBe(403);
    mocks.session.mockResolvedValue(f.actor);
    expect(
      (await ownerPrepare(req("POST", { ...f.input, graph: {} }), ctx(f.template.id, f.version.id)))
        .status,
    ).toBe(422);
    expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(0);
  });
  it("rechecks a revoked template credential before claim, preserving owner recovery and attribution", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    const token = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [], templateIds: [f.template.id], permission: "READ_OPERATE" },
      req("POST"),
    );
    mocks.entries.mockImplementationOnce(async (...keys: xdr.LedgerKey[]) => {
      await revokeDeveloperToken(f.owner.id, token.id, req("DELETE"));
      return { latestLedger: 100, entries: keys.map(codeEntry) };
    });
    const response = await apiSubmit(
      req("POST", { signedXdr: signed(state.prepared!.xdr) }, token.token),
      ctx(f.template.id, undefined, state.deploymentId),
    );
    expect(response.status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      await mocks.client.signedTransaction.count({ where: { deploymentId: state.deploymentId } }),
    ).toBe(0);
    expect((await getOwnedInstance(f.owner.id, f.template.id, state.deploymentId)).status).toBe(
      "PENDING_SIGNATURE",
    );
  });
  it("records pfd caller attribution separately from an owner browser session", async () => {
    const f = await fixture();
    const token = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [], templateIds: [f.template.id], permission: "READ_OPERATE" },
      req("POST"),
    );
    const prepared = await apiPrepare(
      req("POST", f.input, token.token),
      ctx(f.template.id, f.version.id),
    );
    expect(prepared.status).toBe(200);
    const state = (await prepared.json()).data;
    const submitted = await apiSubmit(
      req("POST", { signedXdr: signed(state.prepared.xdr) }, token.token),
      ctx(f.template.id, undefined, state.deploymentId),
    );
    expect(submitted.status).toBe(200);
    const row = await mocks.client.signedTransaction.findUniqueOrThrow({
      where: { txHash: state.txHash },
    });
    expect(row.userId).toBeNull();
    expect(row.developerApiTokenId).toBe(token.id);
    expect(row.callerAccountId).toBe(f.owner.id);
  });
  it("keeps terminal instance history and events readable after service retirement without new work", async () => {
    const f = await fixture();
    const state = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    await submitTemplateInstance(
      f.actor,
      f.template.id,
      state.deploymentId,
      req("POST", { signedXdr: signed(state.prepared!.xdr) }),
    );
    await mocks.client.deployment.update({
      where: { id: state.deploymentId },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await mocks.client.deployment.update({
      where: { id: state.deploymentId },
      data: { serviceState: "RETIRED", retiredAt: new Date(), retirementReconciledAt: new Date() },
    });
    await mocks.client.contractEvent.create({
      data: {
        deploymentId: state.deploymentId,
        eventId: `instance-${randomUUID()}`,
        kind: "RECEIVE",
        ledger: 101,
        txHash: state.txHash!,
        payload: { topics: ["deposit"] },
        decodedData: { amountStroops: "100" },
        occurredAt: new Date(),
      },
    });
    const token = await createDeveloperToken(
      f.owner.id,
      { deploymentIds: [], templateIds: [f.template.id], permission: "READ_ONLY" },
      req("POST"),
    );
    const before = await mocks.client.deploymentWork.count({
      where: { deploymentId: state.deploymentId },
    });
    mocks.get.mockClear();
    const status = await apiState(
      req("GET", undefined, token.token),
      ctx(f.template.id, undefined, state.deploymentId),
    );
    expect(status.status).toBe(200);
    expect((await status.json()).data.serviceState).toBe("RETIRED");
    const events = await apiEvents(
      req("GET", undefined, token.token),
      ctx(f.template.id, undefined, state.deploymentId),
    );
    expect(events.status).toBe(200);
    expect((await events.json()).data.items).toHaveLength(1);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(
      await mocks.client.deploymentWork.count({ where: { deploymentId: state.deploymentId } }),
    ).toBe(before);
  });
});

// Promoted from the independent review's real-DB rejection/double-admission probe.
describe("instance RPC refusal preserves original admission", () => {
  it("keeps ordinary deployment ingestion refusal semantics", async () => {
    const f = await fixture();
    const flow = await mocks.client.flow.create({
      data: {
        ownerId: f.owner.id,
        name: "Ordinary deployment",
        templateKind: "PAYER",
        graph: { nodes: [], edges: [] },
        parameters: {},
      },
    });
    const row = await mocks.client.deployment.create({
      data: {
        ownerId: f.owner.id,
        flowId: flow.id,
        network: "testnet",
        graphSnapshot: { nodes: [], edges: [] },
        paramsSnapshot: [],
      },
    });
    const hash = "e".repeat(64);
    await withDeploymentWork(row.id, "ordinary-refusal-check", async () => {
      await beforeServiceSubmission(hash, "rpc");
      await observeServiceTransaction(hash, "REJECTED");
    });
    expect(
      await mocks.client.serviceTransaction.findMany({ where: { work: { deploymentId: row.id } } }),
    ).toMatchObject([{ txHash: hash, state: "REJECTED" }]);
  });
  it("releases admission only after the original refused hash has a proven ledger failure", async () => {
    const f = await fixture();
    const original = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      f.input,
      req("POST"),
    );
    mocks.send.mockImplementationOnce(async (tx: Transaction) => {
      const hash = tx.hash().toString("hex");
      await beforeServiceSubmission(hash, "rpc");
      await observeServiceTransaction(hash, "REJECTED");
      return { status: "ERROR", hash };
    });
    await submitTemplateInstance(
      f.actor,
      f.template.id,
      original.deploymentId,
      req("POST", { signedXdr: signed(original.prepared!.xdr) }),
    );
    await expect(
      prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        { ...f.input, idempotencyKey: randomUUID() },
        req("POST"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.get.mockImplementationOnce(async () => {
      await observeServiceTransaction(original.txHash!, "FAILED", 101);
      return { status: "FAILED", ledger: 101, envelopeXdr: signed(original.prepared!.xdr) };
    });
    expect(
      (await reconcileTemplateInstance(f.owner.id, f.template.id, original.deploymentId)).status,
    ).toBe("FAILED");
    expect(
      await mocks.client.signedTransaction.findUniqueOrThrow({
        where: { txHash: original.txHash! },
      }),
    ).toMatchObject({ outcome: "FAILED" });
    mocks.account.mockImplementationOnce(
      async (_server, address: string) => new Account(address, "11"),
    );
    const replacement = await prepareTemplateInstance(
      f.actor,
      f.template.id,
      f.version.id,
      { ...f.input, idempotencyKey: randomUUID() },
      req("POST"),
    );
    expect(replacement.status).toBe("PENDING_SIGNATURE");
    expect(replacement.deploymentId).not.toBe(original.deploymentId);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it.each(["ERROR", "TRY_AGAIN_LATER"] as const)(
    "retains unresolved evidence after %s until the original hash confirms",
    async (status) => {
      const f = await fixture();
      const original = await prepareTemplateInstance(
        f.actor,
        f.template.id,
        f.version.id,
        f.input,
        req("POST"),
      );
      const goodSigned = signed(original.prepared!.xdr);
      const malformedHint = TransactionBuilder.fromXDR(goodSigned, Networks.TESTNET) as Transaction;
      malformedHint.signatures[0]!.hint(Buffer.alloc(4, 0));
      expect(malformedHint.hash().toString("hex")).toBe(original.txHash);
      expect(payer.verify(malformedHint.hash(), malformedHint.signatures[0]!.signature())).toBe(
        true,
      );
      mocks.send.mockImplementationOnce(async (tx: Transaction) => {
        const hash = tx.hash().toString("hex");
        await beforeServiceSubmission(hash, "rpc");
        // Exercise the actual shared RPC wrapper's observation as well as the
        // submission helper. Refused ingestion is not a hash-finality receipt.
        await observeServiceTransaction(hash, "REJECTED");
        return {
          status,
          hash,
          ...(status === "ERROR" ? { errorResult: { result: () => ({ code: "txBadAuth" }) } } : {}),
        };
      });
      expect(
        await submitTemplateInstance(
          f.actor,
          f.template.id,
          original.deploymentId,
          req("POST", { signedXdr: malformedHint.toXDR() }),
        ),
      ).toMatchObject({ status: "SUBMITTED", txHash: original.txHash });
      const row = await getOwnedInstance(f.owner.id, f.template.id, original.deploymentId);
      expect(row.status).toBe("SUBMITTED");
      expect(row.deployTxHash).toBe(original.txHash);
      expect(
        await mocks.client.signedTransaction.findUniqueOrThrow({
          where: { txHash: original.txHash! },
        }),
      ).toMatchObject({ outcome: "UNRESOLVED", failureCode: "FINALITY_UNKNOWN" });
      expect(
        await mocks.client.serviceTransaction.findMany({
          where: { work: { deploymentId: row.id } },
        }),
      ).toMatchObject([{ txHash: original.txHash, state: "PENDING" }]);
      mocks.get.mockResolvedValueOnce({ status: "NOT_FOUND" });
      expect((await reconcileTemplateInstance(f.owner.id, f.template.id, row.id)).status).toBe(
        "SUBMITTED",
      );
      // Another RPC may have already accepted the correctly decorated original.
      // Even a newer account sequence never proves which hash consumed it.
      mocks.account.mockImplementationOnce(
        async (_server, address: string) => new Account(address, "11"),
      );
      await expect(
        prepareTemplateInstance(
          f.actor,
          f.template.id,
          f.version.id,
          { ...f.input, idempotencyKey: randomUUID() },
          req("POST"),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await prepareTemplateInstance(f.actor, f.template.id, f.version.id, f.input, req("POST")))
          .deploymentId,
      ).toBe(row.id);
      await submitTemplateInstance(
        f.actor,
        f.template.id,
        row.id,
        req("POST", { signedXdr: goodSigned }),
      );
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(await mocks.client.deployment.count({ where: { ownerId: f.owner.id } })).toBe(1);
      mocks.get.mockImplementationOnce(async () => {
        await observeServiceTransaction(original.txHash!, "SUCCESS", 101);
        return {
          status: "SUCCESS",
          ledger: 101,
          envelopeXdr: goodSigned,
          returnValue: xdr.ScVal.scvVec(
            original.pipeline.map((node) => new Address(node.contractAddress).toScVal()),
          ),
        };
      });
      expect((await reconcileTemplateInstance(f.owner.id, f.template.id, row.id)).status).toBe(
        "CONFIRMED",
      );
      expect(
        await mocks.client.signedTransaction.findUniqueOrThrow({
          where: { txHash: original.txHash! },
        }),
      ).toMatchObject({ outcome: "CONFIRMED" });
      expect(mocks.send).toHaveBeenCalledTimes(1);
    },
  );
});
