import { describe, expect, it } from "vitest";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import { DeploymentCapabilitiesSchema } from "@/lib/api/v1/schema";
import { conditionalAcceptancePlan } from "@/tests/fixtures/conditional-v2-acceptance";

const plan = conditionalAcceptancePlan();
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "CONFIRMED" as const,
  network: "testnet",
  graphSnapshot: {},
  pipelineSnapshot: plan.nodes.map((node) => ({
    nodeId: node.nodeId,
    contractAddress: node.initialState.contractAddress,
    templateKind: node.templateKind,
  })),
  webhookSecret: null,
};
describe("conditional default capability hints", () => {
  it.each([
    { version: 2, generation: "conditional-v2" },
    { version: 2 },
    { generation: "malformed" },
    { version: 99 },
  ])("does not infer default execution support from declaration %o", (paramsSnapshot) => {
    const capabilities = deploymentCapabilities({ ...deployment, paramsSnapshot });
    expect(capabilities.operations.execute.status).toBe("unsupported");
    expect(capabilities.operations.execute.requirements.join(" ")).toContain(
      "/execution?version=2",
    );
    expect(DeploymentCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  });
  it("keeps mode-less legacy deposit hints unchanged", () => {
    expect(
      deploymentCapabilities({ ...deployment, paramsSnapshot: [] }).operations.execute.status,
    ).toBe("supported");
  });
});
