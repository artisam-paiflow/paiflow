import {
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowanceHasExpired } from "@/lib/stellar/allowance-status";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import {
  LEDGER_ACCOUNT,
  LEDGER_CLOSE_TIME,
  LEDGER_CLOSE_TIME_MS,
  LEDGER_CONTRACT,
  LEDGER_SEQUENCE,
  ledgerFixture,
} from "./ledger-fixtures";
import { paymentAccountResponse } from "./payment-account-fixture";

const holder = vi.hoisted(() => ({
  server: null as import("@stellar/stellar-sdk").rpc.Server | null,
}));
vi.mock("@/lib/stellar/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/client")>()),
  sorobanRpc: () => holder.server!,
}));

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
const pendingApproval = {
  txHash: "a".repeat(64),
  maxTime: "1000",
  preparationLedger: LEDGER_SEQUENCE - 1,
};
const notFound = {
  status: "NOT_FOUND",
  latestLedger: LEDGER_SEQUENCE,
  latestLedgerCloseTime: LEDGER_CLOSE_TIME,
  oldestLedger: LEDGER_SEQUENCE - 1,
  oldestLedgerCloseTime: "900",
};

beforeEach(() => {
  holder.server = new rpc.Server("https://rpc.invalid");
});
afterEach(() => vi.restoreAllMocks());

describe("ledger compatibility (#792)", () => {
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

  it.each([3, 4] as const)(
    "decodes Protocol 30 StellarValueType %s in latest and historical headers and metadata",
    async (kind) => {
      const server = holder.server!;
      const fixture = ledgerFixture(kind);
      vi.spyOn(server.httpClient, "post")
        .mockResolvedValueOnce(response(fixture.latest))
        .mockResolvedValueOnce(response(fixture.ledgers));
      const latest = await server.getLatestLedger();
      const ledgers = await server.getLedgers({
        startLedger: latest.sequence,
        pagination: { limit: 1 },
      });
      expect(latest.protocolVersion).toBe(30);
      expect(latest.sequence).toBe(LEDGER_SEQUENCE);
      expect(latest.closeTime).toBe(LEDGER_CLOSE_TIME);
      const historical = ledgers.ledgers[0]!;
      expect(historical.ledgerCloseTime).toBe(LEDGER_CLOSE_TIME);
      for (const header of [
        latest.headerXdr,
        latest.metadataXdr.v2().ledgerHeader().header(),
        historical.headerXdr.header(),
        historical.metadataXdr.v2().ledgerHeader().header(),
      ]) {
        expect(header.ledgerVersion()).toBe(30);
        expect(header.scpValue().closeTime().toString()).toBe(LEDGER_CLOSE_TIME);
        const extension = header.scpValue().ext();
        expect(extension.switch().value).toBe(kind);
        const value = kind === 3 ? extension.signedMsValue() : extension.proposedMsValue();
        expect(value.closeTimeMs().toString()).toBe(LEDGER_CLOSE_TIME_MS);
      }
      if (kind === 4) expect(latest.metadataXdr.v2().txSet().v1TxSet().phases()).toEqual([]);
    },
  );

  it.each([
    { name: "Protocol 29 CAP-71", kind: undefined },
    { name: "Protocol 30 SIGNED_MS", kind: 3 },
    { name: "Protocol 30 EMPTY_TX_SET_MS", kind: 4 },
  ] as const)("prepares an exact simulated unsigned approval through $name", async ({ kind }) => {
    const server = holder.server!;
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    const post = vi
      .spyOn(server.httpClient, "post")
      .mockResolvedValueOnce(response(ledgerFixture(kind).latest))
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

  it.each([3, 4] as const)(
    "proves approval expiry using both parsed Protocol 30 type %s ledger reads and the original hash",
    async (kind) => {
      const fixture = ledgerFixture(kind);
      const post = vi
        .spyOn(holder.server!.httpClient, "post")
        .mockResolvedValueOnce(response(notFound))
        .mockResolvedValueOnce(response(fixture.latest))
        .mockResolvedValueOnce(response(fixture.ledgers))
        .mockResolvedValueOnce(response(notFound));
      expect(await allowanceHasExpired(pendingApproval)).toBe(true);
      expect(post.mock.calls.map(([, body]) => (body as { method: string }).method)).toEqual([
        "getTransaction",
        "getLatestLedger",
        "getLedgers",
        "getTransaction",
      ]);
      for (const index of [0, 3])
        expect(post.mock.calls[index]?.[1]).toMatchObject({
          method: "getTransaction",
          params: { hash: pendingApproval.txHash },
        });
      expect(post.mock.calls[2]?.[1]).toMatchObject({
        method: "getLedgers",
        params: { startLedger: LEDGER_SEQUENCE, pagination: { limit: 1 } },
      });
    },
  );

  it.each([3, 4] as const)(
    "does not expire an approval at the Protocol 30 type %s closed-second boundary",
    async (kind) => {
      const fixture = ledgerFixture(kind);
      const post = vi
        .spyOn(holder.server!.httpClient, "post")
        .mockResolvedValueOnce(response(notFound))
        .mockResolvedValueOnce(response(fixture.latest))
        .mockResolvedValueOnce(response(fixture.ledgers));
      expect(await allowanceHasExpired({ ...pendingApproval, maxTime: LEDGER_CLOSE_TIME })).toBe(
        false,
      );
      expect(post).toHaveBeenCalledTimes(3);
    },
  );

  it.each([3, 4] as const)(
    "retains approval uncertainty when Protocol 30 type %s historical metadata cannot decode",
    async (kind) => {
      const fixture = ledgerFixture(kind);
      fixture.ledgers.ledgers[0]!.metadataXdr = "AAAAfw==";
      const post = vi
        .spyOn(holder.server!.httpClient, "post")
        .mockResolvedValueOnce(response(notFound))
        .mockResolvedValueOnce(response(fixture.latest))
        .mockResolvedValueOnce(response(fixture.ledgers));
      await expect(allowanceHasExpired(pendingApproval)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(post).toHaveBeenCalledTimes(3);
    },
  );

  it.each([3, 4] as const)(
    "retains approval uncertainty if lookup history disappears after Protocol 30 type %s ledger reads",
    async (kind) => {
      const fixture = ledgerFixture(kind);
      vi.spyOn(holder.server!.httpClient, "post")
        .mockResolvedValueOnce(response(notFound))
        .mockResolvedValueOnce(response(fixture.latest))
        .mockResolvedValueOnce(response(fixture.ledgers))
        .mockResolvedValueOnce(response({ ...notFound, oldestLedger: LEDGER_SEQUENCE }));
      await expect(allowanceHasExpired(pendingApproval)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
    },
  );

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

  it("refuses approval preparation when RPC is unavailable", async () => {
    const server = holder.server!;
    vi.spyOn(server, "_getLedgerEntries").mockResolvedValue(paymentAccountResponse(LEDGER_ACCOUNT));
    vi.spyOn(server.httpClient, "post").mockRejectedValue(new Error("timeout"));
    await expect(prepareTokenApproveInvocation(approval)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
});
