"use client";

import { useCallback } from "react";
import { pollTxStatus, type TxPollResult } from "@/lib/tx-status-poll";

export type { TxPollResult };

export function usePollTxStatus(): (
  deploymentId: string,
  txHash: string,
  signal?: AbortSignal,
) => Promise<TxPollResult> {
  return useCallback(
    (deploymentId: string, txHash: string, signal?: AbortSignal) =>
      pollTxStatus(deploymentId, txHash, signal),
    [],
  );
}
