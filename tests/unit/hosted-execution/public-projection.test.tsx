import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.find } } }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/components/deploy/hosted-payment-form", () => ({ default: () => null }));
vi.mock("@/app/trigger/[deploymentId]/trigger-client", () => ({ default: () => null }));
import TriggerPage from "@/app/trigger/[deploymentId]/page";
import { publicPayment } from "@/lib/deployments/public-embed";
import { deploymentId, root } from "./fixtures";
const source = {
  id: deploymentId,
  network: "testnet",
  status: "CONFIRMED",
  serviceState: "ACTIVE",
  hostedExecutionEnabled: true,
  contractAddress: root,
  graphSnapshot: { fieldPolicies: { version: 1, nodes: [] }, email: "private@example.test" },
  pipelineSnapshot: [{ templateKind: "DEPOSIT_TRIGGER" }],
  flow: { name: "Private name", templateKind: "SPLITTER" },
  ownerId: "owner",
  webhookSecret: "secret",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(source);
});
describe("hosted server-page projection", () => {
  it("passes only explicit public form identity and opted-in display name", async () => {
    const page = await TriggerPage({ params: Promise.resolve({ deploymentId }) });
    expect(page.props).toEqual({
      deploymentId,
      flowName: "Private name",
      network: "testnet",
      enabled: true,
    });
    expect(JSON.stringify(page.props)).not.toContain("private@example.test");
    expect(JSON.stringify(page.props)).not.toContain("secret");
  });
  it.each(["disabled", "retiring", "retired"])(
    "retains receipt recovery but publishes no name or active form when %s",
    async (kind) => {
      mocks.find.mockResolvedValue({
        ...source,
        hostedExecutionEnabled: false,
        serviceState: kind === "retiring" ? "RETIRING" : kind === "retired" ? "RETIRED" : "ACTIVE",
      });
      const page = await TriggerPage({ params: Promise.resolve({ deploymentId }) });
      expect(page.props).toEqual({
        deploymentId,
        flowName: "Payment receipt",
        network: "testnet",
        enabled: false,
      });
    },
  );
  it("does not advertise a policy form through embed unless explicitly enabled", () => {
    expect(publicPayment(source)).toEqual({ path: `/trigger/${deploymentId}`, mode: "pay" });
    expect(publicPayment({ ...source, hostedExecutionEnabled: false })).toBeNull();
  });
});
