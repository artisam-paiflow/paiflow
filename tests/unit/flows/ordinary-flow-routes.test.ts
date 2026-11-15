import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  flow: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  session: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  write: vi.fn(),
  address: vi.fn(),
  ai: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { flow: mocks.flow, user: mocks.user } }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  clientIp: () => "127.0.0.1",
  rateLimitedError: () => new Error("limited"),
}));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: mocks.write }));
vi.mock("@/lib/address-book", () => ({ upsertAddress: mocks.address, getAddressBook: vi.fn() }));
vi.mock("@/lib/ai/groq", () => ({ callGroq: mocks.ai }));
import { POST as create } from "@/app/api/flows/route";
import { PATCH as patch, GET as read } from "@/app/api/flows/[id]/route";
import { GET as preview } from "@/app/api/flows/[id]/preview/route";
import { POST as validate } from "@/app/api/flows/[id]/validate/route";
import { POST as edit } from "@/app/api/flows/[id]/edit/route";
import { POST as resolve } from "@/app/api/flows/[id]/resolve-addresses/route";
const id = "12271227-1227-4227-8227-122712271227",
  owner = "12261226-1226-4226-8226-122612261226",
  wallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const graph = () => ({
  generation: "conditional-v2",
  conditionalPolicies: { version: 2, nodes: [] },
  nodes: [
    { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
    { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "0" } },
    {
      id: "yes",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: wallet,
        mode: "percentage",
        percentage: 100,
        fullAmount: true,
      },
    },
    { id: "no", type: "return_to_owner", config: {} },
  ],
  edges: [
    { id: "a", source: "root", target: "condition" },
    { id: "b", source: "condition", target: "yes", sourceHandle: "true" },
    { id: "c", source: "condition", target: "no", sourceHandle: "false" },
  ],
  positions: { root: { x: 1, y: 2 } },
  notify: { mode: "off", sendTo: "" },
});
const ctx = { params: Promise.resolve({ id }) },
  req = (body: unknown, method = "POST") =>
    new NextRequest(`http://localhost/api/flows/${id}`, { method, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: owner, role: "USER" });
  mocks.rateLimit.mockResolvedValue({ ok: true });
  mocks.flow.findFirst.mockResolvedValue({
    id,
    ownerId: owner,
    name: "Conditional",
    templateKind: "ROUTER",
    parameters: { generation: "conditional-v2", version: 2, draft: true },
    graph: graph(),
  });
  mocks.flow.create.mockImplementation(async ({ data }) => ({ id, ...data }));
  mocks.flow.update.mockImplementation(async ({ data }) => ({ id, ...data }));
  mocks.address.mockResolvedValue({});
});
describe("ordinary conditional flow boundaries without storage", () => {
  it("creates a saveable incomplete explicit draft with inert metadata, never constructor data", async () => {
    const draft = graph();
    draft.edges = [];
    const response = await create(req({ name: "Incomplete", graph: draft }));
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.graph).toEqual(draft);
    expect(data.parameters).toEqual({ generation: "conditional-v2", version: 2, draft: true });
    expect(data.templateKind).toBe("ROUTER");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "FLOW_CREATE", userId: owner }),
    );
  });
  it("patches all generation/declaration/layout metadata together without inventing a deployment", async () => {
    const draft = graph();
    draft.conditionalPolicies = {
      version: 2,
      nodes: [],
      condition: { nodeId: "condition", thresholdMode: "mutable" },
    } as typeof draft.conditionalPolicies;
    const response = await patch(req({ graph: draft }, "PATCH"), ctx);
    expect(response.status).toBe(200);
    expect(mocks.flow.update).toHaveBeenCalledWith({
      where: { id, ownerId: owner, graph: { equals: graph() } },
      data: expect.objectContaining({
        graph: draft,
        templateKind: "ROUTER",
        parameters: { generation: "conditional-v2", version: 2, draft: true },
        version: { increment: 1 },
      }),
    });
  });
  it("preserves immutable initial evidence on existing deployments by editing only Flow", async () => {
    await patch(req({ name: "Renamed" }, "PATCH"), ctx);
    expect(mocks.flow.update).toHaveBeenCalledTimes(1);
    expect(mocks.flow.update.mock.calls[0]![0].data).not.toHaveProperty("pipelineSnapshot");
  });
  it("keeps owner scoping for reads and returns saved explicit generation", async () => {
    const response = await read(req({}, "POST"), ctx);
    expect(response.status).toBe(200);
    expect(mocks.flow.findFirst).toHaveBeenCalledWith({ where: { id, ownerId: owner } });
    expect((await response.json()).data.graph.generation).toBe("conditional-v2");
  });
  it("previews both branches and strict equality without lowering owner return", async () => {
    const response = await preview(req({}), ctx);
    expect(response.status).toBe(200);
    const text = (await response.json()).data.english;
    expect(text).toContain("Equality follows False");
    expect(text).toContain("True:");
    expect(text).toContain("False:");
    expect(text).toContain("Return the full incoming amount");
  });
  it("reports layout validation normally without treating source acceptance as capability", async () => {
    let response = await validate(req({}), ctx);
    expect((await response.json()).data).toEqual({ ok: true, templateKind: "ROUTER" });
    const draft = graph();
    draft.edges.pop();
    mocks.flow.findFirst.mockResolvedValueOnce({ id, graph: draft });
    response = await validate(req({}), ctx);
    expect((await response.json()).data).toMatchObject({ ok: false, errors: expect.any(Array) });
  });
  it("refuses conditional AI editing before contacting a model or changing metadata", async () => {
    const response = await edit(req({ message: "change threshold" }), ctx);
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("AI editing is unavailable");
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.flow.update).not.toHaveBeenCalled();
  });
  it("resolves draft recipient labels without losing modes or generation", async () => {
    const draft = graph();
    draft.nodes[2]!.config = {
      asset: { kind: "native" },
      recipient: "PENDING:Alice",
      mode: "percentage",
      percentage: 100,
      fullAmount: true,
    } as never;
    mocks.flow.findFirst.mockResolvedValueOnce({ id, graph: draft });
    const response = await resolve(req({ addresses: { Alice: wallet } }), ctx);
    expect(response.status).toBe(200);
    const saved = mocks.flow.update.mock.calls[0]![0].data;
    expect(saved.graph.generation).toBe("conditional-v2");
    expect(saved.graph.conditionalPolicies).toEqual(draft.conditionalPolicies);
    expect(saved.graph.nodes[2].config.recipient).toBe(wallet);
    expect(saved.parameters).toEqual({ generation: "conditional-v2", version: 2, draft: true });
  });
  it.each([
    { generation: "unknown" },
    { fieldPolicies: { version: 1, nodes: [] } },
    { version: 2 },
  ])("rejects mixed or unknown conditional generation %j", async (extra) => {
    const response = await create(req({ name: "Bad", graph: { ...graph(), ...extra } }));
    expect(response.status).toBe(422);
    expect(mocks.flow.create).not.toHaveBeenCalled();
  });
  it("does not grant another owner access", async () => {
    mocks.flow.findFirst.mockResolvedValueOnce(null);
    const response = await patch(req({ name: "Changed" }, "PATCH"), ctx);
    expect(response.status).toBe(404);
    expect(mocks.flow.update).not.toHaveBeenCalled();
  });
  it("keeps sandbox notifications off without losing conditional policy metadata", async () => {
    mocks.session.mockResolvedValueOnce({ id: owner, role: "SANDBOX" });
    const draft = graph();
    draft.notify = { mode: "every_transaction", sendTo: "private@example.com" };
    const response = await create(req({ name: "Sandbox", graph: draft }));
    expect(response.status).toBe(201);
    const saved = (await response.json()).data.graph;
    expect(saved.notify).toEqual({ mode: "off", sendTo: "" });
    expect(saved.generation).toBe("conditional-v2");
    expect(saved.conditionalPolicies).toEqual(draft.conditionalPolicies);
  });
});

it("rejects implicit downgrade of a stored conditional draft before writing", async () => {
  const response = await patch(req({ graph: { nodes: [], edges: [] } }, "PATCH"), ctx);
  expect(response.status).toBe(409);
  expect(mocks.flow.update).not.toHaveBeenCalled();
});
it("compares raw captured graph and owner atomically when a stale graph edit loses", async () => {
  mocks.flow.update.mockRejectedValueOnce({ code: "P2025" });
  const response = await patch(req({ graph: graph() }, "PATCH"), ctx);
  expect(response.status).toBe(409);
  expect(mocks.flow.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, ownerId: owner, graph: { equals: graph() } } }),
  );
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("metadata-only writes contain only requested columns and never captured graph or parameters", async () => {
  const response = await patch(req({ name: "New name" }, "PATCH"), ctx);
  expect(response.status).toBe(200);
  expect(mocks.flow.update).toHaveBeenCalledWith({
    where: { id, ownerId: owner },
    data: { name: "New name", version: { increment: 1 } },
  });
});
it("stale address resolution fails its captured raw-graph guard before contact side effects", async () => {
  const draft = graph();
  draft.nodes[2]!.config = {
    asset: { kind: "native" },
    recipient: "PENDING:Alice",
    mode: "percentage",
    percentage: 100,
    fullAmount: true,
  } as never;
  mocks.flow.findFirst.mockResolvedValueOnce({ id, ownerId: owner, graph: draft });
  mocks.flow.update.mockRejectedValueOnce({ code: "P2025" });
  const response = await resolve(req({ addresses: { Alice: wallet } }), ctx);
  expect(response.status).toBe(409);
  expect(mocks.flow.update.mock.calls[0]![0].where).toEqual({
    id,
    ownerId: owner,
    graph: { equals: draft },
  });
  expect(mocks.address).not.toHaveBeenCalled();
});
it("delayed resolution cannot overwrite another writer's generation or modes", async () => {
  const raw = {
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: "PENDING:Alice",
          mode: "fixed",
          amountStroops: "1",
        },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "pay" }],
    historicalMetadata: "compare raw JSON before normalization",
  };
  let stored: unknown = raw;
  mocks.flow.findFirst.mockResolvedValueOnce({ id, ownerId: owner, graph: raw });
  mocks.flow.update.mockImplementationOnce(async ({ where }) => {
    stored = graph();
    expect(where).toEqual({ id, ownerId: owner, graph: { equals: raw } });
    throw { code: "P2025" };
  });
  const response = await resolve(req({ addresses: { Alice: wallet } }), ctx);
  expect(response.status).toBe(409);
  expect(stored).toEqual(graph());
  expect(mocks.address).not.toHaveBeenCalled();
});
