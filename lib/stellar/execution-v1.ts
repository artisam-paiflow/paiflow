import "server-only";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { z } from "zod";
import {
  ArtifactCapabilitiesSchema,
  ConfirmedNodeConfigurationSchema,
  ContractAddressSchema,
  ExecutionIntentSchema,
  ExecutionNodeBindingSchema,
  PolicyIdSchema,
  WalletAddressSchema,
  type Allocation,
  type ArtifactCapabilities,
  type ConfirmedNodeConfiguration,
  type ExecutionIntent,
  type MutationArguments,
  MutationArgumentsSchema,
} from "@/lib/flows/field-policies";
import { MUTATION_V1_WASM_HASHES } from "./execution-artifacts";
import type {
  DepositTriggerNodeParams,
  PayerNodeParams,
  SplitterNodeParams,
} from "@/lib/flows/to-params";

const symbol = (value: string) => nativeToScVal(value, { type: "symbol" });
const string = (value: string) => nativeToScVal(value, { type: "string" });
const address = (value: string) => new Address(value).toScVal();
const u32 = (value: number) => nativeToScVal(value, { type: "u32" });
const u64 = (value: string) => nativeToScVal(BigInt(value), { type: "u64" });
const i128 = (value: string) => nativeToScVal(BigInt(value), { type: "i128" });
const variant = (name: string, ...values: xdr.ScVal[]) =>
  xdr.ScVal.scvVec([symbol(name), ...values]);
const record = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => new xdr.ScMapEntry({ key: symbol(key), val })),
  );
const mode = (value: "constant" | "execution" | "mutable") =>
  variant(value === "constant" ? "Constant" : value === "execution" ? "Execution" : "Mutable");
const allocation = (value: Allocation) =>
  value.kind === "fixed"
    ? variant("Fixed", i128(value.amountStroops))
    : variant("Percentage", u32(value.bps));
const maybeAllocation = (value: Allocation | undefined) =>
  value ? variant("Present", allocation(value)) : variant("Missing");
const optionalAddress = (value: string | undefined) =>
  value === undefined ? xdr.ScVal.scvVoid() : address(value);
const targets = (ids: string[], addresses: Record<string, string>) =>
  xdr.ScVal.scvVec(
    ids.map((id) => {
      const target = addresses[id];
      if (!target) throw new Error(`Missing computed address for node ${id}`);
      return record({ address: address(target), data: string("") });
    }),
  );

/** Tagged v1 configuration replaces one legacy constructor argument, never a post-deploy initializer. */
export function executionConstructorConfig(
  params: DepositTriggerNodeParams | PayerNodeParams | SplitterNodeParams,
  addresses: Record<string, string>,
): xdr.ScVal {
  if (params.kind === "deposit_trigger") {
    if (!params.executionNodeId) throw new Error("Missing execution root identity");
    return record({
      version: u32(1),
      node_id: string(params.executionNodeId),
      next_steps: targets(params.nextStepNodeIds, addresses),
      min_amount: i128(params.minAmountStroops ?? "0"),
    });
  }
  const policy = params.fieldPolicy;
  if (!policy) throw new Error("Missing execution policy");
  if (params.kind === "payer" && policy.kind === "pay")
    return record({
      version: u32(1),
      node_id: string(policy.nodeId),
      recipient_mode: mode(policy.recipient),
      payout_value_mode: mode(policy.payoutValue),
      recipient: optionalAddress(policy.recipient === "execution" ? undefined : params.recipient),
      payout_rule: params.fullAmount
        ? variant("Full")
        : params.mode === "percentage"
          ? variant("Percentage", u32(params.percentageBps ?? 0))
          : variant("Fixed", i128(params.amountStroops)),
    });
  if (params.kind !== "splitter" || policy.kind !== "split")
    throw new Error("Mismatched execution policy");
  const splitPolicy = record({
    version: u32(1),
    node_id: string(policy.nodeId),
    allocation_mode: variant(policy.allocationMode === "fixed" ? "Fixed" : "Percentage"),
    additional_mode: mode(policy.additionalRecipients),
    rows: xdr.ScVal.scvVec(
      policy.rows.map((row, index) => {
        const configured = params.recipients[index];
        if (!configured || configured.rowId !== row.rowId)
          throw new Error("Configured row identity mismatch");
        return record({
          row_id: string(row.rowId),
          recipient_mode: mode(row.recipient),
          allocation_mode: mode(row.allocation),
          recipient: optionalAddress(
            row.recipient === "execution" ? undefined : configured.address,
          ),
          allocation: maybeAllocation(
            row.allocation === "execution"
              ? undefined
              : policy.allocationMode === "fixed"
                ? { kind: "fixed", amountStroops: configured.amount }
                : { kind: "percentage", bps: configured.bps },
          ),
        });
      }),
    ),
  });
  if (policy.additionalRecipients !== "mutable") return splitPolicy;
  return record({
    policy: splitPolicy,
    additional: xdr.ScVal.scvVec(
      (params.initialAdditionalRecipients ?? []).map((row) =>
        record({
          row_id: string(row.rowId),
          recipient: address(row.recipient),
          allocation: allocation(row.allocation),
        }),
      ),
    ),
  });
}

/** Root invocation authenticates the complete ordered path and all atomic changes. */
export function mutationV1Args(
  bindings: ExecutionIntent["nodes"],
  raw: MutationArguments,
): xdr.ScVal[] {
  const args = MutationArgumentsSchema.parse(raw);
  const nodes = z.array(ExecutionNodeBindingSchema).min(2).max(40).parse(bindings);
  return [
    xdr.ScVal.scvVec(
      nodes.map((binding) =>
        record({
          node_id: string(binding.nodeId),
          contract_address: address(binding.contractAddress),
          expected_revision: u64(binding.expectedRevision),
        }),
      ),
    ),
    xdr.ScVal.scvVec(
      args.changes.map((change) =>
        change.kind === "pay"
          ? variant(
              "Pay",
              record({
                node_id: string(change.nodeId),
                expected_revision: u64(change.expectedRevision),
                recipient: optionalAddress(change.recipient),
                payout_value: maybeAllocation(change.payoutValue),
              }),
            )
          : variant(
              "Split",
              record({
                node_id: string(change.nodeId),
                expected_revision: u64(change.expectedRevision),
                rows: xdr.ScVal.scvVec(
                  change.rows.map((row) =>
                    record({
                      row_id: string(row.rowId),
                      recipient: optionalAddress(row.recipient),
                      allocation: maybeAllocation(row.allocation),
                    }),
                  ),
                ),
                additional:
                  change.additionalRecipients === undefined
                    ? xdr.ScVal.scvVoid()
                    : xdr.ScVal.scvVec(
                        change.additionalRecipients.map((row) =>
                          record({
                            row_id: string(row.rowId),
                            recipient: address(row.recipient),
                            allocation: allocation(row.allocation),
                          }),
                        ),
                      ),
              }),
            ),
      ),
    ),
  ];
}

/** Exact args authenticated by the payer on the root invocation. */
export function executionV1Args(input: ExecutionIntent): xdr.ScVal[] {
  const intent = ExecutionIntentSchema.parse(input);
  return [
    address(intent.payer),
    address(intent.assetContract),
    i128(intent.amountStroops),
    xdr.ScVal.scvBytes(Buffer.from(intent.nonce, "hex")),
    u32(intent.expiresAtLedger),
    xdr.ScVal.scvVec(
      intent.nodes.map((node) =>
        record({
          node_id: string(node.nodeId),
          contract_address: address(node.contractAddress),
          expected_revision: u64(node.expectedRevision),
        }),
      ),
    ),
    xdr.ScVal.scvVec(
      intent.arguments.inputs.map((node) => {
        if (node.kind === "pay")
          return variant(
            "Pay",
            record({ node_id: string(node.nodeId), recipient: address(node.recipient) }),
          );
        return variant(
          "Split",
          record({
            node_id: string(node.nodeId),
            rows: xdr.ScVal.scvVec(
              node.rows.map((row) =>
                record({
                  row_id: string(row.rowId),
                  recipient: optionalAddress(row.recipient),
                  allocation: maybeAllocation(row.allocation),
                }),
              ),
            ),
            additional:
              node.additionalRecipients === undefined
                ? xdr.ScVal.scvVoid()
                : xdr.ScVal.scvVec(
                    node.additionalRecipients.map((row) =>
                      record({
                        row_id: string(row.rowId),
                        recipient: address(row.recipient),
                        allocation: allocation(row.allocation),
                      }),
                    ),
                  ),
          }),
        );
      }),
    ),
  ];
}

const rawValue = (value: unknown): unknown =>
  value instanceof xdr.ScVal ? scValToNative(value) : value;
const decimal = z
  .union([z.bigint().nonnegative(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform(String);
const positiveDecimal = z.bigint().positive().transform(String);
const rawMode = z
  .union([
    z.tuple([z.literal("Constant")]),
    z.tuple([z.literal("Execution")]),
    z.tuple([z.literal("Mutable")]),
  ])
  .transform(([value]) =>
    value === "Constant"
      ? ("constant" as const)
      : value === "Execution"
        ? ("execution" as const)
        : ("mutable" as const),
  );
const rawAllocation = z
  .union([
    z.tuple([z.literal("Fixed"), positiveDecimal]),
    z.tuple([z.literal("Percentage"), z.number().int().min(1).max(10_000)]),
  ])
  .transform(
    (value): Allocation =>
      value[0] === "Fixed"
        ? { kind: "fixed", amountStroops: value[1] }
        : { kind: "percentage", bps: value[1] },
  );
const rawMaybeAllocation = z
  .union([z.tuple([z.literal("Missing")]), z.tuple([z.literal("Present"), rawAllocation])])
  .transform((value) => (value[0] === "Missing" ? undefined : value[1]));
const rawRecipient = WalletAddressSchema.nullish().transform((value) => value ?? undefined);
const rawTarget = z.object({ address: ContractAddressSchema, data: z.literal("") }).strict();
const rawRoot = z
  .object({
    version: z.literal(1),
    node_id: PolicyIdSchema,
    next_steps: z.array(rawTarget).length(1),
    min_amount: decimal,
  })
  .strict();
const rawPay = z
  .object({
    version: z.literal(1),
    node_id: PolicyIdSchema,
    recipient_mode: rawMode,
    payout_value_mode: rawMode,
    recipient: rawRecipient,
    payout_rule: z.union([
      z.tuple([z.literal("Full")]),
      z.tuple([z.literal("Fixed"), positiveDecimal]),
      z.tuple([z.literal("Percentage"), z.number().int().min(1).max(10_000)]),
    ]),
  })
  .strict();
const rawRow = z
  .object({
    row_id: PolicyIdSchema,
    recipient_mode: rawMode,
    allocation_mode: rawMode,
    recipient: rawRecipient,
    allocation: rawMaybeAllocation,
  })
  .strict();
const rawSplit = z
  .object({
    version: z.literal(1),
    node_id: PolicyIdSchema,
    allocation_mode: z.union([z.tuple([z.literal("Fixed")]), z.tuple([z.literal("Percentage")])]),
    additional_mode: rawMode,
    rows: z.array(rawRow).max(20),
  })
  .strict();
const rootState = z
  .object({ policy: rawRoot, revision: decimal, asset: ContractAddressSchema })
  .strict();
const payState = z
  .object({
    policy: rawPay,
    revision: decimal,
    asset: ContractAddressSchema,
    parent: ContractAddressSchema,
    next_steps: z.array(rawTarget).max(1),
    amount: decimal,
    percentage_bps: z.number().int().min(0).max(10_000),
  })
  .strict();
const splitState = z
  .object({
    policy: rawSplit,
    revision: decimal,
    asset: ContractAddressSchema,
    parent: ContractAddressSchema,
    min_amount: decimal,
    additional: z
      .array(
        z
          .object({
            row_id: PolicyIdSchema,
            recipient: WalletAddressSchema,
            allocation: rawAllocation,
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
export type DecodedExecutionState =
  | {
      kind: "on_receive";
      nodeId: string;
      revision: string;
      asset: string;
      nextSteps: string[];
      minAmountStroops: string;
    }
  | {
      kind: "pay" | "split";
      configuration: ConfirmedNodeConfiguration;
      asset: string;
      parent: string;
      nextSteps: string[];
    };
export function decodeExecutionCapabilities(raw: unknown, wasmHash: string): ArtifactCapabilities {
  const value = z
    .object({
      policy_version: z.literal(1),
      execution_abi: z.literal(1),
      execution: z.literal(true),
      mutation: z.boolean(),
      immutable_policies: z.literal(true),
      revision_binding: z.literal(true),
    })
    .strict()
    .parse(rawValue(raw));
  if (value.mutation !== Object.values(MUTATION_V1_WASM_HASHES).some((hash) => hash === wasmHash))
    throw new Error("Mutation capability differs from the pinned reviewed artifact");
  return ArtifactCapabilitiesSchema.parse({
    policyVersion: value.policy_version,
    executionAbi: value.execution_abi,
    execution: value.execution,
    mutation: value.mutation,
    immutablePolicies: value.immutable_policies,
    revisionBinding: value.revision_binding,
    wasmHash,
  });
}
export function decodeExecutionState(
  raw: unknown,
  binding: {
    nodeId: string;
    contractAddress: string;
    confirmedLedger: number;
    templateKind: string;
  },
): DecodedExecutionState {
  const base = {
    version: 1,
    nodeId: binding.nodeId,
    contractAddress: binding.contractAddress,
    confirmedLedger: binding.confirmedLedger,
  };
  if (binding.templateKind === "DEPOSIT_TRIGGER") {
    const value = rootState.parse(rawValue(raw));
    if (value.policy.node_id !== binding.nodeId || value.revision !== "0")
      throw new Error("Root identity or revision mismatch");
    return {
      kind: "on_receive",
      nodeId: value.policy.node_id,
      revision: value.revision,
      asset: value.asset,
      nextSteps: value.policy.next_steps.map((step) => step.address),
      minAmountStroops: value.policy.min_amount,
    };
  }
  if (binding.templateKind === "PAYER") {
    const value = payState.parse(rawValue(raw));
    const rule = value.policy.payout_rule;
    if (
      rule[0] === "Fixed"
        ? value.amount !== rule[1] || value.percentage_bps !== 0
        : value.amount !== "0" || value.percentage_bps !== (rule[0] === "Full" ? 10_000 : rule[1])
    )
      throw new Error("Inconsistent configured Pay value");
    const configuration = ConfirmedNodeConfigurationSchema.parse({
      ...base,
      revision: value.revision,
      policy: {
        kind: "pay",
        nodeId: value.policy.node_id,
        recipient: value.policy.recipient_mode,
        payoutValue: value.policy.payout_value_mode,
      },
      configuration: {
        kind: "pay",
        ...(value.policy.recipient ? { recipient: value.policy.recipient } : {}),
        payoutValue:
          rule[0] === "Full"
            ? { kind: "full" }
            : rule[0] === "Fixed"
              ? { kind: "fixed", amountStroops: rule[1] }
              : { kind: "percentage", bps: rule[1] },
      },
    });
    return {
      kind: "pay",
      configuration,
      asset: value.asset,
      parent: value.parent,
      nextSteps: value.next_steps.map((step) => step.address),
    };
  }
  if (binding.templateKind !== "SPLITTER") throw new Error("Unsupported execution contract kind");
  const value = splitState.parse(rawValue(raw));
  if (value.min_amount !== "0") throw new Error("Unsupported Split configuration");
  const configuration = ConfirmedNodeConfigurationSchema.parse({
    ...base,
    revision: value.revision,
    policy: {
      kind: "split",
      nodeId: value.policy.node_id,
      allocationMode: value.policy.allocation_mode[0] === "Fixed" ? "fixed" : "percentage",
      additionalRecipients: value.policy.additional_mode,
      rows: value.policy.rows.map((row) => ({
        rowId: row.row_id,
        recipient: row.recipient_mode,
        allocation: row.allocation_mode,
      })),
    },
    configuration: {
      kind: "split",
      configuredRows: value.policy.rows.map((row) => ({
        rowId: row.row_id,
        ...(row.recipient ? { recipient: row.recipient } : {}),
        ...(row.allocation ? { allocation: row.allocation } : {}),
      })),
      additionalRecipients: (value.additional ?? []).map((row) => ({
        rowId: row.row_id,
        recipient: row.recipient,
        allocation: row.allocation,
      })),
    },
  });
  return { kind: "split", configuration, asset: value.asset, parent: value.parent, nextSteps: [] };
}
