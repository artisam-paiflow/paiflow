import {
  address,
  array,
  choice,
  hash,
  network,
  nonempty,
  object,
  pattern,
  parseTransaction,
  stroops,
  text,
  timestamp,
  uuid,
} from "./read-parsers.js";
import { signPreparedEnvelope } from "./payment.js";
import type { PreparedSigner, SignOptions, SignedSubmission } from "./payment.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";

export type FundingAction = "schedule.fund" | "webhook.fund";
export interface FundingPrepareInput {
  nodeId?: string;
  fromAddress: string;
  tokenContractAddress: string;
  amountStroops: string;
}
export interface FundingReconcileInput {
  action: FundingAction;
  intent: string;
}
export interface FundingSubmitInput extends FundingReconcileInput, SignedSubmission {}
const action = (value: unknown) => choice(value, ["schedule.fund", "webhook.fund"]);
const amount = (value: unknown) => stroops(pattern(value, /^[1-9]\d{0,38}$/), true);
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new TypeError("Invalid SDK funding input");
  }
};
const preparationBody = (value: unknown) => {
  const body = object(value);
  return {
    ...(body.nodeId === undefined ? {} : { nodeId: pattern(body.nodeId, /^[\s\S]{1,128}$/) }),
    fromAddress: address(body.fromAddress, "G"),
    tokenContractAddress: address(body.tokenContractAddress, "C"),
    amountStroops: amount(body.amountStroops),
  };
};
const reconciliationBody = (body: FundingReconcileInput) => ({
  action: action(body.action),
  intent: uuid(body.intent),
});
const signedBody = (body: SignedSubmission) =>
  input(() => ({
    signedXdr: pattern(body.signedXdr, /^[\s\S]{1,100000}$/),
  }));
const parseDiscovery = (value: unknown) => {
  const d = object(value);
  return {
    deploymentId: uuid(d.deploymentId),
    network: network(d.network),
    nodes: array(
      d.nodes,
      (value) => {
        const n = object(value);
        return {
          nodeId: nonempty(n.nodeId),
          templateKind: choice(n.templateKind, ["STREAMER", "WEBHOOK"]),
          contractAddress: address(n.contractAddress, "C"),
          action: action(n.action),
          tokenContractAddress: address(n.tokenContractAddress, "C"),
          authorization: choice(n.authorization, ["funding_wallet"]),
          effect: text(n.effect),
        };
      },
      16,
    ),
  };
};
const parsePrepared = (value: unknown) => {
  const d = object(value),
    net = network(d.network);
  const passphrase = choice(d.networkPassphrase, [
    "Test SDF Network ; September 2015",
    "Public Global Stellar Network ; September 2015",
  ]);
  if (
    passphrase !==
    (net === "testnet"
      ? "Test SDF Network ; September 2015"
      : "Public Global Stellar Network ; September 2015")
  )
    throw new Error();
  return {
    fromAddress: address(d.fromAddress, "G"),
    tokenContractAddress: address(d.tokenContractAddress, "C"),
    amountStroops: amount(d.amountStroops),
    nodeId: nonempty(d.nodeId),
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    expiresAt: timestamp(d.expiresAt),
    xdr: nonempty(d.xdr),
    action: action(d.action),
    network: net,
    networkPassphrase: passphrase,
  };
};
const parseReconciled = (value: unknown) => {
  const d = object(value);
  return {
    intent: uuid(d.intent),
    action: action(d.action),
    txHash: hash(d.txHash),
    network: network(d.network),
    state: choice(d.state, ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
    expiresAt: timestamp(d.expiresAt),
  };
};
/** Eligible deployed funding nodes and assets; choose the node explicitly.
 * @useDeclaredType
 */
export type FundingDiscovery = ReturnType<typeof parseDiscovery>;
/** Reserved funding intent and unsigned original envelope, retained through recovery.
 * @useDeclaredType
 */
export type FundingPrepared = ReturnType<typeof parsePrepared>;
/** Funding transaction status, including unresolved UNKNOWN/REJECTED outcomes.
 * @useDeclaredType
 */
export type FundingSubmitted = ReturnType<typeof parseTransaction>;
/** Original funding reservation state; only terminal ledger evidence releases it.
 * @useDeclaredType
 */
export type FundingReconciled = ReturnType<typeof parseReconciled>;

/** Explicit funding only: never pays, triggers callbacks, retries or replaces an intent. */
export function fundingMethods(transport: PaiflowTransport, id: string) {
  const path = `/api/v1/deployments/${id}/funding`;
  return {
    get: (options?: RequestOptions) =>
      transport.request(
        {
          path,
          method: "GET",
          auth: { kind: "token" },
          parse: parseDiscovery,
        },
        options,
      ),
    /**
     * Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.
     * @param body - Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.
     * @param options - Timeout, cancellation and request correlation.
     * @returns Original intent, transaction and unsigned envelope; no submission occurs.
     */
    prepare: (body: FundingPrepareInput, options?: RequestOptions) =>
      transport.request(
        {
          path,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => preparationBody(body)),
          parse: parsePrepared,
        },
        options,
      ),
    /**
     * Submit the unchanged signed envelope for the original reserved intent. Never retried.
     * @param body - Original intent and wallet-signed XDR; do not rebuild after uncertainty.
     * @param options - Request options; retain the original preparationRequestId.
     * @returns Submission status; HTTP success alone is not financial success.
     */
    submit: (body: FundingSubmitInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/submit`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => ({ ...reconciliationBody(body), ...signedBody(body) })),
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
    reconcile: (body: FundingReconcileInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/reconcile`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => reconciliationBody(body)),
          parse: parseReconciled,
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
      prepared: ApiResponse<FundingPrepared>,
      signer: PreparedSigner,
      options: SignOptions,
    ) => {
      const data = input(() => parsePrepared(prepared.data));
      if (data.fromAddress !== options.walletAddress)
        throw new TypeError("Preparation funding wallet mismatch");
      // Check additive wallet metadata too, when present, without fabricating it.
      const result = await signPreparedEnvelope(prepared, signer, options, signedBody);
      return {
        ...result,
        submission: { action: data.action, intent: data.intent, ...result.submission },
      };
    },
  };
}
