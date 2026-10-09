import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export const relayer = Keypair.random().publicKey();
export const subscriber = Keypair.random().publicKey();
export const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
export const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
export const values = () => ({
  is_cancelled: xdr.ScVal.scvBool(false),
  next_charge_at: nativeToScVal(1000n, { type: "u64" }),
  amount_per_period: nativeToScVal(200n, { type: "i128" }),
  subscriber: new Address(subscriber).toScVal(),
  asset: new Address(asset).toScVal(),
  relayer: new Address(relayer).toScVal(),
});
export function map(fields: Record<string, xdr.ScVal> = values()) {
  return xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })),
  );
}
export function missingState(
  opts: { contract?: string; function?: string; type?: xdr.ScError; message?: string } = {},
) {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 1,
    error: "HostError: Error(WasmVm, MissingValue)\nEvent log (newest first):",
    events: [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
          ext: new xdr.ExtensionPoint(0),
          contractId: StrKey.decodeContract(opts.contract ?? contract) as unknown as xdr.Hash,
          type: xdr.ContractEventType.diagnostic(),
          body: new xdr.ContractEventBody(
            0,
            new xdr.ContractEventV0({
              topics: [
                xdr.ScVal.scvSymbol("error"),
                xdr.ScVal.scvError(
                  opts.type ?? xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecMissingValue()),
                ),
              ],
              data: xdr.ScVal.scvVec([
                xdr.ScVal.scvString(
                  opts.message ?? "trying to invoke non-existent contract function",
                ),
                xdr.ScVal.scvSymbol(opts.function ?? "state"),
              ]),
            }),
          ),
        }),
      }),
    ],
  };
}
