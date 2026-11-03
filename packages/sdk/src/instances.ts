import {
  address,
  array,
  boolean,
  choice,
  hash,
  integer,
  network,
  nullable,
  object,
  pattern,
  stroops,
  text,
  timestamp,
  uuid,
} from "./read-parsers.js";
import { signPreparedEnvelope } from "./payment.js";
import type { PreparedSigner, SignOptions } from "./payment.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";

const canonicalUuid = (value: unknown) => uuid(value).toLowerCase();
/** Explicit typed creation value; this grants no execution or mutation authority. */
export type CreationValue =
  | { type: "wallet" | "contract" | "stroops" | "timestamp" | "text"; value: string }
  | { type: "integer" | "bps"; value: number }
  | { type: "boolean"; value: boolean };
export interface CreationBindings {
  version: 1;
  templateVersionId: string;
  values: Array<{ inputId: string; value: CreationValue }>;
}
/** Retain this key and exact request before preparing; never generate a replacement after uncertainty. */
export interface InstancePrepareInput {
  sourceAccount: string;
  bindings: CreationBindings;
  idempotencyKey: string;
}
export interface InstanceListQuery {
  cursor?: string;
  limit?: number;
}
export interface InstanceEventsQuery {
  cursor?: string;
  limit?: number;
  txHash?: string;
}
const exact = (value: unknown, keys: string[]) => {
  const result = object(value);
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new Error();
  return result;
};
const parseValue = (value: unknown): CreationValue => {
  const d = exact(value, ["type", "value"]);
  const type = choice(d.type, [
    "wallet",
    "contract",
    "stroops",
    "timestamp",
    "text",
    "integer",
    "bps",
    "boolean",
  ]);
  switch (type) {
    case "wallet":
      return { type, value: address(d.value, "G") };
    case "contract":
      return { type, value: address(d.value, "C") };
    case "stroops":
      return { type, value: stroops(pattern(d.value, /^[1-9]\d*$/), true) };
    case "timestamp":
      return { type, value: timestamp(d.value) };
    case "text":
      return { type, value: pattern(d.value, /^[\s\S]{0,280}$/) };
    case "integer":
      return { type, value: integer(d.value) };
    case "bps":
      return { type, value: integer(d.value, 1, 10000) };
    case "boolean":
      return { type, value: boolean(d.value) };
  }
};
const parseBindings = (value: unknown): CreationBindings => {
  const d = exact(value, ["version", "templateVersionId", "values"]);
  if (d.version !== 1) throw new Error();
  const values = array(
    d.values,
    (value) => {
      const row = exact(value, ["inputId", "value"]);
      return {
        inputId: pattern(row.inputId, /^[A-Za-z0-9_-]{1,64}$/),
        value: parseValue(row.value),
      };
    },
    256,
  );
  if (new Set(values.map((row) => row.inputId)).size !== values.length) throw new Error();
  return { version: 1, templateVersionId: canonicalUuid(d.templateVersionId), values };
};
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
function parseInstance(value: unknown) {
  const d = object(value),
    net = network(d.network),
    sourceAccount = address(d.sourceAccount, "G");
  const status = choice(d.status, [
    "DRAFT",
    "BUILDING",
    "PENDING_SIGNATURE",
    "SUBMITTED",
    "CONFIRMED",
    "FAILED",
  ]);
  const txHash = nullable(d.txHash, hash);
  const prepared =
    d.prepared === null
      ? null
      : (() => {
          const p = object(d.prepared);
          const result = {
            xdr: pattern(p.xdr, /^[\s\S]{10,200000}$/),
            networkPassphrase: choice(p.networkPassphrase, Object.values(passphrases)),
            txHash: hash(p.txHash),
            expiresAt: timestamp(p.expiresAt),
            feeStroops: stroops(p.feeStroops),
          };
          if (
            result.networkPassphrase !== passphrases[net] ||
            result.txHash !== txHash ||
            status !== "PENDING_SIGNATURE"
          )
            throw new Error();
          return result;
        })();
  return {
    deploymentId: canonicalUuid(d.deploymentId),
    templateId: canonicalUuid(d.templateId),
    templateVersionId: canonicalUuid(d.templateVersionId),
    network: net,
    sourceAccount,
    status,
    serviceState: choice(d.serviceState, ["ACTIVE", "RETIRING", "RETIRED"]),
    txHash,
    contractAddress: nullable(d.contractAddress, (value) => address(value, "C")),
    pipeline: array(
      d.pipeline,
      (value) => {
        const p = object(value);
        return {
          nodeId: text(p.nodeId),
          contractAddress: address(p.contractAddress, "C"),
          templateKind: text(p.templateKind),
        };
      },
      40,
    ),
    prepared,
  };
}
/** Private instance state; SUBMITTED is not finality, and BUILDING never means retry with a new key. */
export type InstanceState = ReturnType<typeof parseInstance>;
export interface InstanceList {
  items: InstanceState[];
  nextCursor: string | null;
}
const input = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch {
    throw new TypeError("Invalid SDK instance input");
  }
};

/** An explicitly granted private template. Construction performs no request. */
export class PaiflowTemplate {
  readonly instances;
  constructor(
    private readonly transport: PaiflowTransport,
    readonly templateId: string,
  ) {
    this.templateId = input(() => canonicalUuid(templateId));
    const base = `/api/v1/flow-templates/${this.templateId}`;
    const path = (instanceId: string) =>
      `${base}/instances/${input(() => canonicalUuid(instanceId))}`;
    const state = (value: unknown) => {
      const result = parseInstance(value);
      if (result.templateId !== this.templateId) throw new Error();
      return result;
    };
    const instanceScope = (instanceId: string) => {
      const expectedId = input(() => canonicalUuid(instanceId));
      return {
        path: `${base}/instances/${expectedId}`,
        parse: (value: unknown) => {
          const result = state(value);
          if (result.deploymentId !== expectedId) throw new Error();
          return result;
        },
      };
    };
    this.instances = {
      prepare: (versionId: string, body: InstancePrepareInput, options?: RequestOptions) => {
        const version = input(() => canonicalUuid(versionId));
        const checked = input(() => {
          const d = exact(body, ["sourceAccount", "bindings", "idempotencyKey"]);
          const bindings = parseBindings(d.bindings);
          if (bindings.templateVersionId !== version) throw new Error();
          return {
            sourceAccount: address(d.sourceAccount, "G"),
            bindings,
            idempotencyKey: pattern(d.idempotencyKey, /^[A-Za-z0-9_-]{16,128}$/),
          };
        });
        return transport.request(
          {
            path: `${base}/versions/${version}/instances/prepare`,
            method: "POST",
            auth: { kind: "token" },
            body: checked,
            parse: (value) => {
              const result = state(value);
              if (
                result.templateVersionId !== version ||
                result.sourceAccount !== checked.sourceAccount
              )
                throw new Error();
              return result;
            },
          },
          options,
        );
      },
      list: (query: InstanceListQuery = {}, options?: RequestOptions) =>
        transport.request(
          {
            path: `${base}/instances`,
            method: "GET",
            auth: { kind: "token" },
            query: input(() => ({
              ...(query.cursor === undefined ? {} : { cursor: canonicalUuid(query.cursor) }),
              ...(query.limit === undefined ? {} : { limit: String(integer(query.limit, 1, 100)) }),
            })),
            parse: (value): InstanceList => {
              const d = object(value);
              return {
                items: array(d.items, state, 100),
                nextCursor: nullable(d.nextCursor, uuid),
              };
            },
          },
          options,
        ),
      get: (instanceId: string, options?: RequestOptions) => {
        const scope = instanceScope(instanceId);
        return transport.request(
          { path: scope.path, method: "GET", auth: { kind: "token" }, parse: scope.parse },
          options,
        );
      },
      submit: (instanceId: string, body: { signedXdr: string }, options?: RequestOptions) => {
        const scope = instanceScope(instanceId);
        return transport.request(
          {
            path: `${scope.path}/submit`,
            method: "POST",
            auth: { kind: "token" },
            body: input(() => {
              const d = exact(body, ["signedXdr"]);
              return { signedXdr: pattern(d.signedXdr, /^[\s\S]{10,200000}$/) };
            }),
            parse: scope.parse,
          },
          options,
        );
      },
      reconcile: (instanceId: string, options?: RequestOptions) => {
        const scope = instanceScope(instanceId);
        return transport.request(
          {
            path: `${scope.path}/reconcile`,
            method: "POST",
            auth: { kind: "token" },
            body: {},
            parse: scope.parse,
          },
          options,
        );
      },
      events: (instanceId: string, query: InstanceEventsQuery = {}, options?: RequestOptions) =>
        transport.request(
          {
            path: `${path(instanceId)}/events`,
            method: "GET",
            auth: { kind: "token" },
            query: input(() => ({
              ...(query.cursor === undefined
                ? {}
                : { cursor: pattern(query.cursor, /^[\s\S]{1,512}$/) }),
              ...(query.limit === undefined ? {} : { limit: String(integer(query.limit, 1, 100)) }),
              ...(query.txHash === undefined ? {} : { txHash: hash(query.txHash) }),
            })),
            parse: (value) => {
              const d = object(value);
              return {
                items: array(
                  d.items,
                  (value) => {
                    const e = object(value);
                    return {
                      id: canonicalUuid(e.id),
                      eventId: text(e.eventId),
                      kind: text(e.kind),
                      ledger: integer(e.ledger, 1),
                      txHash: hash(e.txHash),
                      occurredAt: timestamp(e.occurredAt),
                      data: e.data,
                    };
                  },
                  100,
                ),
                nextCursor: nullable(d.nextCursor, text),
                hasMore: boolean(d.hasMore),
              };
            },
          },
          options,
        ),
      /** Sign the retained exact preparation once. This helper never submits or polls. */
      sign: async (
        prepared: ApiResponse<InstanceState>,
        signer: PreparedSigner,
        options: SignOptions,
      ) => {
        const d = input(() => parseInstance(prepared.data));
        if (
          !d.prepared ||
          d.status !== "PENDING_SIGNATURE" ||
          d.serviceState !== "ACTIVE" ||
          d.templateId !== this.templateId
        )
          throw new TypeError("No active original instance preparation is available");
        const signed = await signPreparedEnvelope(
          {
            ...prepared,
            data: { ...d.prepared, network: d.network, walletAddress: d.sourceAccount },
          },
          signer,
          options,
          (value) => ({ signedXdr: pattern(value.signedXdr, /^[\s\S]{10,200000}$/) }),
        );
        return { ...signed, preparation: prepared };
      },
    };
  }
}
