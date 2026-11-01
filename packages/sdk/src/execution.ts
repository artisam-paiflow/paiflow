import {
  address,
  array,
  boolean,
  hash,
  integer,
  network,
  object,
  pattern,
  stroops,
  text,
  uuid,
  choice,
} from "./read-parsers.js";

/** Exact inputs for one payment. Stored constants and mutable fields are never overrides. */
export type ExecutionAllocation =
  | { kind: "fixed"; amountStroops: string }
  | { kind: "percentage"; bps: number };
export interface ExecutionRowInput {
  rowId: string;
  recipient?: string;
  allocation?: ExecutionAllocation;
}
export interface ExecutionAdditionalRecipient {
  rowId: string;
  recipient: string;
  allocation: ExecutionAllocation;
}
export type ExecutionNodeInput =
  | { kind: "pay"; nodeId: string; recipient: string }
  | {
      kind: "split";
      nodeId: string;
      rows: ExecutionRowInput[];
      additionalRecipients?: ExecutionAdditionalRecipient[];
    };
export interface ExecutionArguments {
  version: 1;
  inputs: ExecutionNodeInput[];
}
export interface ExecutionNodeBinding {
  nodeId: string;
  contractAddress: string;
  expectedRevision: string;
}
export interface ExecutionIntent {
  version: 1;
  deploymentId: string;
  networkPassphraseHash: string;
  rootContract: string;
  assetContract: string;
  payer: string;
  amountStroops: string;
  nonce: string;
  expiresAtLedger: number;
  nodes: ExecutionNodeBinding[];
  arguments: ExecutionArguments;
}
const id = (value: unknown) => pattern(value, /^[A-Za-z0-9_-]{1,64}$/);
const canonicalAmount = (value: unknown) => stroops(pattern(value, /^[1-9]\d*$/), true);
const revision = (value: unknown) => {
  const result = pattern(value, /^(0|[1-9]\d{0,19})$/);
  if (BigInt(result) > (1n << 64n) - 1n) throw new Error();
  return result;
};
const keys = (data: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new Error();
};
const unique = (values: string[]) => {
  if (new Set(values).size !== values.length) throw new Error();
};
const allocation = (value: unknown): ExecutionAllocation => {
  const d = object(value);
  if (d.kind === "fixed") {
    keys(d, ["kind", "amountStroops"]);
    return { kind: "fixed", amountStroops: canonicalAmount(d.amountStroops) };
  }
  if (d.kind !== "percentage") throw new Error();
  keys(d, ["kind", "bps"]);
  return { kind: "percentage", bps: integer(d.bps, 1, 10_000) };
};
const row = (value: unknown): ExecutionRowInput => {
  const d = object(value);
  keys(d, ["rowId", "recipient", "allocation"]);
  if (d.recipient === undefined && d.allocation === undefined) throw new Error();
  return {
    rowId: id(d.rowId),
    ...(d.recipient === undefined ? {} : { recipient: address(d.recipient, "G") }),
    ...(d.allocation === undefined ? {} : { allocation: allocation(d.allocation) }),
  };
};
const additional = (value: unknown): ExecutionAdditionalRecipient => {
  const d = object(value);
  keys(d, ["rowId", "recipient", "allocation"]);
  return {
    rowId: id(d.rowId),
    recipient: address(d.recipient, "G"),
    allocation: allocation(d.allocation),
  };
};

/** Structural validation only; the server additionally validates the exact deployed policy and live amounts. */
export function parseExecutionArguments(value: unknown): ExecutionArguments {
  const d = object(value);
  keys(d, ["version", "inputs"]);
  if (d.version !== 1) throw new Error();
  const inputs = array(
    d.inputs,
    (value): ExecutionNodeInput => {
      const node = object(value);
      if (node.kind === "pay") {
        keys(node, ["kind", "nodeId", "recipient"]);
        return { kind: "pay", nodeId: id(node.nodeId), recipient: address(node.recipient, "G") };
      }
      if (node.kind !== "split") throw new Error();
      keys(node, ["kind", "nodeId", "rows", "additionalRecipients"]);
      const rows = array(node.rows, row, 20);
      const extras =
        node.additionalRecipients === undefined
          ? undefined
          : array(node.additionalRecipients, additional, 20);
      unique([...rows, ...(extras ?? [])].map((row) => row.rowId));
      return {
        kind: "split",
        nodeId: id(node.nodeId),
        rows,
        ...(extras === undefined ? {} : { additionalRecipients: extras }),
      };
    },
    40,
  );
  unique(inputs.map((input) => input.nodeId));
  return { version: 1, inputs };
}
export function parseExecutionIntent(value: unknown): ExecutionIntent {
  const d = object(value);
  if (d.version !== 1) throw new Error();
  const nodes = array(
    d.nodes,
    (value) => {
      const node = object(value);
      return {
        nodeId: id(node.nodeId),
        contractAddress: address(node.contractAddress, "C"),
        expectedRevision: revision(node.expectedRevision),
      };
    },
    40,
  );
  if (!nodes.length || nodes[0]!.contractAddress !== d.rootContract) throw new Error();
  unique(nodes.map((node) => node.nodeId));
  unique(nodes.map((node) => node.contractAddress));
  const args = parseExecutionArguments(d.arguments);
  if (args.inputs.some((input) => !nodes.some((node) => node.nodeId === input.nodeId)))
    throw new Error();
  return {
    version: 1,
    deploymentId: uuid(d.deploymentId),
    networkPassphraseHash: hash(d.networkPassphraseHash),
    rootContract: address(d.rootContract, "C"),
    assetContract: address(d.assetContract, "C"),
    payer: address(d.payer, "G"),
    amountStroops: canonicalAmount(d.amountStroops),
    nonce: hash(d.nonce),
    expiresAtLedger: integer(d.expiresAtLedger, 1, 0xffff_ffff),
    nodes,
    arguments: args,
  };
}
const fieldMode = (value: unknown) => choice(value, ["constant", "execution", "mutable"]);
const nodePolicy = (value: unknown) => {
  const d = object(value);
  if (d.kind === "pay")
    return {
      kind: "pay" as const,
      nodeId: id(d.nodeId),
      recipient: fieldMode(d.recipient),
      payoutValue: choice(d.payoutValue, ["constant", "mutable"]),
    };
  if (d.kind !== "split") throw new Error();
  return {
    kind: "split" as const,
    nodeId: id(d.nodeId),
    allocationMode: choice(d.allocationMode, ["fixed", "percentage"]),
    rows: array(
      d.rows,
      (value) => {
        const row = object(value);
        return {
          rowId: id(row.rowId),
          recipient: fieldMode(row.recipient),
          allocation: fieldMode(row.allocation),
        };
      },
      20,
    ),
    additionalRecipients: fieldMode(d.additionalRecipients),
  };
};
const artifact = (value: unknown) => {
  const d = object(value);
  if (
    d.policyVersion !== 1 ||
    d.executionAbi !== 1 ||
    d.execution !== true ||
    d.mutation !== false ||
    d.immutablePolicies !== true ||
    d.revisionBinding !== true
  )
    throw new Error();
  return {
    policyVersion: 1 as const,
    executionAbi: 1 as const,
    execution: true as const,
    mutation: false as const,
    immutablePolicies: true as const,
    revisionBinding: true as const,
    wasmHash: hash(d.wasmHash),
  };
};
const storedConfig = (value: unknown) => {
  const d = object(value),
    policy = nodePolicy(d.policy),
    config = object(d.configuration);
  if (policy.nodeId !== d.nodeId || policy.kind !== config.kind || d.version !== 1)
    throw new Error();
  const configuration =
    config.kind === "pay"
      ? {
          kind: "pay" as const,
          ...(config.recipient === undefined ? {} : { recipient: address(config.recipient, "G") }),
          payoutValue:
            object(config.payoutValue).kind === "full"
              ? { kind: "full" as const }
              : allocation(config.payoutValue),
        }
      : {
          kind: "split" as const,
          configuredRows: array(
            config.configuredRows,
            (value) => {
              const row = object(value);
              return {
                rowId: id(row.rowId),
                ...(row.recipient === undefined ? {} : { recipient: address(row.recipient, "G") }),
                ...(row.allocation === undefined ? {} : { allocation: allocation(row.allocation) }),
              };
            },
            20,
          ),
          additionalRecipients: array(config.additionalRecipients, additional, 20),
        };
  return {
    version: 1 as const,
    nodeId: id(d.nodeId),
    contractAddress: address(d.contractAddress, "C"),
    confirmedLedger: integer(d.confirmedLedger, 1, 0xffff_ffff),
    revision: revision(d.revision),
    policy,
    configuration,
  };
};
export function parseExecutionDiscovery(value: unknown) {
  const d = object(value);
  const supported = boolean(d.supported);
  const base = { deploymentId: uuid(d.deploymentId), network: network(d.network) };
  if (!supported) {
    if (d.policyVersion !== 0) throw new Error();
    return {
      ...base,
      supported: false as const,
      policyVersion: 0 as const,
      reason: text(d.reason),
    };
  }
  if (d.policyVersion !== 1 || object(d.policies).version !== 1) throw new Error();
  const nodes = array(
    d.nodes,
    (value) => {
      const node = object(value);
      return {
        nodeId: id(node.nodeId),
        contractAddress: address(node.contractAddress, "C"),
        expectedRevision: revision(node.expectedRevision),
        capabilities: artifact(node.capabilities),
      };
    },
    40,
  );
  if (nodes.length < 2 || nodes[0]!.contractAddress !== d.rootContract) throw new Error();
  unique(nodes.map((node) => node.nodeId));
  unique(nodes.map((node) => node.contractAddress));
  const confirmedLedger = integer(d.confirmedLedger, 1, 0xffff_ffff);
  const configurations = array(d.configurations, storedConfig, 39);
  if (
    configurations.length !== nodes.length - 1 ||
    configurations.some(
      (config, index) =>
        config.nodeId !== nodes[index + 1]!.nodeId ||
        config.contractAddress !== nodes[index + 1]!.contractAddress ||
        config.revision !== nodes[index + 1]!.expectedRevision ||
        config.confirmedLedger !== confirmedLedger,
    )
  )
    throw new Error();
  return {
    ...base,
    supported: true as const,
    policyVersion: 1 as const,
    confirmedLedger,
    rootContract: address(d.rootContract, "C"),
    assetContract: address(d.assetContract, "C"),
    minAmountStroops: stroops(pattern(d.minAmountStroops, /^(0|[1-9]\d*)$/)),
    policies: { version: 1 as const, nodes: array(object(d.policies).nodes, nodePolicy, 40) },
    nodes,
    configurations,
  };
}
/** Verified current configuration and exact required-input declarations, without contacts or labels. */
export type ExecutionDiscovery = ReturnType<typeof parseExecutionDiscovery>;
