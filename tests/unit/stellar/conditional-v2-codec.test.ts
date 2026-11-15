import { readFileSync } from "node:fs";
import { Address, Networks, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import {
  conditionalConstructorArgs,
  conditionalContractAddress,
  conditionalExecutionContextScVal,
  conditionalManifestScVal,
  conditionalNodeStateScVal,
  decodeConditionalCapabilities,
  decodeConditionalManifest,
  decodeConditionalMutationStatus,
  decodeConditionalNodeState,
  executionV2Args,
  executionV2StepArgs,
} from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptanceIntent,
  conditionalAcceptancePacket,
  conditionalAcceptancePlan,
  conditionalAcceptanceScenarios,
  conditionalOwner,
  conditionalPayer,
  conditionalSyntheticPins,
  conditionalWallet,
} from "@/tests/fixtures/conditional-v2-acceptance";

const native = (value: xdr.ScVal) => scValToNative(value);
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected record fixture");
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Expected array fixture");
  return value;
};

describe("conditional-v2 production ScVal codecs", () => {
  it.each(conditionalAcceptanceScenarios)(
    "keeps committed native production packet reproducible for $name",
    (scenario) => {
      const stored = readFileSync(
        new URL(
          `../../fixtures/conditional-v2-acceptance/${scenario.name}.xdr-hex`,
          import.meta.url,
        ),
        "utf8",
      ).trim();
      expect(stored).toBe(conditionalAcceptancePacket(scenario));
    },
  );
  it("keeps family constructor arities and derives every redundant arg from one manifest", () => {
    const plan = conditionalAcceptancePlan();
    const constructors = plan.nodes.map((node) => conditionalConstructorArgs(node, plan.manifest));
    expect(constructors.map((args) => args.length)).toEqual([3, 7, 6, 6, 7]);
    constructors.forEach((args, index) => {
      expect(Address.fromScVal(args[0]!).toString()).toBe(conditionalOwner);
      expect(Address.fromScVal(args[1]!).toString()).toBe(plan.definition.assetContract);
      const init = record(native(args[2]!));
      expect(init.version).toBe(2);
      expect(init.node_id).toBe(plan.nodes[index]!.nodeId);
      expect(decodeConditionalManifest(init.manifest)).toEqual(plan.manifest);
    });
    expect(native(constructors[1]![3]!)).toBe(10n);
    expect(native(constructors[1]![4]!)).toBe(0);
    expect(native(constructors[2]![3]!)).toEqual([
      { address: plan.bindings[3]!.contractAddress, data: "" },
    ]);
    expect(native(constructors[2]![4]!)).toEqual([
      { address: plan.bindings[4]!.contractAddress, data: "" },
    ]);
    expect(native(constructors[4]![3]!)).toBe(0n);
    expect(native(constructors[4]![4]!)).toBe(10000);
    expect(native(constructors[4]![5]!)).toEqual([]);
  });
  it.each(conditionalAcceptanceScenarios)(
    "round-trips full semantic manifest for $name",
    (scenario) => {
      const plan = conditionalAcceptancePlan(scenario.definition);
      const encoded = conditionalManifestScVal(plan.manifest);
      expect(decodeConditionalManifest(encoded)).toEqual(plan.manifest);
      for (const node of plan.nodes)
        expect(decodeConditionalNodeState(conditionalNodeStateScVal(node.initialState))).toEqual(
          node.initialState,
        );
    },
  );
  it("uses stable symbol-key maps and retains v1 inner policy plus tagged optional allocations", () => {
    const plan = conditionalAcceptancePlan();
    const state = conditionalNodeStateScVal(plan.nodes[3]!.initialState);
    expect(state.map()!.map((entry) => entry.key().sym().toString())).toEqual([
      "admin",
      "asset",
      "configuration",
      "contract_address",
      "next_steps",
      "node_id",
      "parent",
      "revision",
      "version",
    ]);
    const config = array(record(native(state)).configuration);
    expect(config[0]).toBe("Split");
    const split = record(config[1]);
    const policy = record(split.policy);
    expect(policy.version).toBe(1);
    expect(policy.allocation_mode).toEqual(["Percentage"]);
    const row = record(array(policy.rows)[0]);
    expect(row.allocation).toEqual(["Present", ["Percentage", 1000]]);
    expect(split.additional).toEqual([]);
    expect(
      record(native(conditionalNodeStateScVal(plan.nodes[0]!.initialState))).parent,
    ).toBeNull();
  });
  it("validates exact family, complete initial state and bound pins before constructor encoding", () => {
    const plan = conditionalAcceptancePlan();
    const wrongFamily = { ...plan.nodes[2]!, templateKind: "PAYER" as const };
    expect(() => conditionalConstructorArgs(wrongFamily, plan.manifest)).toThrow();
    const changed = structuredClone(plan.nodes[4]!);
    changed.initialState.parentContract = plan.bindings[3]!.contractAddress;
    expect(() => conditionalConstructorArgs(changed, plan.manifest)).toThrow();
    const missing = structuredClone(plan.manifest);
    missing.nodes.pop();
    expect(() => conditionalConstructorArgs(plan.nodes[0]!, missing)).toThrow();
  });
  it("encodes all eight payer-authenticated args including inactive pins and computed route", () => {
    const intent = conditionalAcceptanceIntent();
    const args = executionV2Args(intent).map(native);
    expect(args).toHaveLength(8);
    expect(args.slice(0, 3)).toEqual([conditionalPayer, intent.assetContract, 111n]);
    expect(args[3]).toEqual(Buffer.from(intent.nonce, "hex"));
    expect(args[4]).toBe(100);
    expect(array(args[5])).toHaveLength(5);
    expect(record(array(args[5])[4])).toEqual({
      node_id: "no",
      contract_address: intent.nodes[4]!.contractAddress,
      expected_revision: 0n,
      wasm_hash: Buffer.from(conditionalSyntheticPins.PAYER, "hex"),
    });
    expect(args[7]).toEqual({ amount_at_condition: 101n, selected_branch: ["True"] });
    expect(() => executionV1Args(intent as never)).toThrow();
  });
  it("preserves i128-max funding/threshold and u64-max revisions without numeric narrowing", () => {
    const maximum = (2n ** 127n - 1n).toString();
    const graph = conditionalAcceptanceDefinition();
    graph.prefix = [];
    graph.condition.thresholdStroops = maximum;
    const intent = conditionalAcceptanceIntent(graph, maximum);
    intent.nodes[1]!.expectedRevision = (2n ** 64n - 1n).toString();
    const args = executionV2Args(intent).map(native);
    expect(args[2]).toBe(BigInt(maximum));
    expect(args[7]).toEqual({ amount_at_condition: BigInt(maximum), selected_branch: ["False"] });
    expect(record(array(args[5])[1]).expected_revision).toBe(2n ** 64n - 1n);
    const plan = conditionalAcceptancePlan(graph);
    const configuration = array(
      record(native(conditionalNodeStateScVal(plan.nodes[1]!.initialState))).configuration,
    );
    expect(record(configuration[1]).threshold).toBe(BigInt(maximum));
  });
  it("preserves context identity and forbids caller-controlled indices or enlarged hop budgets", () => {
    const intent = conditionalAcceptanceIntent();
    const context = record(native(conditionalExecutionContextScVal(intent)));
    expect(context).toMatchObject({
      root: intent.rootContract,
      payer: intent.payer,
      funded_amount: 111n,
      asset: intent.assetContract,
      route: { amount_at_condition: 101n, selected_branch: ["True"] },
    });
    expect(context).not.toHaveProperty("index");
    expect(executionV2StepArgs(intent, "101").map(native)).toEqual([context, 101n]);
    expect(() => executionV2StepArgs(intent, "112")).toThrow();
    expect(() => executionV2StepArgs(intent, "0")).toThrow();
  });
  it.each(["branch", "amount", "inactive", "missing", "extra", "version"])(
    "refuses %s packet substitution before encoding",
    (attack) => {
      const intent = conditionalAcceptanceIntent();
      if (attack === "branch") intent.selectedBranch = "false";
      if (attack === "amount") intent.amountAtConditionStroops = "102";
      if (attack === "inactive") intent.arguments.inputs[0]!.nodeId = "no";
      if (attack === "missing") intent.arguments.inputs = [];
      if (attack === "extra") Object.assign(intent, { routeIndex: 4 });
      if (attack === "version") Object.assign(intent, { version: 1 });
      expect(() => executionV2Args(intent)).toThrow();
    },
  );
  it("uses Void for absent execution slots and a direct empty Vec for present empty roster", () => {
    const graph = conditionalAcceptanceDefinition("amount_gt", "pay");
    const plan = conditionalAcceptancePlan(graph);
    const config = array(
      record(native(conditionalNodeStateScVal(plan.nodes[3]!.initialState))).configuration,
    );
    expect(record(config[1]).recipient).toBeNull();
    const splitGraph = conditionalAcceptanceDefinition();
    if (splitGraph.trueBranch.kind !== "split") throw new Error("split fixture");
    splitGraph.trueBranch.configuration.configuredRows[0]!.allocation = {
      kind: "percentage",
      bps: 10000,
    };
    const intent = conditionalAcceptanceIntent();
    intent.definition = splitGraph;
    const input = intent.arguments.inputs[0];
    if (input?.kind !== "split") throw new Error("split fixture");
    input.additionalRecipients = [];
    const rawInput = record(array(array(executionV2Args(intent).map(native)[6])[0])[1]);
    expect(rawInput.additional).toEqual([]);
  });
  it.each([
    "unknown-state",
    "version",
    "bad-option",
    "bad-amount",
    "execution-payout-mode",
    "bad-enum",
  ])("rejects malformed getter %s", (attack) => {
    const plan = conditionalAcceptancePlan(conditionalAcceptanceDefinition("amount_gt", "pay"));
    const raw = record(native(conditionalNodeStateScVal(plan.nodes[3]!.initialState)));
    if (attack === "unknown-state") raw.extra = true;
    if (attack === "version") raw.version = 1;
    const config = record(array(raw.configuration)[1]);
    if (attack === "bad-option") config.recipient = ["Some", conditionalWallet(4)];
    if (attack === "bad-amount") config.payout_rule = ["Fixed", 1.5];
    if (attack === "execution-payout-mode") config.payout_value_mode = ["Execution"];
    if (attack === "bad-enum") raw.configuration = ["OwnerReturn", { recipient: conditionalOwner }];
    expect(() => decodeConditionalNodeState(raw)).toThrow();
  });
  it("decodes obligations as accounted strings, retaining debt with no raw-balance field", () => {
    const plan = conditionalAcceptancePlan();
    const state = record(native(conditionalNodeStateScVal(plan.nodes[3]!.initialState)));
    expect(decodeConditionalMutationStatus({ state, obligations: 100n }).obligationsStroops).toBe(
      "100",
    );
    expect(() => decodeConditionalMutationStatus({ state, obligations: -1n })).toThrow();
    expect(() => decodeConditionalMutationStatus({ state, obligations: 2n ** 127n })).toThrow();
    expect(() =>
      decodeConditionalMutationStatus({ state, obligations: 0n, balance: 0n }),
    ).toThrow();
  });
  it("keeps partial local capability metadata separate from v1 or production-enabled claims", () => {
    const capabilities = {
      policy_version: 2,
      execution_abi: 2,
      mutation_abi: 0,
      conditional: true,
      execution: true,
      mutation: false,
      immutable_policies: true,
      revision_binding: true,
    };
    expect(decodeConditionalCapabilities(capabilities)).toEqual(capabilities);
    for (const patch of [
      { mutation: true },
      { mutation_abi: 2 },
      { policy_version: 1 },
      { supported: true },
    ])
      expect(() => decodeConditionalCapabilities({ ...capabilities, ...patch })).toThrow();
  });
  it("derives deterministic CAP-46 addresses from explicit owner/salt/server network", () => {
    const salt = Buffer.alloc(32, 101);
    const first = conditionalContractAddress(conditionalOwner, salt, Networks.TESTNET);
    expect(first).toBe(conditionalContractAddress(conditionalOwner, salt, Networks.TESTNET));
    expect(first).not.toBe(conditionalContractAddress(conditionalOwner, salt, Networks.PUBLIC));
    expect(first).not.toBe(conditionalContractAddress(conditionalPayer, salt, Networks.TESTNET));
    expect(() =>
      conditionalContractAddress(conditionalOwner, Buffer.alloc(31), Networks.TESTNET),
    ).toThrow();
    expect(() => conditionalContractAddress(first, salt, Networks.TESTNET)).toThrow();
    expect(() => conditionalContractAddress(conditionalOwner, salt, "")).toThrow();
  });
  it("generates complete unsigned production packets with owner/payer distinction and funding effects", () => {
    const scenario = conditionalAcceptanceScenarios.find(
      (scenario) => scenario.name === "amount_gt-split-return_to_owner",
    )!;
    const packet = array(native(xdr.ScVal.fromXDR(conditionalAcceptancePacket(scenario), "hex")));
    expect(packet[0]).toBe(conditionalOwner);
    expect(array(packet[2])).toHaveLength(5);
    const equal = array(array(packet[3])[1]);
    expect(equal[0]).toBe("funded-110");
    expect(equal[4]).toBe(100n);
    expect(equal[5]).toBe("false");
    expect(array(equal[3])).toContainEqual([conditionalOwner, 100n]);
    expect(packet[4]).toBe("synthetic-native-test-pins");
  });
});
