import { Keypair, xdr } from "@stellar/stellar-sdk";

export function paymentAccountResponse(address: string, sequence = "41") {
  const accountId = Keypair.fromPublicKey(address).xdrPublicKey();
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId }));
  const account = new xdr.AccountEntry({
    accountId,
    balance: xdr.Int64.fromString("1000000000"),
    seqNum: xdr.Int64.fromString(sequence),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Buffer.alloc(4),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
  return {
    latestLedger: 1000,
    entries: [
      {
        key: key.toXDR("base64"),
        xdr: xdr.LedgerEntryData.account(account).toXDR("base64"),
        lastModifiedLedgerSeq: 999,
      },
    ],
  };
}
