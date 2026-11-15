import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  Account,
  Address,
  Networks,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  scValToNative,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  hashes: vi.fn(),
  factory: vi.fn(),
  load: vi.fn(),
  simulate: vi.fn(),
  entries: vi.fn(),
  latest: vi.fn(),
  getAccount: vi.fn(),
  client: null as unknown as PrismaClient,
}));
vi.mock("@/lib/stellar/conditional-artifact-config", () => ({
  getConditionalWasmHashes: mocks.hashes,
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: mocks.factory,
  getWasmHashes: () => {
    throw new Error("No legacy conditional artifact fallback");
  },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    simulateTransaction: mocks.simulate,
    _getLedgerEntries: mocks.entries,
    getLatestLedger: mocks.latest,
    getAccount: mocks.getAccount,
  }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mocks.load }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const v = Reflect.get(mocks.client, key);
        return typeof v === "function" ? v.bind(mocks.client) : v;
      },
    },
  ),
}));
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { readConditionalExecutionState } from "@/lib/stellar/conditional-execution-state";
import {
  recordConditionalConfigurationObservation,
  recordConditionalConfigurationObservations,
  conditionalConfigurationHistory,
} from "@/lib/mutations/conditional-history";
import { projectConditionalConfigurationEvent } from "@/lib/stellar/conditional-configuration-events";
import { projectConditionalRouteEvent } from "@/lib/stellar/conditional-route-events";
import {
  conditionalHostedPaymentReview,
  assertConditionalHostedPrepared,
  assertConditionalHostedCurrent,
} from "@/lib/hosted-execution/conditional-review";
import {
  parseConditionalExecutionDiscovery,
  parseConditionalExecutePrepared,
} from "@/packages/sdk/src/conditional-execution";
import { parseConditionalConfigurationHistory } from "@/packages/sdk/src/conditional-mutation";
import { signPrepared } from "@/packages/sdk/src/payment";
import {
  createJoinedCapsule,
  decodeJoinedResult,
  joinedFactory,
  joinedLayouts,
  joinedSha256,
  readJoinedSidecars,
  writeJoinedCapsules,
  type JoinedCapsule,
} from "@/tests/fixtures/conditional-v2-joined-acceptance";
const run = promisify(execFile);
const json = (value: unknown): unknown =>
  typeof value === "bigint"
    ? String(value)
    : Array.isArray(value)
      ? value.map(json)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, json(v)]))
        : value;
const asJson = (value: unknown) => json(value) as Prisma.InputJsonValue;
function constructionMocks() {
  mocks.hashes.mockResolvedValue(new Map(Object.entries(CONDITIONAL_V2_WASM_HASHES)));
  mocks.factory.mockResolvedValue(joinedFactory);
  mocks.load.mockImplementation(
    async (_server: unknown, address: string) => new Account(address, "10"),
  );
  mocks.simulate.mockImplementation(async () => ({
    _parsed: true,
    id: "local-rpc-adapter",
    latestLedger: 10,
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    events: [],
  }));
}
function preparedReceipt(
  c: JoinedCapsule,
  op: JoinedCapsule["publicEvidence"]["operations"][number],
) {
  if (!("payer" in op.intent)) throw new Error("Payment required");
  const tx = TransactionBuilder.fromXDR(op.unsignedXdr, Networks.TESTNET);
  if (!(tx instanceof Transaction)) throw new Error("Unexpected fee bump");
  return {
    intent: randomUUID(),
    txHash: tx.hash().toString("hex"),
    walletAddress: c.payer.publicKey(),
    xdr: op.unsignedXdr,
    expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
    network: "testnet" as const,
    networkPassphrase: Networks.TESTNET,
    execution: op.intent,
  };
}
function rpcFromGuest(
  c: JoinedCapsule,
  sidecars: Awaited<ReturnType<typeof readJoinedSidecars>>,
  phase: string,
  mixedPin = false,
) {
  mocks.entries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 10,
    entries: keys.map((key, i) => {
      const record = sidecars.instances.find(
        (r) => r.phase === phase && r.key.toXDR("hex") === key.toXDR("hex"),
      );
      if (!record) throw new Error("Missing actual VM instance witness");
      const data = xdr.LedgerEntryData.fromXDR(record.entry.data().toXDR());
      if (mixedPin && i === 0)
        data
          .contractData()
          .val()
          .instance()
          .executable(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 99)));
      // Guest fixtures use ledger10. Only zero host lastModified metadata is adapted
      // to positive1 for production RPC schemas; executable/storage bytes stay exact.
      return {
        key: key.toXDR("base64"),
        xdr: data.toXDR("base64"),
        lastModifiedLedgerSeq: Math.max(1, record.entry.lastModifiedLedgerSeq()),
        liveUntilLedgerSeq: record.liveUntil,
      };
    }),
  }));
  mocks.simulate.mockImplementation(async (tx: Transaction) => {
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error("Expected getter operation");
    const call = op.func.invokeContract(),
      contract = Address.fromScAddress(call.contractAddress()).toString();
    const node = c.publicEvidence.original.pipelineSnapshot.find(
      (n) => n.contractAddress === contract,
    );
    const getter = sidecars.getters.find(
      (g) =>
        g.phase === phase &&
        g.nodeId === node?.nodeId &&
        g.method === call.functionName().toString(),
    );
    if (!getter) throw new Error("Missing actual VM getter result");
    return { transactionData: {}, latestLedger: 10, result: { retval: getter.value } };
  });
}
type ReviewCosts = {
  phase: string;
  nodeCount: number;
  callCounts: {
    simulateTransaction: number;
    getLedgerEntries: number;
    getLatestLedger: number;
    getAccount: number;
    loadPaymentAccountAdapter: number;
  };
  getterMethodCounts: Record<string, number>;
  instanceLedgerKeysRequested: number;
  publicResponseJsonUtf8Bytes: number;
  accountLookupRpcCallsMeasured: false;
};
async function measuredCurrentRead(
  deployment: Parameters<typeof readConditionalExecutionState>[0],
  phase: string,
  costs: ReviewCosts[],
) {
  const before = {
    simulate: mocks.simulate.mock.calls.length,
    entries: mocks.entries.mock.calls.length,
    latest: mocks.latest.mock.calls.length,
    account: mocks.getAccount.mock.calls.length,
    load: mocks.load.mock.calls.length,
  };
  const current = await readConditionalExecutionState(deployment);
  const simulations = mocks.simulate.mock.calls.slice(before.simulate);
  const entries = mocks.entries.mock.calls.slice(before.entries);
  const getterMethodCounts: Record<string, number> = {
    capabilities_v2: 0,
    graph_manifest_v2: 0,
    initial_config_v2: 0,
    mutation_status_v2: 0,
  };
  for (const args of simulations) {
    const tx = args[0] as Transaction,
      operation = tx.operations[0]!;
    if (operation.type !== "invokeHostFunction") throw new Error("Expected measured getter");
    const method = operation.func.invokeContract().functionName().toString();
    getterMethodCounts[method] = (getterMethodCounts[method] ?? 0) + 1;
  }
  const nodeCount = current.supported ? current.nodes.length : 0;
  const callCounts = {
    simulateTransaction: simulations.length,
    getLedgerEntries: entries.length,
    getLatestLedger: mocks.latest.mock.calls.length - before.latest,
    getAccount: mocks.getAccount.mock.calls.length - before.account,
    loadPaymentAccountAdapter: mocks.load.mock.calls.length - before.load,
  };
  expect(callCounts).toEqual({
    simulateTransaction: nodeCount * 4,
    getLedgerEntries: 2,
    getLatestLedger: 0,
    getAccount: 0,
    loadPaymentAccountAdapter: 1,
  });
  expect(Object.values(getterMethodCounts)).toEqual([nodeCount, nodeCount, nodeCount, nodeCount]);
  costs.push({
    phase,
    nodeCount,
    callCounts,
    getterMethodCounts,
    instanceLedgerKeysRequested: entries.reduce((total, args) => total + args.length, 0),
    publicResponseJsonUtf8Bytes: Buffer.byteLength(JSON.stringify({ data: current })),
    accountLookupRpcCallsMeasured: false,
  });
  return current;
}
function feeDiagnostics(
  metrics: { feeDebug: string },
  hasActualEvents: boolean,
  successful: boolean,
) {
  const resourceDebug = metrics.feeDebug.split("resources=")[1] ?? "";
  const writeEntries = /\bwrite_entries: (\d+)/.exec(resourceDebug)?.[1];
  const eventBytes = /\bcontract_events_size_bytes: (\d+)/.exec(resourceDebug)?.[1];
  return {
    feeDiagnosticsComplete: false,
    feeModelOnly: true,
    feeQuoteUsable: false,
    observedDebugWriteEntryCount: writeEntries ?? null,
    observedDebugContractEventBytes: eventBytes ?? null,
    zeroWriteCounterDespiteSuccessfulCall: successful && writeEntries === "0",
    zeroEventCounterDespiteActualEvents: hasActualEvents && eventBytes === "0",
  };
}
describe("conditional joined evidence decoder boundaries", () => {
  it("refuses malformed output and wrong layout rather than manufacturing guest evidence", () => {
    expect(() => decodeJoinedResult(xdr.ScVal.scvVec([]).toXDR("hex"), "standard")).toThrow();
    expect(() => decodeJoinedResult("not-xdr", "minimal-gt")).toThrow();
  });
  it("refuses wrong layout and unknown outcome evidence even when the seven-slot container parses", () => {
    const str = (value: string) => nativeToScVal(value, { type: "string" });
    const vec = xdr.ScVal.scvVec;
    const metric = vec([
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      str("decoder fixture only"),
    ]);
    const packet = (layout: string, outcome: string) =>
      vec([
        str("paiflow.conditional.local-result.v1"),
        str(layout),
        str(outcome),
        metric,
        vec([]),
        vec([]),
        str("native-sac"),
      ]).toXDR("hex");
    expect(() => decodeJoinedResult(packet("minimal-lt", "success"), "minimal-gt")).toThrow(
      /identity/,
    );
    expect(() =>
      decodeJoinedResult(packet("minimal-gt", "invented-success"), "minimal-gt"),
    ).toThrow(/variant/);
  });
});
// Explicit opt-in only: root runs this local gate with freshly verified task-owned
// services and compiled Wasms. No live RPC, HTTP API, wallet extension or funding.
it.skipIf(!process.env.PAIFLOW_CONDITIONAL_JOIN_DIRECTORY)(
  "joins actual factory/guest packets through fenced readers, PG history, SDK and hosted original review",
  async () => {
    const directory = resolve(process.env.PAIFLOW_CONDITIONAL_JOIN_DIRECTORY!);
    const database = new URL(process.env.DATABASE_URL!);
    if (
      database.hostname !== "127.0.0.1" ||
      database.port !== "34263" ||
      database.pathname !== "/paiflow_1229_join" ||
      process.env.NODE_ENV !== "test"
    )
      throw new Error("Explicit owned #1229 join database required");
    await mkdir(directory, { recursive: false });
    const input = join(directory, "input"),
      output = join(directory, "output");
    constructionMocks();
    const capsules: JoinedCapsule[] = [];
    for (const layout of joinedLayouts) capsules.push(await createJoinedCapsule(layout));
    await writeJoinedCapsules(input, capsules);
    await mkdir(output, { recursive: false });
    const wasmDirectory =
      process.env.PAIFLOW_CONDITIONAL_WASM_DIRECTORY ??
      "/var/tmp/paiflow-1229-resource-target/accepted-wasms";
    const artifactFiles = {
      DEPOSIT_TRIGGER: "deposit_trigger.wasm",
      PAYER: "payer.wasm",
      SPLITTER: "paiflow_splitter.wasm",
      ROUTER: "router.wasm",
      factory: "paiflow_factory.wasm",
    };
    const artifactHashes = Object.fromEntries(
      await Promise.all(
        Object.entries(artifactFiles).map(async ([family, file]) => [
          family,
          joinedSha256(await readFile(join(wasmDirectory, file))),
        ]),
      ),
    );
    for (const [family, pin] of Object.entries(CONDITIONAL_V2_WASM_HASHES))
      expect(artifactHashes[family]).toBe(pin);
    await writeFile(
      join(directory, "artifacts.json"),
      JSON.stringify(
        {
          wasmDirectory,
          hashes: artifactHashes,
          qualification:
            "Four previously reviewed family byte hashes, reused after fresh same-input build differed; fresh factory is separately measured, not a new trusted runtime pin.",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    const child = await run(
      "cargo",
      [
        "test",
        "--locked",
        "--offline",
        "-p",
        "payer",
        "--test",
        "conditional-v2-factory-acceptance",
        "actual_factory_resources_and_joined_xdr",
        "--",
        "--ignored",
        "--nocapture",
        "--test-threads=1",
      ],
      {
        cwd: resolve("contracts"),
        env: {
          ...process.env,
          CARGO_HOME: "/var/tmp/paiflow-1228-ci/cargo-home",
          CARGO_BUILD_JOBS: "2",
          PAIFLOW_CONDITIONAL_WASM_DIRECTORY: wasmDirectory,
          PAIFLOW_CONDITIONAL_INPUT_DIRECTORY: input,
          PAIFLOW_CONDITIONAL_OUTPUT_DIRECTORY: output,
          CARGO_TARGET_DIR:
            process.env.PAIFLOW_CONDITIONAL_CARGO_TARGET_DIRECTORY ??
            "/var/tmp/paiflow-1229-resource-target",
        },
        timeout: 600000,
        maxBuffer: 16 * 1024 * 1024,
      },
    ).catch(async (error: unknown) => {
      const stdout =
        error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
          ? error.stdout
          : "";
      const stderr =
        error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
          ? error.stderr
          : "";
      await writeFile(join(directory, "compiled-guest.log"), stdout + stderr, { flag: "wx" });
      throw error;
    });
    await writeFile(join(directory, "compiled-guest.log"), child.stdout + child.stderr, {
      flag: "wx",
    });
    mocks.client = new PrismaClient({ datasourceUrl: database.toString() });
    const summaries = [];
    try {
      for (const c of capsules) {
        const raw = await readFile(join(output, `${c.layout}.result.xdr-hex`), "utf8"),
          result = decodeJoinedResult(raw, c.layout);
        const summary: Record<string, unknown> = {
          layout: c.layout,
          resultSha256: joinedSha256(Buffer.from(raw.trim(), "hex")),
          factoryOutcome: result.factoryOutcome,
          metrics: result.factoryMetrics,
          feeDiagnostics: feeDiagnostics(
            result.factoryMetrics,
            false,
            result.factoryOutcome === "success",
          ),
          assetMode: result.assetMode,
          operations: result.operations.map((op) => ({
            id: op.id,
            outcome: op.outcome,
            metrics: op.metrics,
            feeDiagnostics: feeDiagnostics(
              op.metrics,
              op.events.length > 0,
              op.outcome === "success",
            ),
          })),
        };
        summaries.push(summary);
        const sidecars = await readJoinedSidecars(output, c.layout);
        summary.sidecarHashes = sidecars.hashes;
        const getterFile = await readFile(join(output, `${c.layout}.getters.xdr-hex`));
        const instanceFile = await readFile(join(output, `${c.layout}.instances.xdr-hex`));
        summary.byteSizes = {
          getterSidecarFileBytes: getterFile.byteLength,
          getterSidecarXdrBytes: Buffer.from(getterFile.toString().trim(), "hex").byteLength,
          instanceSidecarFileBytes: instanceFile.byteLength,
          instanceSidecarXdrBytes: Buffer.from(instanceFile.toString().trim(), "hex").byteLength,
          unsignedDeploymentBase64Utf8Bytes: Buffer.byteLength(c.publicEvidence.prepared.xdr),
          unsignedDeploymentXdrBytes: Buffer.from(c.publicEvidence.prepared.xdr, "base64")
            .byteLength,
          inputPacketXdrBytes: Buffer.from(c.packet, "hex").byteLength,
        };
        const reviewCosts: ReviewCosts[] = [];
        summary.allNodeReviewCosts = reviewCosts;
        expect(result.assetMode).toBe("native-sac");
        if (result.factoryOutcome !== "success") {
          expect(["minimal-gt", "minimal-lt", "standard"]).not.toContain(c.layout);
          expect(result.returnedAddresses).toEqual([]);
          continue;
        }
        expect(result.returnedAddresses).toEqual(
          c.publicEvidence.original.pipelineSnapshot.map((n) => n.contractAddress),
        );
        const user = await mocks.client.user.create({
          data: { username: `joined-${randomUUID()}`, passwordHash: "unused-test-only" },
        });
        const flow = await mocks.client.flow.create({
          data: {
            ownerId: user.id,
            name: c.layout,
            templateKind: "PAYER",
            graph: asJson(c.publicEvidence.original.graphSnapshot),
            parameters: {},
          },
        });
        const originalEvidence = structuredClone(c.publicEvidence.original.paramsSnapshot);
        const deployment = await mocks.client.deployment.create({
          data: {
            id: c.publicEvidence.original.id,
            ownerId: user.id,
            flowId: flow.id,
            network: "testnet",
            status: "CONFIRMED",
            sourceAccount: c.owner.publicKey(),
            graphSnapshot: asJson(c.publicEvidence.original.graphSnapshot),
            paramsSnapshot: asJson(c.publicEvidence.original.paramsSnapshot),
            pipelineSnapshot: asJson(c.publicEvidence.original.pipelineSnapshot),
          },
        });
        rpcFromGuest(c, sidecars, "post-deploy");
        const baseline = await measuredCurrentRead(deployment, "post-deploy", reviewCosts);
        expect(parseConditionalExecutionDiscovery(baseline)).toEqual(baseline);
        if (!baseline.supported) throw new Error("Actual factory did not produce supported state");
        await recordConditionalConfigurationObservations(
          deployment.id,
          baseline.statuses.map((s) => s.state),
          10,
        );
        const priorBalances = new Map(
          c.publicEvidence.wallets.map((a) => [a, a.startsWith("G") ? 1000000000n : 0n]),
        );
        const required = ["minimal-gt", "minimal-lt", "standard"].includes(c.layout);
        if (required) expect(result.operations).toHaveLength(c.publicEvidence.operations.length);
        else
          expect(result.operations.length).toBeLessThanOrEqual(c.publicEvidence.operations.length);
        let previousStates = baseline.statuses.map((s) => s.state);
        let successfulPayments = 0;
        let configEvents = 0,
          routeEvents = 0;
        for (const [index, actual] of result.operations.entries()) {
          const op = c.publicEvidence.operations[index]!;
          expect(actual.id).toBe(op.id);
          expect(actual.method).toBe(op.method);
          if (actual.outcome !== (op.expectedSuccess ? "success" : "expected-refusal")) {
            expect(required).toBe(false);
            expect(["host-error", "sdk-post-fence"]).toContain(actual.outcome);
            summary.executionResourceRefusal = { operation: actual.id, outcome: actual.outcome };
            if (actual.outcome === "sdk-post-fence") break;
            continue;
          }
          const balances = new Map(actual.balances.map((b) => [b.address, BigInt(b.amount)]));
          expect([...balances.keys()].sort()).toEqual([...priorBalances.keys()].sort());
          if (!op.expectedSuccess || op.method === "mutate_v2")
            expect(balances).toEqual(priorBalances);
          if (!op.expectedSuccess)
            expect(actual.states.map((s) => s.state)).toEqual(previousStates);
          if (op.expectedSuccess && "payer" in op.intent) {
            successfulPayments++;
            const receipt = preparedReceipt(c, op),
              request = {
                amount: op.intent.amountStroops,
                from: op.intent.payer,
                arguments: op.intent.arguments,
              },
              review = conditionalHostedPaymentReview(op.intent);
            expect(parseConditionalExecutePrepared(receipt, request, deployment.id)).toEqual(
              receipt,
            );
            assertConditionalHostedPrepared(deployment.id, "testnet", request, {
              version: 2,
              prepared: receipt,
              feeStroops: (TransactionBuilder.fromXDR(receipt.xdr, Networks.TESTNET) as Transaction)
                .fee,
              ...review,
            });
            const expectedDeltas = new Map<string, bigint>();
            for (const row of review.rows)
              expectedDeltas.set(
                row.recipient,
                (expectedDeltas.get(row.recipient) ?? 0n) + BigInt(row.amountStroops),
              );
            expectedDeltas.set(
              c.payer.publicKey(),
              (expectedDeltas.get(c.payer.publicKey()) ?? 0n) -
                BigInt(request.amount) +
                BigInt(review.refundStroops),
            );
            for (const [address, balance] of balances)
              expect(balance - priorBalances.get(address)!).toBe(expectedDeltas.get(address) ?? 0n);
            const saved = {
              data: receipt,
              metadata: { status: 200, requestId: `joined-${op.id}` },
            };
            const signed = await signPrepared(
              saved,
              async (r) => {
                const tx = TransactionBuilder.fromXDR(r.xdr, r.networkPassphrase);
                tx.sign(c.payer);
                return { signedXdr: tx.toXDR() };
              },
              { walletAddress: c.payer.publicKey(), expectedNetwork: "testnet" },
            );
            expect(signed.preparation).toBe(saved);
            expect(signed.submission.intent).toBe(receipt.intent);
            // Signed XDR remains only in memory; it is never submitted or persisted.
          }
          for (const [address, balance] of balances) priorBalances.set(address, balance);
          rpcFromGuest(c, sidecars, op.id);
          const current = await measuredCurrentRead(deployment, op.id, reviewCosts);
          expect(parseConditionalExecutionDiscovery(current)).toEqual(current);
          if (!current.supported) throw new Error("Guest current configuration unsupported");
          expect(current.statuses).toEqual(actual.states.map((s) => s.status));
          previousStates = actual.states.map((s) => s.state);
          await recordConditionalConfigurationObservations(
            deployment.id,
            actual.states.map((s) => s.state),
            10,
          );
          if (op.id === "group") {
            const fresh = c.publicEvidence.operations[3]!.intent;
            if (!("payer" in fresh)) throw new Error("fresh payment required");
            assertConditionalHostedCurrent(current, fresh);
            const old = c.publicEvidence.operations[2]!.intent;
            if (!("payer" in old)) throw new Error("payment");
            expect(() => assertConditionalHostedCurrent(current, old)).toThrow(/terms changed/);
          }
          for (const [eventIndex, event] of actual.events.entries()) {
            const topics = event.topics.map((t) => scValToNative(t));
            if (topics[0] !== "config_v2" && topics[0] !== "route_v2") continue;
            const eventId = `joined-${deployment.id}-${op.id}-${eventIndex}`;
            const eventRow = await mocks.client.contractEvent.create({
              data: {
                deploymentId: deployment.id,
                eventId,
                kind: "STATUS_CHANGE",
                occurredAt: new Date(),
                payload: asJson({
                  topics,
                  value: scValToNative(event.data),
                  contractAddress: event.contract,
                  inSuccessfulContractCall: true,
                }),
                ledger: 10,
                txHash: joinedSha256(`${deployment.id}:${op.id}`),
              },
            });
            if (topics[0] === "config_v2") {
              await projectConditionalConfigurationEvent(eventRow);
              await projectConditionalConfigurationEvent(eventRow); // Actual event replay is idempotent.
              configEvents++;
            } else {
              const route = await projectConditionalRouteEvent(eventRow);
              expect(await projectConditionalRouteEvent(eventRow)).toEqual(route);
              if ("payer" in op.intent)
                expect(route).toMatchObject({
                  selectedBranch: op.intent.selectedBranch,
                  amountAtConditionStroops: op.intent.amountAtConditionStroops,
                  nodes: op.intent.nodes,
                });
              routeEvents++;
            }
          }
        }
        summary.configEvents = configEvents;
        summary.routeEvents = routeEvents;
        if (c.layout === "standard") expect(configEvents).toBe(3);
        expect(routeEvents).toBe(successfulPayments);
        // Replay and out-of-order baseline observation cannot replace newer evidence.
        await recordConditionalConfigurationObservations(
          deployment.id,
          baseline.statuses.map((s) => s.state),
          9,
        );
        const history = await conditionalConfigurationHistory(deployment.id, { limit: 100 });
        expect(parseConditionalConfigurationHistory(history)).toEqual(history);
        expect(history.historyComplete).toBe(false);
        expect(history.revisionCoverage.every((r) => r.missingRevisionCount === "0")).toBe(true);
        if (c.layout === "standard") {
          const changed = result.operations[1]!.states.find((s) => s.nodeId === "condition")!.state;
          const event = await mocks.client.configurationHistory.findFirstOrThrow({
            where: { deploymentId: deployment.id, nodeId: "condition", revision: "1" },
          });
          await recordConditionalConfigurationObservation(deployment.id, changed, 10, {
            eventId: event.eventId!,
            txHash: event.txHash!,
          });
          const gapDeployment = await mocks.client.deployment.create({
            data: {
              ownerId: user.id,
              flowId: flow.id,
              network: "testnet",
              status: "CONFIRMED",
              sourceAccount: c.owner.publicKey(),
              graphSnapshot: asJson(c.publicEvidence.original.graphSnapshot),
              paramsSnapshot: asJson(c.publicEvidence.original.paramsSnapshot),
              pipelineSnapshot: asJson(c.publicEvidence.original.pipelineSnapshot),
            },
          });
          await recordConditionalConfigurationObservation(gapDeployment.id, changed, 10);
          const gap = await conditionalConfigurationHistory(gapDeployment.id, { limit: 100 });
          expect(parseConditionalConfigurationHistory(gap).revisionCoverage).toEqual([
            {
              nodeId: "condition",
              highestObservedRevision: "1",
              observedRevisionCount: "1",
              missingRevisionCount: "1",
            },
          ]);
          await recordConditionalConfigurationObservation(
            gapDeployment.id,
            baseline.statuses.find((s) => s.state.nodeId === "condition")!.state,
            9,
          );
          expect(
            (await conditionalConfigurationHistory(gapDeployment.id, { limit: 100 }))
              .revisionCoverage[0]!.missingRevisionCount,
          ).toBe("0");
          const forged = structuredClone(changed);
          forged.admin = c.payer.publicKey();
          await expect(
            recordConditionalConfigurationObservation(deployment.id, forged, 10),
          ).rejects.toThrow();
        }
        expect(
          (await mocks.client.deployment.findUniqueOrThrow({ where: { id: deployment.id } }))
            .paramsSnapshot,
        ).toEqual(originalEvidence);
        rpcFromGuest(c, sidecars, c.publicEvidence.operations.at(-1)!.id, true);
        await expect(readConditionalExecutionState(deployment)).rejects.toMatchObject({
          code: "UPSTREAM_RPC",
        });
      }
      await writeFile(
        join(directory, "joined-report.json"),
        JSON.stringify(
          {
            qualification:
              "Actual local SDK26 guest execution/native SAC; local RPC fixture metadata, direct reader/PG/projection/SDK pure parser integration and sign-only callback. Setup-only stored-code/module-cache warm and observation budgets are separate from default100mCPU/40MiB measured calls. SDK26 fee model is a historical2024-12-11 snapshot. No actual HTTP API, live RPC, current network fees, wallet extension or submitted transaction.",
            reviewCostQualification:
              "Counts cover exactly one successful production fenced-current read per reached phase through the local guest RPC adapter. getLedgerEntries counts the two actual opening/closing instance requests; account loading is separately counted at the mocked loadPaymentAccount adapter boundary, whose underlying RPC lookup is not measured. DTO bytes are exact UTF-8 JSON.stringify({data:current}), excluding HTTP headers/compression. Sidecar sizes cover each complete layout file, not one phase. No live RPC latency or fee claim.",
            feeDiagnosticsComplete: false,
            feeQualification:
              "All feeDebug values are historical SDK26 MODEL ONLY, not usable quotes or actual fees. Incomplete diagnostic read/write/event counters can be zero despite actual successful state changes/events; zero never proves no reads/writes/events. Large first-native-payment rent-model values are not live-network rent or transaction charges. Do not convert to XLM or sum as actual fees.",
            canonicalRebuildSupplement: {
              manifestSha256: "23a5671dad9525f87df913c8d781527cdf6bf9abeb2f27e486b4c055b9ed5639",
              qualification:
                "Root canonical rebuild using original #1224 CargoHome reproduced all four approved bytes; prior differing-path rebuild evidence remains preserved. This run continues to hash and use the reviewed approved bytes.",
            },
            shadowQualification:
              "See actual guest log and metric debug profiles. A bounded shadow-only experiment does not establish default-shadow network acceptance; independent default-shadow controls are retained by the Rust resource lane.",
            metadataAdaptation:
              "Only zero lastModifiedLedgerSeq mapped to1 for production positive-ledger schema; actual instance and getter XDR untouched.",
            artifactHashes,
            artifactQualification: {
              families:
                "Reviewed #1224 bytes reused and verified against all four unchanged source pins; fresh rebuilt family bytes differ and were NOT used or trusted.",
              factory:
                "Fresh locally compiled factory; separately measured hash, not a conditional runtime trust pin.",
              sourceInputs:
                "Root/Rust investigation verified same production sources/toolchain; local bit reproducibility remains qualified, not claimed.",
            },
            summaries,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
    } finally {
      await mocks.client.$disconnect();
    }
  },
  900000,
);
