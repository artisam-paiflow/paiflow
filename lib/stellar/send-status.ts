import "server-only";
import type { rpc } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";

/**
 * What `sendTransaction` said, reduced to the one question every caller has:
 * is this hash in the network's queue or not?
 *
 * `TRY_AGAIN_LATER` is the answer that is easy to get wrong. It is not an
 * error, so a bare `status === "ERROR"` check lets it through as if it were
 * `PENDING`, but the RPC did not enqueue the transaction: the hash it returns
 * will read `NOT_FOUND` forever, and whoever polls it waits out their whole
 * finality budget for something that was never sent. It is what the network
 * says when the source account already has a transaction pending or the
 * queue is full, and the same signed envelope is safe to send again.
 */
export type SendOutcome =
  /** `duplicate`: an earlier send already queued this exact envelope. */
  { outcome: "QUEUED"; duplicate: boolean } | { outcome: "NOT_ACCEPTED" } | { outcome: "REJECTED" };

export function classifySend(send: Pick<rpc.Api.SendTransactionResponse, "status">): SendOutcome {
  switch (send.status) {
    case "PENDING":
      return { outcome: "QUEUED", duplicate: false };
    case "DUPLICATE":
      return { outcome: "QUEUED", duplicate: true };
    case "TRY_AGAIN_LATER":
      return { outcome: "NOT_ACCEPTED" };
    case "ERROR":
      return { outcome: "REJECTED" };
    default: {
      // A status this SDK version does not know must not be read as queued.
      const _exhaustive: never = send.status;
      throw new AppError("UPSTREAM_RPC", "The Soroban RPC answered with an unknown send status");
    }
  }
}

/** For a caller that holds the signed envelope and can send it again as is. */
export const SEND_NOT_ACCEPTED_MESSAGE =
  "The network is busy and did not accept the transaction; submit the same envelope again";
