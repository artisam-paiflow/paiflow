import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireSession: session }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  clientIp: () => "127.0.0.1",
  rateLimitedError: () => new Error("limited"),
}));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: async () => {} }));
import { POST as create } from "@/app/api/flows/route";
import { PATCH as patch } from "@/app/api/flows/[id]/route";
import { GET as preview } from "@/app/api/flows/[id]/preview/route";
import { POST as validate } from "@/app/api/flows/[id]/validate/route";
import { readOrdinaryFlowGraph } from "@/lib/flows/ordinary-flow";
let ownerId: string;
beforeAll(async () => {
  const owner = await db.user.create({ data: { username: `conditional-draft-${randomUUID()}` } });
  ownerId = owner.id;
  session.mockResolvedValue({ id: ownerId, role: "USER" });
});
afterAll(async () => {
  if (ownerId) {
    await db.flow.deleteMany({ where: { ownerId } });
    await db.auditLog.deleteMany({ where: { userId: ownerId } });
    await db.user.delete({ where: { id: ownerId } });
  }
});
const request = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/flows", { method, body: JSON.stringify(body) });
it("Postgres preserves incomplete conditional draft metadata and validates without compiling", async () => {
  const graph = {
    generation: "conditional-v2",
    nodes: [{ id: "receive", type: "on_receive", config: { asset: { kind: "native" } } }],
    edges: [],
    conditionalPolicies: { version: 2, nodes: [] },
    positions: { receive: { x: 4, y: 5 } },
    notify: { mode: "off", sendTo: "" },
  };
  const created = await create(request({ name: "Conditional draft", graph }));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  const stored = await db.flow.findUniqueOrThrow({ where: { id } });
  expect(stored.graph).toEqual(graph);
  expect(readOrdinaryFlowGraph(stored.graph)).toEqual(graph);
  expect(stored.parameters).toEqual({ generation: "conditional-v2", version: 2, draft: true });
  expect(stored.templateKind).toBe("ROUTER");
  const result = await validate(request({}), { params: Promise.resolve({ id }) });
  expect((await result.json()).data.ok).toBe(false);
  const changed = { ...graph, positions: { receive: { x: 40, y: 50 } } };
  const response = await patch(request({ graph: changed }, "PATCH"), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  const updated = await db.flow.findUniqueOrThrow({ where: { id } });
  expect(updated.graph).toEqual(changed);
  expect(updated.version).toBe(stored.version + 1);
  expect(updated.parameters).toEqual(stored.parameters);
  const prose = await preview(request({}), { params: Promise.resolve({ id }) });
  expect((await prose.json()).data.english).toContain("Conditional draft is incomplete");
  expect(await db.deployment.count({ where: { flowId: id } })).toBe(0);
});
it("Postgres preserves complete conditional threshold declarations and owner-return meaning", async () => {
  const graph = {
    generation: "conditional-v2",
    conditionalPolicies: {
      version: 2,
      nodes: [],
      condition: { nodeId: "condition", thresholdMode: "mutable" },
    },
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      { id: "condition", type: "condition", config: { kind: "amount_lt", amountStroops: "0" } },
      { id: "yes", type: "return_to_owner", config: {} },
      { id: "no", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "a", source: "receive", target: "condition" },
      { id: "b", source: "condition", target: "yes", sourceHandle: "true" },
      { id: "c", source: "condition", target: "no", sourceHandle: "false" },
    ],
    notify: { mode: "off", sendTo: "" },
  };
  const created = await create(request({ name: "Owner return", graph }));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id,
    ctx = { params: Promise.resolve({ id }) };
  expect((await (await validate(request({}), ctx)).json()).data).toEqual({
    ok: true,
    templateKind: "ROUTER",
  });
  const stored = await db.flow.findUniqueOrThrow({ where: { id } });
  expect(stored.graph).toEqual(graph);
  const text = (await (await preview(request({}), ctx)).json()).data.english;
  expect(text).toContain("threshold mutable");
  expect(text.match(/Return the full incoming amount/g)).toHaveLength(2);
  expect(text).toContain("Equality follows False");
});

async function legacyRow(name: string) {
  return db.flow.create({
    data: {
      ownerId,
      name,
      templateKind: "PAYER",
      graph: { nodes: [], edges: [] },
      parameters: { legacy: true },
    },
  });
}
const conditionalReplacement = () => ({
  generation: "conditional-v2",
  conditionalPolicies: { version: 2, nodes: [] },
  nodes: [],
  edges: [],
  notify: { mode: "off", sendTo: "" },
});
function pauseBody(body: unknown) {
  const req = request(body, "PATCH");
  let release: () => void = () => {},
    entered: () => void = () => {};
  const reached = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
  vi.spyOn(req, "json").mockImplementation(async () => {
    entered();
    await wait;
    return body;
  });
  return { req, reached, release };
}
it("a legacy read cannot overwrite a concurrent conditional opt-in at the atomic JSON guard", async () => {
  const row = await legacyRow("Stale legacy writer"),
    ctx = { params: Promise.resolve({ id: row.id }) };
  const old = pauseBody({ graph: { nodes: [], edges: [] } });
  const losing = patch(old.req, ctx);
  await old.reached;
  try {
    const winning = await patch(request({ graph: conditionalReplacement() }, "PATCH"), ctx);
    expect(winning.status).toBe(200);
  } finally {
    old.release();
  }
  expect((await losing).status).toBe(409);
  const stored = await db.flow.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.graph).toEqual(conditionalReplacement());
  expect(stored.parameters).toEqual({ generation: "conditional-v2", version: 2, draft: true });
  expect(stored.templateKind).toBe("ROUTER");
});
it("a delayed name-only edit preserves a concurrent graph, parameters and generation", async () => {
  const row = await legacyRow("Metadata race"),
    ctx = { params: Promise.resolve({ id: row.id }) };
  const old = pauseBody({ name: "Explicit new name" });
  const rename = patch(old.req, ctx);
  await old.reached;
  try {
    expect((await patch(request({ graph: conditionalReplacement() }, "PATCH"), ctx)).status).toBe(
      200,
    );
  } finally {
    old.release();
  }
  expect((await rename).status).toBe(200);
  const stored = await db.flow.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.name).toBe("Explicit new name");
  expect(stored.graph).toEqual(conditionalReplacement());
  expect(stored.parameters).toEqual({ generation: "conditional-v2", version: 2, draft: true });
  expect(stored.templateKind).toBe("ROUTER");
});
it("a current conditional draft rejects untagged downgrade without modifying its saved evidence", async () => {
  const row = await legacyRow("No downgrade"),
    ctx = { params: Promise.resolve({ id: row.id }) };
  expect((await patch(request({ graph: conditionalReplacement() }, "PATCH"), ctx)).status).toBe(
    200,
  );
  const original = await db.flow.findUniqueOrThrow({ where: { id: row.id } });
  expect((await patch(request({ graph: { nodes: [], edges: [] } }, "PATCH"), ctx)).status).toBe(
    409,
  );
  const retained = await db.flow.findUniqueOrThrow({ where: { id: row.id } });
  expect(retained.graph).toEqual(original.graph);
  expect(retained.parameters).toEqual(original.parameters);
  expect(retained.version).toBe(original.version);
});
it("normal retained v1 graph edits still persist through the raw JSON guard", async () => {
  const row = await legacyRow("Retained v1"),
    ctx = { params: Promise.resolve({ id: row.id }) };
  const graph = { nodes: [], edges: [], positions: { empty: { x: 1, y: 2 } } };
  expect((await patch(request({ graph }, "PATCH"), ctx)).status).toBe(200);
  const stored = await db.flow.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.graph).toEqual(graph);
  expect(stored.parameters).toEqual({ legacy: true });
  expect(stored.templateKind).toBe("PAYER");
});
