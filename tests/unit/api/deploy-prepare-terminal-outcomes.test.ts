import { TemplateKind } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const { mockDb, prepare, hashes } = vi.hoisted(() => ({
  mockDb: { flow: { findFirst: vi.fn() }, deployment: { create: vi.fn(), update: vi.fn() } },
  prepare: vi.fn(),
  hashes: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => ({ id: "u" })) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/deploy", () => ({
  preparePipelineDeployTx: prepare,
  checkAccountFunding: vi.fn(),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHashes: hashes }));
import { POST } from "@/app/api/deployments/prepare/route";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const FLOW = "11111111-1111-1111-1111-111111111111";
const graph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
    { id: "c", type: "condition", config: { kind: "time_before", at: "2030-06-01T00:00:00.000Z" } },
    { id: "h", type: "hold", config: {} },
    { id: "r", type: "return_to_owner", config: {} },
  ],
  edges: [
    { id: "tc", source: "t", target: "c" },
    { id: "ch", source: "c", target: "h" },
    { id: "cr", source: "c", target: "r", sourceHandle: "false" },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mockDb.flow.findFirst.mockResolvedValue({ id: FLOW, ownerId: "u", graph });
  mockDb.deployment.create.mockResolvedValue({ id: "d" });
  hashes.mockResolvedValue(
    new Map(
      [TemplateKind.DEPOSIT_TRIGGER, TemplateKind.TIMELOCK, TemplateKind.PAYER].map((kind) => [
        kind,
        "a".repeat(64),
      ]),
    ),
  );
  prepare.mockResolvedValue({
    xdr: "unsigned",
    pipeline: [{ nodeId: "t", contractAddress: "trigger" }],
  });
});
it("binds Return to the preparing wallet and persists the original graph", async () => {
  const res = await POST({
    json: async () => ({ flowId: FLOW, sourceAccount: SOURCE }),
  } as unknown as import("next/server").NextRequest);
  expect(res.status).toBe(200);
  expect((await res.json()).data.networkPassphrase).toBe("Test SDF Network ; September 2015");
  const input = prepare.mock.calls[0]?.[0];
  expect(input.sourceAccount).toBe(SOURCE);
  expect(input.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual(["t", "c", "r"]);
  expect(input.nodes[2]).toMatchObject({
    templateKind: "PAYER",
    params: { recipient: SOURCE, percentageBps: 10000 },
  });
  expect(mockDb.deployment.create.mock.calls[0]?.[0].data.graphSnapshot).toEqual(graph);
});
it("persists the prepared implementation bindings with their resolved addresses", async () => {
  const pipeline = [
    {
      nodeId: "t",
      templateKind: "DEPOSIT_TRIGGER",
      contractAddress: "trigger",
      implementation: {
        version: 1,
        bindings: [{ blockId: "t", blockType: "on_receive", role: "trigger" }],
      },
    },
    {
      nodeId: "c",
      templateKind: "TIMELOCK",
      contractAddress: "lock",
      implementation: {
        version: 1,
        bindings: [
          { blockId: "c", blockType: "condition", role: "condition" },
          { blockId: "h", blockType: "hold", role: "strict_lock" },
        ],
      },
    },
    {
      nodeId: "r",
      templateKind: "PAYER",
      contractAddress: "return",
      implementation: {
        version: 1,
        bindings: [{ blockId: "r", blockType: "return_to_owner", role: "action" }],
      },
    },
  ];
  prepare.mockResolvedValue({ xdr: "unsigned", pipeline });
  const res = await POST({
    json: async () => ({ flowId: FLOW, sourceAccount: SOURCE }),
  } as unknown as import("next/server").NextRequest);
  expect(res.status).toBe(200);
  expect(
    prepare.mock.calls[0]?.[0].nodes.map(
      (node: { implementation: unknown }) => node.implementation,
    ),
  ).toEqual(pipeline.map((node) => node.implementation));
  expect(mockDb.deployment.update).toHaveBeenCalledWith({
    where: { id: "d" },
    data: expect.objectContaining({ pipelineSnapshot: pipeline }),
  });
  expect((await res.json()).data.pipeline).toEqual(pipeline);
});
it.each([undefined, "PENDING:owner", "invalid"])(
  "returns 422 VALIDATION for Return to owner with deploying wallet %s",
  async (sourceAccount) => {
    const payrollGraph = {
      ...graph,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "native" },
            employer: SOURCE,
            intervalAmount: 1,
            intervalUnit: "month",
          },
        },
        ...graph.nodes.slice(1),
      ],
    };
    mockDb.flow.findFirst.mockResolvedValue({ id: FLOW, ownerId: "u", graph: payrollGraph });
    const res = await POST({
      json: async () => ({ flowId: FLOW, sourceAccount }),
    } as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: {
        code: "VALIDATION",
        message: "Return to owner requires the deploying wallet address",
      },
    });
    expect(hashes).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  },
);
