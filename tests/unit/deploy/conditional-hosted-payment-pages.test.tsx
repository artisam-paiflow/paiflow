import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  eligibility: vi.fn(),
  hosted: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.find } } }));
vi.mock("@/lib/hosted-execution/conditional-service", () => ({
  assertConditionalHostedDeployment: mocks.eligibility,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/components/deploy/hosted-payment-form", () => ({
  default: (props: unknown) => {
    mocks.hosted(props);
    return null;
  },
}));
vi.mock("@/app/trigger/[deploymentId]/trigger-client", () => ({
  default: () => {
    mocks.legacy();
    return null;
  },
}));
vi.mock("@/lib/stellar/trustline-check", () => ({ checkPayoutTrustlines: vi.fn() }));
import TriggerPage from "@/app/trigger/[deploymentId]/page";
const id = "12281228-1228-4228-8228-122812281228";
let deployment: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  deployment = {
    id,
    status: "CONFIRMED",
    network: "testnet",
    serviceState: "ACTIVE",
    hostedExecutionEnabled: true,
    flow: { name: "PRIVATE_FLOW_CANARY", templateKind: "ROUTER" },
    paramsSnapshot: { version: 2, generation: "conditional-v2" },
    graphSnapshot: { generation: "conditional-v2" },
    pipelineSnapshot: [{ templateKind: "DEPOSIT_TRIGGER" }],
  };
  mocks.find.mockImplementation(async () => deployment);
  mocks.eligibility.mockImplementation(() => {});
});
afterEach(cleanup);
describe("conditional hosted trigger page", () => {
  it("routes metadata-verified generation to the one form explicitly", async () => {
    render(await TriggerPage({ params: Promise.resolve({ deploymentId: id }) }));
    expect(mocks.eligibility).toHaveBeenCalledWith(deployment);
    expect(mocks.hosted.mock.calls[0]![0]).toEqual({
      deploymentId: id,
      flowName: "PRIVATE_FLOW_CANARY",
      network: "testnet",
      enabled: true,
      conditional: true,
    });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each(["disabled", "retiring", "retired"])(
    "retains generic receipt access without private name when %s",
    async (reason) => {
      if (reason === "disabled") deployment.hostedExecutionEnabled = false;
      else deployment.serviceState = reason.toUpperCase();
      const page = await TriggerPage({ params: Promise.resolve({ deploymentId: id }) });
      expect(page.props).toEqual({
        deploymentId: id,
        flowName: "Payment receipt",
        network: "testnet",
        enabled: false,
        conditional: true,
      });
      expect(JSON.stringify(page.props)).not.toContain("PRIVATE_FLOW_CANARY");
      expect(mocks.legacy).not.toHaveBeenCalled();
    },
  );
  it("refuses malformed metadata before any legacy fallback", async () => {
    mocks.eligibility.mockImplementation(() => {
      throw new Error("unsupportedmetadata");
    });
    await expect(TriggerPage({ params: Promise.resolve({ deploymentId: id }) })).rejects.toThrow(
      "not-found",
    );
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.hosted).not.toHaveBeenCalled();
  });
});
