import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conditionalAcceptancePlan } from "@/tests/fixtures/conditional-v2-acceptance";
import type { LegacySubmissionDeployment } from "@/lib/stellar/legacy-submission";

const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  transaction: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { deployment: { findFirst: mocks.deployment }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/deployments/service-route", () => ({ deploymentServiceRoute: (fn: unknown) => fn }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ id: "owner" })),
  getSessionUser: vi.fn(async () => ({ id: "owner" })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), needsSubmitRow: vi.fn() }));
vi.mock("@/lib/stellar/trigger", () => ({
  prepareTriggerTx: mocks.prepare,
  prepareWebhookDepositTx: mocks.prepare,
  submitTriggerTx: mocks.submit,
}));
vi.mock("@/lib/stellar/invoke", () => ({ prepareStreamerTopUpInvocation: mocks.prepare }));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({ buildPipelineErrorHint: vi.fn() }));
import { POST as prepareTrigger } from "@/app/api/deployments/[id]/trigger/route";
import { POST as submitTrigger } from "@/app/api/deployments/[id]/submit-trigger/route";
import { POST as submitInvoke } from "@/app/api/deployments/[id]/submit-invoke/route";
import { registerLegacyPreparation, admitLegacySubmission } from "@/lib/stellar/legacy-submission";

const payer = Keypair.random();
const plan = conditionalAcceptancePlan();
const root = plan.bindings[0]!.contractAddress;
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  network: "testnet",
  status: "CONFIRMED",
  contractAddress: root,
  pipelineSnapshot: plan.nodes.map((node) => ({
    nodeId: node.nodeId,
    contractAddress: node.initialState.contractAddress,
    templateKind: node.templateKind,
  })),
  graphSnapshot: {},
  paramsSnapshot: { version: 2, generation: "conditional-v2" },
  sourceAccount: plan.definition.owner,
  chargeRelayerAddress: null,
  chargeRelayerMode: "USER",
  flow: { templateKind: "PAYER" },
} as LegacySubmissionDeployment;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.deployment.mockResolvedValue(deployment);
});
describe("legacy surfaces fail closed for explicit conditional generations", () => {
  for (const [name, handler] of [
    ["trigger", prepareTrigger],
    ["submit-trigger", submitTrigger],
    ["submit-invoke", submitInvoke],
  ] as const)
    it.each([
      { version: 2, generation: "conditional-v2" },
      { version: 2 },
      { generation: "malformed" },
      { version: 99 },
    ])(
      `${name} refuses declaration %o before legacy simulation/admission`,
      async (paramsSnapshot) => {
        mocks.deployment.mockResolvedValue({ ...deployment, paramsSnapshot });
        const body =
          name === "trigger"
            ? { amount: "111", userAddress: payer.publicKey() }
            : { signedXdr: "signed-fixture-xx" };
        const response = await handler(
          new NextRequest(`https://app.invalid/api/deployments/${deployment.id}/${name}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ id: deployment.id }) },
        );
        expect(response.status).toBe(422);
        expect((await response.json()).error.message).toContain("version2");
        expect(mocks.prepare).not.toHaveBeenCalled();
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.deployment.mock.calls[0]![0].select).toBeUndefined();
      },
    );
  it.each(["TRIGGER", "INVOKE"] as const)(
    "refuses direct legacy %s registration and signed admission without touching financial storage",
    async (kind) => {
      const tx = new TransactionBuilder(new Account(payer.publicKey(), "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: root,
            function: "deposit",
            args: [new Address(payer.publicKey()).toScVal(), nativeToScVal(111n, { type: "i128" })],
          }),
        )
        .setTimeout(180)
        .build();
      await expect(
        registerLegacyPreparation({
          deployment,
          kind,
          unsignedXdr: tx.toXDR(),
          sourceAddress: payer.publicKey(),
          contractAddress: root,
          method: "deposit",
          amount: "111",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      tx.sign(payer);
      await expect(
        admitLegacySubmission({ deployment, kind, signedXdr: tx.toXDR() }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
});
