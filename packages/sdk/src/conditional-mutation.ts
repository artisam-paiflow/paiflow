/** Explicit v2 value readers. Parsing proves coherent evidence, never chain
 * provenance, artifact capability, XDR operations or atomic admission. */
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
  stroops,
  parseTransaction,
} from "./read-parsers.js";
import {
  parseExecutionAllocation,
  parseExecutionArguments,
  parseExecutionRevision,
} from "./execution.js";
import {
  parseConditionalDefinition,
  parseConditionalNodeBindings,
  parseConditionalNodeState,
  parseConditionalExecutionDiscovery,
  type ConditionalDefinition,
} from "./conditional-execution.js";
import type {
  MutationChange,
  MutationSubmitInput,
  MutationReconcileInput,
  ConfigurationHistoryQuery,
} from "./mutation.js";
import type { PaiflowTransport, RequestOptions } from "./transport.js";

export type ConditionalMutationChange =
  | MutationChange
  | { kind: "condition"; nodeId: string; expectedRevision: string; thresholdStroops: string };
export interface ConditionalMutationArguments {
  version: 2;
  changes: ConditionalMutationChange[];
}
export interface ConditionalMutationPrepareInput {
  admin: string;
  arguments: ConditionalMutationArguments;
}
const exact = (v: unknown, keys: string[]) => {
  const d = object(v);
  if (Object.keys(d).some((k) => !keys.includes(k))) throw new Error();
  return d;
};
const id = (v: unknown) => pattern(v, /^[A-Za-z0-9_-]{1,64}$/);
const amount = (v: unknown, positive = false) => stroops(pattern(v, /^(0|[1-9]\d*)$/), positive);
const unique = (v: string[]) => {
  if (new Set(v).size !== v.length) throw new Error();
};
const sameUuid = (a: unknown, b: unknown) => uuid(a).toLowerCase() === uuid(b).toLowerCase();
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aa = object(a),
      bb = object(b),
      keys = Object.keys(aa).filter((k) => aa[k] !== undefined);
    return (
      keys.length === Object.keys(bb).filter((k) => bb[k] !== undefined).length &&
      keys.every((k) => Object.hasOwn(bb, k) && same(aa[k], bb[k]))
    );
  }
  return false;
};
const input = <T>(f: () => T): T => {
  try {
    return f();
  } catch {
    throw new TypeError("Invalid SDK conditional configuration input");
  }
};
export function parseConditionalMutationArguments(value: unknown): ConditionalMutationArguments {
  const d = exact(value, ["version", "changes"]);
  if (d.version !== 2) throw new Error();
  const changes = array(
    d.changes,
    (v): ConditionalMutationChange => {
      const c = object(v),
        base = {
          nodeId: id(c.nodeId),
          expectedRevision: parseExecutionRevision(c.expectedRevision),
        };
      if (c.kind === "condition") {
        exact(c, ["kind", "nodeId", "expectedRevision", "thresholdStroops"]);
        return { ...base, kind: "condition", thresholdStroops: amount(c.thresholdStroops) };
      }
      if (c.kind === "pay") {
        exact(c, ["kind", "nodeId", "expectedRevision", "recipient", "payoutValue"]);
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
      exact(c, ["kind", "nodeId", "expectedRevision", "rows", "additionalRecipients"]);
      if (c.kind !== "split") throw new Error();
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
  if (!changes.length) throw new Error();
  unique(changes.map((c) => c.nodeId));
  return { version: 2, changes };
}
function validateGroup(
  definition: ConditionalDefinition,
  nodes: ReturnType<typeof parseConditionalNodeBindings>,
  args: ConditionalMutationArguments,
) {
  const next = structuredClone(definition);
  let previous = -1;
  for (const c of args.changes) {
    const position = nodes.findIndex((n) => n.nodeId === c.nodeId),
      binding = nodes[position];
    if (
      position <= previous ||
      !binding ||
      binding.expectedRevision !== c.expectedRevision ||
      BigInt(c.expectedRevision) === (1n << 64n) - 1n
    )
      throw new Error();
    previous = position;
    if (c.kind === "condition") {
      if (
        c.nodeId !== next.condition.nodeId ||
        next.condition.thresholdMode !== "mutable" ||
        c.thresholdStroops === next.condition.thresholdStroops
      )
        throw new Error();
      next.condition.thresholdStroops = c.thresholdStroops;
      continue;
    }
    const n = [...next.prefix, next.trueBranch, next.falseBranch].find(
      (n) => n.nodeId === c.nodeId,
    );
    if (!n || n.kind !== c.kind) throw new Error();
    const before = structuredClone(n);
    if (c.kind === "pay" && n.kind === "pay") {
      if (c.recipient !== undefined) {
        if (n.policy.recipient !== "mutable") throw new Error();
        n.configuration.recipient = c.recipient;
      }
      if (c.payoutValue !== undefined) {
        if (
          n.policy.payoutValue !== "mutable" ||
          n.configuration.payoutValue.kind !== c.payoutValue.kind
        )
          throw new Error();
        n.configuration.payoutValue = c.payoutValue;
      }
    } else if (c.kind === "split" && n.kind === "split") {
      for (const patch of c.rows) {
        const i = n.policy.rows.findIndex((r) => r.rowId === patch.rowId),
          p = n.policy.rows[i],
          r = n.configuration.configuredRows[i];
        if (!p || !r) throw new Error();
        if (patch.recipient !== undefined) {
          if (p.recipient !== "mutable") throw new Error();
          r.recipient = patch.recipient;
        }
        if (patch.allocation !== undefined) {
          if (p.allocation !== "mutable" || patch.allocation.kind !== n.policy.allocationMode)
            throw new Error();
          r.allocation = patch.allocation;
        }
      }
      if (c.additionalRecipients !== undefined) {
        if (n.policy.additionalRecipients !== "mutable") throw new Error();
        n.configuration.additionalRecipients = c.additionalRecipients;
      }
    }
    if (same(before, n)) throw new Error();
  }
  parseConditionalDefinition(next);
}
export function parseConditionalMutationIntent(value: unknown) {
  const d = exact(value, [
    "version",
    "deploymentId",
    "networkPassphraseHash",
    "rootContract",
    "admin",
    "definition",
    "nodes",
    "arguments",
  ]);
  if (d.version !== 2) throw new Error();
  const definition = parseConditionalDefinition(d.definition),
    nodes = parseConditionalNodeBindings(d.nodes, definition),
    args = parseConditionalMutationArguments(d.arguments),
    admin = address(d.admin, "G"),
    rootContract = address(d.rootContract, "C");
  if (admin !== definition.owner || rootContract !== nodes[0]!.contractAddress) throw new Error();
  validateGroup(definition, nodes, args);
  return {
    version: 2 as const,
    deploymentId: uuid(d.deploymentId),
    networkPassphraseHash: hash(d.networkPassphraseHash),
    rootContract,
    admin,
    definition,
    nodes,
    arguments: args,
  };
}
export type ConditionalMutationIntent = ReturnType<typeof parseConditionalMutationIntent>;
export function parseConditionalMutationState(value: unknown) {
  const d = object(value),
    { admin, mutationSupported, ...rest } = d;
  const state = parseConditionalExecutionDiscovery(rest);
  if (
    !state.supported ||
    mutationSupported !== true ||
    address(admin, "G") !== state.definition.owner
  )
    throw new Error();
  return { ...state, admin: address(admin, "G"), mutationSupported: true as const };
}
export type ConditionalMutationState = ReturnType<typeof parseConditionalMutationState>;
export function parseConditionalMutationPrepared(value: unknown) {
  const d = exact(value, [
      "intent",
      "txHash",
      "walletAddress",
      "xdr",
      "expiresAt",
      "network",
      "networkPassphrase",
      "feeStroops",
      "mutation",
    ]),
    mutation = parseConditionalMutationIntent(d.mutation),
    net = network(d.network);
  const phrase =
      net === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015",
    networkHash =
      net === "testnet"
        ? "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472"
        : "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979";
  if (
    d.walletAddress !== mutation.admin ||
    d.networkPassphrase !== phrase ||
    mutation.networkPassphraseHash !== networkHash
  )
    throw new Error();
  return {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    walletAddress: address(d.walletAddress, "G"),
    xdr: pattern(d.xdr, /^[\s\S]{10,200000}$/),
    expiresAt: timestamp(d.expiresAt),
    network: net,
    networkPassphrase: phrase,
    feeStroops: amount(d.feeStroops, true),
    mutation,
  };
}
export type ConditionalMutationPrepared = ReturnType<typeof parseConditionalMutationPrepared>;
export function parseConditionalConfigurationHistory(value: unknown) {
  const d = exact(value, [
    "version",
    "deploymentId",
    "network",
    "coverage",
    "historyComplete",
    "revisionCoverage",
    "items",
    "nextCursor",
  ]);
  if (d.version !== 2 || d.coverage !== "observed-revisions-only" || d.historyComplete !== false)
    throw new Error();
  const revisionCoverage = array(
    d.revisionCoverage,
    (v) => {
      const c = exact(v, [
        "nodeId",
        "highestObservedRevision",
        "observedRevisionCount",
        "missingRevisionCount",
      ]);
      const r = {
        nodeId: id(c.nodeId),
        highestObservedRevision: parseExecutionRevision(c.highestObservedRevision),
        observedRevisionCount: pattern(c.observedRevisionCount, /^[1-9]\d*$/),
        missingRevisionCount: pattern(c.missingRevisionCount, /^(0|[1-9]\d*)$/),
      };
      const possible = BigInt(r.highestObservedRevision) + 1n,
        count = BigInt(r.observedRevisionCount);
      if (count > possible || BigInt(r.missingRevisionCount) !== possible - count)
        throw new Error();
      return r;
    },
    40,
  );
  unique(revisionCoverage.map((r) => r.nodeId));
  const items = array(
    d.items,
    (v) => {
      const c = exact(v, [
          "id",
          "configuration",
          "observedLedger",
          "eventLedger",
          "eventId",
          "txHash",
        ]),
        configuration = parseConditionalNodeState(c.configuration),
        coverage = revisionCoverage.find((r) => r.nodeId === configuration.nodeId);
      if (!coverage || BigInt(configuration.revision) > BigInt(coverage.highestObservedRevision))
        throw new Error();
      return {
        id: uuid(c.id),
        configuration,
        observedLedger: integer(c.observedLedger, 1, 0xffffffff),
        eventLedger: c.eventLedger === null ? null : integer(c.eventLedger, 1, 0xffffffff),
        eventId: c.eventId === null ? null : pattern(c.eventId, /^[\s\S]{1,256}$/),
        txHash: c.txHash === null ? null : hash(c.txHash),
      };
    },
    100,
  );
  unique(items.map((i) => i.id.toLowerCase()));
  return {
    version: 2 as const,
    deploymentId: uuid(d.deploymentId),
    network: network(d.network),
    coverage: "observed-revisions-only" as const,
    historyComplete: false as const,
    revisionCoverage,
    items,
    nextCursor: d.nextCursor === null ? null : uuid(d.nextCursor),
  };
}
export type ConditionalConfigurationHistory = ReturnType<
  typeof parseConditionalConfigurationHistory
>;
/** A refusal is evidence of non-admission for one original keyed request only.
 * Generic failures, expiry and missing history never imply this proof. */
export function parseConditionalPreparationRefusal(value: unknown) {
  const d = exact(value, [
    "version",
    "outcome",
    "refusalId",
    "deploymentId",
    "network",
    "admin",
    "idempotencyKeyHash",
    "requestDigest",
    "refusedAt",
    "reasonCode",
  ]);
  if (d.version !== 2 || d.outcome !== "NOT_ADMITTED") throw new Error();
  return {
    version: 2 as const,
    outcome: "NOT_ADMITTED" as const,
    refusalId: uuid(d.refusalId),
    deploymentId: uuid(d.deploymentId),
    network: network(d.network),
    admin: address(d.admin, "G"),
    idempotencyKeyHash: hash(d.idempotencyKeyHash),
    requestDigest: hash(d.requestDigest),
    refusedAt: timestamp(d.refusedAt),
    reasonCode: choice(d.reasonCode, [
      "VALIDATION",
      "CONFLICT",
      "UPSTREAM_RPC",
      "INSUFFICIENT_FUNDS",
    ]),
  };
}
export type ConditionalPreparationRefusal = ReturnType<typeof parseConditionalPreparationRefusal>;
/** Recover the original receipt/hash on uncertainty before reviewing fresh terms. */
export function conditionalMutationMethods(transport: PaiflowTransport, deploymentId: string) {
  const base = `/api/v1/deployments/${input(() => uuid(deploymentId))}/configuration`;
  const scoped =
    <T extends { deploymentId: string }>(parser: (v: unknown) => T) =>
    (v: unknown) => {
      const data = parser(v);
      if (!sameUuid(data.deploymentId, deploymentId)) throw new Error();
      return data;
    };
  return {
    get: (options?: RequestOptions) =>
      transport.request(
        {
          path: base,
          method: "GET",
          auth: { kind: "token" },
          query: { version: "2" },
          parse: scoped(parseConditionalMutationState),
          maxResponseBytes: 4194304,
        },
        options,
      ),
    history: (query: ConfigurationHistoryQuery = {}, options?: RequestOptions) => {
      const q = input(() => {
        exact(query, ["limit", "cursor"]);
        return {
          version: "2",
          ...(query.limit === undefined ? {} : { limit: String(integer(query.limit, 1, 100)) }),
          ...(query.cursor === undefined ? {} : { cursor: uuid(query.cursor) }),
        };
      });
      return transport.request(
        {
          path: `${base}/history`,
          method: "GET",
          auth: { kind: "token" },
          query: q,
          parse: scoped(parseConditionalConfigurationHistory),
          maxResponseBytes: 4194304,
        },
        options,
      );
    },
    prepare: (body: ConditionalMutationPrepareInput, options?: RequestOptions) => {
      if (!options?.idempotencyKey)
        throw new TypeError("Mutation preparation requires idempotencyKey");
      const request = input(() => {
        const d = exact(body, ["admin", "arguments"]);
        return {
          admin: address(d.admin, "G"),
          arguments: parseConditionalMutationArguments(d.arguments),
        };
      });
      return transport.request(
        {
          path: `${base}/prepare`,
          method: "POST",
          auth: { kind: "token" },
          query: { version: "2" },
          body: request,
          parse: (v) => {
            const data = parseConditionalMutationPrepared(v);
            if (
              !sameUuid(data.mutation.deploymentId, deploymentId) ||
              data.walletAddress !== request.admin ||
              !same(data.mutation.arguments, request.arguments)
            )
              throw new Error();
            return data;
          },
          maxResponseBytes: 4194304,
        },
        options,
      );
    },
    submit: (body: MutationSubmitInput, options?: RequestOptions) => {
      const request = input(() => {
        const d = exact(body, ["intent", "signedXdr"]);
        return { intent: uuid(d.intent), signedXdr: pattern(d.signedXdr, /^[\s\S]{1,200000}$/) };
      });
      return transport.request(
        {
          path: `${base}/submit`,
          method: "POST",
          auth: { kind: "token" },
          query: { version: "2" },
          body: request,
          parse: parseTransaction,
        },
        options,
      );
    },
    reconcile: (body: MutationReconcileInput, options?: RequestOptions) => {
      const request = input(() => {
        const d = exact(body, ["intent"]);
        return { intent: uuid(d.intent) };
      });
      return transport.request(
        {
          path: `${base}/reconcile`,
          method: "POST",
          auth: { kind: "token" },
          query: { version: "2" },
          body: request,
          parse: (v) => {
            const d = exact(v, ["intent", "state", "transaction"]);
            if (!sameUuid(d.intent, request.intent)) throw new Error();
            return {
              intent: uuid(d.intent),
              state: choice(d.state, ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
              transaction: parseTransaction(d.transaction),
            };
          },
        },
        options,
      );
    },
  };
}
