import { describe, expect, it } from "vitest";
import {
  FlowGraphSchema,
  migrateFlowGraph,
  withoutNotificationEmails,
  sandboxNotifications,
  type FlowGraph,
} from "@/lib/flows/schema";
import { STARTER_GRAPH } from "@/lib/flows/starter";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { flowToPipeline } from "@/lib/flows/to-params";
import { PatchOpSchema, buildSystemPrompt } from "@/lib/ai/prompts";
import { applyPatch, normalizeFlowGraph } from "@/lib/ai/normalize";

const baseline = () => FlowGraphSchema.parse(structuredClone(STARTER_GRAPH));
function oldGraph() {
  const graph = baseline();
  const split = graph.nodes.find((n) => n.type === "split")!;
  if (split.type !== "split") throw new Error("fixture");
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "old-email",
        type: "email_notify",
        config: {
          recipients: split.config.recipients.map((r, i) => ({
            address: r.address,
            email: `person${i}@example.com`,
          })),
          subject: "Custom subject",
          body: "{{amount}}",
        },
      },
    ],
    edges: [...graph.edges, { id: "email-edge", source: split.id, target: "old-email" }],
  };
}
function migrated(raw: unknown) {
  return FlowGraphSchema.parse(migrateFlowGraph(raw));
}

describe("Email Notify conversion", () => {
  it("moves one email per split recipient and preserves financial parameters", () => {
    const raw = oldGraph();
    const original = structuredClone(raw);
    const graph = migrated(raw);
    const split = graph.nodes.find((n) => n.type === "split")!;
    expect(split.type === "split" && split.config.recipients.map((r) => r.email)).toEqual([
      "person0@example.com",
      "person1@example.com",
      "person2@example.com",
    ]);
    expect(flowToPipeline(graph)).toEqual(flowToPipeline(baseline()));
    expect(raw).toEqual(original);
    expect(graph.notify).toBeUndefined();
    expect(graph.nodes.some((n) => n.type === "email_notify")).toBe(false);
    expect(graph.edges.some((e) => e.target === "old-email")).toBe(false);
    expect(migrated(graph)).toEqual(graph);
  });
  it("moves an email to a pay anywhere in the graph", () => {
    const raw = oldGraph();
    const address = raw.nodes.at(-1)!.config;
    const graph = migrated({
      ...raw,
      nodes: [
        ...raw.nodes,
        {
          id: "pay",
          type: "pay",
          config: {
            recipient: (address as { recipients: { address: string }[] }).recipients[0]!.address,
            asset: { kind: "native" },
            fullAmount: true,
          },
        },
      ],
    });
    expect(graph.nodes.find((n) => n.type === "pay")?.config).toMatchObject({
      email: "person0@example.com",
    });
  });
  it("preserves existing recipient emails", () => {
    const raw = oldGraph();
    const split = raw.nodes.find((n) => n.type === "split")!;
    if (split.type !== "split") throw new Error("fixture");
    split.config.recipients[0]!.email = "kept@example.com";
    expect(migrated(raw).nodes.find((n) => n.type === "split")?.config).toMatchObject({
      recipients: [
        expect.objectContaining({ email: "kept@example.com" }),
        expect.anything(),
        expect.anything(),
      ],
    });
  });
  it("drops unmatched rows from a node off a condition, with custom text", () => {
    const raw = oldGraph();
    raw.nodes.at(-1)!.config = {
      recipients: [{ address: "PENDING:unmatched", email: "drop@example.com" }],
      subject: "Drop me",
      body: "Private body",
    };
    const graph = migrated({
      ...raw,
      nodes: [
        ...raw.nodes,
        {
          id: "condition",
          type: "condition",
          config: { kind: "multisig", signers: ["PENDING:signer"], threshold: 1 },
        },
      ],
      edges: [
        ...raw.edges.filter((e) => e.target !== "old-email"),
        { id: "condition-email", source: "condition", target: "old-email" },
      ],
    });
    expect(JSON.stringify(graph)).not.toMatch(/drop@example|Drop me|Private body/);
    expect(graph.nodes.find((n) => n.id === "condition")).toBeTruthy();
    expect(graph.edges.some((e) => e.id === "condition-email")).toBe(false);
  });
  it.each([
    null,
    {},
    { recipients: null },
    { recipients: [null, 1, {}, { address: "x", email: {} }, { address: "x", email: "bad" }] },
  ])("discards malformed legacy configs: %j", (config) => {
    const raw = oldGraph();
    expect(
      migrated({
        ...raw,
        nodes: [...raw.nodes.slice(0, -1), { id: "old-email", type: "email_notify", config }],
      }).nodes,
    ).toEqual(baseline().nodes);
  });
  it("hydrates old mode-less split rows and drops both incoming and outgoing email edges", () => {
    const raw = oldGraph();
    const split = raw.nodes.find((n) => n.type === "split")!;
    const legacy = JSON.parse(JSON.stringify(raw)) as typeof raw;
    if (split.type === "split")
      for (const r of (legacy.nodes[1]!.config as { recipients: Record<string, unknown>[] })
        .recipients)
        delete r.mode;
    const graph = migrated({
      ...legacy,
      edges: [...legacy.edges, { id: "out", source: "old-email", target: split.id }],
      positions: { "old-email": { x: 1, y: 2 } },
    });
    expect(validateFlow(graph).ok).toBe(true);
    expect(graph.positions).toEqual({});
    expect(graph.edges).toEqual(baseline().edges);
  });
  it.each([null, 1, "bad", { nodes: null }, { nodes: [null], edges: [null] }])(
    "handles adversarial graph input without throwing: %j",
    (raw) => {
      expect(() => migrateFlowGraph(raw)).not.toThrow();
      expect(FlowGraphSchema.safeParse(migrateFlowGraph(raw)).success).toBe(false);
    },
  );
});

describe("notification settings", () => {
  const configured = (): FlowGraph => ({
    ...migrated(oldGraph()),
    notify: { mode: "every_transaction", sendTo: "owner@example.com" },
  });
  it("round-trips owner and recipient emails", () => {
    const graph = configured();
    expect(FlowGraphSchema.parse(JSON.parse(JSON.stringify(graph)))).toEqual(graph);
  });
  it.each(["wrong", "a@", "a\n@example.com"])(
    "refuses malformed owner and recipient email %s",
    (email) => {
      const graph = configured();
      graph.notify!.sendTo = email;
      expect(validateFlow(graph).ok).toBe(false);
      graph.notify!.sendTo = "";
      const split = graph.nodes.find((n) => n.type === "split")!;
      if (split.type === "split") split.config.recipients[0]!.email = email;
      expect(validateFlow(graph).ok).toBe(false);
    },
  );
  it("allows empty owner and recipient emails", () => {
    const graph = baseline();
    graph.notify = { mode: "every_transaction", sendTo: "" };
    expect(validateFlow(graph).ok).toBe(true);
  });
  it.each([
    { mode: "failed_transactions", sendTo: "" },
    { mode: "off", sendTo: 4 },
    { mode: "off", sendTo: "x".repeat(255) },
  ])("rejects adversarial settings %j", (notify) => {
    expect(FlowGraphSchema.safeParse({ ...baseline(), notify }).success).toBe(false);
  });
  it("previews owner and recipient settings with the decided shortfall label", () => {
    const graph = configured();
    expect(flowToEnglish(graph)).toContain("emails you at owner@example.com each time money moves");
    expect(flowToEnglish(graph)).toMatch(/emails G.* when paid/);
    graph.notify!.mode = "shortfalls_only";
    expect(flowToEnglish(graph)).toContain("only when a deposit falls short");
    graph.notify!.mode = "off";
    expect(flowToEnglish(graph)).not.toContain("owner@example.com");
  });
  it("strips all notification data on public surfaces and forces sandbox off", () => {
    expect(JSON.stringify(withoutNotificationEmails(configured()))).not.toContain("@example.com");
    expect(sandboxNotifications(configured()).notify).toEqual({ mode: "off", sendTo: "" });
    expect(JSON.stringify(sandboxNotifications(configured()))).not.toContain("@example.com");
  });
  it("new AI flows default to owner notifications", () => {
    const result = normalizeFlowGraph(baseline());
    expect(result.ok && result.graph.notify).toEqual({ mode: "every_transaction", sendTo: "" });
  });
});

describe("AI notification edits", () => {
  it("preserves owner settings through an ordinary node edit", () => {
    const graph = baseline();
    graph.notify = { mode: "shortfalls_only", sendTo: "owner@example.com" };
    const edited = applyPatch(graph, [
      { op: "updateNode", id: graph.nodes[0]!.id, config: { minAmountStroops: "100" } },
    ]);
    expect(edited.notify).toEqual(graph.notify);
  });
  it("sets owner notifications with a parsed AI patch", () => {
    const patch = PatchOpSchema.parse({
      op: "setNotify",
      notify: { mode: "shortfalls_only", sendTo: "owner@example.com" },
    });
    expect(applyPatch(baseline(), [patch]).notify).toEqual({
      mode: "shortfalls_only",
      sendTo: "owner@example.com",
    });
  });
  it.each([
    { mode: "unknown", sendTo: "" },
    { mode: "off", sendTo: [] },
  ])("rejects malformed notification patches %j", (notify) => {
    expect(PatchOpSchema.safeParse({ op: "setNotify", notify }).success).toBe(false);
  });
  it("normalises AI recipient emails without dropping them", () => {
    const graph = migrated(oldGraph());
    const result = normalizeFlowGraph(graph);
    expect(result.ok && result.graph.nodes[1]?.config).toMatchObject({
      recipients: [
        expect.objectContaining({ email: "person0@example.com" }),
        expect.anything(),
        expect.anything(),
      ],
    });
  });
  it("the system prompt offers settings rather than the retired node", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain("email_notify");
    expect(prompt).not.toContain("Email Notify");
    expect(prompt).toContain("setNotify");
    expect(prompt).toContain("shortfalls_only");
  });
});

describe("non-blocking owner email", () => {
  it("a malformed Send to never blocks save/deploy validation", () => {
    const graph = baseline();
    graph.notify = { mode: "every_transaction", sendTo: "half-typed@" };
    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(validateFlow(graph).ok).toBe(false);
    const result = validateFlow(graph, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(true);
    expect(result.ok && result.graph.notify).toEqual(graph.notify);
    expect(flowToEnglish(graph)).not.toContain("half-typed@");
  });
  it("deploy validation still refuses an invalid recipient email", () => {
    const graph = baseline();
    const split = graph.nodes.find((n) => n.type === "split");
    if (split?.type === "split") split.config.recipients[0]!.email = "wrong@";
    expect(validateFlow(graph, { ignoreOwnerEmail: true }).ok).toBe(false);
  });
});
