import { createHash } from "node:crypto";
import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  ConditionalConfigurationHistorySchema,
  ConditionalMutationPrepareSchema,
  ConditionalMutationPreparedSchema,
  ConditionalMutationStateSchema,
  ConditionalPreparationRefusalSchema,
} from "@/lib/mutations/conditional-schema";
import {
  MutationPrepareSchema,
  MutationPreparedSchema,
  MutationPreparationRefusalSchema,
} from "@/lib/mutations/schema";
import {
  conditionalAcceptancePlan,
  conditionalOwner,
  conditionalPayer,
} from "@/tests/fixtures/conditional-v2-acceptance";

const id = "12261226-1226-4226-8226-122612261226";
function prepare() {
  return {
    admin: conditionalOwner,
    arguments: {
      version: 2 as const,
      changes: [
        {
          kind: "condition" as const,
          nodeId: "condition",
          expectedRevision: "0",
          thresholdStroops: "101",
        },
      ],
    },
  };
}
function receipt() {
  const plan = conditionalAcceptancePlan();
  return {
    intent: id,
    txHash: "ab".repeat(32),
    walletAddress: conditionalOwner,
    xdr: "unsigned-fixture-only",
    expiresAt: "2030-01-01T00:00:00.000Z",
    network: "testnet" as const,
    networkPassphrase: Networks.TESTNET,
    feeStroops: "100",
    mutation: {
      version: 2 as const,
      deploymentId: id,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
      rootContract: plan.bindings[0]!.contractAddress,
      admin: conditionalOwner,
      definition: plan.definition,
      nodes: plan.bindings,
      arguments: {
        ...prepare().arguments,
        changes: [{ ...prepare().arguments.changes[0]!, nodeId: plan.definition.condition.nodeId }],
      },
    },
  };
}
function history() {
  const configuration = conditionalAcceptancePlan().nodes[0]!.initialState;
  return {
    version: 2 as const,
    deploymentId: id,
    network: "testnet" as const,
    coverage: "observed-revisions-only" as const,
    historyComplete: false as const,
    revisionCoverage: [
      {
        nodeId: configuration.nodeId,
        highestObservedRevision: "0",
        observedRevisionCount: "1",
        missingRevisionCount: "0",
      },
    ],
    items: [
      { id, configuration, observedLedger: 100, eventLedger: null, eventId: null, txHash: null },
    ],
    nextCursor: null,
  };
}

describe("conditional mutation public contracts", () => {
  it("requires explicit v2 arguments without widening v1", () => {
    expect(ConditionalMutationPrepareSchema.parse(prepare())).toEqual(prepare());
    expect(MutationPrepareSchema.safeParse(prepare()).success).toBe(false);
    for (const input of [
      { ...prepare(), arguments: { version: 1, changes: [] } },
      { ...prepare(), arguments: { version: 2, changes: [] } },
      { ...prepare(), branch: "true" },
    ])
      expect(ConditionalMutationPrepareSchema.safeParse(input).success).toBe(false);
  });
  it("retains required original fields and rejects admin/network substitutions", () => {
    const value = receipt();
    expect(ConditionalMutationPreparedSchema.parse(value)).toEqual(value);
    expect(MutationPreparedSchema.safeParse(value).success).toBe(false);
    for (const key of Object.keys(value)) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[key];
      expect(ConditionalMutationPreparedSchema.safeParse(missing).success).toBe(false);
    }
    for (const change of [
      { walletAddress: conditionalPayer },
      { network: "mainnet" },
      { networkPassphrase: Networks.PUBLIC },
      { feeStroops: "0" },
      { feeStroops: "01" },
    ])
      expect(ConditionalMutationPreparedSchema.safeParse({ ...value, ...change }).success).toBe(
        false,
      );
    expect(
      ConditionalMutationPreparedSchema.safeParse({
        ...value,
        network: "mainnet",
        networkPassphrase: Networks.PUBLIC,
        mutation: {
          ...value.mutation,
          networkPassphraseHash: createHash("sha256").update(Networks.PUBLIC).digest("hex"),
        },
      }).success,
    ).toBe(true);
  });
  it.each(["0", (2n ** 127n - 1n).toString()])(
    "accepts mutable threshold boundary %s",
    (thresholdStroops) => {
      const value = receipt();
      value.mutation.arguments.changes[0]!.thresholdStroops = thresholdStroops;
      expect(ConditionalMutationPreparedSchema.safeParse(value).success).toBe(true);
    },
  );
  it.each(["100", "01", "-1", (2n ** 127n).toString()])(
    "refuses no-op or invalid threshold %s",
    (thresholdStroops) => {
      const value = receipt();
      value.mutation.arguments.changes[0]!.thresholdStroops = thresholdStroops;
      expect(ConditionalMutationPreparedSchema.safeParse(value).success).toBe(false);
    },
  );
  it("requires all branch bindings and rejects constant threshold overrides", () => {
    const value = receipt();
    expect(
      ConditionalMutationPreparedSchema.safeParse({
        ...value,
        mutation: { ...value.mutation, nodes: value.mutation.nodes.slice(0, -1) },
      }).success,
    ).toBe(false);
    const changed = structuredClone(value);
    changed.mutation.definition.condition.thresholdMode = "constant";
    expect(ConditionalMutationPreparedSchema.safeParse(changed).success).toBe(false);
  });
  it("binds guarded current admin and preserves inactive obligations", () => {
    const plan = conditionalAcceptancePlan();
    const state = {
      version: 2,
      supported: true,
      policyVersion: 2,
      deploymentId: id,
      network: "testnet",
      confirmedLedger: 100,
      definition: plan.definition,
      nodes: plan.bindings,
      statuses: plan.nodes.map((node) => ({
        state: node.initialState,
        obligationsStroops: node.initialState.configuration.kind === "split" ? "7" : "0",
      })),
      admin: conditionalOwner,
      mutationSupported: true,
    };
    expect(ConditionalMutationStateSchema.safeParse(state).success).toBe(true);
    expect(
      ConditionalMutationStateSchema.safeParse({ ...state, admin: conditionalPayer }).success,
    ).toBe(false);
    expect(
      ConditionalMutationStateSchema.safeParse({ ...state, statuses: state.statuses.slice(0, -1) })
        .success,
    ).toBe(false);
  });
  it("keeps immutable baseline observations and explicit gaps without invented events", () => {
    const value = history();
    expect(ConditionalConfigurationHistorySchema.parse(value)).toEqual(value);
    expect(
      ConditionalConfigurationHistorySchema.safeParse({ ...value, historyComplete: true }).success,
    ).toBe(false);
    for (const change of [
      { observedRevisionCount: "2" },
      { missingRevisionCount: "1" },
      { highestObservedRevision: "01" },
    ])
      expect(
        ConditionalConfigurationHistorySchema.safeParse({
          ...value,
          revisionCoverage: [{ ...value.revisionCoverage[0], ...change }],
        }).success,
      ).toBe(false);
    expect(
      ConditionalConfigurationHistorySchema.safeParse({
        ...value,
        revisionCoverage: [...value.revisionCoverage, ...value.revisionCoverage],
      }).success,
    ).toBe(false);
    expect(
      ConditionalConfigurationHistorySchema.safeParse({ ...value, revisionCoverage: [] }).success,
    ).toBe(false);
    expect(
      ConditionalConfigurationHistorySchema.safeParse({
        ...value,
        items: [...value.items, ...value.items],
      }).success,
    ).toBe(false);
  });
  it("separates permanent v2 refusal evidence from v1", () => {
    const value = {
      version: 2,
      outcome: "NOT_ADMITTED",
      refusalId: id,
      deploymentId: id,
      network: "testnet",
      admin: conditionalOwner,
      idempotencyKeyHash: "aa".repeat(32),
      requestDigest: "bb".repeat(32),
      refusedAt: "2030-01-01T00:00:00.000Z",
      reasonCode: "CONFLICT",
    };
    expect(ConditionalPreparationRefusalSchema.safeParse(value).success).toBe(true);
    expect(MutationPreparationRefusalSchema.safeParse(value).success).toBe(false);
    expect(ConditionalPreparationRefusalSchema.safeParse({ ...value, version: 1 }).success).toBe(
      false,
    );
  });
});
