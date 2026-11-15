import {
  address,
  array,
  boolean,
  choice,
  hash,
  integer,
  network,
  object,
  pattern,
  stroops,
  text,
  timestamp,
  uuid,
  parseTransaction,
} from "./read-parsers.js";
import {
  parseExecutionArguments,
  parseExecutionRevision,
  parseStoredConfiguration,
  type ExecutionAllocation,
  type ExecutionNodeInput,
} from "./execution.js";
import type { ExecuteSubmission, ExecuteSubmitOptions } from "./payment.js";
import type { PaiflowTransport, RequestOptions } from "./transport.js";

type Stored = ReturnType<typeof parseStoredConfiguration>;
export interface ConditionalPayNode {
  kind: "pay";
  nodeId: string;
  policy: Extract<Stored["policy"], { kind: "pay" }>;
  configuration: Extract<Stored["configuration"], { kind: "pay" }>;
}
export interface ConditionalSplitNode {
  kind: "split";
  nodeId: string;
  policy: Extract<Stored["policy"], { kind: "split" }>;
  configuration: Extract<Stored["configuration"], { kind: "split" }>;
}
export type ConditionalTerminal =
  | ConditionalPayNode
  | ConditionalSplitNode
  | {
      kind: "return_to_owner";
      nodeId: string;
    };
export interface ConditionalDefinition {
  version: 2;
  owner: string;
  assetContract: string;
  root: { nodeId: string; minAmountStroops: string };
  prefix: ConditionalPayNode[];
  condition: {
    nodeId: string;
    kind: "amount_gt" | "amount_lt";
    thresholdStroops: string;
    thresholdMode: "constant" | "mutable";
  };
  trueBranch: ConditionalTerminal;
  falseBranch: ConditionalTerminal;
}
export interface ConditionalExecutionArguments {
  version: 2;
  inputs: ExecutionNodeInput[];
}
export interface ConditionalNodeBinding {
  nodeId: string;
  contractAddress: string;
  expectedRevision: string;
  wasmHash: string;
}
export interface ConditionalExecutionIntent {
  version: 2;
  deploymentId: string;
  networkPassphraseHash: string;
  rootContract: string;
  assetContract: string;
  payer: string;
  amountStroops: string;
  nonce: string;
  expiresAtLedger: number;
  definition: ConditionalDefinition;
  nodes: ConditionalNodeBinding[];
  arguments: ConditionalExecutionArguments;
  selectedBranch: "true" | "false";
  amountAtConditionStroops: string;
}
export type ConditionalNodeConfiguration =
  | ConditionalPayNode
  | ConditionalSplitNode
  | { kind: "receive"; minAmountStroops: string }
  | {
      kind: "condition";
      comparison: "amount_gt" | "amount_lt";
      thresholdStroops: string;
      thresholdMode: "constant" | "mutable";
    }
  | { kind: "return_to_owner"; recipient: string };
export interface ConditionalNodeState {
  version: 2;
  nodeId: string;
  contractAddress: string;
  revision: string;
  admin: string;
  assetContract: string;
  parentContract: string | null;
  nextContracts: string[];
  configuration: ConditionalNodeConfiguration;
}
export type ConditionalExecutionDiscovery =
  | {
      version: 2;
      supported: false;
      deploymentId: string;
      network: "testnet" | "mainnet";
      policyVersion: 0;
      reason: string;
    }
  | {
      version: 2;
      supported: true;
      deploymentId: string;
      network: "testnet" | "mainnet";
      policyVersion: 2;
      confirmedLedger: number;
      definition: ConditionalDefinition;
      nodes: ConditionalNodeBinding[];
      statuses: { state: ConditionalNodeState; obligationsStroops: string }[];
    };
export interface ConditionalExecutePrepareInput {
  amount: string;
  from: string;
  arguments: ConditionalExecutionArguments;
}
export interface ConditionalExecutePrepared {
  intent: string;
  txHash: string;
  walletAddress: string;
  xdr: string;
  expiresAt: string;
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  execution: ConditionalExecutionIntent;
}
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
// Public SHA256 network IDs; no Node runtime import or crypto dependency.
const networkIds = {
  testnet: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
  mainnet: "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979",
} as const;
const exact = (value: unknown, keys: string[]) => {
  const d = object(value);
  if (Object.keys(d).some((key) => !keys.includes(key))) throw new Error();
  return d;
};
const id = (value: unknown) => pattern(value, /^[A-Za-z0-9_-]{1,64}$/);
const amount = (value: unknown, positive = false) =>
  stroops(pattern(value, /^(0|[1-9]\d*)$/), positive);
const unique = (values: string[]) => {
  if (new Set(values).size !== values.length) throw new Error();
};
// UUID spelling is case-insensitive. Compare identity without rewriting the
// original request or server evidence; other identifiers retain their own rules.
const sameUuid = (left: unknown, right: unknown) =>
  uuid(left).toLowerCase() === uuid(right).toLowerCase();
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
      bb = object(b);
    const keys = Object.keys(aa).filter((key) => aa[key] !== undefined);
    return (
      keys.length === Object.keys(bb).filter((key) => bb[key] !== undefined).length &&
      keys.every((key) => Object.hasOwn(bb, key) && same(aa[key], bb[key]))
    );
  }
  return false;
};
function payment(value: unknown, asset: string): ConditionalPayNode | ConditionalSplitNode {
  const d = exact(value, ["kind", "nodeId", "policy", "configuration"]);
  const nodeId = id(d.nodeId),
    p = object(d.policy),
    c = object(d.configuration);
  if (d.kind === "pay") {
    exact(p, ["kind", "nodeId", "recipient", "payoutValue"]);
    exact(c, ["kind", "recipient", "payoutValue"]);
    exact(
      c.payoutValue,
      object(c.payoutValue).kind === "full"
        ? ["kind"]
        : object(c.payoutValue).kind === "fixed"
          ? ["kind", "amountStroops"]
          : ["kind", "bps"],
    );
  } else if (d.kind === "split") {
    exact(p, ["kind", "nodeId", "allocationMode", "rows", "additionalRecipients"]);
    array(p.rows, (row) => exact(row, ["rowId", "recipient", "allocation"]), 20);
    exact(c, ["kind", "configuredRows", "additionalRecipients"]);
    array(c.configuredRows, (row) => exact(row, ["rowId", "recipient", "allocation"]), 20);
    array(c.additionalRecipients, (row) => exact(row, ["rowId", "recipient", "allocation"]), 20);
  } else throw new Error();
  // Explicit pure value adapter to the retained leaf representation, not a v1
  // wire parser or chain observation. The outer protocol remains strictly v2.
  const parsed = parseStoredConfiguration({
    version: 1,
    nodeId,
    contractAddress: asset,
    confirmedLedger: 1,
    revision: "0",
    policy: p,
    configuration: c,
  });
  if (d.kind === "pay" && parsed.policy.kind === "pay" && parsed.configuration.kind === "pay") {
    const policy = parsed.policy,
      configuration = parsed.configuration;
    if (
      (configuration.recipient !== undefined) !== (policy.recipient !== "execution") ||
      (configuration.payoutValue.kind === "full" && policy.payoutValue !== "constant")
    )
      throw new Error();
    return { kind: "pay", nodeId, policy, configuration };
  }
  if (d.kind !== "split" || parsed.policy.kind !== "split" || parsed.configuration.kind !== "split")
    throw new Error();
  const policy = parsed.policy,
    configuration = parsed.configuration;
  const rows = [...configuration.configuredRows, ...configuration.additionalRecipients];
  if (
    policy.rows.length !== configuration.configuredRows.length ||
    rows.length > 20 ||
    (!rows.length && policy.additionalRecipients !== "execution") ||
    (policy.additionalRecipients !== "mutable" && configuration.additionalRecipients.length)
  )
    throw new Error();
  unique(rows.map((row) => row.rowId));
  unique(rows.flatMap((row) => (row.recipient === undefined ? [] : [row.recipient])));
  for (const [i, row] of configuration.configuredRows.entries()) {
    const declared = policy.rows[i]!;
    if (
      row.rowId !== declared.rowId ||
      (row.recipient !== undefined) !== (declared.recipient !== "execution") ||
      (row.allocation !== undefined) !== (declared.allocation !== "execution")
    )
      throw new Error();
  }
  if (rows.some((row) => row.allocation && row.allocation.kind !== policy.allocationMode))
    throw new Error();
  for (const row of rows) {
    if (row.allocation) {
      const rawRows = [
        ...array(c.configuredRows, object, 20),
        ...array(c.additionalRecipients, object, 20),
      ];
      const raw = rawRows.find((candidate) => candidate.rowId === row.rowId)!;
      exact(
        raw.allocation,
        row.allocation.kind === "fixed" ? ["kind", "amountStroops"] : ["kind", "bps"],
      );
    }
  }
  if (policy.allocationMode === "percentage") {
    const total = rows.reduce(
      (sum, row) => sum + (row.allocation?.kind === "percentage" ? row.allocation.bps : 0),
      0,
    );
    const slots = configuration.configuredRows.filter((row) => !row.allocation).length;
    if (
      total + slots > 10000 ||
      (policy.additionalRecipients !== "execution" && !slots && total !== 10000)
    )
      throw new Error();
  } else if (
    rows.reduce(
      (sum, row) =>
        sum + (row.allocation?.kind === "fixed" ? BigInt(row.allocation.amountStroops) : 0n),
      0n,
    ) >
    (1n << 127n) - 1n
  )
    throw new Error();
  return { kind: "split", nodeId, policy, configuration };
}
function terminal(value: unknown, asset: string): ConditionalTerminal {
  const d = object(value);
  if (d.kind === "return_to_owner") {
    exact(d, ["kind", "nodeId"]);
    return { kind: "return_to_owner", nodeId: id(d.nodeId) };
  }
  return payment(value, asset);
}
export function parseConditionalDefinition(value: unknown): ConditionalDefinition {
  const d = exact(value, [
    "version",
    "owner",
    "assetContract",
    "root",
    "prefix",
    "condition",
    "trueBranch",
    "falseBranch",
  ]);
  if (d.version !== 2) throw new Error();
  const assetContract = address(d.assetContract, "C"),
    root = exact(d.root, ["nodeId", "minAmountStroops"]),
    condition = exact(d.condition, ["nodeId", "kind", "thresholdStroops", "thresholdMode"]);
  const prefix = array(
    d.prefix,
    (value) => {
      const node = payment(value, assetContract);
      if (
        node.kind !== "pay" ||
        node.configuration.payoutValue.kind === "full" ||
        (node.configuration.payoutValue.kind === "percentage" &&
          node.configuration.payoutValue.bps === 10000)
      )
        throw new Error();
      return node;
    },
    36,
  );
  const result: ConditionalDefinition = {
    version: 2,
    owner: address(d.owner, "G"),
    assetContract,
    root: { nodeId: id(root.nodeId), minAmountStroops: amount(root.minAmountStroops) },
    prefix,
    condition: {
      nodeId: id(condition.nodeId),
      kind: choice(condition.kind, ["amount_gt", "amount_lt"]),
      thresholdStroops: amount(condition.thresholdStroops),
      thresholdMode: choice(condition.thresholdMode, ["constant", "mutable"]),
    },
    trueBranch: terminal(d.trueBranch, assetContract),
    falseBranch: terminal(d.falseBranch, assetContract),
  };
  unique(order(result));
  return result;
}
const order = (d: ConditionalDefinition) => [
  d.root.nodeId,
  ...d.prefix.map((n) => n.nodeId),
  d.condition.nodeId,
  d.trueBranch.nodeId,
  d.falseBranch.nodeId,
];
const binding = (value: unknown): ConditionalNodeBinding => {
  const d = exact(value, ["nodeId", "contractAddress", "expectedRevision", "wasmHash"]);
  return {
    nodeId: id(d.nodeId),
    contractAddress: address(d.contractAddress, "C"),
    expectedRevision: parseExecutionRevision(d.expectedRevision),
    wasmHash: hash(d.wasmHash),
  };
};
export function parseConditionalNodeBindings(value: unknown, definition: ConditionalDefinition) {
  const nodes = array(value, binding, 40),
    ids = order(definition);
  if (nodes.length !== ids.length || nodes.some((node, i) => node.nodeId !== ids[i]))
    throw new Error();
  unique(nodes.map((node) => node.nodeId));
  unique(nodes.map((node) => node.contractAddress));
  const immutable = new Set([
    definition.root.nodeId,
    ...(definition.condition.thresholdMode === "constant" ? [definition.condition.nodeId] : []),
    ...[...definition.prefix, definition.trueBranch, definition.falseBranch]
      .filter((node) => node.kind === "return_to_owner" || !mutable(node))
      .map((node) => node.nodeId),
  ]);
  if (nodes.some((node) => immutable.has(node.nodeId) && node.expectedRevision !== "0"))
    throw new Error();
  return nodes;
}
/** Only the explicitly versioned input envelope is accepted. Leaves share the
 * existing Pay/Split value representation, without changing its v1 wire parser. */
export function parseConditionalExecutionArguments(value: unknown): ConditionalExecutionArguments {
  const d = exact(value, ["version", "inputs"]);
  if (d.version !== 2) throw new Error();
  return { version: 2, inputs: parseExecutionArguments({ version: 1, inputs: d.inputs }).inputs };
}
function deduction(node: ConditionalPayNode, incoming: bigint) {
  const payout = node.configuration.payoutValue;
  const result =
    payout.kind === "full"
      ? incoming
      : payout.kind === "fixed"
        ? BigInt(payout.amountStroops)
        : (incoming * BigInt(payout.bps)) / 10000n;
  if (result > incoming) throw new Error();
  return result;
}
/** Preview one verified snapshot only. Preparation rechecks current terms and
 * computes the authoritative route; never send this branch as a request input. */
export function selectConditionalExecutionBranch(raw: ConditionalDefinition, funded: string) {
  const definition = parseConditionalDefinition(raw);
  let remaining = BigInt(amount(funded, true));
  if (remaining < BigInt(definition.root.minAmountStroops)) throw new Error();
  for (const node of definition.prefix) {
    remaining -= deduction(node, remaining);
    if (remaining <= 0n) throw new Error();
  }
  return {
    selectedBranch: (
      definition.condition.kind === "amount_gt"
        ? remaining > BigInt(definition.condition.thresholdStroops)
        : remaining < BigInt(definition.condition.thresholdStroops)
    )
      ? ("true" as const)
      : ("false" as const),
    amountAtConditionStroops: remaining.toString(),
  };
}
const needsInput = (node: ConditionalPayNode | ConditionalSplitNode) =>
  node.kind === "pay"
    ? node.policy.recipient === "execution"
    : node.policy.additionalRecipients === "execution" ||
      node.policy.rows.some(
        (row) => row.recipient === "execution" || row.allocation === "execution",
      );
function checkInputs(
  definition: ConditionalDefinition,
  args: ConditionalExecutionArguments,
  funded: string,
  selected: "true" | "false",
  nodes: ConditionalNodeBinding[],
) {
  const branch = selected === "true" ? definition.trueBranch : definition.falseBranch;
  const active = [...definition.prefix, ...(branch.kind === "return_to_owner" ? [] : [branch])];
  const required = active.filter(needsInput);
  if (
    required.length !== args.inputs.length ||
    required.some((node, i) => node.nodeId !== args.inputs[i]!.nodeId)
  )
    throw new Error();
  let incoming = BigInt(funded);
  for (const node of active) {
    const input = args.inputs.find((value) => value.nodeId === node.nodeId);
    if (node.kind === "pay") {
      if (input && input.kind !== "pay") throw new Error();
      const recipient = input?.kind === "pay" ? input.recipient : node.configuration.recipient;
      if (!recipient || nodes.some((binding) => binding.contractAddress === recipient))
        throw new Error();
      const paid = deduction(node, incoming);
      if (definition.prefix.some((prefix) => prefix.nodeId === node.nodeId)) incoming -= paid;
      continue;
    }
    if (input && input.kind !== "split") throw new Error();
    const rows = input?.kind === "split" ? input.rows : [];
    const declared = node.policy.rows.filter(
      (row) => row.recipient === "execution" || row.allocation === "execution",
    );
    if (rows.length !== declared.length || rows.some((row, i) => row.rowId !== declared[i]!.rowId))
      throw new Error();
    if (
      (input?.kind === "split" && input.additionalRecipients !== undefined) !==
      (node.policy.additionalRecipients === "execution")
    )
      throw new Error();
    const merged = node.configuration.configuredRows.map((row, i) => {
      const policy = node.policy.rows[i]!,
        supplied = rows.find((input) => input.rowId === row.rowId);
      if (
        supplied &&
        ((supplied.recipient !== undefined) !== (policy.recipient === "execution") ||
          (supplied.allocation !== undefined) !== (policy.allocation === "execution"))
      )
        throw new Error();
      const recipient = policy.recipient === "execution" ? supplied?.recipient : row.recipient;
      const allocation = policy.allocation === "execution" ? supplied?.allocation : row.allocation;
      if (!recipient || !allocation || allocation.kind !== node.policy.allocationMode)
        throw new Error();
      return { rowId: row.rowId, recipient, allocation };
    });
    const extras =
      node.policy.additionalRecipients === "execution" && input?.kind === "split"
        ? input.additionalRecipients!
        : node.configuration.additionalRecipients;
    const all = [...merged, ...extras];
    if (
      !all.length ||
      all.length > 20 ||
      all.some((row) => row.allocation.kind !== node.policy.allocationMode)
    )
      throw new Error();
    unique(all.map((row) => row.rowId));
    unique(all.map((row) => row.recipient));
    if (node.policy.allocationMode === "percentage") {
      if (
        all.reduce(
          (sum, row) => sum + (row.allocation.kind === "percentage" ? row.allocation.bps : 0),
          0,
        ) !== 10000
      )
        throw new Error();
    } else {
      const total = all.reduce(
        (sum, row) =>
          sum + (row.allocation.kind === "fixed" ? BigInt(row.allocation.amountStroops) : 0n),
        0n,
      );
      if (total > (1n << 127n) - 1n || (needsInput(node) && total !== incoming)) throw new Error();
    }
  }
}
export function parseConditionalExecutionIntent(value: unknown): ConditionalExecutionIntent {
  const d = exact(value, [
    "version",
    "deploymentId",
    "networkPassphraseHash",
    "rootContract",
    "assetContract",
    "payer",
    "amountStroops",
    "nonce",
    "expiresAtLedger",
    "definition",
    "nodes",
    "arguments",
    "selectedBranch",
    "amountAtConditionStroops",
  ]);
  if (d.version !== 2) throw new Error();
  const definition = parseConditionalDefinition(d.definition),
    nodes = parseConditionalNodeBindings(d.nodes, definition),
    args = parseConditionalExecutionArguments(d.arguments),
    funded = amount(d.amountStroops, true),
    route = selectConditionalExecutionBranch(definition, funded);
  if (
    d.rootContract !== nodes[0]!.contractAddress ||
    d.assetContract !== definition.assetContract ||
    d.selectedBranch !== route.selectedBranch ||
    d.amountAtConditionStroops !== route.amountAtConditionStroops
  )
    throw new Error();
  checkInputs(definition, args, funded, route.selectedBranch, nodes);
  return {
    version: 2,
    deploymentId: uuid(d.deploymentId),
    networkPassphraseHash: hash(d.networkPassphraseHash),
    rootContract: address(d.rootContract, "C"),
    assetContract: definition.assetContract,
    payer: address(d.payer, "G"),
    amountStroops: funded,
    nonce: hash(d.nonce),
    expiresAtLedger: integer(d.expiresAtLedger, 1, 0xffff_ffff),
    definition,
    nodes,
    arguments: args,
    ...route,
  };
}
function mutable(config: ConditionalNodeConfiguration) {
  return config.kind === "condition"
    ? config.thresholdMode === "mutable"
    : config.kind === "pay"
      ? config.policy.recipient === "mutable" || config.policy.payoutValue === "mutable"
      : config.kind === "split"
        ? config.policy.additionalRecipients === "mutable" ||
          config.policy.rows.some(
            (row) => row.recipient === "mutable" || row.allocation === "mutable",
          )
        : false;
}
export function parseConditionalNodeState(value: unknown): ConditionalNodeState {
  const d = exact(value, [
    "version",
    "nodeId",
    "contractAddress",
    "revision",
    "admin",
    "assetContract",
    "parentContract",
    "nextContracts",
    "configuration",
  ]);
  if (d.version !== 2) throw new Error();
  const assetContract = address(d.assetContract, "C"),
    c = object(d.configuration);
  let configuration: ConditionalNodeConfiguration;
  if (c.kind === "pay" || c.kind === "split") configuration = payment(c, assetContract);
  else if (c.kind === "receive") {
    exact(c, ["kind", "minAmountStroops"]);
    configuration = { kind: "receive", minAmountStroops: amount(c.minAmountStroops) };
  } else if (c.kind === "condition") {
    exact(c, ["kind", "comparison", "thresholdStroops", "thresholdMode"]);
    configuration = {
      kind: "condition",
      comparison: choice(c.comparison, ["amount_gt", "amount_lt"]),
      thresholdStroops: amount(c.thresholdStroops),
      thresholdMode: choice(c.thresholdMode, ["constant", "mutable"]),
    };
  } else {
    exact(c, ["kind", "recipient"]);
    if (c.kind !== "return_to_owner") throw new Error();
    configuration = { kind: "return_to_owner", recipient: address(c.recipient, "G") };
  }
  const result: ConditionalNodeState = {
    version: 2,
    nodeId: id(d.nodeId),
    contractAddress: address(d.contractAddress, "C"),
    revision: parseExecutionRevision(d.revision),
    admin: address(d.admin, "G"),
    assetContract,
    parentContract: d.parentContract === null ? null : address(d.parentContract, "C"),
    nextContracts: array(d.nextContracts, (v) => address(v, "C"), 2),
    configuration,
  };
  if (
    (!mutable(configuration) && result.revision !== "0") ||
    ((configuration.kind === "pay" || configuration.kind === "split") &&
      configuration.nodeId !== result.nodeId) ||
    (result.parentContract === null) !== (configuration.kind === "receive") ||
    result.parentContract === result.contractAddress ||
    result.nextContracts.includes(result.contractAddress) ||
    new Set(result.nextContracts).size !== result.nextContracts.length ||
    (configuration.kind === "receive" && result.nextContracts.length !== 1) ||
    (configuration.kind === "condition" && result.nextContracts.length !== 2) ||
    ((configuration.kind === "split" || configuration.kind === "return_to_owner") &&
      result.nextContracts.length !== 0) ||
    (configuration.kind === "pay" &&
      (result.nextContracts.length > 1 ||
        (result.nextContracts.length > 0 &&
          (configuration.configuration.payoutValue.kind === "full" ||
            (configuration.configuration.payoutValue.kind === "percentage" &&
              configuration.configuration.payoutValue.bps === 10000))))) ||
    (configuration.kind === "return_to_owner" && configuration.recipient !== result.admin)
  )
    throw new Error();
  return result;
}
export function parseConditionalExecutionDiscovery(value: unknown): ConditionalExecutionDiscovery {
  const d = object(value),
    base = { version: 2 as const, deploymentId: uuid(d.deploymentId), network: network(d.network) };
  if (d.version !== 2) throw new Error();
  if (!boolean(d.supported)) {
    exact(d, ["version", "supported", "deploymentId", "network", "policyVersion", "reason"]);
    if (d.policyVersion !== 0) throw new Error();
    return { ...base, supported: false, policyVersion: 0, reason: pattern(d.reason, /[\s\S]/) };
  }
  exact(d, [
    "version",
    "supported",
    "deploymentId",
    "network",
    "policyVersion",
    "confirmedLedger",
    "definition",
    "nodes",
    "statuses",
  ]);
  if (d.policyVersion !== 2) throw new Error();
  const definition = parseConditionalDefinition(d.definition),
    nodes = parseConditionalNodeBindings(d.nodes, definition);
  const statuses = array(
    d.statuses,
    (value) => {
      const status = exact(value, ["state", "obligationsStroops"]);
      return {
        state: parseConditionalNodeState(status.state),
        obligationsStroops: amount(status.obligationsStroops),
      };
    },
    40,
  );
  const configs: ConditionalNodeConfiguration[] = [
    { kind: "receive", minAmountStroops: definition.root.minAmountStroops },
    ...definition.prefix,
    {
      kind: "condition",
      comparison: definition.condition.kind,
      thresholdStroops: definition.condition.thresholdStroops,
      thresholdMode: definition.condition.thresholdMode,
    },
    ...[definition.trueBranch, definition.falseBranch].map((node) =>
      node.kind === "return_to_owner"
        ? { kind: "return_to_owner" as const, recipient: definition.owner }
        : node,
    ),
  ];
  const ci = definition.prefix.length + 1;
  if (statuses.length !== nodes.length) throw new Error();
  statuses.forEach(({ state, obligationsStroops }, i) => {
    const binding = nodes[i]!;
    const parent = i === 0 ? null : nodes[i > ci ? ci : i - 1]!.contractAddress;
    const next =
      i === ci
        ? nodes.slice(i + 1).map((v) => v.contractAddress)
        : i < ci
          ? [nodes[i + 1]!.contractAddress]
          : [];
    if (
      state.nodeId !== binding.nodeId ||
      state.contractAddress !== binding.contractAddress ||
      state.revision !== binding.expectedRevision ||
      state.admin !== definition.owner ||
      state.assetContract !== definition.assetContract ||
      state.parentContract !== parent ||
      !same(state.nextContracts, next) ||
      !same(state.configuration, configs[i]) ||
      (["receive", "condition", "return_to_owner"].includes(state.configuration.kind) &&
        obligationsStroops !== "0")
    )
      throw new Error();
  });
  return {
    ...base,
    supported: true,
    policyVersion: 2,
    confirmedLedger: integer(d.confirmedLedger, 1, 0xffff_ffff),
    definition,
    nodes,
    statuses,
  };
}
export function parseConditionalExecutePrepared(
  value: unknown,
  request?: ConditionalExecutePrepareInput,
  deploymentId?: string,
): ConditionalExecutePrepared {
  const d = exact(value, [
      "intent",
      "txHash",
      "walletAddress",
      "xdr",
      "expiresAt",
      "network",
      "networkPassphrase",
      "execution",
    ]),
    net = network(d.network),
    execution = parseConditionalExecutionIntent(d.execution);
  if (
    d.networkPassphrase !== passphrases[net] ||
    execution.networkPassphraseHash !== networkIds[net] ||
    d.walletAddress !== execution.payer ||
    (deploymentId !== undefined && !sameUuid(execution.deploymentId, deploymentId)) ||
    (request &&
      (execution.payer !== request.from ||
        execution.amountStroops !== request.amount ||
        !same(execution.arguments, request.arguments)))
  )
    throw new Error();
  return {
    intent: uuid(d.intent),
    txHash: hash(d.txHash),
    walletAddress: address(d.walletAddress, "G"),
    xdr: pattern(d.xdr, /^[\s\S]{10,200000}$/),
    expiresAt: timestamp(d.expiresAt),
    network: net,
    networkPassphrase: passphrases[net],
    execution,
  };
}
const validatedInput = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch {
    throw new TypeError("Invalid SDK conditional payment input");
  }
};
const prepareInput = (value: ConditionalExecutePrepareInput): ConditionalExecutePrepareInput => {
  const d = exact(value, ["amount", "from", "arguments"]);
  return {
    amount: amount(d.amount, true),
    from: address(d.from, "G"),
    arguments: parseConditionalExecutionArguments(d.arguments),
  };
};
/** Explicit conditional operations. No method prepares a replacement, signs,
 * polls or resubmits automatically after uncertainty. */
export function conditionalPaymentMethods(transport: PaiflowTransport, deploymentId: string) {
  const base = `/api/v1/deployments/${deploymentId}`;
  return {
    state: (options?: RequestOptions) =>
      transport.request(
        {
          path: `${base}/execution`,
          method: "GET",
          auth: { kind: "token" },
          query: { version: "2" },
          parse: (value) => {
            const result = parseConditionalExecutionDiscovery(value);
            if (!sameUuid(result.deploymentId, deploymentId)) throw new Error();
            return result;
          },
        },
        options,
      ),
    prepare: (body: ConditionalExecutePrepareInput, options?: RequestOptions) => {
      const input = validatedInput(() => prepareInput(body));
      return transport.request(
        {
          path: `${base}/execute`,
          method: "POST",
          auth: { kind: "token" },
          query: { version: "2" },
          body: input,
          parse: (value) => parseConditionalExecutePrepared(value, input, deploymentId),
        },
        options,
      );
    },
    submit: (body: ExecuteSubmission, options: ExecuteSubmitOptions = {}) => {
      if (options.wait !== undefined && typeof options.wait !== "boolean")
        throw new TypeError("Invalid wait");
      const input = validatedInput(() => ({
        signedXdr: pattern(body.signedXdr, /^[\s\S]{10,200000}$/),
        ...(body.intent === undefined ? {} : { intent: uuid(body.intent) }),
      }));
      return transport.request(
        {
          path: `${base}/execute/submit`,
          method: "POST",
          auth: { kind: "token" },
          query: {
            version: "2",
            ...(options.wait === undefined ? {} : { wait: String(options.wait) }),
          },
          body: input,
          parse: (value) => {
            const d = object(value);
            return {
              txHash: hash(d.txHash),
              status: choice(d.status, ["SUCCESS", "PENDING", "FAILED", "UNKNOWN", "REJECTED"]),
              ...(d.ledger === undefined ? {} : { ledger: integer(d.ledger, 1) }),
              ...(d.error === undefined
                ? {}
                : {
                    error: {
                      code: text(object(d.error).code),
                      message: text(object(d.error).message),
                    },
                  }),
            };
          },
        },
        options,
      );
    },
    reconcile: (body: { intent: string }, options?: RequestOptions) => {
      const input = validatedInput(() => ({ intent: uuid(body.intent) }));
      return transport.request(
        {
          path: `${base}/execute/reconcile`,
          method: "POST",
          auth: { kind: "token" },
          query: { version: "2" },
          body: input,
          parse: (value) => {
            const d = object(value);
            if (!sameUuid(d.intent, input.intent)) throw new Error();
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
