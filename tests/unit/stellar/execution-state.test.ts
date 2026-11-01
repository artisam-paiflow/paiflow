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
  executionArtifactMetadata,
} from "@/lib/stellar/execution-artifacts";
const mock = vi.hoisted(() => ({
  rpc: { getLatestLedger: vi.fn(), _getLedgerEntries: vi.fn(), simulateTransaction: vi.fn() },
  account: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mock.rpc }));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mock.account }));
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
