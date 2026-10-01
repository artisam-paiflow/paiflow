import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import type { MutationCoordination } from "@/lib/stellar/dev-mutate";
const { eligibility, trustlines, mutation, prepare, lease, acquire, events } = vi.hoisted(() => ({
  eligibility: vi.fn(),
  trustlines: vi.fn(),
  mutation: vi.fn(),
  prepare: vi.fn(),
  acquire: vi.fn(),
  events: [] as string[],
  lease: {
    assertOwnership: vi.fn(),
    checkpointConfiguration: vi.fn(),
    configurationFinal: vi.fn(),
    ready: vi.fn(),
    assertReadyOwnership: vi.fn(),
    close: vi.fn(),
  },
}));
vi.mock("@/lib/api/v1/payout-eligibility", () => ({ payoutEligibility: eligibility }));
vi.mock("@/lib/api/v1/payout-lease", () => ({ acquirePayoutLease: acquire }));
vi.mock("@/lib/stellar/trustline-check", () => ({ checkPayoutTrustlines: trustlines }));
vi.mock("@/lib/stellar/dev-mutate", () => ({ updatePaymentByRelayer: mutation }));
vi.mock("@/lib/stellar/trigger", () => ({ prepareTriggerTx: prepare }));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({ buildPipelineErrorHint: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { preparePayout } from "@/lib/api/v1/payouts";
const source = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const trigger = StrKey.encodeContract(Buffer.alloc(32, 1));
const payer = StrKey.encodeContract(Buffer.alloc(32, 2));
function transaction(method: string) {
  return new TransactionBuilder(new Account(source, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: trigger,
        function: method,
        args:
          method === "deposit"
            ? [nativeToScVal(source, { type: "address" }), nativeToScVal(101n, { type: "i128" })]
            : [],
      }),
    )
    .setTimeout(180)
    .build();
}
const deposit = transaction("deposit");
const config = transaction("update_payment");
const deployment = { id: "d", ownerId: "owner", network: "testnet" } as Deployment;
const input = { from: source, amount: "101", recipient };
beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  acquire.mockResolvedValue(lease);
  for (const method of Object.values(lease)) method.mockResolvedValue(undefined);
  lease.checkpointConfiguration.mockImplementation(async () => {
    events.push("checkpoint");
  });
  lease.ready.mockImplementation(async () => {
    events.push("ready");
  });
  eligibility.mockResolvedValue({
    nodes: [],
    triggerAddress: trigger,
    selected: { nodeId: "p", contractAddress: payer },
    asset: { kind: "native" },
    incoming: "101",
    current: { recipient: undefined, amountStroops: "0", percentageBps: 0, isCashOut: false },
    required: { amountStroops: "0", percentageBps: 10000 },
  });
  trustlines.mockResolvedValue([{ status: "not_needed" }]);
  mutation.mockImplementation(
    async (_address: string, _opts: unknown, coordination: MutationCoordination) => {
      await coordination.beforeSubmit(config);
      events.push("send config");
      return { status: "SUCCESS", txHash: config.hash().toString("hex") };
    },
  );
  prepare.mockImplementation(async () => {
    events.push("prepare deposit");
    return { xdr: deposit.toXDR() };
  });
});
describe("payout preparation", () => {
  it("records the channel mutation hash before send and exact deposit before returning XDR", async () => {
    const result = await preparePayout(deployment, "token", input, "ip");
    expect(events).toEqual(["checkpoint", "send config", "prepare deposit", "ready"]);
    expect(lease.checkpointConfiguration).toHaveBeenCalledWith({
      txHash: config.hash().toString("hex"),
      maxTime: config.timeBounds!.maxTime,
    });
    expect(lease.ready).toHaveBeenCalledWith({
      txHash: deposit.hash().toString("hex"),
      maxTime: deposit.timeBounds!.maxTime,
    });
    expect(trustlines).toHaveBeenCalledWith(
      [{ nodeId: "p", address: recipient, asset: { kind: "native" } }],
      { fresh: true, requireAccount: true },
    );
    expect(result.nodeId).toBe("p");
    expect(lease.close).toHaveBeenCalled();
  });
  it("skips mutation when recipient and required value already match", async () => {
    const current = await eligibility();
    eligibility.mockResolvedValue({
      ...current,
      current: { recipient, amountStroops: "0", percentageBps: 10000, isCashOut: false },
    });
    await preparePayout(deployment, "token", input, "ip");
    expect(mutation).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalled();
  });
  it.each(["no_account", "no_trustline", "unknown", "skipped"])(
    "refuses %s before any mutation",
    async (status) => {
      trustlines.mockResolvedValue([{ status }]);
      await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(/readiness/);
      expect(mutation).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(lease.close).toHaveBeenCalled();
    },
  );
  it("retains uncertain configuration without preparing a deposit", async () => {
    mutation.mockImplementation(async (_a: string, _o: unknown, c: MutationCoordination) => {
      await c.beforeSubmit(config);
      return {
        status: "FAILED",
        txHash: config.hash().toString("hex"),
        errorMessage: "Timed out waiting for finality",
      };
    });
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /protection is retained/,
    );
    expect(lease.configurationFinal).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("retains a checkpoint when send throws ambiguously", async () => {
    mutation.mockImplementation(async (_a: string, _o: unknown, c: MutationCoordination) => {
      await c.beforeSubmit(config);
      throw new Error("network disconnected after send");
    });
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /RPC request failed/,
    );
    expect(lease.configurationFinal).not.toHaveBeenCalled();
  });
  it("does not send if the holder loses ownership before the mutation checkpoint", async () => {
    lease.checkpointConfiguration.mockRejectedValue(new Error("lost ownership"));
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /RPC request failed/,
    );
    expect(events).not.toContain("send config");
  });
  it("does not return XDR if ownership is lost during preparation", async () => {
    lease.ready.mockRejectedValue(new Error("lost ownership"));
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /RPC request failed/,
    );
  });
  it("does not return XDR after ready protection is replaced", async () => {
    lease.assertReadyOwnership.mockRejectedValue(new Error("lost ownership"));
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /RPC request failed/,
    );
    expect(lease.ready).toHaveBeenCalled();
  });
  it("does no mutation on eligibility failures", async () => {
    eligibility.mockRejectedValue(new Error("deposit misses this Pay"));
    await expect(preparePayout(deployment, "token", input, "ip")).rejects.toThrow(
      /RPC request failed/,
    );
    expect(mutation).not.toHaveBeenCalled();
  });
});
