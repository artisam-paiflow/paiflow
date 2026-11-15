import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  StrKey,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import type { ConditionalNodeState } from "@/lib/flows/conditional-v2-state";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import {
  conditionalManifestScVal,
  conditionalNodeStateScVal,
} from "@/lib/stellar/conditional-v2-codec";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
const mocks = vi.hoisted(() => ({
  rpc: { _getLedgerEntries: vi.fn(), simulateTransaction: vi.fn() },
  account: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mocks.rpc }));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mocks.account }));
import {
  readConditionalExecutionState,
  readConditionalExecutionStateForReview,
} from "@/lib/stellar/conditional-execution-state";

let fixture: ReturnType<typeof conditionalDeploymentFixture>;
let states: ConditionalNodeState[];
let obligations: string[];
let overrides: Map<string, (value: xdr.ScVal) => xdr.ScVal>;
const address = (byte: number) => StrKey.encodeContract(Buffer.alloc(32, byte));
const wallet = (byte: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, byte));
function abi(value: unknown): xdr.ScVal {
  if (value instanceof xdr.ScVal) return value;
  if (typeof value === "number") return nativeToScVal(value, { type: "u32" });
  if (typeof value === "bigint") return nativeToScVal(value, { type: "i128" });
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(abi));
  if (value !== null && typeof value === "object")
    return xdr.ScVal.scvMap(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([key, v]) =>
            new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val: abi(v) }),
        ),
    );
  return nativeToScVal(value);
}
function witness(keys: xdr.LedgerKey[], ledger = 10) {
  return {
    latestLedger: ledger,
    entries: keys.map((key) => {
      const contract = Address.fromScAddress(key.contractData().contract()).toString();
      const pin = fixture.pipelineSnapshot.find((node) => node.contractAddress === contract)!;
      return {
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
                  Buffer.from(pin.wasmHash, "hex"),
                ),
                storage: null,
              }),
            ),
          }),
        ).toXDR("base64"),
      };
    }),
  };
}
function rawCurrent(index: number, change: (raw: Record<string, unknown>) => void) {
  overrides.set(`${index}:mutation_status_v2`, (value) => {
    const raw = scValToNative(value) as { state: Record<string, unknown> };
    change(raw.state);
    return abi(raw);
  });
}
function setup(mutable = false) {
  fixture = conditionalDeploymentFixture(mutable);
  states = structuredClone(fixture.plan.manifest.nodes.map((node) => node.state));
  obligations = states.map(() => "0");
  overrides = new Map();
  mocks.account.mockResolvedValue(new Account(fixture.plan.definition.owner, "10"));
  mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => witness(keys));
  mocks.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") throw new Error("operation");
    const call = op.func.invokeContract();
    const contract = Address.fromScAddress(call.contractAddress()).toString();
    const method = call.functionName().toString();
    const index = fixture.pipelineSnapshot.findIndex((node) => node.contractAddress === contract);
    if (index < 0) throw new Error("unknown node");
    let value: xdr.ScVal;
    switch (method) {
      case "capabilities_v2":
        value = abi({
          policy_version: 2,
          execution_abi: 2,
          mutation_abi: 2,
          conditional: true,
          execution: true,
          mutation: true,
          immutable_policies: true,
          revision_binding: true,
        });
        break;
      case "graph_manifest_v2":
        value = conditionalManifestScVal(fixture.plan.manifest);
        break;
      case "initial_config_v2":
        value = conditionalNodeStateScVal(fixture.plan.manifest.nodes[index]!.state);
        break;
      case "mutation_status_v2":
        value = abi({
          state: conditionalNodeStateScVal(states[index]!),
          obligations: BigInt(obligations[index]!),
        });
        break;
      default:
        throw new Error("unexpected getter");
    }
    value = overrides.get(`${index}:${method}`)?.(value) ?? value;
    return { transactionData: {}, latestLedger: 10, result: { retval: value } };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  setup();
});
afterEach(() => vi.useRealTimers());

describe("verified complete conditional state", () => {
  it("verifies both branches, original getters, actual executables, salts and owner return without private authoring metadata", async () => {
    obligations[3] = "40";
    const current = await readConditionalExecutionState(fixture.deployment);
    expect(current.supported).toBe(true);
    if (!current.supported) throw new Error();
    expect(current.nodes).toHaveLength(5);
    expect(current.statuses[3]!.obligationsStroops).toBe("40");
    expect(current.definition.falseBranch.kind).toBe("return_to_owner");
    expect(current.statuses[4]!.state.configuration).toEqual({
      kind: "return_to_owner",
      recipient: fixture.plan.definition.owner,
    });
    expect(JSON.stringify(current)).not.toContain("private@example");
    expect(mocks.rpc.simulateTransaction).toHaveBeenCalledTimes(20);
    expect(mocks.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
  });
  it("accepts only declared current mutable leaves on prefix, condition and both branches", async () => {
    setup(true);
    states.slice(1).forEach((state) => {
      state.revision = "1";
      if (state.configuration.kind === "pay")
        state.configuration.configuration.payoutValue = { kind: "fixed", amountStroops: "11" };
      if (state.configuration.kind === "condition") state.configuration.thresholdStroops = "200";
      if (state.configuration.kind === "split")
        state.configuration.configuration.configuredRows[0]!.recipient = wallet(9);
    });
    const current = await readConditionalExecutionState(fixture.deployment);
    expect(current.supported).toBe(true);
    if (!current.supported) throw new Error();
    expect(current.definition.condition.thresholdStroops).toBe("200");
    expect(current.nodes.map((node) => node.expectedRevision)).toEqual(["0", "1", "1", "1", "1"]);
  });
  it("does not infer generation from reviewed hashes or schema acceptance", async () => {
    fixture.deployment.paramsSnapshot = [];
    expect(await readConditionalExecutionState(fixture.deployment)).toMatchObject({
      version: 2,
      supported: false,
      policyVersion: 0,
    });
    expect(mocks.rpc._getLedgerEntries).not.toHaveBeenCalled();
  });
  it.each([
    "missingTag",
    "unknownVersion",
    "unknownGeneration",
    "partialCapabilities",
    "wrongKind",
    "missingNode",
    "reordered",
    "semanticReturn",
    "saltMissing",
    "saltUppercase",
    "saltWrong",
    "ownerMismatch",
    "ownerMissing",
  ])("rejects malformed original %s before RPC", async (kind) => {
    const params = fixture.deployment.paramsSnapshot as unknown as Record<string, unknown>;
    const pipeline = fixture.pipelineSnapshot;
    switch (kind) {
      case "missingTag":
        delete params.generation;
        break;
      case "unknownVersion":
        params.version = 3;
        break;
      case "unknownGeneration":
        params.generation = "unknown";
        break;
      case "partialCapabilities":
        Object.assign(pipeline[0]!.artifactCapabilities, { mutation: false, mutationAbi: 0 });
        break;
      case "wrongKind":
        pipeline[0]!.templateKind = "PAYER";
        break;
      case "missingNode":
        pipeline.pop();
        break;
      case "reordered":
        pipeline.reverse();
        break;
      case "semanticReturn":
        pipeline.at(-1)!.implementation.bindings[0]!.blockType = "pay";
        break;
      case "saltMissing":
        delete (pipeline[0] as { salt?: string }).salt;
        break;
      case "saltUppercase":
        pipeline[0]!.salt = "AB".repeat(32);
        break;
      case "saltWrong":
        pipeline[0]!.salt = "ff".repeat(32);
        break;
      case "ownerMismatch":
        fixture.deployment.sourceAccount = wallet(10);
        break;
      default:
        fixture.deployment.sourceAccount = null;
    }
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mocks.rpc._getLedgerEntries).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "duplicate",
    "wrongHash",
    "wrongKey",
    "wrongAddress",
    "wrongDurability",
    "missingTtl",
    "expired",
    "modifiedFuture",
    "nullEntries",
  ])("refuses malformed %s instance evidence", async (kind) => {
    mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const result = witness(keys);
      switch (kind) {
        case "missing":
          result.entries.pop();
          break;
        case "duplicate":
          result.entries[0] = result.entries[1]!;
          break;
        case "wrongKey":
          result.entries[0]!.key = keys[1]!.toXDR("base64");
          break;
        case "missingTtl":
          Object.assign(result.entries[0]!, { liveUntilLedgerSeq: undefined });
          break;
        case "expired":
          result.entries[0]!.liveUntilLedgerSeq = 9;
          break;
        case "modifiedFuture":
          result.entries[0]!.lastModifiedLedgerSeq = 11;
          break;
        case "nullEntries":
          Object.assign(result, { entries: null });
          break;
        default: {
          const data = xdr.LedgerEntryData.fromXDR(result.entries.at(-1)!.xdr, "base64");
          if (kind === "wrongHash")
            data
              .contractData()
              .val()
              .instance()
              .executable(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 99)));
          if (kind === "wrongAddress")
            data.contractData().contract(new Address(address(99)).toScAddress());
          if (kind === "wrongDurability")
            data.contractData().durability(xdr.ContractDataDurability.temporary());
          result.entries.at(-1)!.xdr = data.toXDR("base64");
        }
      }
      return result;
    });
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it.each([
    "capabilities",
    "manifest",
    "initial",
    "version",
    "constant",
    "owner",
    "rowOrder",
    "asset",
    "parent",
    "revisionOverflow",
    "obligationOverflow",
    "policyMode",
    "constantAmount",
    "payoutKind",
    "comparison",
    "rootMinimum",
    "mutableAtZero",
  ])("refuses inconsistent %s getter evidence", async (kind) => {
    switch (kind) {
      case "capabilities":
        overrides.set("4:capabilities_v2", (value) => {
          const raw = scValToNative(value);
          raw.mutation_abi = 0;
          raw.mutation = false;
          return abi(raw);
        });
        break;
      case "manifest":
        overrides.set("4:graph_manifest_v2", () => {
          const manifest = structuredClone(fixture.plan.manifest);
          manifest.nodes[1]!.wasmHash = "aa".repeat(32);
          return conditionalManifestScVal(manifest);
        });
        break;
      case "initial":
        overrides.set("2:initial_config_v2", () => {
          const state = structuredClone(fixture.plan.manifest.nodes[2]!.state);
          state.revision = "1";
          return conditionalNodeStateScVal(state);
        });
        break;
      case "constant":
        rawCurrent(1, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].recipient = wallet(11);
        });
        break;
      case "constantAmount":
        rawCurrent(1, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].payout_rule = ["Fixed", 11n];
        });
        break;
      case "payoutKind":
        rawCurrent(1, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].payout_rule = ["Percentage", 1000];
        });
        break;
      case "comparison":
        rawCurrent(2, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].comparison = ["AmountLt"];
        });
        break;
      case "rootMinimum":
        rawCurrent(0, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].min_amount = 2n;
        });
        break;
      case "mutableAtZero":
        rawCurrent(2, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].threshold = 101n;
        });
        break;
      case "owner":
        rawCurrent(4, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].recipient = wallet(11);
        });
        break;
      case "asset":
        rawCurrent(4, (raw) => {
          raw.asset = address(90);
        });
        break;
      case "parent":
        rawCurrent(3, (raw) => {
          raw.parent = address(90);
        });
        break;
      case "revisionOverflow":
        rawCurrent(2, (raw) => {
          raw.revision = 1n << 64n;
        });
        break;
      case "obligationOverflow":
        obligations[3] = (1n << 127n).toString();
        break;
      case "version":
        rawCurrent(2, (raw) => {
          raw.version = 1;
        });
        break;
      case "rowOrder":
        setup(true);
        rawCurrent(3, (raw) => {
          const config = raw.configuration as [string, { policy: { rows: unknown[] } }];
          config[1].policy.rows.reverse();
        });
        break;
      default:
        rawCurrent(1, (raw) => {
          const config = raw.configuration as [string, Record<string, unknown>];
          config[1].recipient_mode = ["Mutable"];
        });
    }
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("retries the full graph once on an inactive-branch change then returns the new common ledger", async () => {
    let batch = 0;
    mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const response = witness(keys, 10 + batch);
      if (++batch >= 2) response.entries.at(-1)!.lastModifiedLedgerSeq = 9;
      return response;
    });
    const simulate = mocks.rpc.simulateTransaction.getMockImplementation()!;
    mocks.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
      ...(await simulate(tx)),
      latestLedger: batch <= 1 ? 10 : 12,
    }));
    const current = await readConditionalExecutionState(fixture.deployment);
    expect(current.supported).toBe(true);
    if (current.supported) expect(current.confirmedLedger).toBe(13);
    expect(mocks.rpc._getLedgerEntries).toHaveBeenCalledTimes(4);
    expect(mocks.rpc.simulateTransaction).toHaveBeenCalledTimes(40);
  });
  it.each(["bytes", "reverted"])(
    "refuses repeated inactive-branch %s writes even when revisions stay equal",
    async (kind) => {
      let batch = 0;
      mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
        const result = witness(keys);
        if (++batch % 2 === 0) {
          const entry = result.entries.at(-1)!;
          entry.lastModifiedLedgerSeq = 6;
          if (kind === "bytes") {
            const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64");
            data
              .contractData()
              .val()
              .instance()
              .storage([new xdr.ScMapEntry({ key: nativeToScVal("debt"), val: nativeToScVal(1) })]);
            entry.xdr = data.toXDR("base64");
          }
        }
        return result;
      });
      await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(mocks.rpc._getLedgerEntries).toHaveBeenCalledTimes(4);
    },
  );
  it("accepts shuffled responses by exact keys while ledger advances without writes", async () => {
    let batch = 0;
    mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const response = witness(keys, 10 + batch++);
      response.entries.reverse();
      return response;
    });
    const current = await readConditionalExecutionState(fixture.deployment);
    expect(current.supported && current.confirmedLedger).toBe(11);
  });
  it("refuses getter ledgers outside the complete observation window", async () => {
    const implementation = mocks.rpc.simulateTransaction.getMockImplementation()!;
    mocks.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => ({
      ...(await implementation(tx)),
      latestLedger: 11,
    }));
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("refuses restoration-needed simulations", async () => {
    mocks.rpc.simulateTransaction.mockResolvedValue({
      transactionData: {},
      latestLedger: 10,
      result: { retval: nativeToScVal(true) },
      restorePreamble: {},
    });
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("runs at most four getters concurrently and stops queued work after failure", async () => {
    const implementation = mocks.rpc.simulateTransaction.getMockImplementation()!;
    let active = 0,
      maximum = 0;
    mocks.rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      return implementation(tx);
    });
    await readConditionalExecutionState(fixture.deployment);
    expect(maximum).toBe(4);
    mocks.rpc.simulateTransaction.mockRejectedValue(new Error("unavailable"));
    mocks.rpc.simulateTransaction.mockClear();
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    expect(mocks.rpc.simulateTransaction.mock.calls.length).toBeLessThanOrEqual(8);
  });
  it("preserves finalRead error identity, settles the closing fence and does not retry admission-related failures", async () => {
    const error = new AppError("INSUFFICIENT_FUNDS", "payer absent");
    const finalRead = vi.fn().mockRejectedValue(error);
    await expect(
      readConditionalExecutionStateForReview(fixture.deployment, { finalRead }),
    ).rejects.toBe(error);
    expect(finalRead).toHaveBeenCalledTimes(1);
    expect(mocks.rpc._getLedgerEntries).toHaveBeenCalledTimes(2);
  });
  it("does not repeat a failed source-account lookup", async () => {
    mocks.account.mockRejectedValue(new Error("missing account"));
    await expect(readConditionalExecutionState(fixture.deployment)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    expect(mocks.account).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("refresh privately binds complete witness and does not trust caller edits", async () => {
    const observation = await readConditionalExecutionStateForReview(fixture.deployment);
    if (!observation.current.supported || !observation.refresh) throw new Error();
    observation.current.definition.condition.thresholdStroops = "999";
    observation.current.nodes.at(-1)!.expectedRevision = "7";
    const refreshed = await observation.refresh();
    expect(refreshed.definition.condition.thresholdStroops).toBe("100");
    expect(refreshed.nodes.at(-1)!.expectedRevision).toBe("0");
    expect(mocks.rpc.simulateTransaction).toHaveBeenCalledTimes(20);
    mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const response = witness(keys, 11);
      response.entries.at(-1)!.lastModifiedLedgerSeq = 9;
      return response;
    });
    await expect(observation.refresh()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses a failed review witness and expired shared deadlines without replacement reads", async () => {
    const observation = await readConditionalExecutionStateForReview(fixture.deployment);
    mocks.rpc._getLedgerEntries.mockRejectedValue(new Error("lost"));
    await expect(observation.refresh!()).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    mocks.rpc._getLedgerEntries.mockClear();
    await expect(
      withInteractiveRpcBudget(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return readConditionalExecutionState(fixture.deployment);
      }, 1),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mocks.rpc._getLedgerEntries).not.toHaveBeenCalled();
  });
  it("cannot carry a review witness out of its original request deadline", async () => {
    const observation = await withInteractiveRpcBudget(() =>
      readConditionalExecutionStateForReview(fixture.deployment),
    );
    const count = mocks.rpc._getLedgerEntries.mock.calls.length;
    await expect(observation.refresh!()).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mocks.rpc._getLedgerEntries).toHaveBeenCalledTimes(count);
  });
  it("checks CAP-46 against the server-selected network, never the wallet's original network", async () => {
    process.env.STELLAR_NETWORK = "mainnet";
    vi.resetModules();
    try {
      const { readConditionalExecutionState: mainnetReader } =
        await import("@/lib/stellar/conditional-execution-state");
      fixture.deployment.network = "mainnet";
      await expect(mainnetReader(fixture.deployment)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(mocks.rpc._getLedgerEntries).not.toHaveBeenCalled();
    } finally {
      delete process.env.STELLAR_NETWORK;
      vi.resetModules();
    }
  });
  it("overlaps the payer-account finalRead with the closing fence and waits for both", async () => {
    const implementation = mocks.rpc._getLedgerEntries.getMockImplementation()!;
    let release: (() => void) | undefined;
    let closingStarted = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    mocks.rpc._getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (++count === 2) {
        closingStarted = true;
        await gate;
      }
      return implementation(...keys);
    });
    const finalRead = vi.fn(async () => {
      expect(closingStarted).toBe(true);
      release!();
    });
    const result = await readConditionalExecutionStateForReview(fixture.deployment, { finalRead });
    expect(result.current.supported).toBe(true);
    expect(finalRead).toHaveBeenCalledTimes(1);
  });
});
