import { describe, expect, it } from "vitest";
import {
  MutationArgumentsSchema,
  type ConfirmedNodeConfiguration,
} from "@/lib/flows/field-policies";
import {
  MutationPrepareSchema,
  MutationIntentSchema,
  MutationSubmitSchema,
  ConfigurationHistoryQuerySchema,
} from "@/lib/mutations/schema";
import { applyMutationValues } from "@/lib/mutations/values";
import { projectConfirmedGraph } from "@/lib/mutations/graph";
import { configuration, graph, admin, nextRecipient, recipient, intent } from "./fixtures";
import type { Deployment } from "@prisma/client";
const args = () =>
  MutationArgumentsSchema.parse({
    version: 1,
    changes: [
      {
        kind: "pay",
        nodeId: "pay",
        expectedRevision: "0",
        recipient: nextRecipient,
        payoutValue: { kind: "fixed", amountStroops: "200" },
      },
    ],
  });
describe("strict stored mutation inputs", () => {
  it("accepts eligible stored fields and keeps initial snapshots unchanged", () => {
    const next = applyMutationValues([configuration], args());
    expect(next[0]!.revision).toBe("1");
    expect(configuration.revision).toBe("0");
    expect(next[0]!.configuration).toEqual({
      kind: "pay",
      recipient: nextRecipient,
      payoutValue: { kind: "fixed", amountStroops: "200" },
    });
    const projected = projectConfirmedGraph(graph, next);
    expect(projected.nodes[1]!.config).toMatchObject({
      recipient: nextRecipient,
      amountStroops: "200",
    });
    expect(graph.nodes[1]!.config).toMatchObject({ recipient, amountStroops: "100" });
  });
  it.each(["constant", "execution"] as const)("refuses %s recipient overrides", (mode) => {
    const value = structuredClone(configuration);
    if (value.policy.kind === "pay") value.policy.recipient = mode;
    expect(() => applyMutationValues([value], args())).toThrow(/not declared mutable/);
  });
  it("refuses allocation kind changes and revision exhaustion", () => {
    const value = args();
    if (value.changes[0]!.kind === "pay")
      value.changes[0]!.payoutValue = { kind: "percentage", bps: 1000 };
    expect(() => applyMutationValues([configuration], value)).toThrow(/immutable/);
    const max = structuredClone(configuration);
    max.revision = (2n ** 64n - 1n).toString();
    value.changes[0]!.expectedRevision = max.revision;
    expect(() => applyMutationValues([max], value)).toThrow(/exhausted/);
  });
  it("refuses stale revision, unknown node and no-op", () => {
    const value = args();
    value.changes[0]!.expectedRevision = "1";
    expect(() => applyMutationValues([configuration], value)).toThrow(/revision changed/);
    value.changes[0]!.expectedRevision = "0";
    value.changes[0]!.nodeId = "foreign";
    expect(() => applyMutationValues([configuration], value)).toThrow(/Unknown/);
    expect(() =>
      applyMutationValues([configuration], {
        version: 1,
        changes: [{ kind: "pay", nodeId: "pay", expectedRevision: "0", recipient }],
      }),
    ).toThrow(/actual change/);
  });
  it.each([
    { admin: "bad", arguments: args() },
    { admin: admin.publicKey(), arguments: args(), network: "mainnet" },
    { admin: admin.publicKey(), arguments: { version: 1, changes: [] } },
    {
      admin: admin.publicKey(),
      arguments: {
        version: 1,
        changes: [{ kind: "schedule", nodeId: "pay", expectedRevision: "0" }],
      },
    },
  ])("refuses hostile prepare input", (value) => {
    expect(MutationPrepareSchema.safeParse(value).success).toBe(false);
  });
  it("requires canonical revision/money, unique nodes/rows, complete bound path and strict submission/history", () => {
    for (const amountStroops of [1, "0", "01", "-1", (2n ** 127n).toString()])
      expect(
        MutationPrepareSchema.safeParse({
          admin: admin.publicKey(),
          arguments: {
            version: 1,
            changes: [
              {
                kind: "pay",
                nodeId: "pay",
                expectedRevision: "0",
                payoutValue: { kind: "fixed", amountStroops },
              },
            ],
          },
        }).success,
      ).toBe(false);
    expect(
      MutationArgumentsSchema.safeParse({
        version: 1,
        changes: [...args().changes, ...args().changes],
      }).success,
    ).toBe(false);
    const bound = intent({ id: "11111111-1111-4111-8111-111111111111" } as Deployment);
    bound.nodes.reverse();
    expect(MutationIntentSchema.safeParse(bound).success).toBe(false);
    expect(MutationSubmitSchema.safeParse({ intent: "not-uuid", signedXdr: "x" }).success).toBe(
      false,
    );
    expect(ConfigurationHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
  it("protects configured Split constants, final totals, duplicate recipients and immutable roster identity", () => {
    const split: ConfirmedNodeConfiguration = {
      ...configuration,
      nodeId: "split",
      policy: {
        kind: "split",
        nodeId: "split",
        allocationMode: "percentage",
        additionalRecipients: "mutable",
        rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
      },
      configuration: {
        kind: "split",
        configuredRows: [
          { rowId: "platform", recipient, allocation: { kind: "percentage", bps: 1500 } },
        ],
        additionalRecipients: [
          {
            rowId: "worker",
            recipient: nextRecipient,
            allocation: { kind: "percentage", bps: 8500 },
          },
        ],
      },
    };
    const update = (additionalRecipients: unknown) =>
      MutationArgumentsSchema.parse({
        version: 1,
        changes: [
          { kind: "split", nodeId: "split", expectedRevision: "0", rows: [], additionalRecipients },
        ],
      });
    expect(() =>
      applyMutationValues(
        [split],
        update([
          {
            rowId: "new",
            recipient: admin.publicKey(),
            allocation: { kind: "percentage", bps: 8500 },
          },
        ]),
      ),
    ).not.toThrow();
    for (const [rowId, address, bps] of [
      ["platform", nextRecipient, 8500],
      ["worker", recipient, 8500],
      ["worker", nextRecipient, 8400],
    ] as const)
      expect(() =>
        applyMutationValues(
          [split],
          update([{ rowId, recipient: address, allocation: { kind: "percentage", bps } }]),
        ),
      ).toThrow();
    expect(() =>
      applyMutationValues([split], {
        version: 1,
        changes: [
          {
            kind: "split",
            nodeId: "split",
            expectedRevision: "0",
            rows: [{ rowId: "platform", allocation: { kind: "percentage", bps: 1600 } }],
          },
        ],
      }),
    ).toThrow(/not mutable/);
  });
});

describe("mutation response and reconciliation wire contracts", () => {
  it("parses realistic confirmed responses and rejects false coverage and wallet/network confusion", async () => {
    const {
      MutationStateSchema,
      MutationPreparedSchema,
      MutationReconcileSchema,
      MutationReconciledSchema,
      ConfigurationHistorySchema,
    } = await import("@/lib/mutations/schema");
    const { current, transaction } = await import("./fixtures");
    const deployment = { id: "11111111-1111-4111-8111-111111111111" } as Deployment;
    const state = current(deployment),
      mutation = intent(deployment),
      id = "22222222-2222-4222-8222-222222222222";
    expect(MutationStateSchema.safeParse(state).success).toBe(true);
    expect(MutationStateSchema.safeParse({ ...state, mutationSupported: false }).success).toBe(
      false,
    );
    const prepared = {
      intent: id,
      txHash: "a".repeat(64),
      walletAddress: admin.publicKey(),
      xdr: transaction(mutation).toXDR(),
      expiresAt: new Date(Date.now() + 180000).toISOString(),
      network: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      feeStroops: "100",
      mutation,
    };
    expect(MutationPreparedSchema.safeParse(prepared).success).toBe(true);
    expect(MutationPreparedSchema.safeParse({ ...prepared, feeStroops: 100 }).success).toBe(false);
    expect(MutationReconcileSchema.safeParse({ intent: id }).success).toBe(true);
    expect(MutationReconcileSchema.safeParse({ intent: id, cancel: true }).success).toBe(false);
    const result = {
      intent: id,
      state: "SUBMITTING",
      transaction: { txHash: "a".repeat(64), network: "testnet", status: "UNKNOWN" },
    };
    expect(MutationReconciledSchema.safeParse(result).success).toBe(true);
    expect(MutationReconciledSchema.safeParse({ ...result, state: "CANCELLED" }).success).toBe(
      false,
    );
    const history = {
      deploymentId: deployment.id,
      network: "testnet",
      coverage: "observed-revisions-only",
      historyComplete: false,
      revisionCoverage: [],
      items: [
        { id, configuration, observedLedger: 100, eventLedger: null, eventId: null, txHash: null },
      ],
      nextCursor: null,
    };
    expect(ConfigurationHistorySchema.safeParse(history).success).toBe(true);
    expect(
      ConfigurationHistorySchema.safeParse({ ...history, historyComplete: true }).success,
    ).toBe(false);
  });
});

it("configuration telemetry normalizes only bounded endpoint names", async () => {
  const { requestEndpoint } = await import("@/lib/api/request-history/schema");
  for (const suffix of ["", "/history", "/prepare", "/submit", "/reconcile"])
    expect(
      requestEndpoint(
        `/api/v1/deployments/11111111-1111-4111-8111-111111111111/configuration${suffix}`,
      ),
    ).toBe(`/api/v1/deployments/:id/configuration${suffix}`);
});
