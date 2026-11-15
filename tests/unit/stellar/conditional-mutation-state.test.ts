import { beforeEach, describe, expect, it, vi } from "vitest";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
const mock = vi.hoisted(() => ({ current: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/stellar/conditional-execution-state", () => ({
  readConditionalExecutionState: mock.current,
}));
vi.mock("@/lib/mutations/conditional-history", () => ({
  recordConditionalConfigurationObservations: mock.record,
}));
import { readConditionalMutationState } from "@/lib/stellar/conditional-mutation-state";
beforeEach(() => {
  vi.clearAllMocks();
});
describe("conditional mutation current state", () => {
  it("uses one fenced graph read including inactive debt and records all immutable and mutable states", async () => {
    const fixture = conditionalDeploymentFixture();
    const current = {
      version: 2,
      supported: true,
      deploymentId: fixture.deployment.id,
      network: "testnet",
      policyVersion: 2,
      definition: fixture.plan.definition,
      nodes: fixture.plan.bindings,
      confirmedLedger: 20,
      statuses: fixture.plan.manifest.nodes.map(({ state }, i) => ({
        state,
        obligationsStroops: i === 3 ? "40" : "0",
      })),
    };
    mock.current.mockResolvedValue(current);
    const finalRead = vi.fn();
    const state = await readConditionalMutationState(fixture.deployment, finalRead);
    expect(state.mutationSupported).toBe(true);
    expect(state.statuses[3]!.obligationsStroops).toBe("40");
    expect(mock.current).toHaveBeenCalledWith(fixture.deployment, { finalRead });
    expect(mock.record).toHaveBeenCalledOnce();
    expect(mock.record).toHaveBeenCalledWith(
      fixture.deployment.id,
      current.statuses.map(({ state }) => state),
      20,
    );
  });
  it("never falls back to history on unsupported or failed current evidence", async () => {
    const { deployment } = conditionalDeploymentFixture();
    mock.current.mockResolvedValue({ supported: false });
    await expect(readConditionalMutationState(deployment)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    mock.current.mockRejectedValue(new Error("RPC unavailable"));
    await expect(readConditionalMutationState(deployment)).rejects.toThrow("RPC unavailable");
    expect(mock.record).not.toHaveBeenCalled();
  });
});
