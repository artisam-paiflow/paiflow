import { track } from "@/lib/analytics/client";

export type TxPollResult = { status: string; errorMessage?: string };

const BUDGET_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 8_000;

// A 429 or a 5xx says "ask again shortly" about the status endpoint; it says
// nothing about the transaction, which is already on the network.
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function abortError(): Error {
  return new Error("Polling aborted");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Polls `/api/deployments/:id/tx-status` until the transaction is final.
 * Resolves on SUCCESS or FAILED; rejects when its fate could not be learned.
 *
 * React-free on purpose: vitest runs under node with no jsdom, so the loop
 * lives here and `usePollTxStatus` only wraps it.
 */
export async function pollTxStatus(
  deploymentId: string,
  txHash: string,
  signal?: AbortSignal,
): Promise<TxPollResult> {
  const deadline = Date.now() + BUDGET_MS;
  let delay = POLL_INTERVAL_MS;
  let consecutiveRetries = 0;
  let lastRetryableStatus: number | undefined;

  for (;;) {
    // Each rejection below leaves the transaction's fate unknown, not failed:
    // it may still confirm. Analytics joins these on tx_hash against the
    // server's trigger_confirmed to measure how often the UI cries wolf.
    // An abort is the caller's own decision, so it is never reported as one.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      track("trigger_status_poll_failed", {
        deployment_id: deploymentId,
        tx_hash: txHash,
        reason: "timeout",
        ...(lastRetryableStatus === undefined ? {} : { http_status: lastRetryableStatus }),
      });
      throw new Error("Timed out waiting for finality");
    }
    // Clamped so a long backoff cannot carry the last check past the budget.
    await sleep(Math.min(delay, remaining), signal);

    let res: Response;
    let data: TxPollResult | null = null;
    try {
      res = await fetch(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`, { signal });
      if (res.ok) {
        const json = (await res.json()) as { data: TxPollResult };
        data = { status: json.data.status, errorMessage: json.data.errorMessage };
      }
    } catch {
      if (signal?.aborted) throw abortError();
      track("trigger_status_poll_failed", {
        deployment_id: deploymentId,
        tx_hash: txHash,
        reason: "network",
      });
      throw new Error("Network error while polling status");
    }

    if (!data) {
      if (isRetryable(res.status)) {
        lastRetryableStatus = res.status;
        delay = Math.min(POLL_INTERVAL_MS * 2 ** consecutiveRetries, MAX_BACKOFF_MS);
        consecutiveRetries += 1;
        continue;
      }
      track("trigger_status_poll_failed", {
        deployment_id: deploymentId,
        tx_hash: txHash,
        reason: "http_error",
        http_status: res.status,
      });
      throw new Error("Failed to check transaction status");
    }

    if (data.status === "SUCCESS") return { status: "SUCCESS" };
    if (data.status === "FAILED") return { status: "FAILED", errorMessage: data.errorMessage };
    consecutiveRetries = 0;
    lastRetryableStatus = undefined;
    delay = POLL_INTERVAL_MS;
  }
}
