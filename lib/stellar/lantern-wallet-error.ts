/** Controlled adapter errors. Provider payloads and arbitrary strings never escape. */
export const LANTERN_WALLET_MESSAGES = {
  LANTERN_UNAVAILABLE: "Lantern is unavailable. Use another wallet.",
  LANTERN_TESTNET_ONLY:
    "Lantern is available for testnet testing only. Use another wallet on mainnet.",
  LANTERN_REJECTED: "Transaction cancelled in your wallet.",
  LANTERN_NOT_ALLOWED:
    "Connect Lantern on TESTNET, or enable websites in Lantern Settings, then reconnect.",
  LANTERN_BUSY: "Lantern is handling another request. Finish it before continuing.",
  LANTERN_TIMEOUT:
    "The Lantern request timed out. Its outcome is unknown; check the transaction status before signing again.",
  LANTERN_CONNECTION_LOST:
    "The Lantern connection was lost. Its outcome is unknown; check the transaction status before signing again.",
  LANTERN_INVALID_REQUEST:
    "Lantern refused this transaction. Check its account and transaction details.",
  LANTERN_WRONG_NETWORK:
    "Lantern is on the wrong network. Switch to TESTNET and reconnect before signing.",
  LANTERN_WRONG_ACCOUNT:
    "The Lantern account changed. Reconnect the intended account before signing.",
  LANTERN_INVALID_RESPONSE:
    "Lantern returned an invalid response. No transaction was submitted by Paiflow.",
  LANTERN_UNSUPPORTED: "This Lantern request is not supported by Paiflow.",
  LANTERN_REQUEST_FAILED:
    "The Lantern request failed. Check any pending transaction before signing again.",
} as const;
export type LanternWalletErrorCode = keyof typeof LANTERN_WALLET_MESSAGES;

export class LanternWalletError extends Error {
  constructor(readonly code: LanternWalletErrorCode) {
    // Use the familiar refusal wording so existing cancellation analytics keep
    // classifying it without trusting provider messages or widening regexes.
    super(
      code === "LANTERN_REJECTED" ? "User rejected Lantern request" : LANTERN_WALLET_MESSAGES[code],
    );
    this.name = "LanternWalletError";
  }
}

/** Preserve semantic kit ext codes; never infer refusal from provider text. */
export function lanternProviderFailure(error: unknown): LanternWalletError {
  try {
    if (error instanceof LanternWalletError) return error;
    const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    const code = typeof record.ext === "string" ? record.ext : record.code;
    switch (code) {
      case "user_rejected":
        return new LanternWalletError("LANTERN_REJECTED");
      case "not_allowed":
        return new LanternWalletError("LANTERN_NOT_ALLOWED");
      case "account_mismatch":
        return new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      case "network_mismatch":
        return new LanternWalletError("LANTERN_WRONG_NETWORK");
      case "invalid_request":
        return new LanternWalletError("LANTERN_INVALID_REQUEST");
      case "unsupported":
        return new LanternWalletError("LANTERN_UNSUPPORTED");
      case "busy":
        return new LanternWalletError("LANTERN_BUSY");
      case "timeout":
        return new LanternWalletError("LANTERN_TIMEOUT");
      case "connection_lost":
        return new LanternWalletError("LANTERN_CONNECTION_LOST");
      default:
        return new LanternWalletError("LANTERN_REQUEST_FAILED");
    }
  } catch {
    return new LanternWalletError("LANTERN_REQUEST_FAILED");
  }
}
