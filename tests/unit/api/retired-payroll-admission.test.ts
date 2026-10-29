import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { findUnique, withDeploymentWork } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  withDeploymentWork: vi.fn(async (_id: string, _kind: string, fn: () => Promise<Response>) =>
    fn(),
  ),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findUnique } } }));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "local",
  enforceRateLimit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/deployments/service-work", () => ({ withDeploymentWork }));
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
const id = "11111111-1111-4111-8111-111111111111";
describe("generic deployment submission refuses retired payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it.each([
    { flow: { templateKind: "PAYROLL" } },
    {
      graphSnapshot: { nodes: [{ type: "payroll" }] },
      pipelineSnapshot: [{ templateKind: "SUBSCRIPTION" }],
    },
    { paramsSnapshot: [{ params: { kind: "payroll_trigger" } }] },
    { pipelineSnapshot: [{ templateKind: "PAYROLL" }] },
  ])(
    "never enters the public submit handler for retired recorded instructions: %j",
    async (recorded) => {
      findUnique.mockResolvedValue(recorded);
      const submit = vi.fn(async () => Response.json({ data: "submitted" }));
      const response = await deploymentServiceRoute(submit, "public")(
        new NextRequest(`https://app.example/api/deployments/${id}/submit-invoke`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(404);
      expect(submit).not.toHaveBeenCalled();
      expect(withDeploymentWork).not.toHaveBeenCalled();
    },
  );
  it("keeps ordinary public submissions available", async () => {
    findUnique.mockResolvedValue({
      graphSnapshot: { nodes: [{ type: "subscription" }] },
      pipelineSnapshot: [{ templateKind: "SUBSCRIPTION" }],
    });
    const submit = vi.fn(async () => Response.json({ data: "submitted" }));
    expect(
      (
        await deploymentServiceRoute(submit)(
          new NextRequest(`https://app.example/api/deployments/${id}/submit-invoke`),
          { params: Promise.resolve({ id }) },
        )
      ).status,
    ).toBe(200);
    expect(submit).toHaveBeenCalledOnce();
  });
});

it("permits explicitly read-only retired history without admitting financial work", async () => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ flow: { templateKind: "PAYROLL" } });
  const history = vi.fn(async () => Response.json({ data: { events: ["retained"] } }));
  const response = await deploymentServiceRoute(history, "public", { allowRetiredHistory: true })(
    new NextRequest(`https://app.example/api/deployments/${id}/events`),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  expect(history).toHaveBeenCalledOnce();
  expect(withDeploymentWork).not.toHaveBeenCalled();
});
it("history permission never permits a retired mutation", async () => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ flow: { templateKind: "PAYROLL" } });
  const submit = vi.fn(async () => Response.json({ data: "unsafe" }));
  const response = await deploymentServiceRoute(submit, "public", { allowRetiredHistory: true })(
    new NextRequest(`https://app.example/api/deployments/${id}/submit`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(404);
  expect(submit).not.toHaveBeenCalled();
  expect(withDeploymentWork).not.toHaveBeenCalled();
});
