import {
  address,
  boolean,
  choice,
  hash,
  integer,
  network,
  object,
  parseAsset,
  parseTransaction,
  pattern,
  text,
  timestamp,
  uuid,
} from "./read-parsers.js";
import { signPreparedEnvelope } from "./payment.js";
import type { PreparedSigner, SignOptions, SignedSubmission } from "./payment.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";

export type SubscriptionAction = "subscription.cancel" | "subscription.reactivate";
export interface SubscriptionPrepareInput {
  walletAddress: string;
}
export interface SubscriptionReconcileInput {
  intent: string;
}
export interface SubscriptionSubmitInput extends SubscriptionReconcileInput, SignedSubmission {}
export interface AllowancePrepareInput {
  amount: string;
  userAddress: string;
}
export interface AllowanceStatusInput {
  intent: string;
}
export interface AllowanceSubmitInput extends AllowanceStatusInput, SignedSubmission {}
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new TypeError("Invalid SDK Subscription input");
  }
};
const amount = (value: unknown, positive = false) => {
  const result = pattern(value, /^[0-9]{1,39}$/);
  if (BigInt(result) > (1n << 127n) - 1n || (positive && BigInt(result) === 0n)) throw new Error();
  return result;
};
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
const passphrase = (value: unknown) => choice(value, Object.values(passphrases));
const opaque = (value: unknown) => pattern(value, /^[\s\S]{10,4096}$/);
const parsePublicState = (value: unknown) => {
  const d = object(value);
  return {
    deploymentId: uuid(d.deploymentId),
    flowName: text(d.flowName),
    network: network(d.network),
    contractAddress: address(d.contractAddress, "C"),
    tokenContractAddress: address(d.tokenContractAddress, "C"),
    subscriber: d.subscriber === null ? null : address(d.subscriber, "G"),
    isCancelled: boolean(d.isCancelled),
    asset: d.asset === null ? null : parseAsset(d.asset),
    assetLabel: text(d.assetLabel),
    allowance: amount(d.allowance),
    setupRequired: boolean(d.setupRequired),
  };
};
const parseState = (value: unknown) => ({
  ...parsePublicState(value),
  templateKind: choice(object(value).templateKind, ["SUBSCRIPTION", "SUBSCRIPTION_DEV"]),
});
const parsePrepared = <A extends SubscriptionAction>(value: unknown, expected: A) => {
  const d = object(value),
    net = network(d.network),
    phrase = passphrase(d.networkPassphrase);
  if (phrase !== passphrases[net]) throw new Error();
  return {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    expiresAt: timestamp(d.expiresAt),
    xdr: pattern(d.xdr, /^[\s\S]{1,200000}$/),
    network: net,
    networkPassphrase: phrase,
    action: choice(d.action, [expected]),
    walletAddress: address(d.walletAddress, "G"),
    nodeId: pattern(d.nodeId, /^[\s\S]+$/),
    contractAddress: address(d.contractAddress, "C"),
    tokenContractAddress: address(d.tokenContractAddress, "C"),
  };
};
const parseReconciled = <A extends SubscriptionAction>(value: unknown, expected: A) => {
  const d = object(value);
  return {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    action: choice(d.action, [expected]),
    state: choice(d.state, ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
    ledger: d.ledger === null ? null : integer(d.ledger, 1),
    replacementAllowed: boolean(d.replacementAllowed),
  };
};
const parseAllowancePrepared = (value: unknown) => {
  const d = object(value);
  return {
    xdr: pattern(d.xdr, /^[\s\S]{1,200000}$/),
    intent: opaque(d.intent),
    txHash: hash(d.txHash),
    networkPassphrase: passphrase(d.networkPassphrase),
    allowance: amount(d.allowance, true),
  };
};
const parseAllowanceStatus = (value: unknown) => {
  const d = object(value);
  return {
    txHash: hash(d.txHash),
    status: choice(d.status, ["SUCCESS", "FAILED", "PENDING"]),
    ...(d.errorMessage === undefined ? {} : { errorMessage: text(d.errorMessage) }),
  };
};
const controlSigned = (body: SignedSubmission) =>
  input(() => ({ signedXdr: pattern(body.signedXdr, /^[\s\S]{1,100000}$/) }));
const allowanceSigned = (body: SignedSubmission) =>
  input(() => ({ signedXdr: pattern(body.signedXdr, /^[\s\S]{10,200000}$/) }));
export type SubscriptionState = ReturnType<typeof parseState>;
export type SubscriptionPrepared<A extends SubscriptionAction = SubscriptionAction> = ReturnType<
  typeof parsePrepared<A>
>;
export type SubscriptionSubmitted = ReturnType<typeof parseTransaction>;
export type SubscriptionReconciled<A extends SubscriptionAction = SubscriptionAction> = ReturnType<
  typeof parseReconciled<A>
>;
export type AllowanceState = ReturnType<typeof parsePublicState>;
export type AllowancePrepared = ReturnType<typeof parseAllowancePrepared>;
export type AllowanceStatus = ReturnType<typeof parseAllowanceStatus>;
/** Explicit subscriber consent. No implicit charge, allowance, replacement or retries. */
export function subscriptionMethods(transport: PaiflowTransport, id: string) {
  const path = `/api/v1/deployments/${id}/subscription`,
    pub = `/api/deployments/${id}/subscription-allowance`;
  const controls = <A extends SubscriptionAction>(action: A) => {
    const route = `${path}/${action === "subscription.cancel" ? "cancel" : "reactivate"}`;
    return {
      prepare: (body: SubscriptionPrepareInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${route}/prepare`,
            method: "POST",
            auth: { kind: "token" },
            body: input(() => ({ walletAddress: address(body.walletAddress, "G") })),
            parse: (value) => parsePrepared(value, action),
          },
          options,
        ),
      submit: (body: SubscriptionSubmitInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${route}/submit`,
            method: "POST",
            auth: { kind: "token" },
            body: input(() => ({ intent: uuid(body.intent), ...controlSigned(body) })),
            parse: parseTransaction,
          },
          options,
        ),
      reconcile: (body: SubscriptionReconcileInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${route}/reconcile`,
            method: "POST",
            auth: { kind: "token" },
            body: input(() => ({ intent: uuid(body.intent) })),
            parse: (value) => parseReconciled(value, action),
          },
          options,
        ),
      signPrepared: async (
        prepared: ApiResponse<SubscriptionPrepared<A>>,
        signer: PreparedSigner,
        options: SignOptions,
      ) => {
        const data = input(() => parsePrepared(prepared.data, action));
        const result = await signPreparedEnvelope(prepared, signer, options, controlSigned);
        return { ...result, submission: { intent: data.intent, ...result.submission } };
      },
    };
  };
  return {
    get: (options?: RequestOptions) =>
      transport.request(
        { path: `${path}/state`, method: "GET", auth: { kind: "token" }, parse: parseState },
        options,
      ),
    cancel: controls("subscription.cancel"),
    reactivate: controls("subscription.reactivate"),
    allowance: {
      get: (options?: RequestOptions) =>
        transport.request(
          { path: pub, method: "GET", auth: { kind: "public" }, parse: parsePublicState },
          options,
        ),
      prepare: (body: AllowancePrepareInput, options?: RequestOptions) =>
        transport.request(
          {
            path: pub,
            method: "POST",
            auth: { kind: "public" },
            body: input(() => ({
              amount: amount(body.amount, true),
              userAddress: address(body.userAddress, "G"),
            })),
            parse: parseAllowancePrepared,
          },
          options,
        ),
      submit: (body: AllowanceSubmitInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${pub}/submit`,
            method: "POST",
            auth: { kind: "public" },
            body: input(() => ({ intent: opaque(body.intent), ...allowanceSigned(body) })),
            parse: parseAllowanceStatus,
          },
          options,
        ),
      status: (query: AllowanceStatusInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${pub}/status`,
            method: "GET",
            auth: { kind: "public" },
            query: input(() => ({ intent: opaque(query.intent) })),
            parse: parseAllowanceStatus,
          },
          options,
        ),
      /** State is explicitly supplied because preparation does not expose subscriber identity. */
      signPrepared: async (
        prepared: ApiResponse<AllowancePrepared>,
        state: ApiResponse<AllowanceState>,
        signer: PreparedSigner,
        options: SignOptions,
      ) => {
        const data = input(() => parseAllowancePrepared(prepared.data)),
          current = input(() => parsePublicState(state.data));
        if (
          current.deploymentId !== id ||
          current.setupRequired ||
          current.subscriber === null ||
          current.isCancelled ||
          current.subscriber !== options.walletAddress ||
          data.networkPassphrase !== passphrases[current.network]
        )
          throw new TypeError("Allowance state or subscriber mismatch");
        const result = await signPreparedEnvelope(prepared, signer, options, allowanceSigned);
        return { ...result, submission: { intent: data.intent, ...result.submission } };
      },
    },
  };
}
