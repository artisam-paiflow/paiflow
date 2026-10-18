import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  xdr,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  Transaction,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const server = vi.hoisted(() => ({ _getLedgerEntries: vi.fn(), simulateTransaction: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
}));
import { SimulationError } from "@/lib/stellar/sim-error";
import { prepareTriggerTx } from "@/lib/stellar/trigger";
import { paymentAccountResponse } from "./payment-account-fixture";

const from = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const now = 2000000000000;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  server._getLedgerEntries.mockResolvedValue(paymentAccountResponse(from, "1"));
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

// Exercise the real deposit preparation boundary, including the lazy hint and
// RPC response's structured diagnostics, rather than a mock of translation.
describe("deposit trustline attribution (#876)", () => {
  const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
  const recipient = Keypair.random().publicKey();
  const label = "USDC issued by GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const hint = {
    addressMap: { [asset]: "stellar_asset" as const },
    assetLabels: { [asset]: label },
  };
  function failure(account: string, origin = asset, code = 13, successful = false) {
    return {
      _parsed: true,
      id: "1",
      latestLedger: 1000,
      error: `HostError: Error(Contract, #${code}) contract:${asset}, topics:[error, Error(Contract, #${code})]`,
      events: [
        new xdr.DiagnosticEvent({
          inSuccessfulContractCall: successful,
          event: new xdr.ContractEvent({
            ext: new xdr.ExtensionPoint(0),
            contractId: StrKey.decodeContract(origin) as unknown as xdr.Hash,
            type: xdr.ContractEventType.diagnostic(),
            body: new xdr.ContractEventBody(
              0,
              new xdr.ContractEventV0({
                topics: [
                  xdr.ScVal.scvSymbol("error"),
                  xdr.ScVal.scvError(xdr.ScError.sceContract(code)),
                ],
                data: xdr.ScVal.scvVec([
                  xdr.ScVal.scvString("trustline entry is missing for account"),
                  new Address(account).toScVal(),
                ]),
              }),
            ),
          }),
        }),
      ],
    };
  }
  const prepareDeposit = (lazyHint = async () => hint) =>
    prepareTriggerTx({
      contractAddress: contract,
      amount: "2500000",
      fromAddress: from,
      isPipeline: true,
      hint: lazyHint,
    });

  it.each([
    ["sender", from],
    ["recipient", recipient],
  ])("identifies the %s from the SAC diagnostic", async (role, account) => {
    server.simulateTransaction.mockResolvedValue(failure(account));
    const lazyHint = vi.fn(async () => hint);
    await expect(prepareDeposit(lazyHint)).rejects.toMatchObject({
      code: "VALIDATION",
      status: 422,
      details: `Soroban simulate failed: ${failure(account).error}`,
      message: expect.stringContaining(`The ${role} (${account}) has no trustline for ${label}`),
    });
    await expect(prepareDeposit()).rejects.toBeInstanceOf(SimulationError);
    expect(lazyHint).toHaveBeenCalledTimes(1);
  });

  it.each([
    "unmapped",
    "successful",
    "no account",
    "unknown format",
    "unknown host message",
    "contract account",
    "non-error topic",
    "different diagnostic code",
    "non-diagnostic event",
  ])("does not guess a wallet from %s diagnostics", async (variant) => {
    const sim = failure(
      from,
      variant === "unmapped" ? contract : asset,
      13,
      variant === "successful",
    );
    if (variant === "no account") sim.events = [];
    if (variant === "unknown format")
      sim.events[0]!.event().body().v0().data(xdr.ScVal.scvString("unknown"));
    const event = sim.events[0]?.event();
    if (variant === "unknown host message")
      event!.body().v0().data().vec()![0] = xdr.ScVal.scvString("unknown host message");
    if (variant === "contract account")
      event!.body().v0().data().vec()![1] = new Address(contract).toScVal();
    if (variant === "non-error topic")
      event!.body().v0().topics()[0] = xdr.ScVal.scvSymbol("transfer");
    if (variant === "different diagnostic code")
      event!.body().v0().topics()[1] = xdr.ScVal.scvError(xdr.ScError.sceContract(10));
    if (variant === "non-diagnostic event") event!.type(xdr.ContractEventType.contract());
    server.simulateTransaction.mockResolvedValue(sim);
    await expect(prepareDeposit()).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
      message: expect.stringContaining("An account involved in this transfer"),
    });
  });

  it("retains the insufficient-token-balance explanation", async () => {
    server.simulateTransaction.mockResolvedValue(failure(from, asset, 10));
    await expect(prepareDeposit()).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
      message: `There isn't enough ${label} to cover this transfer.`,
    });
  });

  it("does not classify an earlier #13 diagnostic over a different failure", async () => {
    const sim = failure(from);
    sim.error = `HostError: Error(Contract, #10) contract:${asset}, topics:[error, Error(Contract, #10)]`;
    server.simulateTransaction.mockResolvedValue(sim);
    await expect(prepareDeposit()).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      status: 502,
      message: `There isn't enough ${label} to cover this transfer.`,
    });
  });

  it("does not turn unknown RPC transport errors into trustline failures", async () => {
    const transport = new Error("socket hang up");
    server.simulateTransaction.mockRejectedValue(transport);
    await expect(prepareDeposit()).rejects.toBe(transport);
  });

  it("does not build the diagnostic hint for a successful deposit", async () => {
    const lazyHint = vi.fn(async () => hint);
    await prepareDeposit(lazyHint);
    expect(lazyHint).not.toHaveBeenCalled();
  });
});
