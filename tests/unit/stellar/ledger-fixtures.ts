import {
  Account,
  Address,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export const LEDGER_SEQUENCE = 42;
export const LEDGER_CLOSE_TIME = "1001";
export const LEDGER_ACCOUNT = Address.account(Buffer.alloc(32, 1)).toString();
export const LEDGER_CONTRACT = Address.contract(Buffer.alloc(32, 2)).toString();

/** Synthetic, unsigned data: no keys, signatures, or captured network metadata. */
export function ledgerFixture() {
  const contractAddress = new Address(LEDGER_CONTRACT).toScAddress();
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress, functionName: "noop", args: [] }),
    ),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new xdr.SorobanAddressCredentialsWithDelegates({
        addressCredentials: new xdr.SorobanAddressCredentials({
          address: new Address(LEDGER_ACCOUNT).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 100,
          signature: xdr.ScVal.scvVoid(),
        }),
        delegates: [],
      }),
    ),
    rootInvocation: invocation,
  });
  const tx = new TransactionBuilder(new Account(LEDGER_ACCOUNT, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEDGER_CONTRACT,
        function: "noop",
        args: [],
        auth: [auth],
      }),
    )
    .setTimebounds(0, 1000)
    .build();
  const zero = Buffer.alloc(32);
  const header = new xdr.LedgerHeader({
    ledgerVersion: 29,
    previousLedgerHash: zero,
    scpValue: new xdr.StellarValue({
      txSetHash: zero,
      closeTime: xdr.Uint64.fromString(LEDGER_CLOSE_TIME),
      upgrades: [],
      ext: xdr.StellarValueExt.stellarValueBasic(),
    }),
    txSetResultHash: zero,
    bucketListHash: zero,
    ledgerSeq: LEDGER_SEQUENCE,
    totalCoins: xdr.Int64.fromString("0"),
    feePool: xdr.Int64.fromString("0"),
    inflationSeq: 0,
    idPool: xdr.Uint64.fromString("0"),
    baseFee: 100,
    baseReserve: 0,
    maxTxSetSize: 100,
    skipList: [zero, zero, zero, zero],
    ext: new xdr.LedgerHeaderExt(0),
  });
  const history = new xdr.LedgerHeaderHistoryEntry({
    hash: zero,
    header,
    ext: new xdr.LedgerHeaderHistoryEntryExt(0),
  });
  const metadata = new xdr.LedgerCloseMeta(
    2,
    new xdr.LedgerCloseMetaV2({
      ext: new xdr.LedgerCloseMetaExt(0),
      ledgerHeader: history,
      txSet: new xdr.GeneralizedTransactionSet(
        1,
        new xdr.TransactionSetV1({
          previousLedgerHash: zero,
          phases: [
            new xdr.TransactionPhase(0, [
              xdr.TxSetComponent.txsetCompTxsMaybeDiscountedFee(
                new xdr.TxSetComponentTxsMaybeDiscountedFee({
                  baseFee: null,
                  txes: [tx.toEnvelope()],
                }),
              ),
            ]),
          ],
        }),
      ),
      txProcessing: [],
      upgradesProcessing: [],
      scpInfo: [],
      totalByteSizeOfLiveSorobanState: xdr.Uint64.fromString("0"),
      evictedKeys: [],
    }),
  );
  return {
    latest: {
      id: zero.toString("hex"),
      sequence: LEDGER_SEQUENCE,
      protocolVersion: 29,
      closeTime: LEDGER_CLOSE_TIME,
      headerXdr: header.toXDR("base64"),
      metadataXdr: metadata.toXDR("base64"),
    },
    ledgers: {
      ledgers: [
        {
          hash: zero.toString("hex"),
          sequence: LEDGER_SEQUENCE,
          ledgerCloseTime: LEDGER_CLOSE_TIME,
          headerXdr: history.toXDR("base64"),
          metadataXdr: metadata.toXDR("base64"),
        },
      ],
      latestLedger: LEDGER_SEQUENCE,
      latestLedgerCloseTime: LEDGER_CLOSE_TIME,
      oldestLedger: LEDGER_SEQUENCE,
      oldestLedgerCloseTime: LEDGER_CLOSE_TIME,
      cursor: "42",
    },
  };
}
