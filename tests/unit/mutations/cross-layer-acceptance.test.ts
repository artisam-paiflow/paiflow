import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Address,
  Contract,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, Prisma, PrismaClient, Role } from "@prisma/client";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
import {
  mutationAdmin,
  mutationArguments,
  mutationConstructors,
  mutationIntent,
  mutationPacket,
  mutationPayment,
  mutationReplacement,
  mutationScenarios,
  mutationWallet,
  type MutationScenario,
} from "@/tests/fixtures/mutation-acceptance";
import {
  mutationObservations,
  guestMutationState,
  type GuestObservation,
} from "@/tests/fixtures/mutation-observations";
import { relocateInstanceValue } from "@/tests/fixtures/instance-acceptance";

const mock = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  simulate: vi.fn(),
  latest: vi.fn(),
  entries: vi.fn(),
  publicEntries: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
  events: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(mock.client, key);
        return typeof value === "function" ? value.bind(mock.client) : value;
      },
    },
  ),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mock.session }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    simulateTransaction: mock.simulate,
    getLatestLedger: mock.latest,
    _getLedgerEntries: mock.entries,
    getLedgerEntries: mock.publicEntries,
    sendTransaction: mock.send,
    getTransaction: mock.get,
    getEvents: mock.events,
  }),
  horizon: () => ({
    loadAccount: async () => ({ balances: [{ asset_type: "native", balance: "1000" }] }),
  }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({
  loadPaymentAccount: async (_rpc: unknown, address: string) => new Account(address, "10"),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null, eventChannel: (id: string) => id }));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: async () => undefined }));
vi.mock("@/lib/flow-notifications", () => ({
  sendEmailNotificationsForTransactions: async () => undefined,
}));
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import {
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
import { pollEventsForWithOutcome, advanceEventCursor } from "@/lib/stellar/events";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { readMutationState } from "@/lib/stellar/mutation-state";
import { prepareMutationTransaction } from "@/lib/stellar/prepare-mutation";
import { prepareExecutionTransaction } from "@/lib/stellar/prepare-execution";
import { createMutationIntent } from "@/lib/mutations/service";
import { mutationAdmission } from "@/lib/mutations/http";
import { MutationPreparationRefusalSchema } from "@/lib/mutations/schema";
import {
  createExecutionIntent,
  executionIdempotencyKey,
  executionRequestDigest,
} from "@/lib/api/v1/execution-intent";
import { assertConfigurationRefusal } from "@/components/deploy/configuration-editor.utils";
import { PaiflowApiError } from "@/packages/sdk/src/transport";
import { GET as getState } from "@/app/api/v1/deployments/[id]/configuration/route";
import { GET as getHistory } from "@/app/api/v1/deployments/[id]/configuration/history/route";
import { POST as prepare } from "@/app/api/v1/deployments/[id]/configuration/prepare/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/configuration/submit/route";
import { POST as reconcile } from "@/app/api/v1/deployments/[id]/configuration/reconcile/route";
import { Paiflow } from "@/packages/sdk/src/client";
import { createFlowTemplate, publishFlowTemplate } from "@/lib/flow-templates/service";
import {
  prepareTemplateInstance,
  submitTemplateInstance,
  getOwnedInstance,
} from "@/lib/flow-instances/service";

let scratch: ReturnType<typeof scratchDatabase>;
let ownerId: string;
let ownerRole: Role;
let flowId: string;
let deployment: Deployment;
let scenario: MutationScenario;
let stage: GuestObservation;
let observedLedger: number;
let bearer: string;
let finalizedHash: string | null;
let relocations = new Map<string, string>();
const factory = StrKey.encodeContract(Buffer.alloc(32, 44));
const json = (value: unknown): Prisma.JsonObject | Prisma.JsonArray =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Prisma.JsonObject | Prisma.JsonArray;
const context = () => ({ params: Promise.resolve({ id: deployment.id }) });
const url = (suffix = "") =>
  `https://mutation-acceptance.invalid/api/v1/deployments/${deployment.id}/configuration${suffix}`;

beforeEach(async () => {
  scratch = scratchDatabase();
  mock.client = await scratch.start();
  const owner = await db.user.create({
    data: { username: `mutation-acceptance-${randomUUID()}`, passwordHash: "unused" },
  });
  ownerId = owner.id;
  ownerRole = owner.role;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "Private mutation evidence",
        templateKind: "DEPOSIT_TRIGGER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
}, 90000);
afterEach(async () => {
  await scratch.stop();
});
beforeEach(() => {
  vi.clearAllMocks();
  observedLedger = 100;
  finalizedHash = null;
  relocations = new Map();
  mock.session.mockResolvedValue({ id: ownerId, role: ownerRole });
  mock.latest.mockImplementation(async () => ({ sequence: observedLedger }));
  mock.entries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: observedLedger,
    entries: keys.map((key) => {
      const address = Address.fromScAddress(key.contractData().contract()).toString();
      const observedNode = stage.nodes.find((node) => node.address === address)!;
      const node = mutationConstructors(scenario).find(
        (node) => node.nodeId === observedNode.nodeId,
      )!;
      return {
        key: key.toXDR("base64"),
        lastModifiedLedgerSeq: 5,
        liveUntilLedgerSeq: 10000,
        xdr: xdr.LedgerEntryData.contractData(
          new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: key.contractData().contract(),
            key: key.contractData().key(),
            durability: xdr.ContractDataDurability.persistent(),
            val: xdr.ScVal.scvContractInstance(
              new xdr.ScContractInstance({
                executable: xdr.ContractExecutable.contractExecutableWasm(
                  Buffer.from(node.wasmHash, "hex"),
                ),
                storage: null,
              }),
            ),
          }),
        ).toXDR("base64"),
      };
    }),
  }));
  mock.simulate.mockImplementation(async (transaction: Transaction) => {
    const operation = transaction.operations[0];
    if (operation?.type !== "invokeHostFunction")
      throw new Error("Expected guest-bound invocation");
    const invocation = operation.func.invokeContract(),
      method = invocation.functionName().toString();
    const node = stage.nodes.find(
      (node) => node.address === Address.fromScAddress(invocation.contractAddress()).toString(),
    )!;
    let retval = xdr.ScVal.scvVoid(),
      auth: xdr.SorobanAuthorizationEntry[] = [];
    if (method === "current_config") retval = node.configuration;
    else if (method === "capabilities") retval = node.capabilities;
    else if (method === "mutation_status") retval = node.status;
    else if (method === "deploy_pipeline" || method === "execute_v1") {
      /* Instance lifecycle replays transport only. */
    } else {
      expect(method).toBe("mutate_v1");
      expect(invocation.args().map((arg) => arg.toXDR("hex"))).toEqual(
        xdr.ScVal.fromXDR(mutationPacket(scenario), "hex")
          .vec()![6]!
          .vec()!
          .map((arg) => relocateInstanceValue(arg, relocations).toXDR("hex")),
      );
      auth = [stage.acceptedMutationAuth];
    }
    return {
      _parsed: true,
      id: "synthetic-rpc-replay-of-guest-observations",
      latestLedger: observedLedger,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: "1000",
      result: { retval, auth },
    };
  });
  mock.send.mockImplementation(async (transaction: Transaction) => {
    const hash = transaction.hash().toString("hex");
    const operation = transaction.operations[0];
    if (
      operation?.type === "invokeHostFunction" &&
      operation.func.invokeContract().functionName().toString() === "deploy_pipeline"
    )
      return { status: "PENDING", hash };
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, txHash: hash, state: "SUBMITTING" },
      }),
    ).toBe(1);
    expect(
      await db.signedTransaction.count({ where: { deploymentId: deployment.id, txHash: hash } }),
    ).toBe(1);
    expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(
      1,
    );
    finalizedHash = hash;
    return { status: "PENDING", hash };
  });
  mock.get.mockImplementation(async (hash: string) => {
    const instance = await db.deployment.findFirst({ where: { deployTxHash: hash } });
    if (instance)
      return {
        status: "SUCCESS",
        ledger: 100,
        returnValue: xdr.ScVal.scvVec(
          (instance.pipelineSnapshot as Array<{ contractAddress: string }>).map((node) =>
            new Address(node.contractAddress).toScVal(),
          ),
        ),
      };
    return hash === finalizedHash ? { status: "SUCCESS", ledger: 101 } : { status: "NOT_FOUND" };
  });
  mock.publicEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 100,
    entries: keys.map((key) => ({
      key,
      lastModifiedLedgerSeq: 1,
      val:
        key.switch().name === "contractCode"
          ? xdr.LedgerEntryData.contractCode(
              new xdr.ContractCodeEntry({
                ext: new xdr.ContractCodeEntryExt(0),
                hash: key.contractCode().hash(),
                code: Buffer.from([0]),
              }),
            )
          : xdr.LedgerEntryData.contractData(
              new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: new Address(factory).toScAddress(),
                key: xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: xdr.ContractDataDurability.persistent(),
                val: xdr.ScVal.scvContractInstance(
                  new xdr.ScContractInstance({
                    executable: xdr.ContractExecutable.contractExecutableWasm(
                      Buffer.alloc(32, 187),
                    ),
                    storage: [],
                  }),
                ),
              }),
            ),
    })),
  }));
  mock.events.mockImplementation(async () => ({
    latestLedger: 101,
    oldestLedger: 1,
    cursor: `${101n << 32n}-0`,
    events: stage.events.map((event, index) => ({
      id: `${deployment.id}-${index}`,
      type: "contract",
      ledger: 101,
      ledgerClosedAt: "2026-11-01T00:00:00Z",
      contractId: new Contract(event.address),
      topic: event.topics,
      value: event.value,
      txHash: finalizedHash ?? "f".repeat(64),
      inSuccessfulContractCall: true,
    })),
  }));
});

function relocateObservation(original: GuestObservation): GuestObservation {
  const relocate = (value: xdr.ScVal) => relocateInstanceValue(value, relocations);
  const auth = xdr.SorobanAuthorizationEntry.fromXDR(original.acceptedMutationAuth.toXDR());
  const invocation = (entry: xdr.SorobanAuthorizedInvocation) => {
    const call = entry.function().contractFn(),
      old = Address.fromScAddress(call.contractAddress()).toString();
    call.contractAddress(new Address(relocations.get(old) ?? old).toScAddress());
    call.args(call.args().map(relocate));
    entry.subInvocations().forEach(invocation);
  };
  invocation(auth.rootInvocation());
  return {
    ...original,
    acceptedMutationAuth: auth,
    nodes: original.nodes.map((node) => ({
      ...node,
      address: relocations.get(node.address) ?? node.address,
      configuration: relocate(node.configuration),
      capabilities: relocate(node.capabilities),
      status: relocate(node.status),
    })),
    events: original.events.map((event) => ({
      address: relocations.get(event.address) ?? event.address,
      topics: event.topics.map(relocate),
      value: relocate(event.value),
    })),
  };
}
async function setup(item: MutationScenario, instance = false) {
  scenario = item;
  stage = mutationObservations(item).initial;
  if (instance) {
    const request = new NextRequest("https://mutation-acceptance.invalid/api/flow-templates", {
      method: "POST",
    });
    for (const node of mutationConstructors(item))
      await db.contractTemplate.create({
        data: { kind: node.templateKind, network: "testnet", wasmHash: node.wasmHash, abiJson: {} },
      });
    await db.factoryDeployment.create({
      data: { network: "testnet", address: factory, wasmHash: "bb".repeat(32) },
    });
    const template = await createFlowTemplate(
      ownerId,
      {
        name: "Mutable private version",
        definition: {
          schemaVersion: 1,
          graph: item.graph,
          inputs: [
            {
              inputId: "platform",
              label: "Creation-time constant platform recipient",
              type: "wallet",
              target: { nodeId: "split", field: "splitRecipient", index: 0 },
            },
          ],
        },
      },
      request,
    );
    const version = await publishFlowTemplate(
      ownerId,
      template.id,
      { expectedRevision: 1 },
      request,
    );
    const prepared = await prepareTemplateInstance(
      { id: ownerId, role: ownerRole },
      template.id,
      version.id,
      {
        sourceAccount: mutationAdmin,
        idempotencyKey: randomUUID(),
        bindings: {
          version: 1,
          templateVersionId: version.id,
          values: [
            {
              inputId: "platform",
              value: {
                type: "wallet",
                value: (
                  item.graph.nodes.find((node) => node.type === "split")!.config as {
                    recipients: Array<{ address: string }>;
                  }
                ).recipients[0]!.address,
              },
            },
          ],
        },
      },
      request,
    );
    for (const node of mutationConstructors(item))
      relocations.set(
        node.address,
        prepared.pipeline.find((actual) => actual.nodeId === node.nodeId)!.contractAddress,
      );
    // Compare all actual factory constructors; only synthetic contract addresses relocate.
    const transaction = TransactionBuilder.fromXDR(
      prepared.prepared!.xdr,
      Networks.TESTNET,
    ) as Transaction;
    const operation = transaction.operations[0];
    if (operation?.type !== "invokeHostFunction") throw new Error("Expected factory invocation");
    const blueprints = operation.func.invokeContract().args()[1]!.vec()!;
    mutationConstructors(item).forEach((node, index) => {
      const args = blueprints[index]!.map()!
        .find((entry) => entry.key().sym().toString() === "constructor_args")!
        .val()
        .vec()!;
      expect(args.map((value) => value.toXDR("hex"))).toEqual(
        node.args.map((value) => relocateInstanceValue(value, relocations).toXDR("hex")),
      );
    });
    transaction.sign(mutationWallet(1));
    await submitTemplateInstance(
      { id: ownerId, role: ownerRole },
      template.id,
      prepared.deploymentId,
      new NextRequest("https://mutation-acceptance.invalid/api/flow-templates/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: transaction.toXDR() }),
      }),
    );
    deployment = await getOwnedInstance(ownerId, template.id, prepared.deploymentId);
    expect(deployment.status).toBe("CONFIRMED");
    stage = relocateObservation(stage);
  } else
    deployment = await db.deployment.create({
      data: {
        ownerId,
        flowId,
        sourceAccount: mutationAdmin,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: json(item.graph),
        paramsSnapshot: json(
          mutationConstructors(item).map(
            ({ args: _args, address: _address, wasmHash: _hash, ...node }) => node,
          ),
        ),
        pipelineSnapshot: json(
          mutationConstructors(item).map((node) => ({
            nodeId: node.nodeId,
            contractAddress: node.address,
            templateKind: node.templateKind,
            wasmHash: node.wasmHash,
            artifactCapabilities: executionArtifactMetadata(node.templateKind, node.wasmHash),
          })),
        ),
        contractAddress: stage.nodes[0]!.address,
      },
    });
  bearer = `pfk_${randomBytes(32).toString("hex")}`;
  await db.deploymentApiToken.create({
    data: {
      deploymentId: deployment.id,
      createdById: ownerId,
      tokenHash: hashApiToken(bearer),
      tokenPrefix: bearer.slice(0, 12),
    },
  });
  await advanceEventCursor(deployment.id, 100);
  const fetcher: typeof fetch = async (input, options) => {
    const request = new NextRequest(String(input), {
      method: options?.method ?? "GET",
      headers: options?.headers,
      ...(options?.body ? { body: options.body as string } : {}),
    });
    const url = new URL(request.url);
    const prefix = `/api/v1/deployments/${deployment.id}/configuration`;
    if (url.origin !== "https://mutation-acceptance.invalid" || !url.pathname.startsWith(prefix))
      throw new Error("Unexpected SDK request identity");
    const suffix = url.pathname.slice(prefix.length);
    const expectedMethod = ["", "/history"].includes(suffix)
      ? "GET"
      : ["/prepare", "/submit", "/reconcile"].includes(suffix)
        ? "POST"
        : null;
    if (!expectedMethod || request.method !== expectedMethod)
      throw new Error("Unexpected SDK request route or method");
    if (request.headers.get("authorization") !== `Bearer ${bearer}`)
      throw new Error("Unexpected SDK authorization");
    const handler =
      suffix === "/history"
        ? getHistory
        : suffix === "/prepare"
          ? prepare
          : suffix === "/submit"
            ? submit
            : suffix === "/reconcile"
              ? reconcile
              : getState;
    return handler(request, context());
  };
  return new Paiflow({
    baseUrl: "https://mutation-acceptance.invalid",
    token: bearer,
    fetch: fetcher,
  }).deployment(deployment.id).configuration;
}

describe("contract packet → mutation API/SDK → actual guest receipt/history bridge", () => {
  for (const item of mutationScenarios)
    it(`${item.name}: exact prepare/sign/submit, confirmed current values and retained initial evidence`, async () => {
      const api = await setup(item);
      const initial = await api.get();
      expect(initial.data).toEqual(guestMutationState(item, stage, deployment.id, observedLedger));
      expect(initial.data.configurations.every((node) => node.revision === "0")).toBe(true);
      const request = { admin: mutationAdmin, arguments: mutationArguments(item) };
      const prepared = await api.prepare(request, { idempotencyKey: `guest-${item.name}` });
      expect(prepared.data.mutation).toEqual(mutationIntent(item, deployment.id));
      const unsigned = TransactionBuilder.fromXDR(
        prepared.data.xdr,
        Networks.TESTNET,
      ) as Transaction;
      const operation = unsigned.operations[0];
      expect(operation?.type).toBe("invokeHostFunction");
      if (operation?.type !== "invokeHostFunction") throw new Error("Expected invocation");
      expect(operation.auth?.[0]!.toXDR("hex")).toBe(stage.acceptedMutationAuth.toXDR("hex"));
      let signatures = 0;
      const signed = await api.signPrepared(
        prepared,
        async (request) => {
          signatures++;
          expect(request.networkPassphrase).toBe(Networks.TESTNET);
          const transaction = TransactionBuilder.fromXDR(
            request.xdr,
            request.networkPassphrase,
          ) as Transaction;
          transaction.sign(mutationWallet(1));
          return { signedXdr: transaction.toXDR() };
        },
        { walletAddress: mutationAdmin, expectedNetwork: "testnet" },
      );
      const submitted = await api.submit(signed.submission, signed.submissionOptions);
      expect(submitted.data.status).toBe("PENDING");
      expect(signatures).toBe(1);
      stage = mutationObservations(item).changed;
      observedLedger = 101;
      expect((await api.reconcile({ intent: prepared.data.intent })).data.state).toBe("SUCCESS");
      const current = await api.get();
      expect(current.data.configurations.every((node) => node.revision === "1")).toBe(true);
      expect(current.data.configurations[0]!.configuration).toMatchObject({
        recipient: mutationReplacement,
        payoutValue: { kind: "fixed", amountStroops: "20" },
      });
      const scan = await pollEventsForWithOutcome(deployment.id);
      expect(scan.status).toBe("complete");
      // Reconciliation already ingests the actual receipts; another poll deduplicates.
      expect(scan.written).toBe(0);
      expect(await db.contractEvent.count({ where: { deploymentId: deployment.id } })).toBe(2);
      const history = await api.history({ limit: 20 });
      expect(history.data.historyComplete).toBe(false);
      expect(history.data.items).toHaveLength(4);
      expect(
        history.data.items
          .filter((item) => item.configuration.revision === "1")
          .every((item) => item.eventLedger === 101 && item.txHash === prepared.data.txHash),
      ).toBe(true);
      const retained = await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
      expect(retained.graphSnapshot).toEqual(json(item.graph));
      expect(retained.pipelineSnapshot).toEqual(deployment.pipelineSnapshot);
      expect(retained.paramsSnapshot).toEqual(deployment.paramsSnapshot);
      expect(mock.send).toHaveBeenCalledTimes(1);
    });

  it("direct external admin receipt converges without fabricated application signer or overwritten initial terms", async () => {
    const item = mutationScenarios[0]!,
      api = await setup(item);
    stage = mutationObservations(item).changed;
    observedLedger = 101;
    expect((await pollEventsForWithOutcome(deployment.id)).written).toBe(2);
    const current = await api.get(),
      history = await api.history();
    expect(current.data.configurations.every((node) => node.revision === "1")).toBe(true);
    expect(history.data.revisionCoverage.every((node) => node.missingRevisionCount === "1")).toBe(
      true,
    );
    expect(await db.signedTransaction.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).graphSnapshot,
    ).toEqual(json(item.graph));
    mock.simulate.mockRejectedValue(new Error("Current getter unavailable"));
    await expect(api.get()).rejects.toMatchObject({ status: 502 });
    expect((await api.history()).data.items).toHaveLength(2);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("actual fixed-Split obligations block an upstream-only API update even at zero raw balances", async () => {
    const item = mutationScenarios[1]!,
      api = await setup(item);
    stage = mutationObservations(item).blocked!;
    expect(stage.balances).toEqual(["0", "0", "0"]);
    const current = await api.get();
    expect(current.data).toEqual(guestMutationState(item, stage, deployment.id, observedLedger));
    expect(current.data.obligations).toContainEqual({ nodeId: "split", obligationsStroops: "50" });
    await expect(
      api.prepare(
        {
          admin: mutationAdmin,
          arguments: { version: 1, changes: [mutationArguments(item).changes[0]!] },
        },
        { idempotencyKey: "blocked-upstream-original" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(await db.signedTransaction.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("an actually prepared private template instance preserves its version, creation constants and original factory evidence after stored updates", async () => {
    const item = mutationScenarios[0]!,
      api = await setup(item, true);
    const original = await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
    const version = await db.flowTemplateVersion.findUniqueOrThrow({
      where: { id: deployment.templateVersionId! },
    });
    expect((await api.get()).data.configurations.every((node) => node.revision === "0")).toBe(true);
    const prepared = await api.prepare(
      { admin: mutationAdmin, arguments: mutationArguments(item) },
      { idempotencyKey: "template-instance-stored-update" },
    );
    expect(prepared.data.mutation.nodes.map((node) => node.contractAddress)).toEqual(
      stage.nodes.map((node) => node.address),
    );
    const signed = await api.signPrepared(
      prepared,
      async (request) => {
        const transaction = TransactionBuilder.fromXDR(
          request.xdr,
          request.networkPassphrase,
        ) as Transaction;
        transaction.sign(mutationWallet(1));
        return { signedXdr: transaction.toXDR() };
      },
      { walletAddress: mutationAdmin, expectedNetwork: "testnet" },
    );
    await api.submit(signed.submission, signed.submissionOptions);
    stage = relocateObservation(mutationObservations(item).changed);
    observedLedger = 101;
    expect((await api.reconcile({ intent: prepared.data.intent })).data.state).toBe("SUCCESS");
    const current = await api.get();
    expect(current.data.configurations[0]!.configuration).toMatchObject({
      recipient: mutationReplacement,
    });
    const split = current.data.configurations[1]!;
    expect(split.policy).toMatchObject({
      rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
    });
    await expect(
      api.prepare(
        {
          admin: mutationAdmin,
          arguments: {
            version: 1,
            changes: [
              {
                kind: "split",
                nodeId: "split",
                expectedRevision: "1",
                rows: [{ rowId: "platform", recipient: mutationReplacement }],
              },
            ],
          },
        },
        { idempotencyKey: "creation-constant-is-not-a-setter" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const retained = await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
    expect(retained.instanceSnapshot).toEqual(original.instanceSnapshot);
    expect(retained.graphSnapshot).toEqual(original.graphSnapshot);
    expect(retained.paramsSnapshot).toEqual(original.paramsSnapshot);
    expect(retained.pipelineSnapshot).toEqual(original.pipelineSnapshot);
    expect(retained.unsignedXdr).toBe(original.unsignedXdr);
    expect(
      await db.flowTemplateVersion.findUniqueOrThrow({
        where: { id: deployment.templateVersionId! },
      }),
    ).toEqual(version);
  });

  it("execution-only and mode-less deployments cannot acquire mutation authority through metadata", async () => {
    const item = mutationScenarios[0]!;
    await setup(item);
    const old = structuredClone(deployment);
    old.pipelineSnapshot = json(
      mutationConstructors(item).map((node) => ({
        nodeId: node.nodeId,
        contractAddress: node.address,
        templateKind: node.templateKind,
        wasmHash:
          EXECUTION_V1_WASM_HASHES[node.templateKind as keyof typeof EXECUTION_V1_WASM_HASHES],
        artifactCapabilities: executionArtifactMetadata(
          node.templateKind,
          EXECUTION_V1_WASM_HASHES[node.templateKind as keyof typeof EXECUTION_V1_WASM_HASHES],
        ),
      })),
    );
    await expect(readMutationState(old)).rejects.toBeDefined();
    const legacy = structuredClone(item.graph);
    delete legacy.fieldPolicies;
    const split = legacy.nodes.find((node) => node.id === "split");
    if (split?.type !== "split") throw new Error("Expected legacy Split");
    const worker = split.config.additionalRecipients![0]!;
    if (worker.allocation.kind !== "percentage") throw new Error("Expected percentage worker");
    split.config.recipients.push({
      address: worker.recipient,
      mode: "percentage",
      bps: worker.allocation.bps,
    });
    delete split.config.additionalRecipients;
    const discovery = await readExecutionState({ ...deployment, graphSnapshot: json(legacy) });
    expect(discovery.supported).toBe(false);
    await expect(
      readMutationState({ ...deployment, graphSnapshot: json(legacy) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("real obligation refusal fences late mutation/payment admission, while admitted unknown work never gains a reset proof", async () => {
    const item = mutationScenarios[1]!,
      api = await setup(item);
    const request = { admin: mutationAdmin, arguments: mutationArguments(item) };
    const key = "original-guest-obligation-refusal",
      keyHash = executionIdempotencyKey(key)!;
    const intent = mutationIntent(item, deployment.id),
      unsignedXdr = await prepareMutationTransaction(intent);
    const execution = {
      ...mutationPayment(item, "0"),
      deploymentId: deployment.id,
      expiresAtLedger: 160,
    };
    const latePayment = await prepareExecutionTransaction(execution);
    stage = mutationObservations(item).blocked!;
    let originalError: unknown;
    try {
      await api.prepare(request, { idempotencyKey: key });
    } catch (error) {
      originalError = error;
    }
    expect(originalError).toBeInstanceOf(PaiflowApiError);
    const refused = originalError as PaiflowApiError;
    expect(refused.code).toBe("CONFLICT");
    const raw = (refused.fields as { preparationRefusal: string[] }).preparationRefusal[0]!;
    const proof = MutationPreparationRefusalSchema.parse(JSON.parse(raw));
    await expect(
      assertConfigurationRefusal(proof, {
        deploymentId: deployment.id,
        network: "testnet",
        request,
        key,
      }),
    ).resolves.toEqual(proof);
    await expect(
      assertConfigurationRefusal(proof, {
        deploymentId: deployment.id,
        network: "testnet",
        request,
        key: "a-different-original-key",
      }),
    ).rejects.toBeDefined();
    expect(
      (await db.mutationPreparationRefusal.findUniqueOrThrow({ where: { id: proof.refusalId } }))
        .reasonCode,
    ).toBe("CONFLICT");
    const digest = executionRequestDigest({
      deploymentId: deployment.id,
      network: "testnet",
      input: request,
    });
    const admission = (client: Prisma.TransactionClient) => mutationAdmission(client, deployment);
    // These simulations completed before the refusal; neither late creator may cross its fence.
    await expect(
      createMutationIntent({
        deployment,
        mutation: intent,
        unsignedXdr,
        preparationLedger: 100,
        keyHash,
        requestDigest: digest,
        assertAdmission: admission,
        ip: "192.0.2.171",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      createExecutionIntent({
        deployment,
        execution,
        artifacts: intent.artifacts,
        unsignedXdr: latePayment.xdr,
        preparationLedger: 100,
        keyHash,
        requestDigest: executionRequestDigest({ execution }),
        assertAdmission: admission,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
    stage = mutationObservations(item).initial;
    // A fresh authenticated replay still proves the same durable non-admission after state changes.
    let replayError: unknown;
    try {
      await api.prepare(request, { idempotencyKey: key });
    } catch (error) {
      replayError = error;
    }
    const replay = replayError as PaiflowApiError;
    const replayProof = JSON.parse(
      (replay.fields as { preparationRefusal: string[] }).preparationRefusal[0]!,
    );
    await expect(
      assertConfigurationRefusal(replayProof, {
        deploymentId: deployment.id,
        network: "testnet",
        request,
        key,
      }),
    ).resolves.toEqual(proof);
    expect(
      (await api.get()).data.obligations.every((status) => status.obligationsStroops === "0"),
    ).toBe(true);
    const fresh = await api.prepare(request, {
      idempotencyKey: "fresh-reviewed-after-verified-refusal",
    });
    const signed = await api.signPrepared(
      fresh,
      async (request) => {
        const transaction = TransactionBuilder.fromXDR(
          request.xdr,
          request.networkPassphrase,
        ) as Transaction;
        transaction.sign(mutationWallet(1));
        return { signedXdr: transaction.toXDR() };
      },
      { walletAddress: mutationAdmin, expectedNetwork: "testnet" },
    );
    mock.send.mockRejectedValue(new Error("Synthetic response loss after durable admission"));
    expect((await api.submit(signed.submission, signed.submissionOptions)).data.status).toBe(
      "UNKNOWN",
    );
    let replacementError: unknown;
    try {
      await api.prepare(request, { idempotencyKey: "cannot-replace-admitted-unknown" });
    } catch (error) {
      replacementError = error;
    }
    expect(replacementError).toBeInstanceOf(PaiflowApiError);
    expect((replacementError as PaiflowApiError).fields).not.toHaveProperty("preparationRefusal");
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, state: "SUBMITTING", txHash: fresh.data.txHash },
      }),
    ).toBe(1);
    expect(
      await db.serviceTransaction.count({ where: { txHash: fresh.data.txHash, state: "PENDING" } }),
    ).toBe(1);
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(1);
  });
});
