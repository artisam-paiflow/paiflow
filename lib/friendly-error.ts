import { translateSorobanError } from "@/lib/stellar/soroban-errors";

export type FriendlyError = {
  message: string;
  /** Raw technical detail to show behind a "show details" affordance. */
  details?: string;
};

const DEFAULT_FALLBACK = "Something went wrong. Please try again.";

/**
 * Build an Error from an API error body, preserving `error.details` (raw
 * technical detail) as an own property so friendlyError() can surface it
 * behind the details disclosure after the error propagates through catches.
 */
export function apiError(body: unknown, fallback: string = DEFAULT_FALLBACK): Error {
  const f = friendlyError(body, fallback);
  const err = new Error(f.message) as Error & { details?: string; code?: string };
  if (f.details) err.details = f.details;
  // The AppError code survives too, so analytics can group failures by it.
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === "string") err.code = code;
  return err;
}

// Freighter / xBull / Lobstr / wallets-kit rejections.
export const WALLET_REJECTION =
  /user (declined|rejected|denied|cancelled|canceled)|(declined|rejected|denied|cancelled|canceled) by (the )?user|request was rejected/i;

// Browser fetch failures: Chrome "Failed to fetch", Firefox "NetworkError when
// attempting to fetch resource", Safari "Load failed".
export const NETWORK_FAILURE =
  /failed to fetch|network ?error|load failed|fetch failed|network request failed/i;

// WalletConnect relay transport failures. "Failed to publish payload ... id:N
// tag:N" is core's 60-second expiring timer around a relay request, not a
// refusal from the relay: the socket never answered. Deliberately excludes
// "Wallet connection timed out", which means the user never approved.
export const WALLET_RELAY_FAILURE =
  /failed to publish payload|websocket connection failed|relayer connection|no internet connection/i;

/**
 * Map any thrown value — Error, string, or an API error body
 * (`{ error: { message, details } }`) — to user-friendly text plus optional
 * raw details for a disclosure affordance.
 *
 * Server-produced messages (AppError) are already friendly and pass through
 * unchanged; raw Soroban dumps are translated here as a backstop.
 */
export function friendlyError(err: unknown, fallback: string = DEFAULT_FALLBACK): FriendlyError {
  // API error body shape from errorResponse()
  if (err != null && typeof err === "object" && "error" in err) {
    const body = (err as { error?: { message?: unknown; details?: unknown } }).error;
    if (body != null && typeof body === "object" && typeof body.message === "string") {
      const details = typeof body.details === "string" && body.details ? body.details : undefined;
      return { message: body.message || fallback, details };
    }
  }

  const rawMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const message = rawMessage.trim() || fallback;

  if (WALLET_REJECTION.test(message)) {
    return { message: "Transaction cancelled in your wallet." };
  }
  if (NETWORK_FAILURE.test(message)) {
    return {
      message: "Couldn't reach the network. Check your connection and try again.",
    };
  }
  if (WALLET_RELAY_FAILURE.test(message)) {
    return {
      message: "Couldn't reach the wallet network. Try again, or use Freighter on desktop.",
      details: message,
    };
  }

  // Backstop: a raw Soroban simulation dump leaking through (older API
  // responses, direct RPC paths). Strip the prefix and translate.
  const simDump =
    /Soroban simulate failed(?: for [A-Z0-9]+)?:\s*([\s\S]+)/.exec(message)?.[1] ?? message;
  if (
    /HostError|Diagnostic Event|Error\((Contract|WasmVm|Storage|Auth|Budget|Context|Value),/.test(
      simDump,
    )
  ) {
    const t = translateSorobanError(simDump);
    return { message: t.friendly, details: message };
  }

  // An Error may carry server-provided details attached by the fetch layer.
  const attached = (err as { details?: unknown } | null)?.details;
  if (typeof attached === "string" && attached) {
    return { message, details: attached };
  }
  return { message };
}
