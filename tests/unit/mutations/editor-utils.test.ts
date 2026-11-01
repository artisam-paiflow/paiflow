import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import {
  configurationChanges,
  proposedConfigurations,
  configurationRevisionKey,
  assertConfigurationPrepared,
  assertConfigurationRefusal,
  configurationOutcomeIsTerminal,
} from "@/components/deploy/configuration-editor.utils";
import { MutationStateSchema } from "@/lib/mutations/schema";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  admin,
  current,
  transaction,
  intent,
  recipient,
  nextRecipient,
  root,
  pay,
} from "./fixtures";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/prisma", () => ({ db: {} }));
const deployment = { id: "11111111-1111-4111-8111-111111111111" } as Deployment;
const state = () => MutationStateSchema.parse(current(deployment));
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
function prepared() {
  const mutation = intent(deployment),
    tx = transaction(mutation);
  return {
    intent: "22222222-2222-4222-8222-222222222222",
    txHash: tx.hash().toString("hex"),
    walletAddress: admin.publicKey(),
    xdr: tx.toXDR(),
    expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
    network: "testnet" as const,
    networkPassphrase: "Test SDF Network ; September 2015",
    feeStroops: "100",
    mutation,
  };
}
describe("owner stored-configuration review", () => {
  it("builds only mutable differences and preserves exact string amounts", () => {
    const original = state(),
      drafts = structuredClone(original.configurations);
    const c = drafts[0]!.configuration;
    if (c.kind !== "pay") throw new Error();
    c.recipient = nextRecipient;
    c.payoutValue = { kind: "fixed", amountStroops: "90071992547409931234567" };
    const request = configurationChanges(original, drafts);
    expect(request.arguments.changes).toEqual([
      {
        kind: "pay",
        nodeId: "pay",
        expectedRevision: "0",
        recipient: nextRecipient,
        payoutValue: { kind: "fixed", amountStroops: "90071992547409931234567" },
      },
    ]);
    expect(proposedConfigurations(original, request)).toEqual(drafts);
    expect(original.configurations[0]!.configuration).toMatchObject({
      recipient,
      payoutValue: { amountStroops: "100" },
    });
  });
  it("rejects constant overrides, policy/identity edits, no-ops and payout-kind changes", () => {
    const original = state(),
      drafts = structuredClone(original.configurations);
    const policy = original.configurations[0]!.policy;
    if (policy.kind !== "pay") throw new Error();
    original.configurations[0]!.policy = { ...policy, recipient: "constant" };
    drafts[0]!.policy = structuredClone(original.configurations[0]!.policy);
    if (drafts[0]!.configuration.kind !== "pay") throw new Error();
    drafts[0]!.configuration.recipient = nextRecipient;
    expect(() => configurationChanges(original, drafts)).toThrow("not declared mutable");
    const fresh = state();
    expect(() => configurationChanges(fresh, structuredClone(fresh.configurations))).toThrow();
    const different = structuredClone(fresh.configurations);
    different[0]!.nodeId = "other";
    expect(() => configurationChanges(fresh, different)).toThrow("identity");
    const mode = structuredClone(fresh.configurations);
    if (mode[0]!.configuration.kind !== "pay") throw new Error();
    mode[0]!.configuration.payoutValue = { kind: "percentage", bps: 5000 };
    expect(() => configurationChanges(fresh, mode)).toThrow("kind");
  });
  it("requires a complete valid grouped Split roster without changing constant rows", () => {
    const original = state();
    original.policies.nodes = [
      {
        kind: "split",
        nodeId: "pay",
        allocationMode: "percentage",
        additionalRecipients: "mutable",
        rows: [
          { rowId: "platform", recipient: "constant", allocation: "constant" },
          { rowId: "worker", recipient: "mutable", allocation: "mutable" },
        ],
      },
    ];
    original.configurations = [
      {
        version: 1,
        nodeId: "pay",
        contractAddress: pay,
        confirmedLedger: 100,
        revision: "0",
        policy: original.policies.nodes[0]!,
        configuration: {
          kind: "split",
          configuredRows: [
            { rowId: "platform", recipient, allocation: { kind: "percentage", bps: 1500 } },
            {
              rowId: "worker",
              recipient: nextRecipient,
              allocation: { kind: "percentage", bps: 8500 },
            },
          ],
          additionalRecipients: [],
        },
      },
    ];
    const drafts = structuredClone(original.configurations),
      config = drafts[0]!.configuration;
    if (config.kind !== "split") throw new Error();
    config.configuredRows[1]!.allocation = { kind: "percentage", bps: 5000 };
    expect(() => configurationChanges(original, drafts)).toThrow("10000");
    const other = admin.publicKey();
    config.additionalRecipients = [
      { rowId: "extra", recipient: other, allocation: { kind: "percentage", bps: 3500 } },
    ];
    const result = configurationChanges(original, drafts);
    expect(result.arguments.changes[0]).toMatchObject({
      kind: "split",
      rows: [{ rowId: "worker", allocation: { kind: "percentage", bps: 5000 } }],
      additionalRecipients: config.additionalRecipients,
    });
    config.configuredRows[0]!.allocation = { kind: "percentage", bps: 1600 };
    config.additionalRecipients[0]!.allocation = { kind: "percentage", bps: 3400 };
    expect(() => configurationChanges(original, drafts)).toThrow("immutable");
    config.configuredRows.reverse();
    expect(() => configurationChanges(original, drafts)).toThrow();
  });
  it("ignores observation ledger changes but detects revisions, values, admin and artifact changes", () => {
    const original = state(),
      later = structuredClone(original);
    later.confirmedLedger = 101;
    later.configurations[0]!.confirmedLedger = 101;
    expect(configurationRevisionKey(later)).toBe(configurationRevisionKey(original));
    later.configurations[0]!.revision = "1";
    expect(configurationRevisionKey(later)).not.toBe(configurationRevisionKey(original));
  });
  it("binds prepared review to exact deployment/network/admin/path/revisions/arguments/artifacts", () => {
    const original = state(),
      p = prepared(),
      request = { admin: admin.publicKey(), arguments: p.mutation.arguments };
    expect(() => assertConfigurationPrepared(p, original, request)).not.toThrow();
    for (const bad of [
      { ...p, network: "mainnet" as const },
      { ...p, walletAddress: recipient },
      { ...p, mutation: { ...p.mutation, deploymentId: "33333333-3333-4333-8333-333333333333" } },
      {
        ...p,
        mutation: {
          ...p.mutation,
          nodes: p.mutation.nodes.map((n, i) => (i ? { ...n, expectedRevision: "1" } : n)),
        },
      },
      {
        ...p,
        mutation: {
          ...p.mutation,
          artifacts: p.mutation.artifacts.map((a, i) =>
            i ? { ...a, wasmHash: "a".repeat(64) } : a,
          ),
        },
      },
    ])
      expect(() => assertConfigurationPrepared(bad, original, request)).toThrow();
  });
  it("accepts only matching fresh refusal identity including array order and idempotency key", async () => {
    const request = { admin: admin.publicKey(), arguments: intent(deployment).arguments },
      record = {
        deploymentId: deployment.id,
        network: "testnet" as const,
        key: "original-key-1170",
        request,
      };
    const proof = {
      version: 1,
      outcome: "NOT_ADMITTED",
      refusalId: "44444444-4444-4444-8444-444444444444",
      deploymentId: record.deploymentId,
      network: record.network,
      admin: request.admin,
      idempotencyKeyHash: createHash("sha256").update(record.key).digest("hex"),
      requestDigest: executionRequestDigest({
        deploymentId: record.deploymentId,
        network: record.network,
        input: request,
      }),
      refusedAt: "2026-11-01T13:00:00.000Z",
      reasonCode: "CONFLICT",
    };
    await expect(assertConfigurationRefusal(proof, record)).resolves.toEqual(proof);
    for (const bad of [
      { ...proof, deploymentId: "55555555-5555-4555-8555-555555555555" },
      { ...proof, network: "mainnet" },
      { ...proof, admin: recipient },
      { ...proof, idempotencyKeyHash: "a".repeat(64) },
      { ...proof, requestDigest: "b".repeat(64) },
    ])
      await expect(assertConfigurationRefusal(bad, record)).rejects.toThrow();
    await expect(
      assertConfigurationRefusal(proof, { ...record, key: "different-original-key" }),
    ).rejects.toThrow();
    await expect(
      assertConfigurationRefusal(proof, {
        ...record,
        request: {
          ...request,
          arguments: {
            version: 1,
            changes: [{ kind: "pay", nodeId: "pay", expectedRevision: "0", recipient }],
          },
        },
      }),
    ).rejects.toThrow();
    const ordered = {
      ...request,
      arguments: {
        version: 1 as const,
        changes: [
          ...request.arguments.changes,
          { kind: "pay" as const, nodeId: "pay2", expectedRevision: "0", recipient },
        ],
      },
    };
    const orderedRecord = { ...record, request: ordered },
      orderedProof = {
        ...proof,
        requestDigest: executionRequestDigest({
          deploymentId: record.deploymentId,
          network: record.network,
          input: ordered,
        }),
      };
    await expect(assertConfigurationRefusal(orderedProof, orderedRecord)).resolves.toEqual(
      orderedProof,
    );
    await expect(
      assertConfigurationRefusal(orderedProof, {
        ...orderedRecord,
        request: {
          ...ordered,
          arguments: { ...ordered.arguments, changes: [...ordered.arguments.changes].reverse() },
        },
      }),
    ).rejects.toThrow();
  });
  it("never considers an unknown or contradictory reconciliation terminal", () => {
    const base = {
      intent: "22222222-2222-4222-8222-222222222222",
      transaction: {
        txHash: "a".repeat(64),
        network: "testnet" as const,
        status: "UNKNOWN" as const,
      },
    };
    expect(configurationOutcomeIsTerminal({ ...base, state: "SUBMITTING" })).toBe(false);
    expect(configurationOutcomeIsTerminal({ ...base, state: "SUCCESS" })).toBe(false);
    expect(
      configurationOutcomeIsTerminal({
        ...base,
        state: "SUCCESS",
        transaction: { ...base.transaction, status: "SUCCESS" },
      }),
    ).toBe(true);
    expect(
      configurationOutcomeIsTerminal({
        ...base,
        state: "EXPIRED",
        transaction: {
          ...base.transaction,
          status: "REJECTED",
          error: { code: "EXPIRED", message: "Verified non-inclusion" },
        },
      }),
    ).toBe(true);
  });
});
