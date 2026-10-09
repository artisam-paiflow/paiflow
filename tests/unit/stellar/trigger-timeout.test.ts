import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  Transaction,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const server = vi.hoisted(() => ({ getAccount: vi.fn(), simulateTransaction: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
import { prepareTriggerTx } from "@/lib/stellar/trigger";

const from = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const now = 2000000000000;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  server.getAccount.mockImplementation(async () => new Account(from, "1"));
  server.simulateTransaction.mockResolvedValue({
    _parsed: true,
    id: "1",
    latestLedger: 1000,
    events: [],
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "1000",
    result: { auth: [], retval: nativeToScVal(true) },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("prepared deposit validity", () => {
  it.each([
    [60, 60],
    [undefined, 180],
  ] as const)(
    "uses timeout %s through simulation and assembly (default execute stays 180)",
    async (timeoutSeconds, expected) => {
      const { xdr } = await prepareTriggerTx({
        contractAddress: contract,
        amount: "100",
        fromAddress: from,
        isPipeline: true,
        timeoutSeconds,
      });
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      expect(tx).toBeInstanceOf(Transaction);
      if (!(tx instanceof Transaction)) throw new Error("Expected a deposit transaction");
      expect(tx.timeBounds?.maxTime).toBe(String(now / 1000 + expected));
      expect(server.simulateTransaction.mock.lastCall?.[0].timeBounds.maxTime).toBe(
        tx.timeBounds?.maxTime,
      );
    },
  );
});
