import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { ComponentProps } from "react";
import type ApiAccessPanel from "@/components/deploy/api-access-panel";
import type DeploymentView from "@/components/deploy/deployment-view";

const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  session: vi.fn(),
  panel: vi.fn(),
  overview: vi.fn(),
  devModeEnabled: true,
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.deployment } } }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("@/lib/env", () => ({
  env: () => ({
    STELLAR_NETWORK: "testnet",
    LOG_LEVEL: "silent",
    FEATURE_DEV_MODE_ENABLED: mocks.devModeEnabled,
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/components/app/topbar", () => ({ default: () => <div>Topbar</div> }));
vi.mock("@/components/deploy/deployment-view", () => ({
  default: (props: ComponentProps<typeof DeploymentView>) => {
    mocks.overview(props);
    return <div>Overview</div>;
  },
}));
vi.mock("@/components/deploy/api-access-panel", () => ({
  default: (props: ComponentProps<typeof ApiAccessPanel>) => {
    mocks.panel(props);
    return <div>Integration panel</div>;
  },
}));

import DeploymentPage from "@/app/deployments/[deploymentId]/page";

const id = "00000000-0000-4000-8000-000000000000";
const address = StrKey.encodeContract(Buffer.alloc(32, 1));
const params = Promise.resolve({ deploymentId: id });
function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "CONFIRMED",
    network: "testnet",
    contractAddress: address,
    createdAt: new Date(),
    graphSnapshot: {
      nodes: [
        { id: "trigger", type: "web2_webhook", config: { asset: { kind: "native" } } },
        {
          id: "pay",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2)),
            fullAmount: true,
          },
        },
      ],
      edges: [{ id: "e", source: "trigger", target: "pay" }],
    },
    pipelineSnapshot: [{ nodeId: "trigger", contractAddress: address, templateKind: "WEBHOOK" }],
    webhookSecret: "synthetic-webhook-secret",
    flow: { name: "Rewards", templateKind: "WEBHOOK" },
    events: [],
    errorMessage: null,
    ...overrides,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.devModeEnabled = true;
  mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "USER" });
  mocks.deployment.mockResolvedValue(deployment());
});

describe("owner deployment integration panel", () => {
  it("removes Dev configuration while retaining the overview and API panel", async () => {
    mocks.devModeEnabled = false;
    render(await DeploymentPage({ params }));
    expect(mocks.overview.mock.calls[0]![0]).toMatchObject({
      canEditDevValues: false,
      devModeEnabled: false,
    });
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Integration panel")).toBeTruthy();
  });
  it("uses the owner guard, passes capabilities without a token and keeps funding in the overview", async () => {
    render(await DeploymentPage({ params }));
    expect(mocks.session).toHaveBeenCalled();
    expect(mocks.deployment.mock.calls[0]![0].where).toEqual({ id, ownerId: "owner" });
    const props = mocks.panel.mock.calls[0]![0];
    expect(props.capabilities.triggerType).toBe("webhook");
    expect(props.capabilities.operations.execute.status).toBe("unsupported");
    expect(props.webhookSecret).toBe("synthetic-webhook-secret");
    expect(JSON.stringify(props.capabilities)).not.toContain("synthetic-webhook-secret");
    expect(mocks.overview.mock.calls[0]![0].qrUrl).toBe(`/api/deployments/${id}/qr?action=trigger`);
    expect(mocks.overview.mock.calls[0]![0]).not.toHaveProperty("webhookSecret");
  });

  it("refuses a deployment not returned by the owner-scoped lookup", async () => {
    mocks.deployment.mockResolvedValue(null);
    await expect(DeploymentPage({ params })).rejects.toThrow("not-found");
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it.each(["SANDBOX", "PENDING"])("keeps the panel unavailable for %s", async (state) => {
    if (state === "SANDBOX")
      mocks.session.mockResolvedValue({ id: "owner", username: "Owner", role: "SANDBOX" });
    else mocks.deployment.mockResolvedValue(deployment({ status: state }));
    render(await DeploymentPage({ params }));
    expect(screen.queryByText("Integration panel")).toBeNull();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(mocks.overview.mock.calls[0]![0]).not.toHaveProperty("webhookSecret");
  });

  it("keeps the overview available when the deployment belongs to another network", async () => {
    mocks.deployment.mockResolvedValue(deployment({ network: "mainnet" }));
    render(await DeploymentPage({ params }));
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(mocks.panel.mock.calls[0]![0].capabilities).toBeNull();
  });
});
