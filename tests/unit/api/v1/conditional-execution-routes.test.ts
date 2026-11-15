import type { Deployment } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conditionalAcceptanceIntent,
  conditionalAcceptancePlan,
} from "@/tests/fixtures/conditional-v2-acceptance";

const mocks = vi.hoisted(() => ({
  state1: vi.fn(),
  state2: vi.fn(),
  prepare1: vi.fn(),
  prepare2: vi.fn(),
  submit1: vi.fn(),
  submit2: vi.fn(),
  audit: vi.fn(),
  control: vi.fn(),
  reconcile: vi.fn(),
  status: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("@/lib/api/v1/handler", () => ({
  v1Route: (_options: unknown, callback: unknown) => callback,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/api/request-history/context", () => ({ linkApiTransaction: vi.fn() }));
vi.mock("@/lib/api/v1/execution-payments", () => ({
  prepareExecutionPayment: mocks.prepare1,
  submitExecutionPayment: mocks.submit1,
}));
vi.mock("@/lib/api/v1/conditional-execution-payments", () => ({
  prepareConditionalExecutionPayment: mocks.prepare2,
  submitConditionalExecutionPayment: mocks.submit2,
}));
vi.mock("@/lib/stellar/execution-state", () => ({ readExecutionState: mocks.state1 }));
vi.mock("@/lib/stellar/conditional-execution-state", () => ({
  readConditionalExecutionState: mocks.state2,
}));
vi.mock("@/lib/stellar/trigger", () => ({ prepareTriggerTx: mocks.legacy }));
vi.mock("@/lib/stellar/submit-deposit", () => ({ submitPreparedDeposit: mocks.legacy }));
vi.mock("@/lib/api/v1/execution-intent", () => ({
  executionIdempotencyKey: (value: unknown) => value,
}));
vi.mock("@/lib/api/v1/control-intent", () => ({
  readControlIntent: mocks.control,
  reconcileControlIntent: mocks.reconcile,
}));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: mocks.status }));
import { GET as discover } from "@/app/api/v1/deployments/[id]/execution/route";
import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { POST as reconcile } from "@/app/api/v1/deployments/[id]/execute/reconcile/route";

const execution = conditionalAcceptanceIntent();
const deployment = {
  id: execution.deploymentId,
  ownerId: "11111111-1111-4111-8111-111111111111",
  network: "testnet",
  status: "CONFIRMED",
  paramsSnapshot: { version: 2, generation: "conditional-v2" },
  graphSnapshot: {},
  pipelineSnapshot: conditionalAcceptancePlan().nodes.map((node) => ({
    nodeId: node.nodeId,
    templateKind: node.templateKind,
    contractAddress: node.initialState.contractAddress,
  })),
} as unknown as Deployment;
const intent = "11111111-1111-4111-8111-111111111111";
async function run(handler: unknown, query = "", body: unknown = undefined, selected = deployment) {
  const callback = handler as (context: Record<string, unknown>) => Promise<Response>;
  const req = new Request(
    `https://app.invalid/api/v1/deployments/${selected.id}/execution${query}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "key" },
          body: JSON.stringify(body),
        },
  );
  return callback({
    req,
    params: { id: selected.id },
    deployment: selected,
    token: { id: "token" },
    tokenType: "deployment",
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state1.mockResolvedValue({ supported: true, policyVersion: 1 });
  mocks.state2.mockResolvedValue({ supported: true, policyVersion: 2 });
  mocks.prepare1.mockResolvedValue({ intent, txHash: "ab".repeat(32), execution: { version: 1 } });
  mocks.prepare2.mockResolvedValue({ intent, txHash: "cd".repeat(32), execution });
  mocks.submit1.mockResolvedValue({ txHash: "ab".repeat(32), status: "PENDING" });
  mocks.submit2.mockResolvedValue({ txHash: "cd".repeat(32), status: "PENDING" });
  mocks.control.mockResolvedValue({
    id: intent,
    txHash: "cd".repeat(32),
    executionIntent: execution,
  });
  mocks.reconcile.mockResolvedValue({ id: intent, txHash: "cd".repeat(32), state: "PREPARED" });
  mocks.status.mockResolvedValue({ txHash: "cd".repeat(32), status: "UNKNOWN" });
});

describe("explicit conditional partner execution dispatch", () => {
  it("returns old unsupported discovery by default instead of leaking a v2 shape", async () => {
    const response = await run(discover);
    expect((await response.json()).data).toMatchObject({ supported: false, policyVersion: 0 });
    expect(mocks.state1).not.toHaveBeenCalled();
    expect(mocks.state2).not.toHaveBeenCalled();
  });
  it("only returns a conditional discovery after explicit opt-in", async () => {
    const response = await run(discover, "?version=2");
    expect((await response.json()).data).toEqual({ supported: true, policyVersion: 2 });
    expect(mocks.state2).toHaveBeenCalledWith(deployment);
    expect(mocks.state1).not.toHaveBeenCalled();
  });
  it.each(["?version=1", "", "?version=3", "?version=2&version=2"])(
    "refuses implicit/unknown/multiple generation prepare %s without legacy fallback",
    async (query) => {
      await expect(
        run(prepare, query, {
          from: execution.payer,
          amount: "111",
          arguments: execution.arguments,
        }),
      ).rejects.toThrow();
      expect(mocks.prepare2).not.toHaveBeenCalled();
      expect(mocks.prepare1).not.toHaveBeenCalled();
      expect(mocks.legacy).not.toHaveBeenCalled();
    },
  );
  it("requires explicit v2 arguments and preserves payer/body/key on preparation", async () => {
    const body = { from: execution.payer, amount: "111", arguments: execution.arguments };
    expect((await (await run(prepare, "?version=2", body)).json()).data.execution.version).toBe(2);
    expect(mocks.prepare2).toHaveBeenCalledWith(deployment, body, "key");
    await expect(
      run(prepare, "?version=2", { ...body, arguments: { version: 1, inputs: [] } }),
    ).rejects.toThrow();
  });
  it("retains optional original-id/hash lookup shape with explicit v2 submit and waiting policy", async () => {
    await run(submit, "?version=2&wait=false", { signedXdr: "signed-fixture-xx" });
    expect(mocks.submit2).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment,
        intent: undefined,
        signedXdr: "signed-fixture-xx",
        wait: false,
      }),
    );
    expect(mocks.submit1).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
    await expect(run(submit, "?version=1", { signedXdr: "signed-fixture-xx" })).rejects.toThrow(
      "opt-in",
    );
  });
  it("reconciles only the matching saved generation without reading current state", async () => {
    const response = await run(reconcile, "?version=2", { intent });
    expect((await response.json()).data).toMatchObject({ intent, state: "PREPARED" });
    expect(mocks.reconcile).toHaveBeenCalledWith(intent, deployment.id, "payment.execute");
    mocks.reconcile.mockClear();
    await expect(run(reconcile, "", { intent })).rejects.toMatchObject({
      code: "CONFLICT",
      fields: { intent: [intent], txHash: ["cd".repeat(32)] },
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.state2).not.toHaveBeenCalled();
  });
  it("keeps explicit1/default old discovery unchanged for an immediate deployment", async () => {
    const old = {
      ...deployment,
      paramsSnapshot: [],
      graphSnapshot: { fieldPolicies: { version: 1, nodes: [] } },
    };
    expect(
      (await (await run(discover, "?version=1", undefined, old)).json()).data.policyVersion,
    ).toBe(1);
    const body = { from: execution.payer, amount: "111", arguments: { version: 1, inputs: [] } };
    expect((await (await run(prepare, "", body, old)).json()).data.execution.version).toBe(1);
    expect(mocks.prepare2).not.toHaveBeenCalled();
  });
});
