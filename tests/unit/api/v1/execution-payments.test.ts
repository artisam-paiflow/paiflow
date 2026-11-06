import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
const mock = vi.hoisted(() => ({
  state: vi.fn(),
  observation: vi.fn(),
  account: vi.fn(),
  prepare: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  control: vi.fn(),
}));
vi.mock("@/lib/stellar/execution-state", () => ({
  readExecutionState: mock.state,
  readExecutionStateForReview: mock.observation,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({}) }));
vi.mock("@/lib/stellar/load-payment-account", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/load-payment-account")>()),
  loadPaymentAccount: mock.account,
}));
vi.mock("@/lib/stellar/prepare-execution", () => ({ prepareExecutionTransaction: mock.prepare }));
vi.mock("@/lib/api/v1/execution-intent", () => ({
  createExecutionIntent: mock.save,
  findExecutionRetry: mock.retry,
  executionRequestDigest: () => "digest",
  readExecutionForSubmission: vi.fn(),
}));
vi.mock("@/lib/api/v1/control-intent", () => ({
  readControlIntent: mock.control,
  recordControlFinality: vi.fn(),
}));
import { prepareExecutionPayment, assertExecutionEligible } from "@/lib/api/v1/execution-payments";
const root = StrKey.encodeContract(Buffer.alloc(32, 1));
const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
const wallet = Keypair.random().publicKey();
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  network: "testnet",
  status: "CONFIRMED",
} as Deployment;
let current: ReturnType<typeof ExecutionDiscoverySchema.parse>;
beforeEach(() => {
  vi.clearAllMocks();
  const policy = { kind: "pay", nodeId: "pay", recipient: "execution", payoutValue: "constant" };
  const capabilities = {
    policyVersion: 1,
    executionAbi: 1,
    execution: true,
    mutation: false,
    immutablePolicies: true,
    revisionBinding: true,
    wasmHash: "aa".repeat(32),
  };
  current = ExecutionDiscoverySchema.parse({
    supported: true,
    policyVersion: 1,
    deploymentId: deployment.id,
    network: "testnet",
    confirmedLedger: 10,
    rootContract: root,
    assetContract: root,
    minAmountStroops: "10",
    policies: { version: 1, nodes: [policy] },
    nodes: [
      { nodeId: "root", contractAddress: root, expectedRevision: "0", capabilities },
      { nodeId: "pay", contractAddress: pay, expectedRevision: "0", capabilities },
    ],
    configurations: [
      {
        version: 1,
        nodeId: "pay",
        contractAddress: pay,
        confirmedLedger: 10,
        revision: "0",
        policy,
        configuration: { kind: "pay", payoutValue: { kind: "full" } },
      },
    ],
  });
  mock.state.mockResolvedValue(current);
  mock.account.mockResolvedValue(new Account(wallet, "10"));
  mock.prepare.mockResolvedValue({ xdr: "unsigned" });
  mock.retry.mockResolvedValue(null);
  mock.save.mockImplementation(async (input) => input);
});
const input = () => ({
  amount: "100",
  from: wallet,
  arguments: {
    version: 1 as const,
    inputs: [{ kind: "pay" as const, nodeId: "pay", recipient: wallet }],
  },
});
describe("reviewed runtime payment preparation", () => {
  it("binds complete live path/revisions/artifacts and payer-owned amount into one signed intent", async () => {
    await prepareExecutionPayment(deployment, input(), "key-digest");
    const saved = mock.save.mock.calls[0]![0];
    expect(saved.execution).toMatchObject({
      payer: wallet,
      deploymentId: deployment.id,
      amountStroops: "100",
      rootContract: root,
      assetContract: root,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
      expiresAtLedger: 730,
      nodes: [
        { nodeId: "root", contractAddress: root, expectedRevision: "0" },
        { nodeId: "pay", contractAddress: pay, expectedRevision: "0" },
      ],
      arguments: input().arguments,
    });
    expect(saved.execution.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.artifacts).toEqual([
      { nodeId: "root", contractAddress: root, wasmHash: "aa".repeat(32) },
      { nodeId: "pay", contractAddress: pay, wasmHash: "aa".repeat(32) },
    ]);
    expect(mock.prepare).toHaveBeenCalledWith(saved.execution, undefined);
  });
  it("never falls back to a saved recipient when a declared input is missing", async () => {
    await expect(
      prepareExecutionPayment(deployment, { amount: "100", from: wallet }, null),
    ).rejects.toThrow("required");
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("rejects a configured minimum shortfall before asking for a signature", async () => {
    await expect(
      prepareExecutionPayment(deployment, { ...input(), amount: "9" }, null),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("returns the original keyed preparation even if live configuration has since changed", async () => {
    mock.retry.mockResolvedValue({ intent: "original", txHash: "old-hash" });
    expect(await prepareExecutionPayment(deployment, input(), "key")).toEqual({
      intent: "original",
      txHash: "old-hash",
    });
    expect(mock.state).not.toHaveBeenCalled();
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("refuses legacy capability rather than enabling inputs from a graph declaration", async () => {
    mock.state.mockResolvedValue({ supported: false });
    await expect(prepareExecutionPayment(deployment, input(), null)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("allows first-send eligibility at a later verified ledger when reviewed revisions and artifacts are unchanged", async () => {
    await prepareExecutionPayment(deployment, input(), "original-key");
    const saved = mock.save.mock.calls[0]![0];
    mock.control.mockResolvedValue({
      executionIntent: saved.execution,
      executionArtifacts: saved.artifacts,
    });
    if (!current.supported) throw new Error();
    current.confirmedLedger = 15;
    current.configurations[0]!.confirmedLedger = 15;
    await expect(assertExecutionEligible(deployment, "original-intent")).resolves.toBeUndefined();
    expect(mock.state).toHaveBeenCalledTimes(2);
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(mock.control).toHaveBeenCalledWith("original-intent", deployment.id, "payment.execute");
  });
  it.each(["revision", "artifact"])(
    "first-submit rejects changed %s; on-chain revision checks still cover the read/send race",
    async (field) => {
      await prepareExecutionPayment(deployment, input(), null);
      const saved = mock.save.mock.calls[0]![0];
      mock.control.mockResolvedValue({
        executionIntent: saved.execution,
        executionArtifacts: saved.artifacts,
      });
      if (!current.supported) throw new Error();
      if (field === "revision") current.nodes[1]!.expectedRevision = "1";
      else current.nodes[1]!.capabilities.wasmHash = "bb".repeat(32);
      await expect(assertExecutionEligible(deployment, "intent")).rejects.toMatchObject({
        code: "CONFLICT",
      });
    },
  );
});

it("overlaps payer loading with the closing fence and passes the verified payer into simulation", async () => {
  mock.state.mockImplementation(async (_deployment, options) => {
    await options.finalRead();
    return current;
  });
  await prepareExecutionPayment(deployment, input(), "key");
  expect(mock.prepare).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({}));
  const source = mock.prepare.mock.calls[0]![1] as Account;
  expect(source.accountId()).toBe(wallet);
  expect(mock.account).toHaveBeenCalledTimes(1);
});

it("requires post-admission fresh fence before returning request-local review state", async () => {
  const refresh = vi.fn(async () => {
    expect(mock.save).toHaveBeenCalledTimes(1);
    return current;
  });
  mock.observation.mockResolvedValue({ current, refresh });
  const review = vi.fn();
  await prepareExecutionPayment(deployment, input(), "key", undefined, "capability-hash", review);
  expect(review).toHaveBeenCalledWith(current);
  expect(mock.state).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("retains the admitted original after a post-admission review deadline and recovers exact keyed retry", async () => {
  const { AppError } = await import("@/lib/errors");
  const refresh = vi.fn().mockRejectedValue(new AppError("UPSTREAM_RPC", "Deadline exhausted"));
  mock.observation.mockResolvedValue({ current, refresh });
  const review = vi.fn();
  await expect(
    prepareExecutionPayment(deployment, input(), "key", undefined, "capability-hash", review),
  ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(review).not.toHaveBeenCalled();
  mock.retry.mockResolvedValue({ intent: "original", txHash: "original-hash" });
  expect(
    await prepareExecutionPayment(deployment, input(), "key", undefined, "capability-hash", review),
  ).toEqual({ intent: "original", txHash: "original-hash" });
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(mock.prepare).toHaveBeenCalledTimes(1);
  expect(mock.observation).toHaveBeenCalledTimes(1);
  expect(review).not.toHaveBeenCalled();
});
