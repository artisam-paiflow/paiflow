import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { ConditionalDefinitionSchema, conditionalNodeOrder } from "@/lib/flows/conditional-v2";
import {
  ConditionalConfigurationEventSchema,
  ConditionalCurrentConfigurationSchema,
  ConditionalNodeStateSchema,
  conditionalMutationAdmissible,
} from "@/lib/flows/conditional-v2-state";

const wallet = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const address = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
function fixture() {
  const definition = ConditionalDefinitionSchema.parse({
    version: 2,
    owner: wallet,
    assetContract: address(20),
    root: { nodeId: "root" },
    prefix: [],
    condition: {
      nodeId: "condition",
      kind: "amount_gt",
      thresholdStroops: "10",
      thresholdMode: "mutable",
    },
    trueBranch: {
      kind: "split",
      nodeId: "yes",
      policy: {
        kind: "split",
        nodeId: "yes",
        allocationMode: "fixed",
        rows: [{ rowId: "one", recipient: "constant", allocation: "constant" }],
      },
      configuration: {
        kind: "split",
        configuredRows: [
          { rowId: "one", recipient: wallet, allocation: { kind: "fixed", amountStroops: "20" } },
        ],
        additionalRecipients: [],
      },
    },
    falseBranch: { kind: "return_to_owner", nodeId: "no" },
  });
  const nodes = conditionalNodeOrder(definition).map((nodeId, index) => ({
    nodeId,
    contractAddress: address(index + 2),
    expectedRevision: index === 1 ? "1" : "0",
    wasmHash: "a".repeat(64),
  }));
  const configurations = [
    { kind: "receive", minAmountStroops: "0" },
    {
      kind: "condition",
      comparison: "amount_gt",
      thresholdStroops: "10",
      thresholdMode: "mutable",
    },
    definition.trueBranch,
    { kind: "return_to_owner", recipient: wallet },
  ];
  return {
    version: 2,
    confirmedLedger: 100,
    definition,
    nodes,
    statuses: nodes.map((node, index) => ({
      state: {
        version: 2,
        nodeId: node.nodeId,
        contractAddress: node.contractAddress,
        revision: node.expectedRevision,
        admin: wallet,
        assetContract: definition.assetContract,
        parentContract: index === 0 ? null : nodes[index === 1 ? 0 : 1]!.contractAddress,
        nextContracts:
          index === 0
            ? [nodes[1]!.contractAddress]
            : index === 1
              ? nodes.slice(2).map((n) => n.contractAddress)
              : [],
        configuration: configurations[index],
      },
      obligationsStroops: "0",
    })),
  };
}

describe("conditional whole-graph current state and events", () => {
  it.each(["pay", "split"] as const)(
    "keeps immutable %s revision zero while allowing declared mutable history",
    (kind) => {
      const branch = ConditionalCurrentConfigurationSchema.parse(fixture()).statuses[2]!.state;
      const policy =
        kind === "pay"
          ? { kind, nodeId: branch.nodeId, recipient: "constant", payoutValue: "constant" }
          : {
              kind,
              nodeId: branch.nodeId,
              allocationMode: "fixed",
              rows: [{ rowId: "one", recipient: "constant", allocation: "constant" }],
              additionalRecipients: "constant",
            };
      const configuration = {
        kind,
        nodeId: branch.nodeId,
        policy,
        configuration:
          kind === "pay"
            ? { kind, recipient: wallet, payoutValue: { kind: "fixed", amountStroops: "20" } }
            : {
                kind,
                configuredRows: [
                  {
                    rowId: "one",
                    recipient: wallet,
                    allocation: { kind: "fixed", amountStroops: "20" },
                  },
                ],
                additionalRecipients: [],
              },
      };
      const initial = { ...branch, configuration, revision: "0" };
      expect(ConditionalNodeStateSchema.safeParse(initial).success).toBe(true);
      expect(ConditionalNodeStateSchema.safeParse({ ...initial, revision: "1" }).success).toBe(
        false,
      );
      const mutable = {
        ...initial,
        revision: "1",
        configuration: {
          ...configuration,
          policy:
            kind === "pay"
              ? { ...policy, recipient: "mutable" }
              : { ...policy, additionalRecipients: "mutable" },
        },
      };
      expect(ConditionalNodeStateSchema.safeParse(mutable).success).toBe(true);
      expect(ConditionalConfigurationEventSchema.safeParse(mutable).success).toBe(true);
    },
  );

  it("checks both terminal parents and canonical True/False successor order", () => {
    const current = ConditionalCurrentConfigurationSchema.parse(fixture());
    expect(conditionalMutationAdmissible(current)).toBe(true);
    const swapped = structuredClone(current);
    swapped.statuses[1]!.state.nextContracts.reverse();
    expect(ConditionalCurrentConfigurationSchema.safeParse(swapped).success).toBe(false);
    current.statuses[3]!.state.parentContract = current.nodes[2]!.contractAddress;
    expect(ConditionalCurrentConfigurationSchema.safeParse(current).success).toBe(false);
  });
  it("blocks any update for inactive-branch accounted debt even without balance evidence", () => {
    const current = ConditionalCurrentConfigurationSchema.parse(fixture());
    current.statuses[2]!.obligationsStroops = "1";
    expect(conditionalMutationAdmissible(current)).toBe(false);
    expect(() =>
      conditionalMutationAdmissible({ ...current, statuses: current.statuses.slice(0, 3) }),
    ).toThrow();
  });
  it.each([
    "unknown",
    "badRevision",
    "wrongOwner",
    "wrongAsset",
    "thresholdMismatch",
    "returnRedirect",
    "rootDebt",
    "missingStatus",
    "duplicateContract",
    "obligationOverflow",
  ])("rejects %s evidence", (kind) => {
    const value = fixture();
    switch (kind) {
      case "unknown":
        Object.assign(value, { capabilities: { conditional: true } });
        break;
      case "badRevision":
        value.statuses[1]!.state.revision = "2";
        break;
      case "wrongOwner":
        value.statuses[3]!.state.admin = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
        break;
      case "wrongAsset":
        value.statuses[1]!.state.assetContract = address(30);
        break;
      case "thresholdMismatch":
        Object.assign(value.statuses[1]!.state.configuration!, { thresholdStroops: "11" });
        break;
      case "returnRedirect":
        Object.assign(value.statuses[3]!.state.configuration!, {
          recipient: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4)),
        });
        break;
      case "rootDebt":
        value.statuses[0]!.obligationsStroops = "1";
        break;
      case "missingStatus":
        value.statuses.pop();
        break;
      case "duplicateContract":
        value.nodes[3]!.contractAddress = value.nodes[2]!.contractAddress;
        break;
      case "obligationOverflow":
        value.statuses[2]!.obligationsStroops = (2n ** 127n).toString();
        break;
    }
    expect(ConditionalCurrentConfigurationSchema.safeParse(value).success).toBe(false);
  });
  it("retains complete changed threshold evidence while refusing initial or Return events", () => {
    const current = ConditionalCurrentConfigurationSchema.parse(fixture());
    expect(
      ConditionalConfigurationEventSchema.parse(current.statuses[1]!.state).configuration.kind,
    ).toBe("condition");
    expect(ConditionalConfigurationEventSchema.safeParse(current.statuses[3]!.state).success).toBe(
      false,
    );
    const initial = { ...current.statuses[1]!.state, revision: "0" };
    expect(ConditionalConfigurationEventSchema.safeParse(initial).success).toBe(false);
    expect(
      ConditionalConfigurationEventSchema.safeParse({ ...initial, revision: "1", extra: true })
        .success,
    ).toBe(false);
  });
  it("rejects impossible or nonmutable event configurations before history ingestion", () => {
    const current = ConditionalCurrentConfigurationSchema.parse(fixture());
    const threshold = current.statuses[1]!.state;
    expect(
      ConditionalConfigurationEventSchema.safeParse({
        ...threshold,
        configuration: { ...threshold.configuration, thresholdMode: "constant" },
      }).success,
    ).toBe(false);
    const branch = current.statuses[2]!.state;
    expect(
      ConditionalConfigurationEventSchema.safeParse({ ...branch, revision: "1" }).success,
    ).toBe(false);
    const badPay = {
      ...branch,
      revision: "1",
      configuration: {
        kind: "pay",
        nodeId: branch.nodeId,
        policy: {
          kind: "pay",
          nodeId: branch.nodeId,
          recipient: "execution",
          payoutValue: "mutable",
        },
        configuration: { kind: "pay", recipient: wallet, payoutValue: { kind: "full" } },
      },
    };
    expect(ConditionalConfigurationEventSchema.safeParse(badPay).success).toBe(false);
  });
  it("returns validation failure for malformed nested definition instead of throwing", () => {
    const current = fixture();
    current.definition.owner = "bad";
    expect(ConditionalCurrentConfigurationSchema.safeParse(current).success).toBe(false);
  });
  it("shares Split totals/slot feasibility and nonterminal Pay invariants with definitions", () => {
    const state = ConditionalCurrentConfigurationSchema.parse(fixture()).statuses[2]!.state;
    const pay = {
      ...state,
      revision: "1",
      nextContracts: [address(40)],
      configuration: {
        kind: "pay",
        nodeId: state.nodeId,
        policy: { kind: "pay", nodeId: state.nodeId, recipient: "mutable" },
        configuration: { kind: "pay", recipient: wallet, payoutValue: { kind: "full" } },
      },
    };
    expect(ConditionalConfigurationEventSchema.safeParse(pay).success).toBe(false);
    const split = {
      ...state,
      revision: "1",
      configuration: {
        kind: "split",
        nodeId: state.nodeId,
        policy: {
          kind: "split",
          nodeId: state.nodeId,
          allocationMode: "fixed",
          rows: ["a", "b"].map((rowId) => ({ rowId, recipient: "mutable" })),
        },
        configuration: {
          kind: "split",
          configuredRows: ["a", "b"].map((rowId, index) => ({
            rowId,
            recipient: index === 0 ? wallet : StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7)),
            allocation: { kind: "fixed", amountStroops: (2n ** 127n - 1n).toString() },
          })),
          additionalRecipients: [],
        },
      },
    };
    expect(ConditionalConfigurationEventSchema.safeParse(split).success).toBe(false);
    const impossibleSlots = {
      ...split,
      configuration: {
        ...split.configuration,
        policy: {
          ...split.configuration.policy,
          allocationMode: "percentage",
          rows: [
            { rowId: "a", recipient: "mutable", allocation: "constant" },
            { rowId: "b", recipient: "constant", allocation: "execution" },
          ],
        },
        configuration: {
          ...split.configuration.configuration,
          configuredRows: [
            { rowId: "a", recipient: wallet, allocation: { kind: "percentage", bps: 10000 } },
            { rowId: "b", recipient: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7)) },
          ],
        },
      },
    };
    expect(ConditionalConfigurationEventSchema.safeParse(impossibleSlots).success).toBe(false);
  });
});
