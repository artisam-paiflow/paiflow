import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  SANDBOX_STARTER_GRAPH,
  STARTER_GRAPH,
  DEMO_RECIPIENT_ALICE,
  DEMO_RECIPIENT_BOB,
  DEMO_RECIPIENT_CHARLIE,
  SANDBOX_DEMO_RECIPIENT,
} from "@/lib/flows/starter";
import { FlowGraphSchema, getPendingLabels } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToParams, flowToPipeline } from "@/lib/flows/to-params";

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

// The sandbox session seeds this graph instead (`POST /api/auth/sandbox`), and
// the route refuses to create a session if it stops validating. It is the D1
// evidence path: someone with no account opens it and configures the Swap
// block, so it has to be deployable as-is.
describe("sandbox starter flow seeds a deployable swap graph", () => {
  it("parses with FlowGraphSchema", () => {
    expect(() => FlowGraphSchema.parse(SANDBOX_STARTER_GRAPH)).not.toThrow();
  });

  it("passes validateFlow as a SWAPPER with no pending addresses", () => {
    const v = validateFlow(SANDBOX_STARTER_GRAPH);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.templateKind).toBe("SWAPPER");
      expect(v.pendingLabels).toEqual([]);
    }
  });

  it("contains a swap block, which is the whole point of the sandbox", () => {
    const parsed = FlowGraphSchema.parse(SANDBOX_STARTER_GRAPH);
    const swap = parsed.nodes.find((n) => n.type === "swap");
    expect(swap).toBeDefined();
    // A swap of one asset for itself is rejected by validateFlow; guard the
    // two sides staying different if someone edits the constant.
    if (swap?.type === "swap") {
      expect(swap.config.assetIn).not.toEqual(swap.config.assetOut);
    }
  });

  // The sandbox graph is deployed AND triggered without anyone editing it, and
  // `deposit` simulates the pipeline down to the payer's SAC transfer. Pointing
  // the Pay node at one of the unfunded placeholders made every sandbox trigger
  // fail pre-flight with a 502 (they have no account on testnet, let alone a
  // USDC trustline).
  it("pays a recipient that is not one of the unfunded placeholders", () => {
    const parsed = FlowGraphSchema.parse(SANDBOX_STARTER_GRAPH);
    const pay = parsed.nodes.find((n) => n.type === "pay");
    expect(pay).toBeDefined();
    if (pay?.type !== "pay") return;
    expect(pay.config.recipient).toBe(SANDBOX_DEMO_RECIPIENT);
    expect([DEMO_RECIPIENT_ALICE, DEMO_RECIPIENT_BOB, DEMO_RECIPIENT_CHARLIE]).not.toContain(
      pay.config.recipient,
    );
    expect(StrKey.isValidEd25519PublicKey(SANDBOX_DEMO_RECIPIENT)).toBe(true);
  });

  it("builds a three-node pipeline the factory can deploy", () => {
    const v = validateFlow(SANDBOX_STARTER_GRAPH);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // flowToPipeline, not flowToParams: the swapper only exists on the pipeline
    // path, and this is what the sandbox route stores as Flow.parameters.
    const pipeline = flowToPipeline(v.graph);
    expect(pipeline.map((n) => n.templateKind)).toEqual(["DEPOSIT_TRIGGER", "SWAPPER", "PAYER"]);
  });
});
