import {
  address,
  array,
  choice,
  hash,
  integer,
  network,
  object,
  pattern,
  timestamp,
  uuid,
  parseTransaction,
  stroops,
} from "./read-parsers.js";
import {
  parseExecutionArguments,
  parseExecutionAllocation,
  parseExecutionDiscovery,
  parseExecutionRevision,
  parseStoredConfiguration,
  type ExecutionAllocation,
  type ExecutionRowInput,
  type ExecutionAdditionalRecipient,
} from "./execution.js";
import { signPreparedEnvelope, type PreparedSigner, type SignOptions } from "./payment.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";

export type MutationChange =
  | {
      kind: "pay";
      nodeId: string;
      expectedRevision: string;
      recipient?: string;
      payoutValue?: ExecutionAllocation;
    }
  | {
      kind: "split";
      nodeId: string;
      expectedRevision: string;
      rows: ExecutionRowInput[];
      additionalRecipients?: ExecutionAdditionalRecipient[];
    };
export interface MutationArguments {
  version: 1;
  changes: MutationChange[];
}
export interface MutationPrepareInput {
  admin: string;
  arguments: MutationArguments;
}
export interface MutationSubmitInput {
  intent: string;
  signedXdr: string;
}
export interface MutationReconcileInput {
  intent: string;
}
export interface ConfigurationHistoryQuery {
  limit?: number;
  cursor?: string;
}
const keys = (d: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(d).some((k) => !allowed.includes(k))) throw new Error();
};
const nodeId = (v: unknown) => pattern(v, /^[A-Za-z0-9_-]{1,64}$/);
const input = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch {
    throw new TypeError("Invalid SDK configuration input");
  }
};
function parseArguments(raw: unknown): MutationArguments {
  const d = object(raw);
  keys(d, ["version", "changes"]);
  if (d.version !== 1) throw new Error();
  const changes = array(
    d.changes,
    (raw): MutationChange => {
      const c = object(raw),
        base = {
          nodeId: nodeId(c.nodeId),
          expectedRevision: parseExecutionRevision(c.expectedRevision),
        };
      if (c.kind === "pay") {
        keys(c, ["kind", "nodeId", "expectedRevision", "recipient", "payoutValue"]);
        if (c.recipient === undefined && c.payoutValue === undefined) throw new Error();
        return {
          ...base,
          kind: "pay",
          ...(c.recipient === undefined ? {} : { recipient: address(c.recipient, "G") }),
          ...(c.payoutValue === undefined
            ? {}
            : { payoutValue: parseExecutionAllocation(c.payoutValue) }),
        };
      }
      if (c.kind !== "split") throw new Error();
      keys(c, ["kind", "nodeId", "expectedRevision", "rows", "additionalRecipients"]);
      const split = parseExecutionArguments({
        version: 1,
        inputs: [
          {
            kind: "split",
            nodeId: base.nodeId,
            rows: c.rows,
            ...(c.additionalRecipients === undefined
              ? {}
              : { additionalRecipients: c.additionalRecipients }),
          },
        ],
      }).inputs[0]!;
      if (
        split.kind !== "split" ||
        (!split.rows.length && split.additionalRecipients === undefined)
      )
        throw new Error();
      return { ...split, expectedRevision: base.expectedRevision };
    },
    40,
  );
  if (!changes.length || new Set(changes.map((c) => c.nodeId)).size !== changes.length)
    throw new Error();
  return { version: 1, changes };
}
function parseIntent(raw: unknown) {
  const d = object(raw);
  if (d.version !== 1) throw new Error();
  const nodes = array(
    d.nodes,
    (raw) => {
      const n = object(raw);
      return {
        nodeId: nodeId(n.nodeId),
        contractAddress: address(n.contractAddress, "C"),
        expectedRevision: parseExecutionRevision(n.expectedRevision),
      };
    },
    40,
  );
  const artifacts = array(
    d.artifacts,
    (raw) => {
      const a = object(raw);
      return {
        nodeId: nodeId(a.nodeId),
        contractAddress: address(a.contractAddress, "C"),
        wasmHash: hash(a.wasmHash),
      };
    },
    40,
  );
  const args = parseArguments(d.arguments);
  if (
    nodes.length < 2 ||
    new Set(nodes.map((n) => n.nodeId)).size !== nodes.length ||
    new Set(nodes.map((n) => n.contractAddress)).size !== nodes.length ||
    nodes[0]!.contractAddress !== d.rootContract ||
    artifacts.length !== nodes.length ||
    artifacts.some(
      (a, i) => a.nodeId !== nodes[i]!.nodeId || a.contractAddress !== nodes[i]!.contractAddress,
    ) ||
    args.changes.some(
      (c) => !nodes.some((n) => n.nodeId === c.nodeId && n.expectedRevision === c.expectedRevision),
    )
  )
    throw new Error();
  return {
    version: 1 as const,
    deploymentId: uuid(d.deploymentId).toLowerCase(),
    network: network(d.network),
    admin: address(d.admin, "G"),
    rootContract: address(d.rootContract, "C"),
    nodes,
    arguments: args,
    artifacts,
  };
}
function parsePrepared(raw: unknown) {
  const d = object(raw),
    mutation = parseIntent(d.mutation),
    net = network(d.network);
  const passphrase = choice(d.networkPassphrase, [
    "Test SDF Network ; September 2015",
    "Public Global Stellar Network ; September 2015",
  ]);
  if (
    net !== mutation.network ||
    d.walletAddress !== mutation.admin ||
    passphrase !==
      (net === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015")
  )
    throw new Error();
  return {
    intent: uuid(d.intent).toLowerCase(),
    txHash: hash(d.txHash),
    walletAddress: address(d.walletAddress, "G"),
    xdr: pattern(d.xdr, /^[\s\S]{1,200000}$/),
    expiresAt: timestamp(d.expiresAt),
    network: net,
    networkPassphrase: passphrase,
    feeStroops: stroops(d.feeStroops, true),
    mutation,
  };
}
export type MutationPrepared = ReturnType<typeof parsePrepared>;
export type MutationState = ReturnType<typeof parseState>;
export type MutationSubmitted = ReturnType<typeof parseTransaction>;
function parseState(raw: unknown) {
  const d = object(raw),
    state = parseExecutionDiscovery(raw);
  if (
    !state.supported ||
    state.nodes.some((n) => !n.capabilities.mutation) ||
    d.mutationSupported !== true
  )
    throw new Error();
  const obligations = array(
    d.obligations,
    (raw) => {
      const o = object(raw);
      return {
        nodeId: nodeId(o.nodeId),
        obligationsStroops: pattern(o.obligationsStroops, /^(0|[1-9]\d{0,38})$/),
      };
    },
    39,
  );
  if (
    obligations.length !== state.nodes.length - 1 ||
    obligations.some(
      (o, i) =>
        o.nodeId !== state.nodes[i + 1]!.nodeId || BigInt(o.obligationsStroops) > 2n ** 127n - 1n,
    )
  )
    throw new Error();
  return { ...state, admin: address(d.admin, "G"), mutationSupported: true as const, obligations };
}
function parseHistory(raw: unknown) {
  const d = object(raw);
  if (d.coverage !== "observed-revisions-only" || d.historyComplete !== false) throw new Error();
  return {
    deploymentId: uuid(d.deploymentId).toLowerCase(),
    network: network(d.network),
    coverage: "observed-revisions-only" as const,
    historyComplete: false as const,
    revisionCoverage: array(
      d.revisionCoverage,
      (raw) => {
        const c = object(raw);
        return {
          nodeId: nodeId(c.nodeId),
          highestObservedRevision: parseExecutionRevision(c.highestObservedRevision),
          observedRevisionCount: pattern(c.observedRevisionCount, /^[1-9]\d*$/),
          missingRevisionCount: pattern(c.missingRevisionCount, /^(0|[1-9]\d*)$/),
        };
      },
      39,
    ),
    items: array(
      d.items,
      (raw) => {
        const item = object(raw),
          ledger = integer(item.observedLedger, 1, 0xffff_ffff);
        return {
          id: uuid(item.id),
          configuration: parseStoredConfiguration({
            ...object(item.configuration),
            confirmedLedger: ledger,
          }),
          observedLedger: ledger,
          eventLedger: item.eventLedger === null ? null : integer(item.eventLedger, 1, 0xffff_ffff),
          eventId: item.eventId === null ? null : pattern(item.eventId, /^[\s\S]{1,256}$/),
          txHash: item.txHash === null ? null : hash(item.txHash),
        };
      },
      100,
    ),
    nextCursor: d.nextCursor === null ? null : uuid(d.nextCursor),
  };
}
export type ConfigurationHistory = ReturnType<typeof parseHistory>;
/** Admin-owned stored updates. API credentials supply access, never on-chain consent.
 * No automatic polling, re-signing, resubmission or replacement after uncertainty. */
export function mutationMethods(transport: PaiflowTransport, rawId: string) {
  const id = input(() => uuid(rawId).toLowerCase()),
    path = `/api/v1/deployments/${id}/configuration`;
  const scoped =
    <T extends { deploymentId: string }>(parse: (v: unknown) => T) =>
    (raw: unknown) => {
      const d = parse(raw);
      if (d.deploymentId !== id) throw new Error();
      return d;
    };
  const prepared = (raw: unknown) => {
    const d = parsePrepared(raw);
    if (d.mutation.deploymentId !== id) throw new Error();
    return d;
  };
  const signedBody = (body: MutationSubmitInput) =>
    input(() => {
      keys(object(body), ["intent", "signedXdr"]);
      return {
        intent: uuid(body.intent).toLowerCase(),
        signedXdr: pattern(body.signedXdr, /^[\s\S]{1,200000}$/),
      };
    });
  return {
    get: (options?: RequestOptions) =>
      transport.request(
        {
          path,
          method: "GET",
          auth: { kind: "token" },
          parse: scoped(parseState),
          maxResponseBytes: 4194304,
        },
        options,
      ),
    history: (query: ConfigurationHistoryQuery = {}, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/history`,
          method: "GET",
          auth: { kind: "token" },
          query: input(() => ({
            ...(query.limit === undefined ? {} : { limit: String(integer(query.limit, 1, 100)) }),
            ...(query.cursor === undefined ? {} : { cursor: uuid(query.cursor) }),
          })),
          parse: scoped(parseHistory),
          maxResponseBytes: 4194304,
        },
        options,
      ),
    prepare: (body: MutationPrepareInput, options?: RequestOptions) => {
      if (!options?.idempotencyKey)
        throw new TypeError("Mutation preparation requires idempotencyKey");
      const request = input(() => {
        keys(object(body), ["admin", "arguments"]);
        return { admin: address(body.admin, "G"), arguments: parseArguments(body.arguments) };
      });
      return transport.request(
        {
          path: `${path}/prepare`,
          method: "POST",
          auth: { kind: "token" },
          body: request,
          parse: (raw) => {
            const data = prepared(raw);
            if (
              data.mutation.admin !== request.admin ||
              JSON.stringify(data.mutation.arguments) !== JSON.stringify(request.arguments)
            )
              throw new Error();
            return data;
          },
          maxResponseBytes: 4194304,
        },
        options,
      );
    },
    submit: (body: MutationSubmitInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/submit`,
          method: "POST",
          auth: { kind: "token" },
          body: signedBody(body),
          parse: parseTransaction,
        },
        options,
      ),
    reconcile: (body: MutationReconcileInput, options?: RequestOptions) =>
      transport.request(
        {
          path: `${path}/reconcile`,
          method: "POST",
          auth: { kind: "token" },
          body: input(() => {
            keys(object(body), ["intent"]);
            return { intent: uuid(body.intent) };
          }),
          parse: (raw) => {
            const d = object(raw);
            if (uuid(d.intent).toLowerCase() !== uuid(body.intent).toLowerCase()) throw new Error();
            return {
              intent: uuid(d.intent).toLowerCase(),
              state: choice(d.state, ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
              transaction: parseTransaction(d.transaction),
            };
          },
        },
        options,
      ),
    signPrepared: async (
      preparation: ApiResponse<MutationPrepared>,
      signer: PreparedSigner,
      options: SignOptions,
    ) => {
      const data = input(() => prepared(preparation.data));
      if (data.walletAddress !== options.walletAddress)
        throw new TypeError("Mutation admin wallet mismatch");
      return signPreparedEnvelope(preparation, signer, options, (body) =>
        signedBody({ intent: data.intent, ...body }),
      );
    },
  };
}
