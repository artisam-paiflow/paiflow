import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Address,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { flowToEnglish } from "@/lib/flows/english";
import {
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
import {
  ExecutePreparedSchema,
  ExecutePrepareSchema,
  type ExecutePrepare,
} from "@/lib/api/v1/schema";
import {
  HostedOwnershipChallengeSchema,
  HostedPreparedSchema,
  HostedReceiptSchema,
} from "@/lib/hosted-execution/schema";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { formArguments, fieldKey } from "@/lib/hosted-execution/form";
import { hostedPaymentReview } from "@/lib/hosted-execution/review";
import {
  acceptancePacket,
  acceptanceScenarios,
  structuralCeilingScenario,
  acceptanceWallet,
  addresses,
  constructors,
  platform,
  type AcceptanceCall,
  type AcceptanceScenario,
} from "../fixtures/execution-acceptance";

const rpc = vi.hoisted(() => ({
  getLatestLedger: vi.fn(),
  _getLedgerEntries: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
vi.mock("@/lib/stellar/load-payment-account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/load-payment-account")>()),
  loadPaymentAccount: async (_server: unknown, address: string) => new Account(address, "10"),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: async () => undefined }));
// The public route module also exports owner management. That separate session
// surface is not exercised here; bearer deployment authentication remains real.
vi.mock("@/lib/auth", () => ({
  requireSession: async () => {
    throw new Error("Unexpected owner session in wallet-only acceptance");
  },
}));
import { POST as apiPrepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as apiSubmit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { hostedPublicRoute } from "@/lib/hosted-execution/routes";
import { recordControlFinality } from "@/lib/api/v1/control-intent";

const symbol = (value: string) => nativeToScVal(value, { type: "symbol" });
const record = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, val]) => new xdr.ScMapEntry({ key: symbol(key), val })),
  );
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
let ownerId: string;
let flowId: string;
const deploymentIds: string[] = [];
const revisions = new Map<string, bigint>();
const finalized = new Map<string, number>();
let currentScenario: AcceptanceScenario;
let currentDeployment: Deployment;
let bearer: string;
let currentFamilyIsMutationCapable = false;
const request = (url: string, body?: unknown, headers?: Record<string, string>) =>
  new NextRequest(`https://acceptance.invalid${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-real-ip": "192.0.2.163", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const context = () => ({ params: Promise.resolve({ id: currentDeployment.id }) });
async function api(body: unknown, key: string) {
  return apiPrepare(
    request(`/api/v1/deployments/${currentDeployment.id}/execute`, body, {
      authorization: `Bearer ${bearer}`,
      "idempotency-key": key,
    }),
    context(),
  );
}
async function hosted(
  action: "state" | "ownership" | "prepare" | "submit" | "receipt",
  body?: unknown,
) {
  return hostedPublicRoute(action)(
    request(`/api/deployments/${currentDeployment.id}/hosted-execution/${action}`, body),
    context(),
  );
}
async function ownershipProof(payment: ExecutePrepare, recoveryKey: string, seed: number) {
  const response = await hosted("ownership", { recoveryKey, payment });
  expect(response.status).toBe(200);
  const challenge = HostedOwnershipChallengeSchema.parse((await response.json()).data);
  return sign(challenge.xdr, seed);
}
function payment(call: AcceptanceCall, payerSeed = call.payerSeed): ExecutePrepare {
  return ExecutePrepareSchema.parse({
    from: acceptanceWallet(payerSeed).publicKey(),
    amount: call.execution.amountStroops,
    arguments: call.execution.arguments,
  });
}
function sign(unsigned: string, seed: number, network = Networks.TESTNET) {
  const tx = TransactionBuilder.fromXDR(unsigned, network) as Transaction;
  tx.sign(acceptanceWallet(seed));
  return tx.toXDR();
}
async function newDeployment(scenario: AcceptanceScenario, mutationCapable = false) {
  currentScenario = scenario;
  currentFamilyIsMutationCapable = mutationCapable;
  currentDeployment = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      sourceAccount: acceptanceWallet(1).publicKey(),
      hostedExecutionEnabled: true,
      graphSnapshot: json({ ...scenario.graph, privateContact: "private@example.invalid" }),
      paramsSnapshot: json(constructors(scenario).map((node) => node.params)),
      pipelineSnapshot: json(
        constructors(scenario).map((node) => {
          const kind = node.templateKind as keyof typeof EXECUTION_V1_WASM_HASHES;
          const wasmHash = (mutationCapable ? MUTATION_V1_WASM_HASHES : EXECUTION_V1_WASM_HASHES)[
            kind
          ];
          return {
            nodeId: node.nodeId,
            templateKind: kind,
            contractAddress: node.address,
            wasmHash,
            artifactCapabilities: executionArtifactMetadata(kind, wasmHash),
          };
        }),
      ),
    },
  });
  deploymentIds.push(currentDeployment.id);
  bearer = `pfk_${randomBytes(32).toString("hex")}`;
  await db.deploymentApiToken.create({
    data: {
      deploymentId: currentDeployment.id,
      createdById: ownerId,
      tokenHash: hashApiToken(bearer),
      tokenPrefix: bearer.slice(0, 12),
    },
  });
  return currentDeployment;
}
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `acceptance-${randomUUID()}`, passwordHash: "synthetic-unused" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "Private acceptance flow",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  revisions.clear();
  finalized.clear();
  rpc.getLatestLedger.mockResolvedValue({ sequence: 10 });
  rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 10,
    entries: keys.map((key) => {
      const address = Address.fromScAddress(key.contractData().contract()).toString();
      const node = constructors(currentScenario).find((node) => node.address === address)!;
      return {
        key: key.toXDR("base64"),
        xdr: xdr.LedgerEntryData.contractData(
          new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: key.contractData().contract(),
            key: key.contractData().key(),
            durability: xdr.ContractDataDurability.persistent(),
            val: xdr.ScVal.scvContractInstance(
              new xdr.ScContractInstance({
                executable: xdr.ContractExecutable.contractExecutableWasm(
                  Buffer.from(
                    (currentFamilyIsMutationCapable
                      ? MUTATION_V1_WASM_HASHES
                      : EXECUTION_V1_WASM_HASHES)[
                      node.templateKind as keyof typeof EXECUTION_V1_WASM_HASHES
                    ],
                    "hex",
                  ),
                ),
                storage: null,
              }),
            ),
          }),
        ).toXDR("base64"),
      };
    }),
  }));
  rpc.simulateTransaction.mockImplementation(async (transaction: Transaction) => {
    const op = transaction.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error("Expected contract invocation");
    const invocation = op.func.invokeContract();
    const method = invocation.functionName().toString();
    let retval = xdr.ScVal.scvVoid();
    if (method === "capabilities")
      retval = record({
        policy_version: nativeToScVal(1, { type: "u32" }),
        execution_abi: nativeToScVal(1, { type: "u32" }),
        execution: xdr.ScVal.scvBool(true),
        mutation: xdr.ScVal.scvBool(currentFamilyIsMutationCapable),
        immutable_policies: xdr.ScVal.scvBool(true),
        revision_binding: xdr.ScVal.scvBool(true),
      });
    else if (method === "current_config") {
      const address = Address.fromScAddress(invocation.contractAddress()).toString();
      const node = constructors(currentScenario).find((node) => node.address === address)!;
      const fields: Record<string, xdr.ScVal> = {
        policy: node.args[2]!,
        asset: node.args[1]!,
        revision: nativeToScVal(revisions.get(node.nodeId) ?? 0n, { type: "u64" }),
      };
      if (node.templateKind === "PAYER")
        Object.assign(fields, {
          amount: node.args[3]!,
          percentage_bps: node.args[4]!,
          next_steps: node.args[5]!,
          parent: node.args[6]!,
        });
      if (node.templateKind === "SPLITTER")
        Object.assign(fields, { min_amount: node.args[3]!, parent: node.args[4]! });
      if (node.templateKind === "SPLITTER" && currentFamilyIsMutationCapable)
        fields.additional = xdr.ScVal.scvVec([]);
      retval = record(fields);
    } else {
      expect(method).toBe("execute_v1");
      if (currentScenario.name.startsWith("structural-"))
        return {
          error: "Error(Budget, ExceededLimit): invocation memory exceeds 41943040",
          latestLedger: 10,
          events: [],
        };
    }
    return {
      _parsed: true,
      id: "synthetic-simulation",
      latestLedger: 10,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: "1000",
      result: { auth: [], retval },
    };
  });
  rpc.getTransaction.mockImplementation(async (hash: string) =>
    finalized.has(hash)
      ? { status: "SUCCESS", ledger: finalized.get(hash) }
      : { status: "NOT_FOUND" },
  );
  rpc.sendTransaction.mockImplementation(async (transaction: Transaction) => {
    const txHash = transaction.hash().toString("hex");
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: currentDeployment.id, txHash, state: "SUBMITTING" },
      }),
    ).toBe(1);
    expect(
      await db.signedTransaction.count({ where: { deploymentId: currentDeployment.id, txHash } }),
    ).toBe(1);
    expect(
      await db.serviceTransaction.count({
        where: { txHash, work: { deploymentId: currentDeployment.id } },
      }),
    ).toBe(1);
    return { status: "PENDING" };
  });
});
afterAll(async () => {
  await db.serviceTransaction.deleteMany({
    where: { work: { deploymentId: { in: deploymentIds } } },
  });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.walletControlIntent.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.auditLog.deleteMany({ where: { userId: ownerId } });
  await db.deployment.deleteMany({ where: { id: { in: deploymentIds } } });
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: ownerId } });
});

describe("production execution cross-layer acceptance", () => {
  it.each([false, true])(
    "preserves exact execution preparation on retained/new artifact family (mutation capable=%s)",
    async (mutationCapable) => {
      const scenario = acceptanceScenarios[0]!;
      await newDeployment(scenario, mutationCapable);
      const stateResponse = await hosted("state");
      expect(stateResponse.status).toBe(200);
      const state = ExecutionDiscoverySchema.parse((await stateResponse.json()).data);
      if (!state.supported) throw new Error("Expected verified artifact family");
      expect(state.nodes.every((node) => node.capabilities.mutation === mutationCapable)).toBe(
        true,
      );
      const response = await api(payment(scenario.calls[0]!), "family-compatibility");
      expect(response.status).toBe(200);
      const prepared = ExecutePreparedSchema.parse((await response.json()).data);
      expect(prepared.execution?.arguments).toEqual(scenario.calls[0]!.execution.arguments);
      const saved = await db.walletControlIntent.findUniqueOrThrow({
        where: { id: prepared.intent },
      });
      expect(saved.executionArtifacts).toEqual(
        state.nodes.map((node) => ({
          nodeId: node.nodeId,
          contractAddress: node.contractAddress,
          wasmHash: node.capabilities.wasmHash,
        })),
      );
    },
  );
  it("recovers a pre-admission RPC failure with a proof for the same capability/request", async () => {
    const scenario = acceptanceScenarios[0]!;
    await newDeployment(scenario);
    const input = payment(scenario.calls[0]!, 14);
    const recoveryKey = randomBytes(32).toString("hex");
    const original = rpc.simulateTransaction.getMockImplementation()!;
    let failed = false;
    rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      const operation = tx.operations[0]!;
      if (
        operation.type === "invokeHostFunction" &&
        operation.func.invokeContract().functionName().toString() === "execute_v1" &&
        !failed
      ) {
        failed = true;
        throw new Error("synthetic transport failed before admission");
      }
      return original(tx);
    });
    const first = await hosted("prepare", {
      recoveryKey,
      payment: input,
      ownershipProofXdr: await ownershipProof(input, recoveryKey, 14),
    });
    expect(first.status).toBe(502);
    expect(
      await db.walletControlIntent.count({ where: { deploymentId: currentDeployment.id } }),
    ).toBe(0);
    expect((await hosted("prepare", { recoveryKey, payment: input })).status).toBe(422);
    const retry = await hosted("prepare", {
      recoveryKey,
      payment: input,
      ownershipProofXdr: await ownershipProof(input, recoveryKey, 14),
    });
    expect(retry.status).toBe(200);
    expect(
      await db.walletControlIntent.count({ where: { deploymentId: currentDeployment.id } }),
    ).toBe(1);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("a re-proof racing the original simulation admits one immutable payment identity", async () => {
    const scenario = acceptanceScenarios[0]!;
    await newDeployment(scenario);
    const input = payment(scenario.calls[0]!, 15);
    const recoveryKey = randomBytes(32).toString("hex");
    const original = rpc.simulateTransaction.getMockImplementation()!;
    let started = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      const operation = tx.operations[0]!;
      if (
        operation.type === "invokeHostFunction" &&
        operation.func.invokeContract().functionName().toString() === "execute_v1" &&
        !started
      ) {
        started = true;
        await gate;
      }
      return original(tx);
    });
    const pending = hosted("prepare", {
      recoveryKey,
      payment: input,
      ownershipProofXdr: await ownershipProof(input, recoveryKey, 15),
    });
    let originalResponse: Response;
    let retryResponse: Response;
    try {
      await vi.waitFor(() => expect(started).toBe(true));
      expect((await hosted("prepare", { recoveryKey, payment: input })).status).toBe(422);
      retryResponse = await hosted("prepare", {
        recoveryKey,
        payment: input,
        ownershipProofXdr: await ownershipProof(input, recoveryKey, 15),
      });
    } finally {
      release();
      originalResponse = await pending;
    }
    expect(originalResponse.status).toBe(200);
    expect(retryResponse!.status).toBe(200);
    const first = HostedPreparedSchema.parse((await originalResponse.json()).data);
    const second = HostedPreparedSchema.parse((await retryResponse!.json()).data);
    expect(first.prepared.intent).toBe(second.prepared.intent);
    expect(first.prepared.txHash).toBe(second.prepared.txHash);
    expect(
      await db.walletControlIntent.count({ where: { deploymentId: currentDeployment.id } }),
    ).toBe(1);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(acceptanceScenarios)(
    "$name: compiler/hosted/API share exact inputs and durable repeated/concurrent identities",
    async (scenario) => {
      expect(
        readFileSync(
          path.join(
            process.cwd(),
            "tests/fixtures/execution-acceptance",
            `${scenario.name}.xdr-hex`,
          ),
          "utf8",
        ).trim(),
      ).toBe(acceptancePacket(scenario));
      await newDeployment(scenario);
      const originalGraph = JSON.stringify(currentDeployment.graphSnapshot);
      const publicResponse = await hosted("state");
      expect(publicResponse.status).toBe(200);
      const publicBody: unknown = await publicResponse.json();
      const state = ExecutionDiscoverySchema.parse((publicBody as { data: unknown }).data);
      if (!state.supported) throw new Error("Policy-aware fixture must be available");
      expect(JSON.stringify(publicBody)).not.toContain("private@example.invalid");
      expect(JSON.stringify(publicBody)).not.toContain(bearer);
      expect(state.network).toBe("testnet");
      expect(flowToEnglish(scenario.graph)).toContain(
        scenario.name.includes("fixed") ? "constant" : "15%",
      );
      const valid = scenario.calls.filter((call) => call.succeeds);
      // Two different sources may prepare concurrently against ONE deployed graph.
      const results = await Promise.all(
        valid.slice(0, 2).map(async (call, index) => {
          const response = await api(payment(call), `acceptance-${index}`);
          expect(response.status).toBe(200);
          return { call, prepared: ExecutePreparedSchema.parse((await response.json()).data) };
        }),
      );
      expect(new Set(results.map(({ prepared }) => prepared.intent)).size).toBe(2);
      for (const { call, prepared } of results) {
        expect(prepared.execution?.arguments).toEqual(call.execution.arguments);
        expect(prepared.execution?.nodes).toEqual(call.execution.nodes);
        expect(
          hostedPaymentReview(state, prepared.execution!).rows.map((row) => ({
            recipient: row.recipient,
            amountStroops: row.amountStroops,
          })),
        ).toEqual(call.payouts);
        const unsigned = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction;
        expect(unsigned.source).toBe(payment(call).from);
        const signedXdr = sign(prepared.xdr, call.payerSeed);
        const send = () =>
          apiSubmit(
            request(
              `/api/v1/deployments/${currentDeployment.id}/execute/submit?wait=false`,
              { signedXdr, intent: prepared.intent },
              { authorization: `Bearer ${bearer}` },
            ),
            context(),
          );
        const submissions = await Promise.all([send(), send()]);
        expect(submissions.map((result) => result.status)).toEqual([200, 200]);
        finalized.set(prepared.txHash!, 11);
        await recordControlFinality(currentDeployment.id, prepared.txHash!, "SUCCESS", 11);
      }
      expect(rpc.sendTransaction).toHaveBeenCalledTimes(2);
      const repeat = valid[2] ?? { ...valid[0]!, payerSeed: 10 };
      const recoveryKey = randomBytes(32).toString("hex");
      // These are the actual hosted form's conversion helpers, not a parallel UI encoder.
      const fields: Record<string, string> = {};
      const rosters: Record<
        string,
        Array<{ rowId: string; recipient: string; allocation: string }>
      > = {};
      for (const input of repeat.execution.arguments.inputs) {
        if (input.kind === "pay")
          fields[fieldKey(input.nodeId, "pay", "recipient")] = input.recipient;
        else
          rosters[input.nodeId] = (input.additionalRecipients ?? []).map((row) => ({
            rowId: row.rowId,
            recipient: row.recipient,
            allocation:
              row.allocation.kind === "fixed"
                ? (BigInt(row.allocation.amountStroops) / 10_000_000n).toString() +
                  "." +
                  (BigInt(row.allocation.amountStroops) % 10_000_000n).toString().padStart(7, "0")
                : (row.allocation.bps / 100).toFixed(2),
          }));
      }
      const hostedPayment = {
        ...payment(repeat),
        arguments: formArguments(state, fields, rosters),
      };
      const challengeResponse = await hosted("ownership", { recoveryKey, payment: hostedPayment });
      expect(challengeResponse.status).toBe(200);
      const challenge = HostedOwnershipChallengeSchema.parse((await challengeResponse.json()).data);
      const preparedResponse = await hosted("prepare", {
        recoveryKey,
        payment: hostedPayment,
        ownershipProofXdr: sign(challenge.xdr, repeat.payerSeed),
      });
      expect(preparedResponse.status).toBe(200);
      const prepared = HostedPreparedSchema.parse((await preparedResponse.json()).data);
      expect(
        prepared.rows.map((row) => ({
          recipient: row.recipient,
          amountStroops: row.amountStroops,
        })),
      ).toEqual(repeat.payouts);
      const sent = await hosted("submit", {
        recoveryKey,
        intent: prepared.prepared.intent,
        signedXdr: sign(prepared.prepared.xdr, repeat.payerSeed),
      });
      expect(sent.status).toBe(200);
      finalized.set(prepared.prepared.txHash, 12);
      const receiptResponse = await hosted("receipt", { recoveryKey });
      expect(HostedReceiptSchema.parse((await receiptResponse.json()).data).state).toBe("SUCCESS");
      expect(rpc.sendTransaction).toHaveBeenCalledTimes(3);
      expect(
        JSON.stringify(
          (await db.deployment.findUniqueOrThrow({ where: { id: currentDeployment.id } }))
            .graphSnapshot,
        ),
      ).toBe(originalGraph);
      const platformRows = prepared.rows.filter((row) => row.recipient === platform);
      expect(platformRows).toHaveLength(1);
      expect(platformRows[0]).toMatchObject({
        recipientSource: "constant",
        allocationSource: "constant",
      });
    },
  );

  it.each(acceptanceScenarios)(
    "$name: hostile inputs fail before reservation/send; stale signed preparation cannot execute",
    async (scenario) => {
      await newDeployment(scenario);
      for (const call of scenario.calls.filter(
        (call) => !call.succeeds && !["replayed-nonce", "stale-revision"].includes(call.name),
      )) {
        const response = await api(payment(call, 11), `hostile-${call.name}`);
        expect(response.status, call.name).toBe(422);
        const recoveryKey = randomBytes(32).toString("hex");
        const input = payment(call, 11);
        const refused = await hosted("prepare", {
          recoveryKey,
          payment: input,
          ownershipProofXdr: await ownershipProof(input, recoveryKey, 11),
        });
        expect(refused.status, `hosted ${call.name}`).toBe(422);
      }
      expect(
        await db.walletControlIntent.count({ where: { deploymentId: currentDeployment.id } }),
      ).toBe(0);
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
      const response = await api(payment(scenario.calls[0]!, 11), "stale-after-review");
      expect(response.status).toBe(200);
      const prepared = ExecutePreparedSchema.parse((await response.json()).data);
      revisions.set(scenario.calls[0]!.execution.nodes.at(-1)!.nodeId, 1n);
      const stale = await apiSubmit(
        request(
          `/api/v1/deployments/${currentDeployment.id}/execute/submit?wait=false`,
          { intent: prepared.intent, signedXdr: sign(prepared.xdr, 11) },
          { authorization: `Bearer ${bearer}` },
        ),
        context(),
      );
      expect(stale.status).toBe(409);
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
      expect(
        (await db.walletControlIntent.findUniqueOrThrow({ where: { id: prepared.intent } })).state,
      ).toBe("PREPARED");
      revisions.clear();
      const recoveryKey = randomBytes(32).toString("hex");
      const input = payment(scenario.calls[0]!, 12);
      const hostedPreparation = await hosted("prepare", {
        recoveryKey,
        payment: input,
        ownershipProofXdr: await ownershipProof(input, recoveryKey, 12),
      });
      expect(hostedPreparation.status).toBe(200);
      const hostedPrepared = HostedPreparedSchema.parse((await hostedPreparation.json()).data);
      revisions.set(scenario.calls[0]!.execution.nodes.at(-1)!.nodeId, 1n);
      const hostedStale = await hosted("submit", {
        recoveryKey,
        intent: hostedPrepared.prepared.intent,
        signedXdr: sign(hostedPrepared.prepared.xdr, 12),
      });
      expect(hostedStale.status).toBe(409);
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("accepts twenty combined recipients and rejects the twenty-first through hosted/API preparation", async () => {
    const scenario = acceptanceScenarios[0]!;
    await newDeployment(scenario);
    const response = await hosted("state");
    const state = ExecutionDiscoverySchema.parse((await response.json()).data);
    if (!state.supported) throw new Error("Expected reviewed execution state");
    const call = scenario.calls.find((call) => call.name === "twenty-combined-recipients")!;
    const result = await api(payment(call), "bounded-roster");
    expect(result.status).toBe(200);
    const prepared = ExecutePreparedSchema.parse((await result.json()).data);
    expect(hostedPaymentReview(state, prepared.execution!).rows).toHaveLength(20);
    expect(
      hostedPaymentReview(state, prepared.execution!).rows.map((row) => ({
        recipient: row.recipient,
        amountStroops: row.amountStroops,
      })),
    ).toEqual(call.payouts);
    const args = call.execution.arguments.inputs[0]!;
    if (args.kind !== "split") throw new Error("Expected roster");
    const rosters = {
      split: args.additionalRecipients!.map((row) => ({
        rowId: row.rowId,
        recipient: row.recipient,
        allocation: row.allocation.kind === "percentage" ? String(row.allocation.bps / 100) : "",
      })),
    };
    expect(formArguments(state, {}, rosters)).toEqual(call.execution.arguments);
    expect(() =>
      formArguments(
        state,
        {},
        {
          split: [
            ...rosters.split,
            { rowId: "excess", recipient: acceptanceWallet(50).publicKey(), allocation: "1" },
          ],
        },
      ),
    ).toThrow();
    const recoveryKey = randomBytes(32).toString("hex");
    const input = payment(call, 13);
    const hostedResponse = await hosted("prepare", {
      recoveryKey,
      payment: input,
      ownershipProofXdr: await ownershipProof(input, recoveryKey, 13),
    });
    expect(hostedResponse.status).toBe(200);
    expect(HostedPreparedSchema.parse((await hostedResponse.json()).data).rows).toHaveLength(20);
  });

  it("treats 40 bindings as a structural ceiling and refuses a resource-failing simulation before admission/signing", async () => {
    const scenario = structuralCeilingScenario;
    await newDeployment(scenario);
    expect(scenario.calls[0]!.execution.nodes).toHaveLength(40);
    expect(
      readFileSync(
        path.join(process.cwd(), "tests/fixtures/execution-acceptance", `${scenario.name}.xdr-hex`),
        "utf8",
      ).trim(),
    ).toBe(acceptancePacket(scenario));
    const refused = await api(payment(scenario.calls[0]!), "resource-ceiling");
    expect(refused.status).toBe(422);
    const body: unknown = await refused.json();
    expect(body).not.toHaveProperty("data.xdr");
    const call = rpc.simulateTransaction.mock.calls.find((call) => {
      const tx = call[0] as Transaction;
      const op = tx.operations[0];
      return (
        op?.type === "invokeHostFunction" &&
        op.func.invokeContract().functionName().toString() === "execute_v1"
      );
    });
    expect(call).toBeDefined();
    const simulationInput = call![0] as Transaction;
    const bytes = Buffer.from(simulationInput.toXDR(), "base64").length;
    // This is the simulation request, NOT an admitted/assembled network envelope:
    // actual footprint, authorization and wallet signatures would add bytes.
    process.stdout.write(`40-node/20-recipient unsigned simulation request: ${bytes} bytes\n`);
    expect(bytes).toBeLessThan(132_096); // Captured 2026-11-01 limit, not a readiness guarantee.
    expect(
      await db.walletControlIntent.count({ where: { deploymentId: currentDeployment.id } }),
    ).toBe(0);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
