"use client";

import { useCallback } from "react";

export type TxPollResult = { status: string; errorMessage?: string };

export function usePollTxStatus(): (
  deploymentId: string,
  txHash: string,
  signal?: AbortSignal,
) => Promise<TxPollResult> {
  return useCallback((deploymentId: string, txHash: string, signal?: AbortSignal) => {
    return new Promise<TxPollResult>((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const interval = 2_000;

      const check = async () => {
        if (signal?.aborted) {
          reject(new Error("Polling aborted"));
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for finality"));
          return;
        }
        try {
          const res = await fetch(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`);
          if (!res.ok) {
            reject(new Error("Failed to check transaction status"));
            return;
          }
          const json = (await res.json()) as {
            data: { status: string; errorMessage?: string };
          };
          if (json.data.status === "SUCCESS") {
            resolve({ status: "SUCCESS" });
            return;
          }
          if (json.data.status === "FAILED") {
            resolve({ status: "FAILED", errorMessage: json.data.errorMessage });
            return;
          }
          setTimeout(check, interval);
        } catch {
          reject(new Error("Network error while polling status"));
        }
      };

      setTimeout(check, interval);
    });
  }, []);
}
