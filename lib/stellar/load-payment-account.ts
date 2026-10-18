import "server-only";
import { Account, Keypair, StrKey, type rpc, xdr } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";

/** Only a successful ledger lookup with no matching entry establishes absence. */
export class MissingPaymentAccountError extends AppError {
  constructor() {
    super(
      "INSUFFICIENT_FUNDS",
      "The source account does not exist on this network. Fund it before preparing a payment.",
    );
  }
}

const unavailable = () =>
  new AppError("UPSTREAM_RPC", "The source account could not be read from Soroban RPC; try again");

/** Bypass SDK16 getAccount's catch-all `Account not found` translation.
 * Keep the caller's existing client, HTTP deadline and single-read behavior.
 */
export async function loadPaymentAccount(
  server: Pick<rpc.Server, "_getLedgerEntries">,
  address: string,
): Promise<Account> {
  if (!StrKey.isValidEd25519PublicKey(address))
    throw new AppError("VALIDATION", "Supply a valid source account address");
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrPublicKey() }),
  );
  try {
    // SDK16's declared raw method preserves malformed entries:null; its public
    // parsed getLedgerEntries normalizes that value to [], incorrectly proving absence.
    const response: unknown = await server._getLedgerEntries(key);
    if (
      !response ||
      typeof response !== "object" ||
      !("latestLedger" in response) ||
      typeof response.latestLedger !== "number" ||
      !Number.isInteger(response.latestLedger) ||
      response.latestLedger <= 0 ||
      response.latestLedger > 0xffff_ffff ||
      ("entries" in response && response.entries !== undefined && !Array.isArray(response.entries))
    )
      throw unavailable();
    // Stellar RPC may omit entries when none of the requested keys exists.
    const entries = "entries" in response ? response.entries : undefined;
    if (entries === undefined || (Array.isArray(entries) && entries.length === 0))
      throw new MissingPaymentAccountError();
    if (!Array.isArray(entries) || entries.length !== 1) throw unavailable();
    const entry: unknown = entries[0];
    if (
      !entry ||
      typeof entry !== "object" ||
      !("key" in entry) ||
      typeof entry.key !== "string" ||
      !("xdr" in entry) ||
      typeof entry.xdr !== "string"
    )
      throw unavailable();
    const returnedKey = xdr.LedgerKey.fromXDR(entry.key, "base64");
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64");
    if (!returnedKey.toXDR().equals(key.toXDR()) || data.switch().name !== "account")
      throw unavailable();
    const account = data.account();
    if (!account.accountId().toXDR().equals(key.account().accountId().toXDR())) throw unavailable();
    const sequence = account.seqNum().toString();
    if (!/^(0|[1-9]\d*)$/.test(sequence)) throw unavailable();
    return new Account(address, sequence);
  } catch (error) {
    if (error instanceof MissingPaymentAccountError) throw error;
    // SDK/HTTP/XDR errors can contain credentials, payloads or malformed server data.
    // Do not expose them as public diagnostics or pass them into route error logging.
    throw unavailable();
  }
}
