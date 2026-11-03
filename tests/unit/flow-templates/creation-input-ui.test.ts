import { describe, expect, it } from "vitest";
import {
  creationLeaves,
  parseCreationValue,
} from "@/components/flow-templates/creation-input.utils";
import { CreationDeclarationSchema } from "@/lib/flow-templates/schema";
import {
  TemplatePageSchema,
  VersionSchema,
  BindingPreviewSchema,
  InstanceInitialReviewSchema,
} from "@/lib/flow-templates/client-schema";
import { graph, version, receipt, artifacts, versionId, compiledTerms } from "./ui-fixtures";

describe("typed template authoring UI", () => {
  it("offers finite configured leaves and no owner, mode, asset or arbitrary path", () => {
    expect(creationLeaves(graph)).toEqual([
      { target: { nodeId: "pay", field: "recipient" }, type: "wallet" },
      { target: { nodeId: "pay", field: "amountStroops" }, type: "stroops" },
    ]);
    expect(
      creationLeaves({
        ...graph,
        fieldPolicies: {
          version: 1,
          nodes: [{ nodeId: "pay", kind: "pay", recipient: "execution", payoutValue: "constant" }],
        },
      }).some((leaf) => leaf.target.field === "recipient"),
    ).toBe(false);
  });
  it("keeps money as a canonical string above Number precision", () => {
    expect(parseCreationValue("stroops", "900719925474099312345")).toEqual({
      type: "stroops",
      value: "900719925474099312345",
    });
    for (const raw of ["1.5", "1e7", " 100", "01", "-1", ""])
      expect(() => parseCreationValue("stroops", raw)).toThrow();
  });
  it("parses typed controls without truthiness or numeric coercion surprises", () => {
    expect(parseCreationValue("boolean", "false")).toEqual({ type: "boolean", value: false });
    expect(parseCreationValue("bps", "1500")).toEqual({ type: "bps", value: 1500 });
    for (const [type, raw] of [
      ["integer", "1e3"],
      ["integer", "1.5"],
      ["bps", "10001"],
      ["boolean", "yes"],
      ["timestamp", "tomorrow"],
      ["wallet", "SSECRET"],
    ] as const)
      expect(() => parseCreationValue(type, raw)).toThrow();
  });
  it("rejects malformed default types and numeric money in declarations", () => {
    const input = {
      inputId: "amount",
      label: "Amount",
      target: { nodeId: "pay", field: "amountStroops" },
      type: "stroops",
    };
    expect(
      CreationDeclarationSchema.safeParse({
        ...input,
        defaultValue: { type: "stroops", value: 100 },
      }).success,
    ).toBe(false);
    expect(
      CreationDeclarationSchema.safeParse({
        ...input,
        defaultValue: { type: "integer", value: 100 },
      }).success,
    ).toBe(false);
  });
  it("validates actual response shapes and rejects missing durable review evidence", () => {
    expect(VersionSchema.parse(version).definition).toEqual(version.definition);
    expect(
      TemplatePageSchema.safeParse({ items: [{ id: versionId }], nextCursor: null }).success,
    ).toBe(false);
    const preview = {
      graph,
      bindings: { version: 1, templateVersionId: versionId, values: [] },
      artifacts,
    };
    expect(BindingPreviewSchema.parse(preview).graph).toEqual(graph);
    expect(
      InstanceInitialReviewSchema.safeParse({
        ...preview,
        receipt: receipt(),
        contentHash: "d".repeat(64),
        compiledTerms,
      }).success,
    ).toBe(true);
    expect(InstanceInitialReviewSchema.safeParse({ ...preview, receipt: receipt() }).success).toBe(
      false,
    );
  });
});
