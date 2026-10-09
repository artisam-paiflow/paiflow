import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ send: vi.fn(), build: vi.fn(), pending: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ sendTransaction: m.send }) }));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  buildRelayerTx: m.build,
  withRelayerChannel: (fn: (channel: unknown) => unknown) => fn({ trackPending: m.pending }),
}));
vi.mock("@/lib/stellar/invoke", () => ({
  webhookEscrowOperation: () => ({}),
  webhookExecuteOperation: () => ({}),
}));
vi.mock("@/lib/analytics/outcomes", () => ({}));
import { submitWebhookExecuteTx } from "@/lib/stellar/trigger";
const hash = "a".repeat(64);
const tx = { hash: () => Buffer.from(hash, "hex"), timeBounds: { maxTime: "2000000000" } };
beforeEach(() => {
  vi.resetAllMocks();
  m.build.mockResolvedValue(tx);
  m.send.mockResolvedValue({ status: "PENDING", hash });
});
const input = { contractAddress: "contract", escrow: true, amount: "100" };
describe("keyed webhook submission boundary", () => {
  it("persists the hash before the only network send", async () => {
    const order: string[] = [];
    m.send.mockImplementation(async () => {
      order.push("send");
      return { status: "PENDING", hash };
    });
    await submitWebhookExecuteTx({
      ...input,
      submissionHooks: {
        beforeSend: async (h) => {
          expect(h).toBe(hash);
          order.push("persist");
        },
        afterSend: async (queued) => {
          expect(queued).toBe(true);
          order.push("accepted");
        },
      },
    });
    expect(order).toEqual(["persist", "send", "accepted"]);
    expect(m.build).toHaveBeenCalledOnce();
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("never sends if hash persistence fails or its acknowledgement is lost", async () => {
    await expect(
      submitWebhookExecuteTx({
        ...input,
        submissionHooks: {
          beforeSend: async () => {
            throw new Error("DB ack lost");
          },
          afterSend: vi.fn(),
        },
      }),
    ).rejects.toThrow("DB ack lost");
    expect(m.send).not.toHaveBeenCalled();
  });
  it("does not rebuild a keyed transaction after txBadSeq", async () => {
    m.send.mockResolvedValue({ status: "ERROR", hash, errorResult: { result: () => "txBadSeq" } });
    const afterSend = vi.fn();
    expect(
      (
        await submitWebhookExecuteTx({
          ...input,
          submissionHooks: {
            beforeSend: vi.fn(),
            afterSend,
          },
        })
      ).status,
    ).toBe("FAILED");
    expect(afterSend).toHaveBeenCalledWith(false);
    expect(m.build).toHaveBeenCalledOnce();
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("retains the pending barrier for a transport-uncertain send", async () => {
    m.send.mockRejectedValue(new Error("timeout"));
    const afterSend = vi.fn();
    await expect(
      submitWebhookExecuteTx({
        ...input,
        submissionHooks: {
          beforeSend: vi.fn(),
          afterSend,
        },
      }),
    ).rejects.toThrow("timeout");
    expect(afterSend).not.toHaveBeenCalled();
    expect(m.pending).toHaveBeenCalledWith(hash, tx.timeBounds.maxTime);
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("never resends after failure to store acceptance", async () => {
    await expect(
      submitWebhookExecuteTx({
        ...input,
        submissionHooks: {
          beforeSend: vi.fn(),
          afterSend: async () => {
            throw new Error("DB write failed");
          },
        },
      }),
    ).rejects.toThrow("DB write failed");
    expect(m.pending).toHaveBeenCalledWith(hash, tx.timeBounds.maxTime);
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("records explicit queue refusal without treating it as pending", async () => {
    m.send.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash });
    const afterSend = vi.fn();
    await expect(
      submitWebhookExecuteTx({
        ...input,
        submissionHooks: {
          beforeSend: vi.fn(),
          afterSend,
        },
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(afterSend).toHaveBeenCalledWith(false);
    expect(m.pending).not.toHaveBeenCalled();
  });
});
