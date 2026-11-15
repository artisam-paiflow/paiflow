import { readFileSync } from "node:fs";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  conditionalMutationContextScVal,
  conditionalNodeStateScVal,
  decodeConditionalCapabilities,
  decodeConditionalConfigurationEvent,
  decodeConditionalGuardedCapabilities,
  mutationV2Args,
  mutationV2StepArgs,
} from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalAcceptancePlan,
  conditionalOwner,
  conditionalPayer,
  conditionalWallet,
} from "@/tests/fixtures/conditional-v2-acceptance";
import {
  conditionalMutationAcceptancePacket,
  conditionalMutationFixtures,
  conditionalMutationIntent,
  conditionalMutationResult,
  mutationUpdatedRecipient,
} from "@/tests/fixtures/conditional-v2-mutation-acceptance";

const native = (value: xdr.ScVal): unknown => scValToNative(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected map");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected vector");
  return value;
}

describe("conditional v2 mutation production codecs", () => {
  it.each(conditionalMutationFixtures)("reproduces committed native packet %s", (fixture) => {
    const stored = readFileSync(
      new URL(
        `../../fixtures/conditional-v2-mutation-acceptance/${fixture}.xdr-hex`,
        import.meta.url,
      ),
      "utf8",
    ).trim();
    expect(conditionalMutationAcceptancePacket(fixture)).toBe(stored);
  });

  it("encodes exactly two root args with every prefix/branch pin and canonical changes", () => {
    const intent = conditionalMutationIntent();
    const args = mutationV2Args(intent).map(native);
    expect(args).toHaveLength(2);
    expect(array(args[0])).toEqual(
      intent.nodes.map((node) => ({
        node_id: node.nodeId,
        contract_address: node.contractAddress,
        expected_revision: BigInt(node.expectedRevision),
        wasm_hash: Buffer.from(node.wasmHash, "hex"),
      })),
    );
    expect(array(args[0])).toHaveLength(5);
    const changes = array(args[1]);
    expect(changes.map((change) => record(array(change)[1]).node_id)).toEqual([
      "fee",
      "condition",
      "yes",
      "no",
    ]);
    expect(changes[0]).toEqual([
      "Pay",
      {
        node_id: "fee",
        expected_revision: 0n,
        recipient: null,
        payout_value: ["Present", ["Fixed", 11n]],
      },
    ]);
    expect(changes[1]).toEqual([
      "Condition",
      { node_id: "condition", expected_revision: 0n, threshold: 200n },
    ]);
    const yes = record(array(changes[2])[1]);
    const no = record(array(changes[3])[1]);
    expect(yes.additional).toEqual([]);
    expect(no.additional).toBeNull();
    expect(record(array(no.rows)[0])).toEqual({
      row_id: "first",
      recipient: mutationUpdatedRecipient,
      allocation: ["Present", ["Fixed", 20n]],
    });
  });

  it("binds root/admin/full graph and group in one child context without routing controls", () => {
    const intent = conditionalMutationIntent();
    const args = mutationV2Args(intent).map(native);
    const context = record(native(conditionalMutationContextScVal(intent)));
    expect(context).toEqual({
      root: intent.rootContract,
      admin: conditionalOwner,
      bindings: args[0],
      changes: args[1],
    });
    expect(mutationV2StepArgs(intent).map(native)).toEqual([context]);
    expect(Object.keys(context)).toEqual(["admin", "bindings", "changes", "root"]);
  });

  it("preserves reversed row patch request order without reordering stored configured rows", () => {
    const intent = conditionalMutationIntent("grouped-amount_lt");
    const changes = array(mutationV2Args(intent).map(native)[1]);
    expect(changes.map((change) => record(array(change)[1]).node_id)).toEqual([
      "fee",
      "condition",
      "yes",
      "no",
    ]);
    for (const change of changes.slice(2))
      expect(array(record(array(change)[1]).rows).map((row) => record(row).row_id)).toEqual([
        "second",
        "first",
      ]);
    const result = conditionalMutationResult(intent);
    for (const branch of [result.definition.trueBranch, result.definition.falseBranch]) {
      if (branch.kind !== "split") throw new Error("Split fixture");
      expect(branch.configuration.configuredRows.map((row) => row.rowId)).toEqual([
        "first",
        "second",
      ]);
      expect(branch.configuration.configuredRows.map((row) => row.allocation)).toEqual(
        branch.nodeId === "yes"
          ? [
              { kind: "fixed", amountStroops: "30" },
              { kind: "fixed", amountStroops: "70" },
            ]
          : [
              { kind: "fixed", amountStroops: "20" },
              { kind: "fixed", amountStroops: "80" },
            ],
      );
    }
    for (const branch of [intent.definition.trueBranch, intent.definition.falseBranch]) {
      if (branch.kind !== "split") throw new Error("Split fixture");
      expect(branch.configuration.configuredRows.map((row) => row.rowId)).toEqual([
        "first",
        "second",
      ]);
    }
  });

  it("retains absent Pay allocation as Missing and Option recipient as a bare address", () => {
    const intent = conditionalMutationIntent();
    intent.arguments.changes = [
      { kind: "pay", nodeId: "fee", expectedRevision: "0", recipient: conditionalWallet(11) },
    ];
    expect(array(mutationV2Args(intent).map(native)[1])[0]).toEqual([
      "Pay",
      {
        node_id: "fee",
        expected_revision: 0n,
        recipient: conditionalWallet(11),
        payout_value: ["Missing"],
      },
    ]);
  });

  it.each(["0", (2n ** 127n - 1n).toString()])(
    "encodes strict threshold boundary %s without narrowing",
    (thresholdStroops) => {
      const intent = conditionalMutationIntent();
      intent.arguments.changes = [
        { kind: "condition", nodeId: "condition", expectedRevision: "0", thresholdStroops },
      ];
      const change = array(array(mutationV2Args(intent).map(native)[1])[0]);
      expect(record(change[1]).threshold).toBe(BigInt(thresholdStroops));
    },
  );

  it("uses a u64 revision exactly through its final permitted increment", () => {
    const intent = conditionalMutationIntent();
    const revision = (2n ** 64n - 2n).toString();
    intent.nodes[2]!.expectedRevision = revision;
    intent.arguments.changes = [
      { kind: "condition", nodeId: "condition", expectedRevision: revision, thresholdStroops: "0" },
    ];
    expect(
      record(array(array(mutationV2Args(intent).map(native)[1])[0])[1]).expected_revision,
    ).toBe(2n ** 64n - 2n);
    expect(conditionalMutationResult(intent).nodes[2]!.expectedRevision).toBe(
      (2n ** 64n - 1n).toString(),
    );
  });

  it.each([
    "empty",
    "duplicate",
    "unordered",
    "noop",
    "constant-threshold",
    "negative-threshold",
    "threshold-overflow",
    "wrong-kind",
    "unknown-node",
    "stale-revision",
    "revision-exhausted",
    "wrong-admin",
    "wrong-root",
    "inactive-pin-missing",
    "constant-row",
    "execution-override",
    "allocation-kind",
    "extra-key",
    "version",
  ])("rejects %s before serializing root or child args", (attack) => {
    const intent = conditionalMutationIntent();
    if (attack === "empty") intent.arguments.changes = [];
    if (attack === "duplicate") intent.arguments.changes.push(intent.arguments.changes[0]!);
    if (attack === "unordered") intent.arguments.changes.reverse();
    if (attack === "noop")
      intent.arguments.changes = [
        { kind: "condition", nodeId: "condition", expectedRevision: "0", thresholdStroops: "50" },
      ];
    if (attack === "constant-threshold") intent.definition.condition.thresholdMode = "constant";
    if (attack === "negative-threshold")
      Object.assign(intent.arguments.changes[1]!, { thresholdStroops: "-1" });
    if (attack === "threshold-overflow")
      Object.assign(intent.arguments.changes[1]!, { thresholdStroops: (2n ** 127n).toString() });
    if (attack === "wrong-kind") Object.assign(intent.arguments.changes[1]!, { nodeId: "fee" });
    if (attack === "unknown-node") intent.arguments.changes[0]!.nodeId = "missing";
    if (attack === "stale-revision") intent.arguments.changes[0]!.expectedRevision = "1";
    if (attack === "revision-exhausted") {
      intent.nodes[2]!.expectedRevision = (2n ** 64n - 1n).toString();
      intent.arguments.changes[1]!.expectedRevision = (2n ** 64n - 1n).toString();
    }
    if (attack === "wrong-admin") intent.admin = conditionalPayer;
    if (attack === "wrong-root") intent.rootContract = intent.nodes[1]!.contractAddress;
    if (attack === "inactive-pin-missing") intent.nodes.pop();
    if (attack === "constant-row") {
      const change = intent.arguments.changes[3]!;
      if (change.kind !== "split") throw new Error("Split fixture");
      change.rows[1]!.recipient = conditionalWallet(11);
    }
    if (attack === "execution-override") {
      intent.definition.prefix[0]!.policy.recipient = "execution";
      delete intent.definition.prefix[0]!.configuration.recipient;
      Object.assign(intent.arguments.changes[0]!, { recipient: conditionalWallet(11) });
    }
    if (attack === "allocation-kind")
      Object.assign(intent.arguments.changes[0]!, {
        payoutValue: { kind: "percentage", bps: 500 },
      });
    if (attack === "extra-key") Object.assign(intent.arguments, { branch: "true" });
    if (attack === "version") Object.assign(intent, { version: 1 });
    expect(() => mutationV2Args(intent)).toThrow();
    expect(() => mutationV2StepArgs(intent)).toThrow();
  });

  it("rejects changing an owner-return destination through a Pay patch", () => {
    const intent = conditionalMutationIntent();
    intent.definition.falseBranch = { kind: "return_to_owner", nodeId: "no" };
    intent.arguments.changes = [
      { kind: "pay", nodeId: "no", expectedRevision: "0", recipient: conditionalPayer },
    ];
    expect(() => mutationV2Args(intent)).toThrow();
  });

  it("decodes resulting full-state config_v2 payloads without rewriting initial state", () => {
    const intent = conditionalMutationIntent();
    const initial = conditionalAcceptancePlan(intent.definition);
    const result = conditionalMutationResult(intent);
    const updated = conditionalAcceptancePlan(result.definition);
    for (const node of updated.nodes.slice(1)) {
      const state = { ...node.initialState, revision: "1" };
      const wire = conditionalNodeStateScVal(state);
      expect(decodeConditionalConfigurationEvent(wire)).toEqual(state);
      expect(decodeConditionalConfigurationEvent(native(wire))).toEqual(state);
    }
    expect(initial.nodes[2]!.initialState.revision).toBe("0");
    expect(initial.nodes[2]!.initialState.configuration).toMatchObject({ thresholdStroops: "50" });
  });

  it.each(["initial", "root", "constant", "extra", "wrong-owner", "revision-overflow"])(
    "rejects %s configuration-event claims",
    (attack) => {
      const plan = conditionalAcceptancePlan(conditionalMutationIntent().definition);
      const state = structuredClone(plan.nodes[attack === "root" ? 0 : 2]!.initialState);
      state.revision = attack === "initial" ? "0" : "1";
      if (attack === "constant" && state.configuration.kind === "condition")
        state.configuration.thresholdMode = "constant";
      if (attack === "wrong-owner")
        state.configuration = { kind: "return_to_owner", recipient: conditionalPayer };
      if (attack === "revision-overflow") state.revision = (2n ** 64n).toString();
      if (attack === "extra") {
        const raw = record(native(conditionalNodeStateScVal(state)));
        raw.contact = "private metadata";
        expect(() => decodeConditionalConfigurationEvent(raw)).toThrow();
      } else
        expect(() =>
          decodeConditionalConfigurationEvent(conditionalNodeStateScVal(state)),
        ).toThrow();
    },
  );

  it("separates exact local guarded and execution-only tuples without granting runtime trust", () => {
    const partial = {
      policy_version: 2,
      execution_abi: 2,
      mutation_abi: 0,
      conditional: true,
      execution: true,
      mutation: false,
      immutable_policies: true,
      revision_binding: true,
    };
    const guarded = { ...partial, mutation_abi: 2, mutation: true };
    expect(decodeConditionalCapabilities(partial)).toEqual(partial);
    expect(() => decodeConditionalCapabilities(guarded)).toThrow();
    expect(decodeConditionalGuardedCapabilities(guarded)).toEqual(guarded);
    const wire = xdr.ScVal.scvMap(
      Object.entries(guarded).map(
        ([key, value]) =>
          new xdr.ScMapEntry({
            key: nativeToScVal(key, { type: "symbol" }),
            val:
              typeof value === "number"
                ? nativeToScVal(value, { type: "u32" })
                : nativeToScVal(value),
          }),
      ),
    );
    expect(decodeConditionalGuardedCapabilities(wire)).toEqual(guarded);
    for (const unsupported of [
      partial,
      { ...guarded, mutation_abi: 1 },
      { ...guarded, mutation: false },
      { ...guarded, revision_binding: false },
      { ...guarded, advertised: true },
    ])
      expect(() => decodeConditionalGuardedCapabilities(unsupported)).toThrow();
  });
});
