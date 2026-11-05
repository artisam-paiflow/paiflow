import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  StrKey,
  nativeToScVal,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import {
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
  executionArtifactMetadata,
} from "@/lib/stellar/execution-artifacts";
const mock = vi.hoisted(() => ({
  rpc: { getLatestLedger: vi.fn(), _getLedgerEntries: vi.fn(), simulateTransaction: vi.fn() },
  account: vi.fn(),
  observe: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mock.rpc }));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mock.account }));
vi.mock("@/lib/mutations/history", () => ({ recordConfigurationObservation: mock.observe }));
import { readMutationState } from "@/lib/stellar/mutation-state";
import { readExecutionState } from "@/lib/stellar/execution-state";

const owner = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const root = StrKey.encodeContract(Buffer.alloc(32, 1));
const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
const asset = Asset.native().contractId(Networks.TESTNET);
const capabilities = {
  policy_version: 1,
  execution_abi: 1,
  execution: true,
  mutation: false,
  immutable_policies: true,
  revision_binding: true,
};
let rawRoot: Record<string, unknown>;
let rawPay: Record<string, unknown>;
let deployment: Deployment;
function abiValue(value: unknown): xdr.ScVal {
  if (typeof value === "number") return nativeToScVal(value, { type: "u32" });
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(abiValue));
  if (value && typeof value === "object")
    return xdr.ScVal.scvMap(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([key, entry]) =>
            new xdr.ScMapEntry({
              key: nativeToScVal(key, { type: "symbol" }),
              val: abiValue(entry),
            }),
        ),
    );
  return nativeToScVal(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  rawRoot = {
    policy: {
      version: 1,
      node_id: "root",
      next_steps: [{ address: pay, data: "" }],
      min_amount: 0n,
    },
    revision: 0n,
    asset,
  };
  rawPay = {
    policy: {
      version: 1,
      node_id: "pay",
      recipient_mode: ["Execution"],
      payout_value_mode: ["Constant"],
      recipient: null,
      payout_rule: ["Full"],
    },
    revision: 0n,
    asset,
    parent: root,
    next_steps: [],
    amount: 0n,
    percentage_bps: 10000,
  };
  deployment = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "CONFIRMED",
    network: "testnet",
    sourceAccount: owner,
    graphSnapshot: {
      nodes: [
        { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "pay",
          type: "pay",
          config: { recipient: "", asset: { kind: "native" }, fullAmount: true },
        },
      ],
      edges: [{ id: "edge", source: "root", target: "pay" }],
      fieldPolicies: {
        version: 1,
        nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution" }],
      },
    },
    pipelineSnapshot: [
      {
        nodeId: "root",
        contractAddress: root,
        templateKind: "DEPOSIT_TRIGGER",
        wasmHash: EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
        artifactCapabilities: executionArtifactMetadata(
          "DEPOSIT_TRIGGER",
          EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
        ),
      },
      {
        nodeId: "pay",
        contractAddress: pay,
        templateKind: "PAYER",
        wasmHash: EXECUTION_V1_WASM_HASHES.PAYER,
        artifactCapabilities: executionArtifactMetadata("PAYER", EXECUTION_V1_WASM_HASHES.PAYER),
      },
    ],
  } as unknown as Deployment;
  mock.account.mockResolvedValue(new Account(owner, "10"));
  mock.rpc.getLatestLedger.mockResolvedValue({ sequence: 10 });
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 10,
    entries: keys.map((key, index) => ({
      key: key.toXDR("base64"),
      lastModifiedLedgerSeq: 5,
      liveUntilLedgerSeq: 1000,
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
                  index === 0
                    ? EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER
                    : EXECUTION_V1_WASM_HASHES.PAYER,
                  "hex",
                ),
              ),
              storage: null,
            }),
          ),
        }),
      ).toXDR("base64"),
    })),
  }));
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error();
    const call = op.func.invokeContract();
    const value =
      call.functionName().toString() === "capabilities"
        ? capabilities
        : Address.fromScAddress(call.contractAddress()).toString() === root
          ? rawRoot
          : rawPay;
    return { transactionData: {}, latestLedger: 10, result: { retval: abiValue(value) } };
  });
});

describe("verified current execution state", () => {
  it("verifies real executable hashes/getters and returns tagged absent inputs without draft contacts", async () => {
    const state = await readExecutionState(deployment);
    expect(state.supported).toBe(true);
    if (!state.supported) throw new Error();
    expect(state.confirmedLedger).toBe(10);
    expect(state.configurations[0]!.configuration).toEqual({
      kind: "pay",
      payoutValue: { kind: "full" },
    });
    expect(state.policies.nodes[0]).toMatchObject({ nodeId: "pay", recipient: "execution" });
    expect(JSON.stringify(state)).not.toContain("email");
    expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(4);
  });
  it("reports legacy unavailability without querying arbitrary getters", async () => {
    const graph = deployment.graphSnapshot as Record<string, unknown>;
    delete graph.fieldPolicies;
    expect(await readExecutionState(deployment)).toMatchObject({
      supported: false,
      policyVersion: 0,
    });
    expect(mock.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("refuses missing or changed pinned artifact metadata before RPC", async () => {
    const nodes = deployment.pipelineSnapshot as Array<Record<string, unknown>>;
    nodes[0]!.wasmHash = "aa".repeat(32);
    await expect(readExecutionState(deployment)).rejects.toThrow();
    expect(mock.rpc._getLedgerEntries).not.toHaveBeenCalled();
  });
  it("refuses malformed missing entries", async () => {
    mock.rpc._getLedgerEntries.mockResolvedValue({ latestLedger: 10, entries: null });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("refuses a changed live WASM executable despite valid pinned metadata", async () => {
    const original = mock.rpc._getLedgerEntries.getMockImplementation()!;
    mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const result = await original(...keys);
      const data = xdr.LedgerEntryData.fromXDR(result.entries[0].xdr, "base64");
      data
        .contractData()
        .val()
        .instance()
        .executable(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 9)));
      result.entries[0].xdr = data.toXDR("base64");
      return result;
    });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mock.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("checks returned instance key/address instead of trusting response order", async () => {
    const original = mock.rpc._getLedgerEntries.getMockImplementation()!;
    mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const result = await original(...keys);
      result.entries[0].key = keys[1]!.toXDR("base64");
      return result;
    });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("rejects inconsistent ledgers rather than mixing revisions", async () => {
    const original = mock.rpc.simulateTransaction.getMockImplementation()!;
    mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
      ...(await original(tx)),
      latestLedger: 11,
    }));
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it.each(["asset", "parent", "routing"])("refuses changed immutable %s", async (field) => {
    if (field === "asset") rawPay.asset = StrKey.encodeContract(Buffer.alloc(32, 9));
    if (field === "parent") rawPay.parent = pay;
    if (field === "routing") rawPay.next_steps = [{ address: root, data: "" }];
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("refuses changed constant recipient even when getters claim the policy is unchanged", async () => {
    const graph = deployment.graphSnapshot as {
      nodes: Array<{ config: Record<string, unknown> }>;
      fieldPolicies: { nodes: Array<{ recipient: string }> };
    };
    graph.nodes[1]!.config.recipient = recipient;
    graph.fieldPolicies.nodes[0]!.recipient = "constant";
    rawPay.policy = {
      ...(rawPay.policy as object),
      recipient_mode: ["Constant"],
      recipient: Keypair.random().publicKey(),
    };
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("does not infer support from an unknown/missing capability", async () => {
    const original = mock.rpc.simulateTransaction.getMockImplementation()!;
    mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      const result = await original(tx);
      const op = tx.operations[0]!;
      if (
        op.type === "invokeHostFunction" &&
        op.func.invokeContract().functionName().toString() === "capabilities"
      )
        result.result.retval = abiValue({ ...capabilities, execution: false });
      return result;
    });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
});

function useGuardedArtifacts() {
  const nodes = deployment.pipelineSnapshot as Array<Record<string, unknown>>;
  for (const node of nodes) {
    const kind = node.templateKind as "DEPOSIT_TRIGGER" | "PAYER";
    node.wasmHash = MUTATION_V1_WASM_HASHES[kind];
    node.artifactCapabilities = executionArtifactMetadata(kind, MUTATION_V1_WASM_HASHES[kind]);
  }
  const ledger = mock.rpc._getLedgerEntries.getMockImplementation()!;
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
    const result = await ledger(...keys);
    result.entries.forEach((entry: { xdr: string }, index: number) => {
      const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64");
      data
        .contractData()
        .val()
        .instance()
        .executable(
          xdr.ContractExecutable.contractExecutableWasm(
            Buffer.from(
              index === 0 ? MUTATION_V1_WASM_HASHES.DEPOSIT_TRIGGER : MUTATION_V1_WASM_HASHES.PAYER,
              "hex",
            ),
          ),
        );
      entry.xdr = data.toXDR("base64");
    });
    return result;
  });
  const simulate = mock.rpc.simulateTransaction.getMockImplementation()!;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const result = await simulate(tx);
    const op = tx.operations[0];
    if (
      op?.type === "invokeHostFunction" &&
      op.func.invokeContract().functionName().toString() === "capabilities"
    )
      result.result.retval = abiValue({ ...capabilities, mutation: true });
    return result;
  });
}

it("new guarded artifacts retain execution discovery while old pinned artifacts remain execution-only", async () => {
  const original = await readExecutionState(deployment);
  expect(original.supported && original.nodes.every((node) => !node.capabilities.mutation)).toBe(
    true,
  );
  useGuardedArtifacts();
  const state = await readExecutionState(deployment);
  expect(state.supported && state.nodes.every((node) => node.capabilities.mutation)).toBe(true);
});
it("reads changed mutable values at confirmed revision while preserving original graph evidence", async () => {
  useGuardedArtifacts();
  const graph = deployment.graphSnapshot as {
    nodes: Array<{ config: Record<string, unknown> }>;
    fieldPolicies: { nodes: Array<Record<string, unknown>> };
  };
  Object.assign(graph.nodes[1]!.config, {
    fullAmount: false,
    mode: "fixed",
    amountStroops: "10",
    recipient,
  });
  Object.assign(graph.fieldPolicies.nodes[0]!, { recipient: "mutable", payoutValue: "mutable" });
  rawPay.policy = {
    ...(rawPay.policy as object),
    recipient_mode: ["Mutable"],
    payout_value_mode: ["Mutable"],
    recipient: owner,
    payout_rule: ["Fixed", 20n],
  };
  Object.assign(rawPay, { revision: 2n, amount: 20n, percentage_bps: 0 });
  const state = await readExecutionState(deployment);
  expect(state.supported).toBe(true);
  if (!state.supported) throw new Error();
  expect(state.configurations[0]).toMatchObject({
    revision: "2",
    configuration: { recipient: owner, payoutValue: { kind: "fixed", amountStroops: "20" } },
  });
  expect(graph.nodes[1]!.config.amountStroops).toBe("10");
  Object.assign(graph.fieldPolicies.nodes[0]!, { payoutValue: "constant" });
  rawPay.policy = { ...(rawPay.policy as object), payout_value_mode: ["Constant"] };
  await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
});
it("refuses mutable declarations on retained execution-only artifacts before RPC", async () => {
  const graph = deployment.graphSnapshot as {
    fieldPolicies: { nodes: Array<Record<string, unknown>> };
  };
  Object.assign(graph.fieldPolicies.nodes[0]!, { recipient: "mutable" });
  await expect(readExecutionState(deployment)).rejects.toThrow();
  expect(mock.rpc._getLedgerEntries).not.toHaveBeenCalled();
});

/** Model RPC snapshots independently of getter results, including writes that do
 * not change decoded revisions (e.g. accumulation or change-then-revert). */
function bracket(options: {
  before?: number;
  after?: number;
  changed?: "metadata" | "storage" | "code";
  firstAttemptOnly?: boolean;
}) {
  const original = mock.rpc._getLedgerEntries.getMockImplementation()!;
  let calls = 0;
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
    const result = await original(...keys);
    calls++;
    const closing = calls % 2 === 0;
    result.latestLedger = closing ? (options.after ?? 12) : (options.before ?? 10);
    if (closing && (!options.firstAttemptOnly || calls === 2)) {
      if (options.changed === "metadata") result.entries[1].lastModifiedLedgerSeq = 11;
      if (options.changed === "storage" || options.changed === "code") {
        const data = xdr.LedgerEntryData.fromXDR(result.entries[1].xdr, "base64");
        const instance = data.contractData().val().instance();
        if (options.changed === "code")
          instance.executable(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 9)));
        else
          instance.storage([new xdr.ScMapEntry({ key: abiValue("balance"), val: abiValue(1n) })]);
        result.entries[1].xdr = data.toXDR("base64");
      }
    }
    return result;
  });
}

it("accepts unchanged two-node state across multiple ledger closes and labels the common final snapshot", async () => {
  bracket({ after: 13 });
  const simulate = mock.rpc.simulateTransaction.getMockImplementation()!;
  let calls = 0;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
    ...(await simulate(tx)),
    latestLedger: 10 + Math.floor(calls++ / 2),
  }));
  const state = await readExecutionState(deployment);
  expect(state.supported && state.confirmedLedger).toBe(13);
  expect(state.supported && state.configurations[0]!.confirmedLedger).toBe(13);
  expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
  expect(mock.rpc.getLatestLedger).not.toHaveBeenCalled();
});

it("accepts a three-node path whose successive getter batches cross ledgers", async () => {
  const middle = StrKey.encodeContract(Buffer.alloc(32, 3));
  const graph = deployment.graphSnapshot as unknown as {
    nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
  graph.nodes.splice(1, 0, {
    id: "fee",
    type: "pay",
    config: {
      mode: "percentage",
      percentage: 15,
      recipient,
      asset: { kind: "native" },
      fullAmount: false,
    },
  });
  graph.edges = [
    { id: "a", source: "root", target: "fee" },
    { id: "b", source: "fee", target: "pay" },
  ];
  const snapshot = deployment.pipelineSnapshot as Array<Record<string, unknown>>;
  snapshot.splice(1, 0, { ...snapshot[1], nodeId: "fee", contractAddress: middle });
  rawRoot.policy = { ...(rawRoot.policy as object), next_steps: [{ address: middle, data: "" }] };
  rawPay.parent = middle;
  const fee = {
    ...rawPay,
    parent: root,
    percentage_bps: 1500,
    next_steps: [{ address: pay, data: "" }],
    policy: {
      version: 1,
      node_id: "fee",
      recipient_mode: ["Constant"],
      payout_value_mode: ["Constant"],
      recipient,
      payout_rule: ["Percentage", 1500],
    },
  };
  bracket({ after: 12 });
  const original = mock.rpc.simulateTransaction.getMockImplementation()!;
  let calls = 0;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const result = await original(tx);
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error();
    const call = op.func.invokeContract();
    if (
      Address.fromScAddress(call.contractAddress()).toString() === middle &&
      call.functionName().toString() === "current_config"
    )
      result.result.retval = abiValue(fee);
    return { ...result, latestLedger: 10 + Math.floor(calls++ / 2) };
  });
  const state = await readExecutionState(deployment);
  expect(state.supported && state.nodes).toHaveLength(3);
  expect(state.supported && state.confirmedLedger).toBe(12);
  expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(6);
});

it.each(["metadata", "storage", "code"] as const)(
  "refuses %s changes during the read even if getter revisions agree",
  async (changed) => {
    bracket({ changed });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(4);
  },
);

it("restarts all getters after a detected write and accepts only the stable retry", async () => {
  bracket({ changed: "metadata", firstAttemptOnly: true });
  expect((await readExecutionState(deployment)).supported).toBe(true);
  expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(8);
});

it.each([
  { lastModifiedLedgerSeq: undefined },
  { lastModifiedLedgerSeq: 0 },
  { lastModifiedLedgerSeq: 11 },
  { lastModifiedLedgerSeq: 1.5 },
  { liveUntilLedgerSeq: undefined },
  { liveUntilLedgerSeq: 9 },
])("refuses incomplete, malformed or expired instance metadata %j", async (metadata) => {
  const original = mock.rpc._getLedgerEntries.getMockImplementation()!;
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
    const result = await original(...keys);
    Object.assign(result.entries[0], metadata);
    return result;
  });
  await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  expect(mock.rpc.simulateTransaction).not.toHaveBeenCalled();
});

it("rejects a regressing final batch", async () => {
  bracket({ after: 9 });
  await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
});

it.each([9, 13])("rejects a getter outside the bracket at ledger %i", async (latestLedger) => {
  bracket({ after: 12 });
  const original = mock.rpc.simulateTransaction.getMockImplementation()!;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
    ...(await original(tx)),
    latestLedger,
  }));
  await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
});

it("refuses getters needing archived-entry restoration", async () => {
  const original = mock.rpc.simulateTransaction.getMockImplementation()!;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
    ...(await original(tx)),
    restorePreamble: { transactionData: {}, minResourceFee: "100" },
  }));
  await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
});

function mutationGetters(obligations = 0n) {
  useGuardedArtifacts();
  const original = mock.rpc.simulateTransaction.getMockImplementation()!;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error();
    if (op.func.invokeContract().functionName().toString() === "mutation_status")
      return {
        transactionData: {},
        latestLedger: 12,
        result: {
          retval: abiValue({
            node_id: "pay",
            admin: owner,
            asset,
            parent: root,
            next_steps: [],
            revision: 0n,
            obligations,
          }),
        },
      };
    return original(tx);
  });
}

it("reads mutation authority and obligations inside the configuration fence across ledger closes", async () => {
  mutationGetters(200n);
  bracket({ after: 12 });
  const state = await readMutationState(deployment);
  expect(state.confirmedLedger).toBe(12);
  expect(state.obligations).toEqual([{ nodeId: "pay", obligationsStroops: "200" }]);
  expect(mock.observe).toHaveBeenCalledWith(
    deployment.id,
    expect.objectContaining({ confirmedLedger: 12 }),
  );
});

it("rejects obligation writes after configuration getters even with unchanged revision and never records stale history", async () => {
  mutationGetters(0n);
  bracket({ after: 12, changed: "storage" });
  await expect(readMutationState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(10);
  expect(mock.observe).not.toHaveBeenCalled();
});

it.each(["missing", "duplicate", "metadata"])(
  "refuses a malformed final batch (%s)",
  async (fault) => {
    const original = mock.rpc._getLedgerEntries.getMockImplementation()!;
    let calls = 0;
    mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const result = await original(...keys);
      if (++calls % 2 === 0) {
        if (fault === "missing") result.entries.pop();
        else if (fault === "duplicate") result.entries[1] = result.entries[0];
        else result.entries[0].lastModifiedLedgerSeq = undefined;
      }
      return result;
    });
    await expect(readExecutionState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  },
);

it("retries the complete mutation observation and publishes only the latest obligations", async () => {
  mutationGetters();
  bracket({ after: 12, changed: "metadata", firstAttemptOnly: true });
  const original = mock.rpc.simulateTransaction.getMockImplementation()!;
  let statuses = 0;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const result = await original(tx);
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error();
    if (op.func.invokeContract().functionName().toString() === "mutation_status") {
      result.result.retval = abiValue({
        node_id: "pay",
        admin: owner,
        asset,
        parent: root,
        next_steps: [],
        revision: 0n,
        obligations: BigInt(++statuses),
      });
    }
    return result;
  });
  const state = await readMutationState(deployment);
  expect(state.obligations).toEqual([{ nodeId: "pay", obligationsStroops: "2" }]);
  expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(10);
  expect(mock.observe).toHaveBeenCalledTimes(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("overlaps the initial account read with the opening instance fence", async () => {
  const account = deferred<Account>();
  mock.account.mockReturnValue(account.promise);
  const reading = readExecutionState(deployment);
  await vi.waitFor(() => expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(1));
  expect(mock.rpc.simulateTransaction).not.toHaveBeenCalled();
  account.resolve(new Account(owner, "10"));
  expect((await reading).supported).toBe(true);
});

it("starts queued obligation getters while slower configuration getters are still running", async () => {
  mutationGetters();
  bracket({ after: 12 });
  const simulate = mock.rpc.simulateTransaction.getMockImplementation()!;
  const pending: Array<ReturnType<typeof deferred<void>>> = [];
  let active = 0,
    maximum = 0;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const gate = deferred<void>();
    pending.push(gate);
    active++;
    maximum = Math.max(maximum, active);
    try {
      const value = await simulate(tx);
      await gate.promise;
      return value;
    } finally {
      active--;
    }
  });
  const reading = readMutationState(deployment);
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(1);
  pending[0]!.resolve();
  await vi.waitFor(() => expect(pending).toHaveLength(5));
  const fifth = mock.rpc.simulateTransaction.mock.calls[4]![0] as Transaction;
  const op = fifth.operations[0]!;
  if (op.type !== "invokeHostFunction") throw new Error();
  expect(op.func.invokeContract().functionName().toString()).toBe("mutation_status");
  expect(mock.observe).not.toHaveBeenCalled();
  expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(1);
  pending.slice(1).forEach((gate) => gate.resolve());
  await reading;
  expect(maximum).toBe(4);
  expect(active).toBe(0);
  expect(mock.observe).toHaveBeenCalledOnce();
});

it("overlaps preparation-only work with the closing fence but verifies both before publishing", async () => {
  mutationGetters();
  bracket({ after: 12 });
  const entries = mock.rpc._getLedgerEntries.getMockImplementation()!;
  const closing = deferred<void>(),
    account = deferred<void>();
  let calls = 0;
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
    const value = await entries(...keys);
    if (++calls === 2) await closing.promise;
    return value;
  });
  const finalRead = vi.fn(() => account.promise);
  const reading = readMutationState(deployment, finalRead);
  await vi.waitFor(() => {
    expect(calls).toBe(2);
    expect(finalRead).toHaveBeenCalledOnce();
  });
  account.resolve();
  await Promise.resolve();
  expect(mock.observe).not.toHaveBeenCalled();
  closing.resolve();
  await reading;
  expect(mock.observe).toHaveBeenCalledOnce();
});

it("retains preparation-only account failures without retrying or publishing history", async () => {
  mutationGetters();
  bracket({ after: 12 });
  const error = new Error("safe account error");
  await expect(
    readMutationState(deployment, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
  expect(mock.observe).not.toHaveBeenCalled();
});

it("settles failed-attempt siblings before retrying and never exceeds four active getters", async () => {
  mutationGetters();
  const simulate = mock.rpc.simulateTransaction.getMockImplementation()!;
  const gates = Array.from({ length: 4 }, () => deferred<void>());
  let calls = 0,
    active = 0,
    maximum = 0;
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const index = calls++;
    active++;
    maximum = Math.max(maximum, active);
    try {
      if (index < 4) await gates[index]!.promise;
      return { ...(await simulate(tx)), latestLedger: 10 };
    } finally {
      active--;
    }
  });
  const reading = readMutationState(deployment);
  await vi.waitFor(() => expect(calls).toBe(4));
  gates[0]!.reject(new Error("transport failure"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(1);
  expect(calls).toBe(4);
  gates.slice(1).forEach((gate) => gate.resolve());
  expect((await reading).supported).toBe(true);
  expect(maximum).toBe(4);
  expect(active).toBe(0);
  expect(mock.observe).toHaveBeenCalledOnce();
});

it("stops queued getters and refuses retry or history publication after the deadline", async () => {
  const { withInteractiveRpcBudget } = await import("@/lib/stellar/interactive-rpc-budget");
  mutationGetters();
  bracket({ after: 12 });
  const simulate = mock.rpc.simulateTransaction.getMockImplementation()!;
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  mock.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const gate = deferred<void>();
    gates.push(gate);
    await gate.promise;
    return simulate(tx);
  });
  vi.useFakeTimers();
  try {
    const reading = withInteractiveRpcBudget(() => readMutationState(deployment), 25);
    const refused = expect(reading).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(25);
    gates.forEach((gate) => gate.resolve());
    await refused;
    expect(mock.rpc.simulateTransaction).toHaveBeenCalledTimes(4);
    expect(mock.rpc._getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(mock.observe).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("settles the closing fence when a preparation callback throws synchronously", async () => {
  mutationGetters();
  bracket({ after: 12 });
  const entries = mock.rpc._getLedgerEntries.getMockImplementation()!;
  const closing = deferred<void>();
  let calls = 0,
    completed = false;
  mock.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
    const value = await entries(...keys);
    if (++calls === 2) await closing.promise;
    return value;
  });
  const error = new Error("safe independent failure");
  const reading = readMutationState(deployment, () => {
    throw error;
  });
  const refused = expect(reading).rejects.toBe(error);
  void reading
    .finally(() => {
      completed = true;
    })
    .catch(() => {});
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(completed).toBe(false);
  expect(mock.observe).not.toHaveBeenCalled();
  closing.resolve();
  await refused;
  expect(calls).toBe(2);
});
