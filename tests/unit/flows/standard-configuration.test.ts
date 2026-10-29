import { describe, expect, it } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";

const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const asset = { kind: "native" };
const trigger = { id: "t", type: "on_receive", config: { asset } };
const graph = (action: unknown) =>
  FlowGraphSchema.parse({
    devMode: true,
    nodes: [trigger, action],
    edges: [{ id: "e", source: "t", target: "a" }],
  });

describe("standard configuration after mutable-flow removal (#1138)", () => {
  it("discards retired configuration flags without supplying payment values", () => {
    const g = graph({
      id: "a",
      type: "pay",
      config: { asset, recipient: address, fillValueViaApi: true },
    });
    expect(g).not.toHaveProperty("devMode");
    expect(g.nodes[1]?.config).not.toHaveProperty("fillValueViaApi");
    expect(g.nodes[1]?.config).not.toHaveProperty("amountStroops");
    const result = validateFlow(g, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path.endsWith("amountStroops"))).toBe(true);
  });
  it("requires recipients before an empty split can deploy", () => {
    const g = graph({ id: "a", type: "split", config: { asset, recipients: [] } });
    const result = validateFlow(g, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path.endsWith("recipients"))).toBe(true);
  });
  it("compiles complete inputs only to standard contracts despite retired input flags", () => {
    const g = graph({
      id: "a",
      type: "pay",
      config: {
        asset,
        recipient: address,
        mode: "fixed",
        amountStroops: "1234567890123456789",
        fillValueViaApi: true,
      },
    });
    expect(validateFlow(g, { ignoreOwnerEmail: true }).ok).toBe(true);
    expect(flowToPipeline(g).map((n) => n.templateKind)).toEqual(["DEPOSIT_TRIGGER", "PAYER"]);
    expect(flowToPipeline(g)[1]?.params).toMatchObject({
      recipient: address,
      amountStroops: "1234567890123456789",
    });
  });
});
