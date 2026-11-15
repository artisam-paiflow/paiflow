import type { MutationPreparationRefusal } from "@prisma/client";
import { Account, Contract, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  storedMutationProtocol,
  storedMutationArguments,
  assertStoredMutationVersion,
} from "@/lib/mutations/mutation-protocol";
import { preparationRefusalError } from "@/lib/mutations/refusals";
import { assertControlTransaction } from "@/lib/api/v1/control-intent";
import {
  admin,
  conditionalMutationFixture,
  conditionalMutationTransaction,
} from "./conditional-mutation-fixtures";
import { intent as v1Intent } from "./fixtures";

const fixture = conditionalMutationFixture();
const mutation = fixture.mutation;
const transaction = () => conditionalMutationTransaction(mutation);
function binding(tx = transaction()) {
  return {
    deploymentId: fixture.deployment.id,
    network: "testnet",
    nodeId: mutation.nodes[0]!.nodeId,
    contractAddress: mutation.rootContract,
    walletAddress: mutation.admin,
    action: "configuration.mutate",
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds!.maxTime,
    mutationIntent: mutation,
  };
}
describe("stored mutation generation and exact control dispatch", () => {
  it("derives method only from strict persisted generation and retains null historical v1 behavior", () => {
    expect(storedMutationProtocol({ mutationIntent: mutation })).toEqual({
      version: 2,
      method: "mutate_v2",
    });
    expect(storedMutationProtocol({ mutationIntent: v1Intent(fixture.deployment) })).toEqual({
      version: 1,
      method: "mutate_v1",
    });
    expect(storedMutationProtocol({ mutationIntent: null })).toEqual({
      version: 1,
      method: "mutate_v1",
    });
    const tx = transaction();
    expect(() => assertControlTransaction(tx, binding(tx))).not.toThrow();
    expect(() =>
      assertControlTransaction(tx, { ...binding(tx), mutationIntent: undefined }),
    ).toThrow();
  });
  it.each([{ version: 99 }, { version: 2 }, { arguments: { version: 2 } }, {}])(
    "fails closed on malformed explicit saved evidence %o",
    (mutationIntent) => {
      expect(() => storedMutationProtocol({ mutationIntent })).toThrow();
      expect(() =>
        assertControlTransaction(transaction(), { ...binding(), mutationIntent }),
      ).toThrow();
    },
  );
  it("preserves original id/hash when a selector requests another saved generation", () => {
    expect(() =>
      assertStoredMutationVersion(
        { id: fixture.deployment.id, txHash: "ab".repeat(32), mutationIntent: mutation },
        1,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        fields: { intent: [fixture.deployment.id], txHash: ["ab".repeat(32)] },
      }),
    );
  });
  it.each(["root", "admin", "network", "arguments", "method", "node-pin"])(
    "rejects %s substitution before signing or sending",
    (attack) => {
      const tx = transaction();
      const evidence = binding(tx);
      if (attack === "root") evidence.contractAddress = mutation.nodes[1]!.contractAddress;
      if (attack === "admin")
        evidence.walletAddress =
          mutation.definition.trueBranch.kind === "split"
            ? mutation.definition.trueBranch.configuration.configuredRows[0]!.recipient!
            : mutation.admin;
      if (attack === "network") evidence.network = "mainnet";
      if (attack === "arguments") {
        const altered = structuredClone(mutation);
        const change = altered.arguments.changes.find((value) => value.kind === "condition")!;
        if (change.kind !== "condition") throw new Error();
        change.thresholdStroops = "201";
        evidence.mutationIntent = altered;
      }
      if (attack === "node-pin")
        evidence.mutationIntent = {
          ...mutation,
          nodes: mutation.nodes.map((node, index) =>
            index === 4 ? { ...node, wasmHash: "cc".repeat(32) } : node,
          ),
        };
      if (attack === "method") {
        const wrong = new TransactionBuilder(new Account(admin.publicKey(), "10"), {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            new Contract(mutation.rootContract).call(
              "mutate_v1",
              ...storedMutationArguments(mutation),
            ),
          )
          .setTimeout(180)
          .build();
        expect(() =>
          assertControlTransaction(wrong, {
            ...evidence,
            txHash: wrong.hash().toString("hex"),
            maxTime: wrong.timeBounds!.maxTime,
          }),
        ).toThrow();
        return;
      }
      expect(() => assertControlTransaction(tx, evidence)).toThrow();
    },
  );
});

describe("immutable refusal generation evidence", () => {
  function row(request: unknown): MutationPreparationRefusal {
    return {
      id: "12261226-1226-4226-8226-122612261226",
      deploymentId: fixture.deployment.id,
      network: "testnet",
      admin: mutation.admin,
      idempotencyKeyHash: "ab".repeat(32),
      requestDigest: "cd".repeat(32),
      reasonCode: "VALIDATION",
      createdAt: new Date(),
      request,
    } as MutationPreparationRefusal;
  }
  it("keeps valid v1 proofs unchanged and emits strict v2 proof only for a saved v2 request", () => {
    const requests = [
      { admin: mutation.admin, arguments: v1Intent(fixture.deployment).arguments },
      { admin: mutation.admin, arguments: mutation.arguments },
    ];
    requests.forEach((request, index) => {
      const error = preparationRefusalError(row(request), "cd".repeat(32));
      expect(error.code).toBe("VALIDATION");
      expect(JSON.parse(error.fields!.preparationRefusal![0]!).version).toBe(index + 1);
    });
  });
  it.each([
    {},
    { admin: mutation.admin, arguments: { version: 99, changes: [] } },
    { admin: mutation.admin, arguments: { version: 2, changes: [] } },
  ])("never manufactures terminal proof from malformed stored request %o", (request) => {
    const error = preparationRefusalError(row(request), "cd".repeat(32));
    expect(error.code).toBe("UPSTREAM_RPC");
    expect(error.fields?.preparationRefusal).toBeUndefined();
  });
  it("changed payload retains the original refusal without exposing a mismatched proof", () => {
    const error = preparationRefusalError(
      row({ admin: mutation.admin, arguments: mutation.arguments }),
      "ef".repeat(32),
    );
    expect(error.code).toBe("CONFLICT");
    expect(error.fields?.preparationRefusal).toBeUndefined();
  });
});
