import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.findFirst } } }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/stellar/trustline-check", () => ({
  checkPayoutTrustlines: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/app/trigger/[deploymentId]/trigger-client", () => ({
  default: function LegacyTrigger() {
    return <div>Legacy form</div>;
  },
}));
vi.mock("@/components/deploy/hosted-payment-form", () => ({
  default: function V1Hosted() {
    return <div>V1 form</div>;
  },
}));
import TriggerPage from "@/app/trigger/[deploymentId]/page";
const id = "12271227-1227-4227-8227-122712271227";
const address = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const base = {
  id,
  network: "testnet",
  status: "CONFIRMED",
  serviceState: "ACTIVE",
  hostedExecutionEnabled: true,
  contractAddress: address,
  flow: { name: "Original", templateKind: "ROUTER" },
  pipelineSnapshot: [
    { templateKind: "DEPOSIT_TRIGGER", nodeId: "receive", contractAddress: address },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
});
it.each([
  { graphSnapshot: { generation: "conditional-v2", nodes: [], edges: [] }, paramsSnapshot: [] },
  {
    graphSnapshot: { nodes: [], edges: [] },
    paramsSnapshot: { version: 2, generation: "conditional-v2" },
  },
  { graphSnapshot: { nodes: [], edges: [] }, paramsSnapshot: { version: 3 } },
])(
  "refuses explicit conditional/unknown generation before legacy form fallback",
  async (evidence) => {
    mocks.findFirst.mockResolvedValue({ ...base, ...evidence });
    await expect(TriggerPage({ params: Promise.resolve({ deploymentId: id }) })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  },
);
it("retains ordinary legacy form eligibility", async () => {
  mocks.findFirst.mockResolvedValue({
    ...base,
    graphSnapshot: { nodes: [], edges: [] },
    paramsSnapshot: [],
  });
  const page = await TriggerPage({ params: Promise.resolve({ deploymentId: id }) });
  expect(page.props.deploymentId).toBe(id);
  expect(mocks.notFound).not.toHaveBeenCalled();
});

it("retains explicit v1 hosted eligibility", async () => {
  mocks.findFirst.mockResolvedValue({
    ...base,
    graphSnapshot: { nodes: [], edges: [], fieldPolicies: { version: 1, nodes: [] } },
    paramsSnapshot: [],
  });
  const page = await TriggerPage({ params: Promise.resolve({ deploymentId: id }) });
  expect(page.props.deploymentId).toBe(id);
  expect(page.props.enabled).toBe(true);
  expect(mocks.notFound).not.toHaveBeenCalled();
});
