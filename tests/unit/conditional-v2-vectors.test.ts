import { describe, expect, it } from "vitest";
import vectors from "@/docs/conditional-v2-vectors.json";
import {
  ConditionalDefinitionSchema,
  ConditionalExecutionIntentSchema,
  ConditionalMutationIntentSchema,
  conditionalMutationArgumentsSchema,
  selectConditionalBranch,
} from "@/lib/flows/conditional-v2";

describe("published conditional-v2 handoff vectors", () => {
  it("validates the complete execution and grouped threshold update examples", () => {
    const intent = ConditionalExecutionIntentSchema.parse(vectors.executionIntent);
    expect(intent.payer).not.toBe(intent.definition.owner);
    expect(
      conditionalMutationArgumentsSchema(intent.definition, intent.nodes).safeParse(
        vectors.mutationArguments,
      ).success,
    ).toBe(true);
    const reversed = {
      version: 2,
      changes: [
        { kind: "pay", nodeId: "platform", expectedRevision: "0", recipient: intent.payer },
        ...vectors.mutationArguments.changes,
      ].reverse(),
    };
    expect(
      conditionalMutationArgumentsSchema(intent.definition, intent.nodes).safeParse(reversed)
        .success,
    ).toBe(false);
  });
  it.each(vectors.selectionCases)("computes $name", (vector) => {
    const definition = ConditionalDefinitionSchema.parse({
      ...vectors.executionIntent.definition,
      condition: {
        ...vectors.executionIntent.definition.condition,
        kind: vector.comparison,
        thresholdStroops: vector.thresholdStroops,
      },
    });
    expect(selectConditionalBranch(definition, vector.amountStroops)).toEqual({
      amountAtConditionStroops: vector.amountAtConditionStroops,
      selectedBranch: vector.selectedBranch,
    });
  });
  it.each(vectors.invalidIntents)("refuses $name", (vector) => {
    expect(ConditionalExecutionIntentSchema.safeParse(vector.intent).success).toBe(false);
  });
  it.each(["bad", "1.5", "-1", "01", "0", (2n ** 127n).toString()])(
    "returns validation failure for malformed money %s",
    (amount) => {
      const definition = structuredClone(vectors.executionIntent.definition);
      Object.assign(definition, {
        trueBranch: {
          kind: "split",
          nodeId: "workers",
          policy: {
            kind: "split",
            nodeId: "workers",
            allocationMode: "fixed",
            rows: [{ rowId: "row" }],
          },
          configuration: {
            kind: "split",
            configuredRows: [
              {
                rowId: "row",
                recipient: definition.owner,
                allocation: { kind: "fixed", amountStroops: amount },
              },
            ],
            additionalRecipients: [],
          },
        },
      });
      expect(ConditionalDefinitionSchema.safeParse(definition).success).toBe(false);
      expect(
        ConditionalExecutionIntentSchema.safeParse({ ...vectors.executionIntent, definition })
          .success,
      ).toBe(false);
      const inactive = {
        ...definition,
        falseBranch: definition.trueBranch,
        trueBranch: { kind: "return_to_owner", nodeId: "other" },
      };
      expect(ConditionalDefinitionSchema.safeParse(inactive).success).toBe(false);
    },
  );
  it("returns validation failure for malformed embedded definitions", () => {
    const value = {
      ...vectors.executionIntent,
      definition: { ...vectors.executionIntent.definition, owner: "bad" },
    };
    expect(ConditionalExecutionIntentSchema.safeParse(value).success).toBe(false);
  });
  it("binds exact mutation admin, root, changes and complete inactive graph", () => {
    const payment = ConditionalExecutionIntentSchema.parse(vectors.executionIntent);
    const mutation = {
      version: 2,
      deploymentId: payment.deploymentId,
      networkPassphraseHash: payment.networkPassphraseHash,
      rootContract: payment.rootContract,
      admin: payment.definition.owner,
      definition: payment.definition,
      nodes: payment.nodes,
      arguments: vectors.mutationArguments,
    };
    expect(ConditionalMutationIntentSchema.safeParse(mutation).success).toBe(true);
    for (const invalid of [
      { ...mutation, admin: payment.payer },
      { ...mutation, nodes: payment.nodes.slice(0, -1) },
      { ...mutation, version: 1 },
      { ...mutation, definition: { ...payment.definition, owner: "bad" } },
      {
        ...mutation,
        arguments: {
          version: 2,
          changes: [...vectors.mutationArguments.changes].map((change) => ({
            ...change,
            expectedRevision: "1",
          })),
        },
      },
    ])
      expect(ConditionalMutationIntentSchema.safeParse(invalid).success).toBe(false);
  });
});
