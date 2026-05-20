import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  STARTER_GRAPH,
  DEMO_RECIPIENT_ALICE,
  DEMO_RECIPIENT_BOB,
  DEMO_RECIPIENT_CHARLIE,
} from "@/lib/flows/starter";
import { FlowGraphSchema, getPendingLabels } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToParams } from "@/lib/flows/to-params";

// This guards the demo path. The starter flow seeded into every new flow at
// `/flows/new` MUST be deployable as-is, otherwise the hero demo
// (`SPEC.md §1.3` — "drag → deploy in 90 seconds") breaks on stage.
//
// Regression #61.
describe("starter flow seeds a deployable graph", () => {
  it("parses with FlowGraphSchema", () => {
    expect(() => FlowGraphSchema.parse(STARTER_GRAPH)).not.toThrow();
  });

  it("passes validateFlow as a SPLITTER", () => {
    const v = validateFlow(STARTER_GRAPH);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.templateKind).toBe("SPLITTER");
      expect(v.pendingLabels).toEqual([]);
    }
  });

  it("has zero pending labels (deploy-prepare guard)", () => {
    const parsed = FlowGraphSchema.parse(STARTER_GRAPH);
    expect(getPendingLabels(parsed)).toEqual([]);
  });

  it("serializes to splitter params", () => {
    const parsed = FlowGraphSchema.parse(STARTER_GRAPH);
    const params = flowToParams(parsed, "SPLITTER");
    expect(params.kind).toBe("splitter");
    if (params.kind === "splitter") {
      expect(params.recipients).toHaveLength(3);
      expect(params.recipients.map((r) => r.bps).reduce((a, b) => a + b, 0)).toBe(10_000);
      expect(params.recipients.map((r) => r.address)).toEqual([
        DEMO_RECIPIENT_ALICE,
        DEMO_RECIPIENT_BOB,
        DEMO_RECIPIENT_CHARLIE,
      ]);
    }
  });

  it("uses valid Stellar Ed25519 public keys for all recipients", () => {
    for (const addr of [DEMO_RECIPIENT_ALICE, DEMO_RECIPIENT_BOB, DEMO_RECIPIENT_CHARLIE]) {
      expect(StrKey.isValidEd25519PublicKey(addr)).toBe(true);
    }
  });

  it("does not contain any PENDING: placeholder addresses", () => {
    const parsed = FlowGraphSchema.parse(STARTER_GRAPH);
    for (const node of parsed.nodes) {
      if (node.type === "split") {
        for (const r of node.config.recipients) {
          expect(r.address.startsWith("PENDING:")).toBe(false);
        }
      }
      if (node.type === "pay") {
        expect(node.config.recipient.startsWith("PENDING:")).toBe(false);
      }
    }
  });
});
