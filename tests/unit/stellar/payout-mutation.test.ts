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
const { rpc, build, track, channel } = vi.hoisted(() => ({
  rpc: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  },
  build: vi.fn(),
  track: vi.fn(),
  channel: { entered: false },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  buildRelayerTx: build,
  withRelayerChannel: async (fn: (channel: unknown) => Promise<unknown>) => {
    channel.entered = true;
    try {
      return await fn({ trackPending: track });
    } finally {
      channel.entered = false;
    }
  },
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  stellarRelayerAddress: () => "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
}));
import { updatePaymentByRelayer } from "@/lib/stellar/dev-mutate";
const source = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const tx = new TransactionBuilder(new Account(source, "1"), {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.invokeContractFunction({ contract, function: "update_payment", args: [] }),
  )
  .setTimeout(180)
  .build();
beforeEach(() => {
  vi.clearAllMocks();
  rpc.getAccount.mockResolvedValue(new Account(source, "1"));
  build.mockResolvedValue(tx);
  rpc.simulateTransaction.mockImplementation(async (built: typeof tx) => {
    const op = built.operations[0];
    if (op?.type !== "invokeHostFunction") throw new Error();
    const method = op.func.invokeContract().functionName().toString();
    const values: Record<string, unknown> = {
      recipient: source,
      configured_amount: 0n,
      percentage_bps: 10000,
      is_cash_out: false,
    };
    return {
      result: {
        retval:
          method === "recipient"
            ? nativeToScVal(source, { type: "address" })
            : nativeToScVal(values[method]),
      },
    };
  });
  rpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: tx.hash().toString("hex") });
  rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
});
describe("coordinated payment mutation uses the channel path", () => {
  it("runs the exact signed-transaction checkpoint inside the channel before send", async () => {
    const sequence: string[] = [];
    rpc.sendTransaction.mockImplementation(async () => {
      sequence.push("send");
      expect(channel.entered).toBe(true);
      return { status: "PENDING", hash: tx.hash().toString("hex") };
    });
    const result = await updatePaymentByRelayer(
      contract,
      { recipient: source, percentageBps: 10000 },
      {
        beforeSubmit: async (actual) => {
          expect(channel.entered).toBe(true);
          expect(actual).toBe(tx);
          sequence.push("checkpoint");
        },
      },
    );
    expect(sequence).toEqual(["checkpoint", "send"]);
    expect(result.status).toBe("SUCCESS");
    expect(track).toHaveBeenCalledWith(tx.hash().toString("hex"));
  });
  it("never sends if coordination refuses ownership", async () => {
    await expect(
      updatePaymentByRelayer(
        contract,
        { recipient: source },
        {
          beforeSubmit: async () => {
            throw new Error("lost lease");
          },
        },
      ),
    ).rejects.toThrow(/lost lease/);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("polls the locally computed coordinated hash even if the send reply differs", async () => {
    rpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "wrong" });
    const result = await updatePaymentByRelayer(
      contract,
      { recipient: source },
      { beforeSubmit: async () => {} },
    );
    expect(result.txHash).toBe(tx.hash().toString("hex"));
    expect(rpc.getTransaction).toHaveBeenCalledWith(tx.hash().toString("hex"));
  });
});
