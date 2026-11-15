import { createHash } from "node:crypto";
import { Account, Networks } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConditionalExecutionDiscoverySchema,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptanceIntent,
  conditionalAcceptancePlan,
} from "@/tests/fixtures/conditional-v2-acceptance";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  observation: vi.fn(),
  account: vi.fn(),
  prepare: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  control: vi.fn(),
}));
vi.mock("@/lib/stellar/conditional-execution-state", () => ({
  readConditionalExecutionState: mocks.read,
  readConditionalExecutionStateForReview: mocks.observation,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({}) }));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mocks.account }));
vi.mock("@/lib/stellar/prepare-conditional-execution", () => ({
  prepareConditionalExecutionTransaction: mocks.prepare,
}));
vi.mock("@/lib/api/v1/conditional-execution-intent", () => ({
  createConditionalExecutionIntent: mocks.save,
  findConditionalExecutionRetry: mocks.retry,
  readConditionalExecutionForSubmission: vi.fn(),
}));
vi.mock("@/lib/api/v1/control-intent", () => ({
  readControlIntent: mocks.control,
  recordControlFinality: vi.fn(),
}));
import {
  assertConditionalExecutionEligible,
  prepareConditionalExecutionPayment,
} from "@/lib/api/v1/conditional-execution-payments";

const definition = conditionalAcceptanceDefinition();
const plan = conditionalAcceptancePlan(definition);
const original = conditionalAcceptanceIntent();
const deployment = {
  id: original.deploymentId,
  network: "testnet",
  status: "CONFIRMED",
} as Deployment;
let current: SupportedConditionalExecutionState;
const input = () => ({ from: original.payer, amount: "111", arguments: original.arguments });
beforeEach(() => {
  vi.clearAllMocks();
  current = ConditionalExecutionDiscoverySchema.parse({
    version: 2,
    supported: true,
    policyVersion: 2,
    deploymentId: deployment.id,
    network: "testnet",
    confirmedLedger: 10,
    definition,
    nodes: plan.bindings,
    statuses: plan.nodes.map((node) => ({ state: node.initialState, obligationsStroops: "0" })),
  }) as SupportedConditionalExecutionState;
  mocks.read.mockResolvedValue(current);
  mocks.account.mockResolvedValue(new Account(original.payer, "10"));
  mocks.prepare.mockResolvedValue({ xdr: "unsigned-fixture" });
  mocks.retry.mockResolvedValue(null);
  mocks.save.mockImplementation(async (input) => input);
});

describe("conditional payment admission preparation", () => {
  it("persists server-computed route, complete inactive/prefix evidence and exact declared inputs", async () => {
    await prepareConditionalExecutionPayment(deployment, input(), "key");
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.execution).toMatchObject({
      version: 2,
      payer: original.payer,
      amountStroops: "111",
      selectedBranch: "true",
      amountAtConditionStroops: "101",
      definition,
      nodes: plan.bindings,
      arguments: original.arguments,
      expiresAtLedger: 730,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    });
    expect(saved.execution.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.artifacts).toEqual(
      plan.bindings.map(({ nodeId, contractAddress, wasmHash }) => ({
        nodeId,
        contractAddress,
        wasmHash,
      })),
    );
    expect(mocks.prepare).toHaveBeenCalledWith(saved.execution, undefined);
  });
  it("computes equality and upstream deductions before choosing the allowed branch inputs", async () => {
    await prepareConditionalExecutionPayment(
      deployment,
      { from: original.payer, amount: "110", arguments: { version: 2, inputs: [] } },
      null,
    );
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.execution).toMatchObject({
      selectedBranch: "false",
      amountAtConditionStroops: "100",
    });
    expect(saved.execution.definition.falseBranch.kind).toBe("return_to_owner");
    expect(saved.execution.definition.owner).not.toBe(saved.execution.payer);
  });
  it.each([
    "inactive-input",
    "missing-input",
    "constant-override",
    "underfunded-prefix",
    "below-root",
    "wrong-version",
  ])("refuses %s before simulation or reservation", async (attack) => {
    const body = structuredClone(input());
    if (attack === "inactive-input") body.arguments.inputs[0]!.nodeId = "no";
    if (attack === "missing-input") body.arguments.inputs = [];
    if (attack === "constant-override")
      body.arguments.inputs.push({ kind: "pay", nodeId: "fee", recipient: original.payer });
    if (attack === "underfunded-prefix") body.amount = "10";
    if (attack === "below-root") body.amount = "0";
    if (attack === "wrong-version") Object.assign(body.arguments, { version: 1 });
    await expect(prepareConditionalExecutionPayment(deployment, body, null)).rejects.toThrow();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns the original keyed preparation before unavailable current state or new account reads", async () => {
    mocks.retry.mockResolvedValue({ intent: "original", txHash: "original-hash" });
    mocks.read.mockRejectedValue(new Error("current state gone"));
    expect(await prepareConditionalExecutionPayment(deployment, input(), "key")).toEqual({
      intent: "original",
      txHash: "original-hash",
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("fails unsupported generation rather than falling through to legacy deposit", async () => {
    mocks.read.mockResolvedValue({ version: 2, supported: false, policyVersion: 0 });
    await expect(
      prepareConditionalExecutionPayment(deployment, input(), null),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("overlaps payer account lookup with the closing instance fence", async () => {
    mocks.read.mockImplementation(async (_deployment, options) => {
      await options.finalRead();
      return current;
    });
    await prepareConditionalExecutionPayment(deployment, input(), null);
    expect(mocks.account).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0]![1].accountId()).toBe(original.payer);
  });
  it("retains the admitted original after a post-admission review failure", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("closing fence unavailable"));
    mocks.observation.mockResolvedValue({ current, refresh });
    const review = vi.fn();
    await expect(
      prepareConditionalExecutionPayment(
        deployment,
        input(),
        "key",
        undefined,
        "ab".repeat(32),
        review,
      ),
    ).rejects.toThrow("closing fence unavailable");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    mocks.retry.mockResolvedValue({ intent: "original", txHash: "original-hash" });
    await prepareConditionalExecutionPayment(
      deployment,
      input(),
      "key",
      undefined,
      "ab".repeat(32),
      review,
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("conditional first-send eligibility", () => {
  async function reviewed() {
    await prepareConditionalExecutionPayment(deployment, input(), null);
    const saved = mocks.save.mock.calls[0]![0];
    mocks.control.mockResolvedValue({
      id: "original",
      txHash: "original-hash",
      executionIntent: saved.execution,
      executionArtifacts: saved.artifacts,
    });
  }
  it("accepts a later confirmed ledger when every original term, pin and revision is unchanged", async () => {
    await reviewed();
    current.confirmedLedger = 12;
    await expect(
      assertConditionalExecutionEligible(deployment, "original"),
    ).resolves.toBeUndefined();
  });
  it.each([
    "prefix",
    "threshold",
    "inactive-revision",
    "inactive-artifact",
    "owner",
    "route-terms",
  ])("refuses stale %s with original intent/hash recovery fields", async (attack) => {
    await reviewed();
    if (attack === "prefix") current.nodes[1]!.expectedRevision = "1";
    if (attack === "threshold") current.nodes[2]!.expectedRevision = "1";
    if (attack === "inactive-revision") current.nodes[4]!.expectedRevision = "1";
    if (attack === "inactive-artifact") current.nodes[4]!.wasmHash = "bb".repeat(32);
    if (attack === "owner") current.definition.owner = original.payer;
    if (attack === "route-terms") current.definition.condition.thresholdStroops = "101";
    await expect(assertConditionalExecutionEligible(deployment, "original")).rejects.toMatchObject({
      code: "CONFLICT",
      fields: { intent: ["original"], txHash: ["original-hash"] },
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
