import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type BuilderClient from "@/components/builder/builder-client";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
import { FlowGraphSchema } from "@/lib/flows/schema";

const mocks = vi.hoisted(() => ({
  flow: vi.fn(),
  hash: vi.fn(),
  builder: vi.fn(),
  trustlines: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    flow: { findFirst: mocks.flow },
    user: { findUnique: async () => ({ email: "owner@example.com" }) },
  },
}));
vi.mock("@/lib/auth", () => ({
  requirePageSession: async () => ({ id: "owner", username: "Owner", role: "USER" }),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ STELLAR_NETWORK: "testnet" }),
  soroswapRouterAddress: () => undefined,
}));
vi.mock("@/lib/features", () => ({
  serverFeatures: () => ({ aiAssistant: false, oracleCondition: true }),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHash: mocks.hash }));
vi.mock("@/lib/stellar/trustline-check", () => ({ checkPayoutTrustlines: mocks.trustlines }));
vi.mock("@/components/app/topbar", () => ({ default: () => <div>Topbar</div> }));
vi.mock("@/components/builder/builder-client", () => ({
  default: (props: ComponentProps<typeof BuilderClient>) => {
    mocks.builder(props);
    return <div>Draft editor</div>;
  },
}));
vi.mock("@/components/deploy/deploy-review", () => ({
  default: () => <div>Wallet deployment review</div>,
}));
import FlowBuilderPage from "@/app/flows/[flowId]/page";
import DeployReviewPage from "@/app/flows/[flowId]/deploy/page";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function graph(explicit = true) {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: explicit ? "" : ADDRESS, fullAmount: true },
      },
    ],
    edges: [{ id: "edge", source: "receive", target: "pay" }],
    ...(explicit
      ? {
          fieldPolicies: {
            version: 1,
            nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution" }],
          },
        }
      : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.flow.mockResolvedValue({ id: "flow", name: "Payments", graph: graph() });
  mocks.hash.mockResolvedValue("a".repeat(64));
  mocks.trustlines.mockResolvedValue([]);
});
describe("builder and deployment artifact readiness", () => {
  it("passes readiness from resolved reviewed hashes instead of inferring capability from the graph", async () => {
    mocks.hash.mockImplementation(
      async (kind: keyof typeof EXECUTION_V1_WASM_HASHES) => EXECUTION_V1_WASM_HASHES[kind],
    );
    render(await FlowBuilderPage({ params: Promise.resolve({ flowId: "flow" }) }));
    expect(mocks.builder.mock.lastCall![0].executionArtifacts).toEqual({
      receive: true,
      pay: true,
      split: true,
    });
    expect(mocks.hash).toHaveBeenCalledWith("DEPOSIT_TRIGGER");
    expect(mocks.hash).toHaveBeenCalledWith("PAYER");
    expect(mocks.hash).toHaveBeenCalledWith("SPLITTER");
    expect(mocks.flow).toHaveBeenCalledWith({ where: { id: "flow", ownerId: "owner" } });
  });

  it("withholds policy deployment when resolved artifacts are legacy while retaining the draft summary", async () => {
    render(await DeployReviewPage({ params: Promise.resolve({ flowId: "flow" }) }));
    expect(screen.queryByText("Wallet deployment review")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("not ready to deploy");
    expect(screen.getByText(/Every declared input is required for each payment/)).toBeTruthy();
    expect(mocks.trustlines).toHaveBeenCalledWith([]);
  });

  it("offers policy review only for every participating reviewed artifact and does not require an unused kind", async () => {
    mocks.hash.mockImplementation(async (kind: keyof typeof EXECUTION_V1_WASM_HASHES) =>
      kind === "SPLITTER" ? undefined : EXECUTION_V1_WASM_HASHES[kind],
    );
    render(await DeployReviewPage({ params: Promise.resolve({ flowId: "flow" }) }));
    expect(screen.getByText("Wallet deployment review")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not gate or reinterpret legacy mode-less deployment", async () => {
    mocks.flow.mockResolvedValue({ id: "flow", name: "Legacy", graph: graph(false) });
    render(await DeployReviewPage({ params: Promise.resolve({ flowId: "flow" }) }));
    expect(screen.getByText("Wallet deployment review")).toBeTruthy();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.trustlines.mock.lastCall![0]).toEqual([
      { nodeId: "pay", address: ADDRESS, asset: { kind: "native" } },
    ]);
  });
});
