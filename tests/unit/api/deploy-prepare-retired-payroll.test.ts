import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    flow: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    deployment: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ id: "owner", role: "USER" })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/flows/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flows/schema")>();
  return { ...actual, migrateFlowGraph: vi.fn(actual.migrateFlowGraph) };
});
vi.mock("@/lib/stellar/deploy", () => ({
  preparePipelineDeployTx: vi.fn(),
  checkAccountFunding: vi.fn(),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHashes: vi.fn() }));
vi.mock("@/lib/deployments/service-work", () => ({
  prepareServiceDeployment: vi.fn(),
  withDeploymentWork: vi.fn(),
}));

import { POST } from "@/app/api/deployments/prepare/route";
import { audit } from "@/lib/audit";
import { prepareServiceDeployment, withDeploymentWork } from "@/lib/deployments/service-work";
import { migrateFlowGraph } from "@/lib/flows/schema";
import { PAYROLL_RETIRED_MESSAGE } from "@/lib/flows/retired-payroll";
import { getWasmHashes } from "@/lib/stellar/config";
import { checkAccountFunding, preparePipelineDeployTx } from "@/lib/stellar/deploy";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ordinaryGraph = {
  nodes: [
    { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "pay",
      type: "pay",
      config: { asset: { kind: "native" }, recipient: SOURCE, fullAmount: true },
    },
  ],
  edges: [{ id: "edge", source: "receive", target: "pay" }],
};
const ordinaryFlow = {
  id: FLOW_ID,
  ownerId: "owner",
  templateKind: "PAYER",
  parameters: [],
  graph: ordinaryGraph,
};
const legacyInstructions = [
  { type: "payroll" },
  { type: "payroll_dev" },
  { kind: "payroll" },
  { kind: "payroll_dev" },
  { kind: "payroll_trigger" },
  { kind: "payroll_trigger_dev" },
  { templateKind: "PAYROLL" },
  { templateKind: "PAYROLL_DEV" },
];

function request() {
  return {
    json: async () => ({ flowId: FLOW_ID, sourceAccount: SOURCE }),
  } as unknown as import("next/server").NextRequest;
}

describe("deployment preparation refuses recorded Payroll instructions (#1148)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.flow.findFirst.mockResolvedValue(structuredClone(ordinaryFlow));
    mockDb.deployment.create.mockResolvedValue({ id: "deployment" });
    vi.mocked(getWasmHashes).mockResolvedValue(
      new Map([
        ["DEPOSIT_TRIGGER", "a".repeat(64)],
        ["PAYER", "b".repeat(64)],
      ]),
    );
    vi.mocked(preparePipelineDeployTx).mockResolvedValue({
      xdr: "unsigned",
      pipeline: [],
    });
  });

  it.each([
    ...["PAYROLL", "PAYROLL_DEV"].map((templateKind) => ({ templateKind })),
    ...legacyInstructions.map((instruction) => ({ parameters: [{ params: instruction }] })),
    // Unknown graph fields can be discarded by parsing or migration: inspect the raw graph first.
    ...legacyInstructions.map((instruction) => ({
      graph: { ...ordinaryGraph, extra: { compiled: [instruction] } },
    })),
    ...["payroll", "payroll_dev"].map((type) => ({
      graph: {
        ...ordinaryGraph,
        nodes: [{ ...ordinaryGraph.nodes[0], type }, ordinaryGraph.nodes[1]],
      },
    })),
  ])("refuses retired saved input %j before preparation side effects", async (retired) => {
    const savedFlow = structuredClone({ ...ordinaryFlow, ...retired });
    const original = structuredClone(savedFlow);
    mockDb.flow.findFirst.mockResolvedValue(savedFlow);

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION",
        message: "Invalid input",
        fields: { _: [PAYROLL_RETIRED_MESSAGE] },
      },
    });
    expect(mockDb.flow.findFirst).toHaveBeenCalledWith({
      where: { id: FLOW_ID, ownerId: "owner" },
    });
    expect(migrateFlowGraph).not.toHaveBeenCalled();
    expect(getWasmHashes).not.toHaveBeenCalled();
    expect(checkAccountFunding).not.toHaveBeenCalled();
    expect(preparePipelineDeployTx).not.toHaveBeenCalled();
    expect(prepareServiceDeployment).not.toHaveBeenCalled();
    expect(withDeploymentWork).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
    expect(mockDb.flow.update).not.toHaveBeenCalled();
    expect(mockDb.flow.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(savedFlow).toEqual(original);
  });

  it("prepares an ordinary flow with Payroll only in labels and names", async () => {
    const savedFlow = {
      ...structuredClone(ordinaryFlow),
      name: "Payroll",
      parameters: [{ label: "Payroll", name: "payroll_trigger" }],
    };
    const original = structuredClone(savedFlow);
    mockDb.flow.findFirst.mockResolvedValue(savedFlow);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { deploymentId: "deployment", xdr: "unsigned" },
    });
    expect(getWasmHashes).toHaveBeenCalledWith("testnet");
    expect(checkAccountFunding).toHaveBeenCalledWith(SOURCE);
    expect(preparePipelineDeployTx).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccount: SOURCE,
        deploymentId: "deployment",
        nodes: [
          expect.objectContaining({ templateKind: "DEPOSIT_TRIGGER" }),
          expect.objectContaining({ templateKind: "PAYER" }),
        ],
      }),
    );
    expect(mockDb.deployment.create).toHaveBeenCalledOnce();
    expect(mockDb.deployment.update).toHaveBeenCalledWith({
      where: { id: "deployment" },
      data: expect.objectContaining({ status: "PENDING_SIGNATURE" }),
    });
    expect(savedFlow).toEqual(original);
  });
});
