import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  session: vi.fn(),
  eligibility: vi.fn(),
  hosted: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.find } } }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("@/lib/hosted-execution/conditional-service", () => ({
  assertConditionalHostedDeployment: mocks.eligibility,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/app/topbar", () => ({ default: () => null }));
vi.mock("@/components/deploy/retirement-panel", () => ({ default: () => null }));
vi.mock("@/components/deploy/api-access-panel", () => ({ default: () => null }));
vi.mock("@/components/deploy/configuration-panel", () => ({ default: () => null }));
vi.mock("@/components/deploy/conditional-owner-view", () => ({ default: () => null }));
vi.mock("@/components/deploy/deployment-view", () => ({ default: () => null }));
vi.mock("@/components/deploy/hosted-execution-panel", () => ({
  default: (props: unknown) => {
    mocks.hosted(props);
    return null;
  },
}));
import DeploymentPage from "@/app/deployments/[deploymentId]/page";
let fixture: ReturnType<typeof conditionalDeploymentFixture>, deployment: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  fixture = conditionalDeploymentFixture(true);
  const graph = ConditionalCanvasSchema.parse({
    generation: "conditional-v2",
    nodes: [],
    edges: [],
    conditionalPolicies: { version: 2, nodes: [] },
  });
  deployment = {
    ...fixture.deployment,
    graphSnapshot: graph,
    contractAddress: fixture.plan.manifest.rootContract,
    createdAt: new Date(),
    serviceState: "ACTIVE",
    hostedExecutionEnabled: false,
    flow: { name: "Owner flow", templateKind: "ROUTER" },
    events: [],
  };
  mocks.find.mockImplementation(async () => deployment);
  mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "USER" });
  mocks.eligibility.mockImplementation(() => {});
});
afterEach(cleanup);
describe("conditional owner hosted opt-in", () => {
  it("selects version2 only for owned confirmed metadata-verified conditional deployment", async () => {
    render(
      await DeploymentPage({ params: Promise.resolve({ deploymentId: fixture.deployment.id }) }),
    );
    expect(mocks.eligibility).toHaveBeenCalledWith(deployment);
    expect(mocks.hosted.mock.calls[0]![0]).toEqual({
      deploymentId: fixture.deployment.id,
      initialEnabled: false,
      conditional: true,
    });
    expect(mocks.find.mock.calls[0]![0].where).toMatchObject({
      ownerId: "owner",
      serviceState: { not: "RETIRED" },
    });
  });
  it.each(["sandbox", "metadata", "pending"])("keeps %s opt-in unavailable", async (reason) => {
    if (reason === "sandbox")
      mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "SANDBOX" });
    if (reason === "metadata")
      mocks.eligibility.mockImplementation(() => {
        throw new Error("unsupported");
      });
    if (reason === "pending") deployment.status = "PENDING";
    render(
      await DeploymentPage({ params: Promise.resolve({ deploymentId: fixture.deployment.id }) }),
    );
    expect(mocks.hosted).not.toHaveBeenCalled();
  });
});
