import { Networks } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConditionalExecutePrepareSchema,
  ConditionalExecutePreparedSchema,
  ConditionalExecutionDiscoverySchema,
  conditionalExecutionVersion,
} from "@/lib/api/v1/conditional-execution-schema";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { ExecutePrepareSchema } from "@/lib/api/v1/schema";
import {
  conditionalAcceptanceIntent,
  conditionalAcceptancePlan,
  conditionalPayer,
  conditionalWallet,
} from "@/tests/fixtures/conditional-v2-acceptance";

function discovery() {
  const plan = conditionalAcceptancePlan();
  return {
    version: 2,
    supported: true,
    policyVersion: 2,
    deploymentId: "12251225-1225-4225-8225-122512251225",
    network: "testnet",
    confirmedLedger: 100,
    definition: plan.definition,
    nodes: plan.bindings,
    statuses: plan.nodes.map((node) => ({ state: node.initialState, obligationsStroops: "0" })),
  };
}
function prepared() {
  const execution = conditionalAcceptanceIntent();
  return {
    intent: "12251225-1225-4225-8225-122512251225",
    txHash: "a1".repeat(32),
    walletAddress: execution.payer,
    xdr: "unsigned-envelope-fixture",
    expiresAt: "2030-01-01T00:00:00.000Z",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    execution,
  };
}

describe("explicit conditional API v2 protocol", () => {
  it.each([
    ["", 1],
    ["wait=false", 1],
    ["version=1", 1],
    ["version=2", 2],
    ["version=2&wait=false", 2],
  ] as const)("selects %s without changing old defaults", (query, expected) => {
    expect(conditionalExecutionVersion(new URLSearchParams(query))).toBe(expected);
  });
  it.each(["version=", "version=3", "version=02", "version=2&version=1", "version=2&version=2"])(
    "refuses ambiguous or unknown selector %s",
    (query) => expect(() => conditionalExecutionVersion(new URLSearchParams(query))).toThrow(),
  );
  it("requires explicit v2 arguments and canonical positive bounded amounts", () => {
    const input = { from: conditionalPayer, amount: "1", arguments: { version: 2, inputs: [] } };
    expect(ConditionalExecutePrepareSchema.parse(input)).toEqual(input);
    for (const amount of ["0", "01", "-1", "1.0", (2n ** 127n).toString()])
      expect(ConditionalExecutePrepareSchema.safeParse({ ...input, amount }).success).toBe(false);
    expect(
      ConditionalExecutePrepareSchema.safeParse({ from: input.from, amount: input.amount }).success,
    ).toBe(false);
    expect(
      ConditionalExecutePrepareSchema.safeParse({ ...input, arguments: { version: 1, inputs: [] } })
        .success,
    ).toBe(false);
    expect(ConditionalExecutePrepareSchema.safeParse({ ...input, branch: "true" }).success).toBe(
      false,
    );
    expect(ExecutePrepareSchema.safeParse(input).success).toBe(false);
    expect(ExecutePrepareSchema.safeParse({ from: input.from, amount: "01" }).success).toBe(true);
  });
  it("retains complete current graph linkage and separates the old discovery parser", () => {
    const value = discovery();
    expect(ConditionalExecutionDiscoverySchema.parse(value)).toEqual(value);
    expect(ExecutionDiscoverySchema.safeParse(value).success).toBe(false);
    const inactive = structuredClone(value);
    inactive.statuses.at(-1)!.state.parentContract = value.nodes[1]!.contractAddress;
    expect(ConditionalExecutionDiscoverySchema.safeParse(inactive).success).toBe(false);
    const changed = structuredClone(value);
    changed.nodes.at(-1)!.expectedRevision = "1";
    expect(ConditionalExecutionDiscoverySchema.safeParse(changed).success).toBe(false);
    expect(
      ConditionalExecutionDiscoverySchema.safeParse({ ...value, privateContact: "private" })
        .success,
    ).toBe(false);
  });
  it("requires an explicit unsupported v2 response rather than a success-shaped fallback", () => {
    const unsupported = {
      version: 2,
      supported: false,
      policyVersion: 0,
      deploymentId: discovery().deploymentId,
      network: "testnet",
      reason: "No explicit conditional generation",
    };
    expect(ConditionalExecutionDiscoverySchema.parse(unsupported)).toEqual(unsupported);
    expect(
      ConditionalExecutionDiscoverySchema.safeParse({ ...unsupported, version: 1 }).success,
    ).toBe(false);
    expect(
      ConditionalExecutionDiscoverySchema.safeParse({ ...unsupported, supported: true }).success,
    ).toBe(false);
  });
  it("retains the exact conditional receipt and refuses wallet/network/route substitutions", () => {
    const value = prepared();
    expect(ConditionalExecutePreparedSchema.parse(value)).toEqual(value);
    for (const key of Object.keys(value)) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[key];
      expect(ConditionalExecutePreparedSchema.safeParse(missing).success).toBe(false);
    }
    expect(
      ConditionalExecutePreparedSchema.safeParse({ ...value, walletAddress: conditionalWallet(9) })
        .success,
    ).toBe(false);
    expect(
      ConditionalExecutePreparedSchema.safeParse({ ...value, network: "mainnet" }).success,
    ).toBe(false);
    expect(
      ConditionalExecutePreparedSchema.safeParse({
        ...value,
        execution: { ...value.execution, networkPassphraseHash: "00".repeat(32) },
      }).success,
    ).toBe(false);
    expect(
      ConditionalExecutePreparedSchema.safeParse({
        ...value,
        network: "mainnet",
        networkPassphrase: Networks.PUBLIC,
        execution: {
          ...value.execution,
          networkPassphraseHash: createHash("sha256").update(Networks.PUBLIC).digest("hex"),
        },
      }).success,
    ).toBe(true);
    expect(
      ConditionalExecutePreparedSchema.safeParse({
        ...value,
        execution: { ...value.execution, selectedBranch: "false" },
      }).success,
    ).toBe(false);
    expect(
      ConditionalExecutePreparedSchema.safeParse({ ...value, privateContact: "private" }).success,
    ).toBe(false);
  });
});
