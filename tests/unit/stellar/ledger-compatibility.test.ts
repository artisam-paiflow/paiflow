import {
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEDGER_ACCOUNT,
  LEDGER_CLOSE_TIME,
  LEDGER_CONTRACT,
  LEDGER_SEQUENCE,
  ledgerFixture,
} from "./ledger-fixtures";

const holder = vi.hoisted(() => ({
  server: null as import("@stellar/stellar-sdk").rpc.Server | null,
}));
vi.mock("@/lib/stellar/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/client")>()),
  sorobanRpc: () => holder.server!,
}));
import { paymentAccountResponse } from "./payment-account-fixture";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { payoutTransactionFinished } from "@/lib/stellar/payout-state";

function response(result: unknown) {
  return {
    data: { jsonrpc: "2.0", id: 1, result },
    headers: {},
    config: {},
    status: 200,
    statusText: "OK",
  };
}
const approval = {
  tokenContractAddress: LEDGER_CONTRACT,
  from: LEDGER_ACCOUNT,
  spender: LEDGER_CONTRACT,
  amount: "9007199254740993",
};
const payout = { txHash: "a".repeat(64), maxTime: "1000" };
const notFound = {
  status: "NOT_FOUND",
  latestLedger: LEDGER_SEQUENCE,
  latestLedgerCloseTime: LEDGER_CLOSE_TIME,
  oldestLedger: LEDGER_SEQUENCE,
  oldestLedgerCloseTime: LEDGER_CLOSE_TIME,
};

beforeEach(() => {
  holder.server = new rpc.Server("https://rpc.invalid");
});
afterEach(() => vi.restoreAllMocks());

describe("CAP-71 ledger compatibility (#792)", () => {
  it("decodes credential value 3 in both latest-ledger and historical-ledger metadata", async () => {
    const server = holder.server!;
    const fixture = ledgerFixture();
    vi.spyOn(server.httpClient, "post")
      .mockResolvedValueOnce(response(fixture.latest))
      .mockResolvedValueOnce(response(fixture.ledgers));
    const latest = await server.getLatestLedger();
    const ledgers = await server.getLedgers({
      startLedger: latest.sequence,
      pagination: { limit: 1 },
    });
    expect(latest.sequence).toBe(LEDGER_SEQUENCE);
    expect(ledgers.ledgers[0]?.ledgerCloseTime).toBe(LEDGER_CLOSE_TIME);
    const envelope = latest.metadataXdr
      .v2()
      .txSet()
      .v1TxSet()
      .phases()[0]!
      .v0Components()[0]!
      .txsMaybeDiscountedFee()
      .txes()[0]!;
    expect(
      envelope
        .v1()
        .tx()
        .operations()[0]!
        .body()
        .invokeHostFunctionOp()
        .auth()[0]!
        .credentials()
        .switch().value,
    ).toBe(3);
  });

  it("prepares a simulated unsigned approval with bounded expiration and exact stroops", async () => {
    const server = holder.server!;
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    const post = vi
      .spyOn(server.httpClient, "post")
      .mockResolvedValueOnce(response(ledgerFixture().latest))
      .mockResolvedValueOnce(
        response({
          latestLedger: LEDGER_SEQUENCE,
          transactionData: new SorobanDataBuilder().setResourceFee("200").build().toXDR("base64"),
          minResourceFee: "200",
          results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
        }),
      );
    const simulate = vi.spyOn(server, "simulateTransaction");
    const prepared = await prepareTokenApproveInvocation(approval);
    const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET);
    if ("innerTransaction" in tx) throw new Error("Expected a user-source transaction");
    const operation = tx.operations[0]!;
    expect(operation.type).toBe("invokeHostFunction");
    if (operation.type !== "invokeHostFunction") throw new Error("Expected contract invocation");
    const call = operation.func.invokeContract();
    expect(call.functionName().toString()).toBe("approve");
    expect(call.args().map(scValToNative)).toEqual([
      LEDGER_ACCOUNT,
      LEDGER_CONTRACT,
      BigInt(approval.amount),
      LEDGER_SEQUENCE + 3_110_400 - 10,
    ]);
    expect(tx.source).toBe(LEDGER_ACCOUNT);
    expect(tx.signatures).toHaveLength(0);
    expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: String(now / 1000 + 180) });
    expect(tx.fee).toBe("300");
    expect(simulate).toHaveBeenCalledOnce();
    expect(post.mock.calls.map(([, body]) => (body as { method: string }).method)).toEqual([
      "getLatestLedger",
      "simulateTransaction",
    ]);
  });

  it.each([undefined, "42", -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0xffff_ffff])(
    "refuses an invalid approval sequence %s before simulation",
    async (sequence) => {
      const server = holder.server!;
      vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(
        paymentAccountResponse(LEDGER_ACCOUNT),
      );
      vi.spyOn(server.httpClient, "post").mockResolvedValue(
        response({ ...ledgerFixture().latest, sequence }),
      );
      const simulate = vi.spyOn(server, "simulateTransaction");
      await expect(prepareTokenApproveInvocation(approval)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(simulate).not.toHaveBeenCalled();
    },
  );

  it("does not return an approval when simulation rejects", async () => {
    const server = holder.server!;
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    vi.spyOn(server.httpClient, "post")
      .mockResolvedValueOnce(response(ledgerFixture().latest))
      .mockResolvedValueOnce(
        response({ error: "Error(Contract, #1)", latestLedger: LEDGER_SEQUENCE }),
      );
    await expect(prepareTokenApproveInvocation(approval)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });

  it("refuses approval preparation when latest-ledger metadata cannot decode", async () => {
    const server = holder.server!;
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    vi.spyOn(server.httpClient, "post").mockResolvedValue(
      response({ ...ledgerFixture().latest, metadataXdr: "AAAAfw==" }),
    );
    const simulate = vi.spyOn(server, "simulateTransaction");
    await expect(prepareTokenApproveInvocation(approval)).rejects.toThrow();
    expect(simulate).not.toHaveBeenCalled();
  });

  it("proves payout expiry through both SDK ledger parsers with delegated credentials", async () => {
    const server = holder.server!;
    const fixture = ledgerFixture();
    const post = vi
      .spyOn(server.httpClient, "post")
      .mockResolvedValueOnce(response(notFound))
      .mockResolvedValueOnce(response(fixture.latest))
      .mockResolvedValueOnce(response(fixture.ledgers));
    expect(await payoutTransactionFinished(payout)).toBe(true);
    expect(post.mock.calls.map(([, body]) => (body as { method: string }).method)).toEqual([
      "getTransaction",
      "getLatestLedger",
      "getLedgers",
    ]);
  });

  it.each(["latest", "ledgers"] as const)(
    "retains payout protection when %s metadata cannot decode",
    async (step) => {
      const server = holder.server!;
      const fixture = ledgerFixture();
      vi.spyOn(server.httpClient, "post")
        .mockResolvedValueOnce(response(notFound))
        .mockResolvedValueOnce(
          response({
            ...fixture.latest,
            ...(step === "latest" ? { metadataXdr: "AAAAfw==" } : {}),
          }),
        )
        .mockResolvedValueOnce(
          response({
            ...fixture.ledgers,
            ledgers: [{ ...fixture.ledgers.ledgers[0], metadataXdr: "AAAAfw==" }],
          }),
        );
      await expect(payoutTransactionFinished(payout)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
        message: expect.stringContaining("protection is retained"),
      });
    },
  );

  it("refuses approval preparation when RPC is unavailable", async () => {
    const server = holder.server!;
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    vi.spyOn(server.httpClient, "post").mockRejectedValue(new Error("timeout"));
    await expect(prepareTokenApproveInvocation(approval)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
});
