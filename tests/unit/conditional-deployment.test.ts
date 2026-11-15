import { describe, expect, it } from "vitest";
import {
  ConditionalDeploymentEnvelopeSchema,
  hasConditionalDeploymentDeclaration,
} from "@/lib/flows/conditional-deployment";
import {
  CONDITIONAL_V2_WASM_HASHES,
  assertConditionalArtifact,
  conditionalArtifactMetadata,
} from "@/lib/stellar/conditional-artifacts";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";

describe("immutable conditional deployment evidence", () => {
  it("recompiles exact complete evidence and preserves semantic owner Return", () => {
    const { paramsSnapshot } = conditionalDeploymentFixture();
    expect(ConditionalDeploymentEnvelopeSchema.parse(paramsSnapshot)).toEqual(paramsSnapshot);
    expect(paramsSnapshot.nodes.at(-1)).toMatchObject({
      templateKind: "PAYER",
      implementation: {
        version: 1,
        bindings: [{ blockId: "no", blockType: "return_to_owner", role: "action" }],
      },
      initialState: {
        configuration: { kind: "return_to_owner", recipient: paramsSnapshot.definition.owner },
      },
    });
  });
  it.each(["family", "semantic", "binding", "initial", "revision", "order", "unknown", "version"])(
    "rejects mismatched %s evidence",
    (kind) => {
      const raw = structuredClone(conditionalDeploymentFixture().paramsSnapshot);
      switch (kind) {
        case "family":
          raw.nodes.at(-1)!.templateKind = "ROUTER";
          break;
        case "semantic":
          raw.nodes.at(-1)!.implementation.bindings[0]!.blockType = "pay";
          break;
        case "binding":
          raw.nodes.at(-1)!.implementation.bindings[0]!.blockId = "other";
          break;
        case "initial":
          raw.nodes[0]!.initialState.admin = raw.manifest.nodes[1]!.state.contractAddress;
          break;
        case "revision":
          raw.manifest.nodes[2]!.state.revision = "1";
          break;
        case "order":
          raw.nodes.reverse();
          break;
        case "unknown":
          Object.assign(raw, { extra: true });
          break;
        default:
          Object.assign(raw, { version: 1 });
      }
      expect(ConditionalDeploymentEnvelopeSchema.safeParse(raw).success).toBe(false);
    },
  );
  it("refuses a self-consistent manifest that disagrees with its original definition", () => {
    const raw = structuredClone(conditionalDeploymentFixture().paramsSnapshot);
    raw.definition.condition.thresholdStroops = "999";
    expect(ConditionalDeploymentEnvelopeSchema.safeParse(raw).success).toBe(false);
  });
  it.each([
    { version: 2 },
    { generation: "conditional-v2" },
    { generation: "unknown" },
    { version: 99 },
    { generation: undefined },
  ])("routes malformed explicit declarations to refusal, without granting support", (raw) => {
    expect(hasConditionalDeploymentDeclaration(raw)).toBe(true);
    expect(ConditionalDeploymentEnvelopeSchema.safeParse(raw).success).toBe(false);
  });
  it.each([null, [], {}, [{ version: 1 }], { version: 1 }])(
    "does not infer conditional generation from old/no evidence",
    (raw) => expect(hasConditionalDeploymentDeclaration(raw)).toBe(false),
  );
  it("only accepts reviewed kind-specific guarded Wasms", () => {
    for (const [kind, hash] of Object.entries(CONDITIONAL_V2_WASM_HASHES))
      expect(conditionalArtifactMetadata(kind, hash)).toMatchObject({
        policyVersion: 2,
        mutationAbi: 2,
        mutation: true,
        wasmHash: hash,
      });
    for (const [kind, hash] of [
      ["PAYER", CONDITIONAL_V2_WASM_HASHES.ROUTER],
      ["UNKNOWN", CONDITIONAL_V2_WASM_HASHES.PAYER],
      ["PAYER", "c3a509d752d91dc8bc12c2ece91747b859f142feadad1869a99322c733217d7f"],
      ["PAYER", "dcfc03ef0b4f608148313059c531e034ae43d3c2b6ae6149f9766e341c887318"],
    ])
      expect(() => assertConditionalArtifact(kind!, hash!)).toThrow();
  });
});
