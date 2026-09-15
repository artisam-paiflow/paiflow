"use client";

import { useCallback } from "react";
import { track } from "@/lib/analytics/client";

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
        // Each rejection below leaves the transaction's fate unknown, not failed:
        // it may still confirm. Analytics joins these on tx_hash against the
        // server's trigger_confirmed to measure how often the UI cries wolf.
        if (Date.now() > deadline) {
          track("trigger_status_poll_failed", {
            deployment_id: deploymentId,
            tx_hash: txHash,
            reason: "timeout",
          });
          reject(new Error("Timed out waiting for finality"));
          return;
        }
        try {
          const res = await fetch(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`);
          if (!res.ok) {
            track("trigger_status_poll_failed", {
              deployment_id: deploymentId,
              tx_hash: txHash,
              reason: "http_error",
              http_status: res.status,
            });
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
          track("trigger_status_poll_failed", {
            deployment_id: deploymentId,
            tx_hash: txHash,
            reason: "network",
          });
          reject(new Error("Network error while polling status"));
        }
      };

      setTimeout(check, interval);
    });
  }, []);
}
