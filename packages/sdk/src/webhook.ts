import {
  address,
  array,
  choice,
  hash,
  integer,
  network,
  nonempty,
  object,
  pattern,
  stroops,
  text,
  uuid,
} from "./read-parsers.js";
import type { PaiflowTransport, RequestOptions } from "./transport.js";

/** Releases from an already funded pool; omitted amount or "0" releases its whole balance. */
export interface WebhookEscrowInput {
  escrow: true;
  amount?: string;
}
/** Native execute: auth contains caller-signed Soroban authorization entries, never private keys. */
export interface WebhookNativeInput {
  escrow?: false;
  from: string;
  amount: string;
  auth?: string[];
}
export type WebhookTriggerInput = WebhookEscrowInput | WebhookNativeInput;
export interface WebhookUnkeyedOptions extends RequestOptions {
  webhookSecret: string;
}
export interface WebhookTriggerOptions extends WebhookUnkeyedOptions {
  /** Caller-persisted logical event identity; reuse with the same effective arguments. */
  idempotencyKey: string;
}
export interface ReleaseEarlyInput {
  nodeId?: string;
}
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new TypeError("Invalid SDK webhook/release input");
  }
};
const amount = (value: unknown) => stroops(pattern(value, /^(0|[1-9][0-9]*)$/));
const body = (value: WebhookTriggerInput): WebhookTriggerInput => {
  const d = object(value);
  if (d.escrow !== undefined && typeof d.escrow !== "boolean") throw new Error();
  if (d.escrow === true)
    return { escrow: true, ...(d.amount === undefined ? {} : { amount: amount(d.amount) }) };
  return {
    ...(d.escrow === false ? { escrow: false as const } : {}),
    from: address(d.from, "G"),
    amount: amount(d.amount),
    ...(d.auth === undefined ? {} : { auth: array(d.auth, nonempty, Number.MAX_SAFE_INTEGER) }),
  };
};
const parseAttempt = (value: unknown) => {
  const d = object(value);
  const error = d.error === undefined ? undefined : object(d.error);
  return {
    attemptId: uuid(d.attemptId),
    network: network(d.network),
    status: choice(d.status, ["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"]),
    ...(d.txHash === undefined ? {} : { txHash: hash(d.txHash) }),
    ...(d.ledger === undefined ? {} : { ledger: integer(d.ledger, 1) }),
    ...(error === undefined
      ? {}
      : { error: { code: text(error.code), message: text(error.message) } }),
  };
};
const parseUnkeyed = (value: unknown) => {
  const d = object(value);
  return {
    txHash: hash(d.txHash),
    ...(d.status === undefined ? {} : { status: choice(d.status, ["PENDING"]) }),
  };
};
const parseReleased = (value: unknown) => {
  const d = object(value);
  return {
    nodeId: text(d.nodeId),
    txHash: hash(d.txHash),
    ...(d.ledger === undefined ? {} : { ledger: integer(d.ledger, Number.MIN_SAFE_INTEGER) }),
  };
};
/** Durable keyed callback outcome; preserve the same event key and effective arguments.
 * @useDeclaredType
 */
export type WebhookAttempt = ReturnType<typeof parseAttempt>;
/** Legacy unkeyed callback hash; every deliberate call can pay again.
 * @useDeclaredType
 */
export type WebhookUnkeyedResult = ReturnType<typeof parseUnkeyed>;
/** Explicit early-release result with node ID, transaction hash and optional ledger.
 * @useDeclaredType
 */
export type Released = ReturnType<typeof parseReleased>;
export function webhookMethods(transport: PaiflowTransport, id: string) {
  const auth = (options: WebhookUnkeyedOptions) =>
    input(() => {
      const secret = pattern(options.webhookSecret, /^[^\x00-\x1f\x7f]+$/);
      return { kind: "webhook" as const, secret };
    });
  return {
    /** No automatic retries or key generation. UNKNOWN without a hash requires operator review. */
    trigger: (value: WebhookTriggerInput, options: WebhookTriggerOptions) =>
      transport.request(
        {
          path: `/api/webhooks/${id}`,
          method: "POST",
          auth: {
            ...auth(options),
            idempotencyKey: input(() =>
              pattern(options.idempotencyKey, /^[A-Za-z0-9._:-]{1,128}$/),
            ),
          },
          body: input(() => body(value)),
          parse: parseAttempt,
        },
        options,
      ),
    /** Legacy compatibility: every call can pay again. Never replay after an uncertain result. */
    triggerUnkeyed: (value: WebhookTriggerInput, options: WebhookUnkeyedOptions) =>
      transport.request(
        {
          path: `/api/webhooks/${id}`,
          method: "POST",
          auth: auth(options),
          body: input(() => body(value)),
          parse: parseUnkeyed,
        },
        options,
      ),
  };
}
export function releaseEarlyMethod(transport: PaiflowTransport, id: string) {
  return (value: ReleaseEarlyInput = {}, options?: RequestOptions) =>
    transport.request(
      {
        path: `/api/v1/deployments/${id}/release-early`,
        method: "POST",
        auth: { kind: "token" },
        body: input(() => {
          const d = object(value);
          return d.nodeId === undefined
            ? {}
            : { nodeId: pattern(text(d.nodeId).trim(), /^[\s\S]{1,128}$/) };
        }),
        parse: parseReleased,
      },
      options,
    );
}
