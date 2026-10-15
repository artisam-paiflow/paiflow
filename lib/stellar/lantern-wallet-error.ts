/** Controlled adapter errors. Provider payloads and arbitrary strings never escape. */
export const LANTERN_WALLET_MESSAGES = {
  LANTERN_UNVERIFIED: "Lantern's browser integration is not yet supported. Use another wallet.",
  LANTERN_UNAVAILABLE: "Lantern is unavailable. Use another wallet.",
  LANTERN_TESTNET_ONLY:
    "Lantern is available for testnet testing only. Use another wallet on mainnet.",
  LANTERN_REJECTED: "Transaction cancelled in your wallet.",
  LANTERN_LOCKED: "Unlock Lantern and try again.",
  LANTERN_WRONG_NETWORK:
    "Lantern is on the wrong network. Switch to TESTNET and reconnect before signing.",
  LANTERN_WRONG_ACCOUNT:
    "The Lantern account changed. Reconnect the intended account before signing.",
  LANTERN_INVALID_RESPONSE:
    "Lantern returned an invalid response. No transaction was submitted by Paiflow.",
  LANTERN_UNSUPPORTED: "This Lantern request is not supported by Paiflow.",
  LANTERN_REQUEST_FAILED: "The Lantern request failed. Try again or use another wallet.",
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

/** Provisional fixture codes only; replace with documented upstream mapping later. */
export function lanternProviderFailure(error: unknown): LanternWalletError {
  try {
    if (error instanceof LanternWalletError) return error;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    switch (code) {
      case "USER_REJECTED":
        return new LanternWalletError("LANTERN_REJECTED");
      case "LOCKED":
        return new LanternWalletError("LANTERN_LOCKED");
      case "WRONG_NETWORK":
        return new LanternWalletError("LANTERN_WRONG_NETWORK");
      case "WRONG_ACCOUNT":
        return new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      default:
        return new LanternWalletError("LANTERN_REQUEST_FAILED");
    }
  } catch {
    return new LanternWalletError("LANTERN_REQUEST_FAILED");
  }
}
