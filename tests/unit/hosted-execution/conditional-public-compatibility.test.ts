import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { publicPayment, projectPublicEmbed } from "@/lib/deployments/public-embed";
const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  qr: vi.fn(),
  deposit: vi.fn(),
  distribute: vi.fn(),
  sep7: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: m.findFirst } } }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/deployments/service-route", () => ({ deploymentServiceRoute: (fn: unknown) => fn }));
vi.mock("@/lib/stellar/interactive-rpc-budget", () => ({
  withInteractiveRpcBudget: (fn: () => unknown) => fn(),
}));
vi.mock("qrcode", () => ({ default: { toString: m.qr, toBuffer: m.qr } }));
vi.mock("@/lib/stellar/invoke", () => ({
  prepareDepositInvocation: m.deposit,
  prepareDistributeTx: m.distribute,
}));
vi.mock("@/lib/stellar/sep7", () => ({ sep7PaymentUri: m.sep7 }));
import { GET } from "@/app/api/deployments/[id]/qr/route";
const id = "12281228-1228-4228-8228-122812281228";
const row = {
  id,
  status: "CONFIRMED",
  network: "testnet",
  serviceState: "ACTIVE",
  ownerId: "owner",
  contractAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  hostedExecutionEnabled: true,
  flow: { templateKind: "ROUTER" },
  pipelineSnapshot: [{ templateKind: "DEPOSIT_TRIGGER" }],
  graphSnapshot: { generation: "conditional-v2", nodes: [], edges: [] },
  paramsSnapshot: { generation: "conditional-v2", version: 2 },
  events: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  m.findFirst.mockResolvedValue(row);
});
it.each(["pay", "invoke", "trigger", "allowance"])(
  "refuses legacy QR %s before constructing asset or invocation",
  async (action) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/deployments/${id}/qr?action=${action}`),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(422);
    for (const f of [m.deposit, m.distribute, m.sep7, m.qr]) expect(f).not.toHaveBeenCalled();
  },
);
it("refuses unknown declared generation even when graph looks old", async () => {
  m.findFirst.mockResolvedValue({
    ...row,
    graphSnapshot: { nodes: [], edges: [] },
    paramsSnapshot: { version: 3 },
  });
  expect(
    (
      await GET(new NextRequest(`http://localhost/api/deployments/${id}/qr`), {
        params: Promise.resolve({ id }),
      })
    ).status,
  ).toBe(422);
});
it("does not advertise a legacy embedded payment from conditional Receive", () => {
  expect(publicPayment(row)).toBeNull();
  expect(publicPayment({ ...row, hostedExecutionEnabled: false })).toBeNull();
  expect(projectPublicEmbed(row)).toBeNull();
});
it("retains immediate ordinary projection and SEP7", async () => {
  const legacy = {
    ...row,
    graphSnapshot: { nodes: [], edges: [] },
    paramsSnapshot: [],
    flow: { templateKind: "SPLITTER" },
  };
  expect(publicPayment(legacy)).toEqual({ path: `/trigger/${id}`, mode: "pay" });
  m.findFirst.mockResolvedValue(legacy);
  m.sep7.mockReturnValue("web+stellar:pay?destination=synthetic");
  m.qr.mockResolvedValue("<svg />");
  expect(
    (
      await GET(new NextRequest(`http://localhost/api/deployments/${id}/qr`), {
        params: Promise.resolve({ id }),
      })
    ).status,
  ).toBe(200);
  expect(m.sep7).toHaveBeenCalledOnce();
});
