vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  session: vi.fn(),
  configuration: vi.fn(),
  conditional: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.deployment } } }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/app/topbar", () => ({ default: () => null }));
vi.mock("@/components/deploy/retirement-panel", () => ({ default: () => null }));
vi.mock("@/components/deploy/api-access-panel", () => ({ default: () => null }));
vi.mock("@/components/deploy/hosted-execution-panel", () => ({
  default: () => {
    throw new Error("Legacy payment controls must not activate");
  },
}));
vi.mock("@/components/deploy/configuration-panel", () => ({
  default: (props: unknown) => {
    mocks.configuration(props);
    return <div>Conditional configuration editor</div>;
  },
}));
vi.mock("@/components/deploy/conditional-owner-view", () => ({
  default: (props: unknown) => {
    mocks.conditional(props);
    return <div>Conditional initial evidence and activity</div>;
  },
}));
vi.mock("@/components/deploy/deployment-view", () => ({
  default: (props: unknown) => {
    mocks.legacy(props);
    return null;
  },
}));
import DeploymentPage from "@/app/deployments/[deploymentId]/page";
let fixture: ReturnType<typeof conditionalDeploymentFixture>;
let graph: ReturnType<typeof ConditionalCanvasSchema.parse>;
function deployment(overrides: Record<string, unknown> = {}) {
  return {
    ...fixture.deployment,
    graphSnapshot: graph,
    contractAddress: fixture.plan.manifest.rootContract,
    createdAt: new Date(),
    serviceState: "ACTIVE",
    flow: { name: "Conditional owner flow", templateKind: "ROUTER" },
    events: [
      {
        id: "evt",
        eventId: "evt",
        kind: "STATUS_CHANGE",
        ledger: 100,
        txHash: "aa".repeat(32),
        payload: {},
        decodedData: { route: { selectedBranch: "false" } },
        occurredAt: new Date(),
      },
    ],
    ...overrides,
  };
}
const params = () => Promise.resolve({ deploymentId: fixture.deployment.id });
beforeEach(() => {
  vi.clearAllMocks();
  fixture = conditionalDeploymentFixture(true);
  graph = ConditionalCanvasSchema.parse({
    generation: "conditional-v2",
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "50" } },
    ],
    edges: [],
    conditionalPolicies: {
      version: 2,
      nodes: [],
      condition: { nodeId: "condition", thresholdMode: "mutable" },
    },
  });
  mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "USER" });
  mocks.deployment.mockImplementation(async () => deployment());
});
afterEach(cleanup);
describe("conditional owner page activation and evidence", () => {
  it("enables threshold-only editing and preserves complete original terms/addresses and financial event evidence", async () => {
    render(await DeploymentPage({ params: params() }));
    expect(screen.getByText("Conditional configuration editor")).toBeTruthy();
    expect(mocks.configuration.mock.calls[0]![0]).toMatchObject({
      deploymentId: fixture.deployment.id,
      initialGraph: graph,
    });
    expect(mocks.conditional.mock.calls[0]![0]).toMatchObject({
      original: fixture.paramsSnapshot,
      initialEvents: [{ eventId: "evt", kind: "STATUS_CHANGE" }],
    });
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.deployment.mock.calls[0]![0].where).toMatchObject({
      ownerId: "owner",
      serviceState: { not: "RETIRED" },
    });
  });
  it.each(["sandbox", "network", "pending", "constant"])(
    "refuses editor activation for %s while retaining owner evidence",
    async (reason) => {
      if (reason === "sandbox")
        mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "SANDBOX" });
      if (reason === "constant") graph.conditionalPolicies.condition!.thresholdMode = "constant";
      mocks.deployment.mockImplementation(async () =>
        deployment(
          reason === "network"
            ? { network: "mainnet" }
            : reason === "pending"
              ? { status: "PENDING" }
              : {},
        ),
      );
      render(await DeploymentPage({ params: params() }));
      expect(mocks.configuration).not.toHaveBeenCalled();
      expect(mocks.conditional).toHaveBeenCalled();
    },
  );
  it("rejects missing or mismatched immutable original envelopes instead of rendering legacy fallback", async () => {
    for (const changed of [{ paramsSnapshot: [] }, { sourceAccount: "foreign" }]) {
      mocks.deployment.mockResolvedValue(deployment(changed));
      await expect(DeploymentPage({ params: params() })).rejects.toThrow("not-found");
    }
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
});
