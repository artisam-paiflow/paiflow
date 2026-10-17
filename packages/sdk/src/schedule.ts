import {
  address,
  boolean,
  choice,
  hash,
  network,
  nonempty,
  object,
  pattern,
  parseTransaction,
  timestamp,
  uuid,
} from "./read-parsers.js";
import { signPreparedEnvelope } from "./payment.js";
import type { PreparedSigner, SignOptions, SignedSubmission } from "./payment.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";

export type ScheduleAction = "pause" | "resume" | "retrieve";
export interface ScheduleStateQuery {
  nodeId?: string;
}
export interface SchedulePrepareInput extends ScheduleStateQuery {
  walletAddress: string;
}
export interface ScheduleReconcileInput {
  intent: string;
}
export interface ScheduleSubmitInput extends ScheduleReconcileInput, SignedSubmission {}
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new TypeError("Invalid SDK Schedule input");
  }
};
const nodeQuery = (value: ScheduleStateQuery): Record<string, string> =>
  value.nodeId === undefined ? {} : { nodeId: pattern(value.nodeId, /^[\s\S]{1,128}$/) };
const actor = (value: unknown) => {
  try {
    return address(value, "G");
  } catch {
    return address(value, "C");
  }
};
const amount = (value: unknown) => pattern(value, /^(0|[1-9][0-9]*)$/);
const parseState = (value: unknown) => {
  const d = object(value),
    e = object(d.controlEligibility);
  return {
    deploymentId: uuid(d.deploymentId),
    network: network(d.network),
    nodeId: nonempty(d.nodeId),
    contractAddress: address(d.contractAddress, "C"),
    controller: actor(d.controller),
    tokenContractAddress: address(d.tokenContractAddress, "C"),
    paused: boolean(d.paused),
    pauseAllowed: boolean(d.pauseAllowed),
    retrieveAllowed: boolean(d.retrieveAllowed),
    balanceStroops: amount(d.balanceStroops),
    availableStroops: amount(d.availableStroops),
    claimedStroops: amount(d.claimedStroops),
    unvestedStroops: amount(d.unvestedStroops),
    retrievableStroops: amount(d.retrievableStroops),
    retrievalRecipient: actor(d.retrievalRecipient),
    readAt: timestamp(d.readAt),
    controlEligibility: {
      walletProtocolSupported: boolean(e.walletProtocolSupported),
      pause: boolean(e.pause),
      resume: boolean(e.resume),
      retrieve: boolean(e.retrieve),
    },
  };
};
export interface SchedulePreparedBase<A extends ScheduleAction = ScheduleAction> {
  intent: string;
  txHash: string;
  expiresAt: string;
  unsignedXdr: string;
  network: "testnet" | "mainnet";
  action: A;
  nodeId: string;
  contractAddress: string;
  walletAddress: string;
}
export type SchedulePrepared<A extends ScheduleAction = ScheduleAction> = A extends "retrieve"
  ? SchedulePreparedBase<A> & {
      recipient: string;
      estimatedAmountStroops: string;
      tokenContractAddress: string;
    }
  : SchedulePreparedBase<A>;
const parsePrepared = <A extends ScheduleAction>(
  value: unknown,
  expected: A,
): SchedulePrepared<A> => {
  const d = object(value);
  const base = {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    expiresAt: timestamp(d.expiresAt),
    unsignedXdr: nonempty(d.unsignedXdr),
    network: network(d.network),
    action: choice(d.action, [expected]),
    nodeId: nonempty(d.nodeId),
    contractAddress: address(d.contractAddress, "C"),
    walletAddress: address(d.walletAddress, "G"),
  };
  // The conditional wire shape is selected by the action, never by optional invented fields.
  return (
    expected === "retrieve"
      ? {
          ...base,
          recipient: actor(d.recipient),
          estimatedAmountStroops: amount(d.estimatedAmountStroops),
          tokenContractAddress: address(d.tokenContractAddress, "C"),
        }
      : base
  ) as SchedulePrepared<A>;
};
const parseReconciled = <A extends ScheduleAction>(value: unknown, expected: A) => {
  const d = object(value);
  return {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    network: network(d.network),
    action: choice(d.action, [expected]),
    state: choice(d.state, ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
    replacementAllowed: boolean(d.replacementAllowed),
  };
};
const signedBody = (body: SignedSubmission) =>
  input(() => ({ signedXdr: pattern(body.signedXdr, /^[\s\S]{1,100000}$/) }));
/** Schedule controller, eligibility, holdings and entitlement as separate values.
 * @useDeclaredType
 */
export type ScheduleState = ReturnType<typeof parseState>;
/** Schedule control transaction status, not an automatic payout guarantee.
 * @useDeclaredType
 */
export type ScheduleSubmitted = ReturnType<typeof parseTransaction>;
/** Original wallet-control evidence. Preserve the intent and server replacement permission.
 * @useDeclaredType
 */
export type ScheduleReconciled<A extends ScheduleAction = ScheduleAction> = ReturnType<
  typeof parseReconciled<A>
>;
/** Explicit wallet controls. Reads and local expiry never authorize replacement or writes. */
export function scheduleMethods(transport: PaiflowTransport, id: string) {
  const path = `/api/v1/deployments/${id}/schedule`;
  const controls = <A extends ScheduleAction>(action: A) => ({
    /**
     * Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.
     * @param body - Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.
     * @param options - Timeout, cancellation and request correlation.
     * @returns Original intent, transaction and unsigned envelope; no submission occurs.
     */
    prepare: (body: SchedulePrepareInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/${action}`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => ({
            ...nodeQuery(body),
            walletAddress: address(body.walletAddress, "G"),
          })),
          parse: (value) => parsePrepared(value, action),
        },
        options,
      ),
    /**
     * Submit the unchanged signed envelope for the original reserved intent. Never retried.
     * @param body - Original intent and wallet-signed XDR; do not rebuild after uncertainty.
     * @param options - Request options; retain the original preparationRequestId.
     * @returns Submission status; HTTP success alone is not financial success.
     */
    submit: (body: ScheduleSubmitInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/${action}/submit`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => ({ intent: uuid(body.intent), ...signedBody(body) })),
          parse: parseTransaction,
        },
        options,
      ),
    /**
     * Reconcile the original reserved operation explicitly, without creating a replacement.
     * @param body - The original intent (and funding action where required).
     * @param options - Timeout, cancellation and correlation.
     * @returns Server finality/reservation evidence; elapsed time never permits replacement.
     */
    reconcile: (body: ScheduleReconcileInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/${action}/reconcile`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => ({ intent: uuid(body.intent) })),
          parse: (value) => parseReconciled(value, action),
        },
        options,
      ),
    /**
     * Ask the wallet to sign once; never submits, retries or checks finality.
     * @param prepared - Saved original preparation response, including history metadata.
     * @param signer - Application callback signing the unchanged envelope with the supplied passphrase.
     * @param options - Expected wallet/network, cancellation and signing deadline.
     * @returns Preserved preparation and explicit submission arguments/history options.
     */
    signPrepared: async (
      prepared: ApiResponse<SchedulePrepared<A>>,
      signer: PreparedSigner,
      options: SignOptions,
    ) => {
      const data = input(() => parsePrepared(prepared.data, action));
      const result = await signPreparedEnvelope(prepared, signer, options, signedBody);
      return { ...result, submission: { intent: data.intent, ...result.submission } };
    },
  });
  return {
    get: (query: ScheduleStateQuery = {}, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/state`,
          method: "GET",
          auth: { kind: "token" },
          query: input(() => nodeQuery(query)),
          parse: parseState,
        },
        options,
      ),
    pause: controls("pause"),
    resume: controls("resume"),
    retrieve: controls("retrieve"),
  };
}
