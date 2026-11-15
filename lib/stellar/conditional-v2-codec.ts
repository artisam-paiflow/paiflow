import "server-only";
import { Address, hash, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { z } from "zod";
import {
  ConditionalExecutionIntentSchema,
  type ConditionalExecutionIntent,
  type ConditionalPayNode,
  type ConditionalSplitNode,
} from "@/lib/flows/conditional-v2";
import {
  ConditionalGraphManifestSchema,
  type ConditionalCompiledNode,
  type ConditionalGraphManifest,
} from "@/lib/flows/conditional-v2-compiler";
import {
  ConditionalMutationStatusSchema,
  ConditionalNodeStateSchema,
  type ConditionalNodeState,
} from "@/lib/flows/conditional-v2-state";
import {
  ContractAddressSchema,
  PolicyIdSchema,
  StroopsSchema,
  WalletAddressSchema,
  type AdditionalRecipient,
  type Allocation,
  type FieldMode,
  type NodeExecutionInput,
} from "@/lib/flows/field-policies";

const symbol = (value: string) => nativeToScVal(value, { type: "symbol" });
const string = (value: string) => nativeToScVal(value, { type: "string" });
const address = (value: string) => new Address(value).toScVal();
const i128 = (value: string) => nativeToScVal(BigInt(value), { type: "i128" });
const u32 = (value: number) => nativeToScVal(value, { type: "u32" });
const u64 = (value: string) => nativeToScVal(BigInt(value), { type: "u64" });
const bytes = (value: string) => xdr.ScVal.scvBytes(Buffer.from(value, "hex"));
const vec = (values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
const variant = (name: string, ...values: xdr.ScVal[]) => vec([symbol(name), ...values]);
const record = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => new xdr.ScMapEntry({ key: symbol(key), val })),
  );
const optionalAddress = (value: string | null | undefined) =>
  value == null ? xdr.ScVal.scvVoid() : address(value);
const mode = (value: FieldMode) =>
  variant(value === "constant" ? "Constant" : value === "execution" ? "Execution" : "Mutable");
const allocation = (value: Allocation) =>
  value.kind === "fixed"
    ? variant("Fixed", i128(value.amountStroops))
    : variant("Percentage", u32(value.bps));
const maybeAllocation = (value: Allocation | undefined) =>
  value === undefined ? variant("Missing") : variant("Present", allocation(value));
const additional = (row: AdditionalRecipient) =>
  record({
    row_id: string(row.rowId),
    recipient: address(row.recipient),
    allocation: allocation(row.allocation),
  });

/** Explicit server-selected passphrase and deployer are inputs to CAP-46; this
 * helper reads no environment and never derives an address from wallet config. */
export function conditionalContractAddress(
  owner: string,
  salt: Uint8Array,
  networkPassphrase: string,
): string {
  WalletAddressSchema.parse(owner);
  if (salt.length !== 32 || networkPassphrase.length === 0)
    throw new Error("CAP-46 requires a 32-byte salt and server-selected network passphrase");
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(owner).toScAddress(),
          salt: Buffer.from(salt),
        }),
      ),
    }),
  );
  return Address.contract(hash(preimage.toXDR())).toString();
}
function payConfig(node: ConditionalPayNode) {
  const { configuration, policy } = node;
  const payout = configuration.payoutValue;
  return record({
    version: u32(1),
    node_id: string(node.nodeId),
    recipient_mode: mode(policy.recipient),
    payout_value_mode: mode(policy.payoutValue),
    recipient: optionalAddress(configuration.recipient),
    payout_rule: payout.kind === "full" ? variant("Full") : allocation(payout),
  });
}
function splitConfig(node: ConditionalSplitNode) {
  return record({
    policy: record({
      version: u32(1),
      node_id: string(node.nodeId),
      allocation_mode: variant(node.policy.allocationMode === "fixed" ? "Fixed" : "Percentage"),
      additional_mode: mode(node.policy.additionalRecipients),
      rows: vec(
        node.policy.rows.map((policy, index) => {
          const row = node.configuration.configuredRows[index]!;
          return record({
            row_id: string(row.rowId),
            recipient_mode: mode(policy.recipient),
            allocation_mode: mode(policy.allocation),
            recipient: optionalAddress(row.recipient),
            allocation: maybeAllocation(row.allocation),
          });
        }),
      ),
    }),
    additional: vec(node.configuration.additionalRecipients.map(additional)),
  });
}
function nodeConfiguration(state: ConditionalNodeState): xdr.ScVal {
  const value = state.configuration;
  switch (value.kind) {
    case "receive":
      return variant("Receive", record({ min_amount: i128(value.minAmountStroops) }));
    case "pay":
      return variant("Pay", payConfig(value));
    case "split":
      return variant("Split", splitConfig(value));
    case "condition":
      return variant(
        "Condition",
        record({
          comparison: variant(value.comparison === "amount_gt" ? "AmountGt" : "AmountLt"),
          threshold: i128(value.thresholdStroops),
          threshold_mode: mode(value.thresholdMode),
        }),
      );
    case "return_to_owner":
      return variant("ReturnToOwner", record({ recipient: address(value.recipient) }));
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}
/** Exact NodeStateV2 encoding used by constructors, versioned getters and events. */
export function conditionalNodeStateScVal(raw: ConditionalNodeState): xdr.ScVal {
  const state = ConditionalNodeStateSchema.parse(raw);
  return record({
    version: u32(2),
    node_id: string(state.nodeId),
    contract_address: address(state.contractAddress),
    revision: u64(state.revision),
    admin: address(state.admin),
    asset: address(state.assetContract),
    parent: optionalAddress(state.parentContract),
    next_steps: vec(state.nextContracts.map(address)),
    configuration: nodeConfiguration(state),
  });
}
export function conditionalManifestScVal(raw: ConditionalGraphManifest): xdr.ScVal {
  const manifest = ConditionalGraphManifestSchema.parse(raw);
  return record({
    version: u32(2),
    root: address(manifest.rootContract),
    admin: address(manifest.admin),
    asset: address(manifest.assetContract),
    nodes: vec(
      manifest.nodes.map((node) =>
        record({ wasm_hash: bytes(node.wasmHash), state: conditionalNodeStateScVal(node.state) }),
      ),
    ),
  });
}
const targets = (values: string[]) =>
  vec(values.map((value) => record({ address: address(value), data: string("") })));
/** Family arities are retained. Only the reviewed tagged slot changes; every
 * redundant outer argument is derived from the same immutable initial state. */
export function conditionalConstructorArgs(
  node: ConditionalCompiledNode,
  rawManifest: ConditionalGraphManifest,
): xdr.ScVal[] {
  const manifest = ConditionalGraphManifestSchema.parse(rawManifest);
  const state = ConditionalNodeStateSchema.parse(node.initialState);
  const canonical = manifest.nodes.find(
    (candidate) => candidate.state.nodeId === node.nodeId,
  )?.state;
  if (
    !canonical ||
    node.version !== 2 ||
    node.nodeId !== state.nodeId ||
    !conditionalNodeStateScVal(canonical).toXDR().equals(conditionalNodeStateScVal(state).toXDR())
  )
    throw new Error("Constructor state must equal its complete immutable manifest entry");
  const init = record({
    version: u32(2),
    node_id: string(node.nodeId),
    manifest: conditionalManifestScVal(manifest),
  });
  const admin = address(manifest.admin),
    asset = address(manifest.assetContract);
  const value = state.configuration;
  if (value.kind === "receive" && node.templateKind === "DEPOSIT_TRIGGER")
    return [admin, asset, init];
  if (!state.parentContract) throw new Error("Conditional child requires an immutable parent");
  const parent = address(state.parentContract);
  if ((value.kind === "pay" || value.kind === "return_to_owner") && node.templateKind === "PAYER") {
    const rule =
      value.kind === "return_to_owner"
        ? { kind: "full" as const }
        : value.configuration.payoutValue;
    return [
      admin,
      asset,
      init,
      i128(rule.kind === "fixed" ? rule.amountStroops : "0"),
      u32(rule.kind === "full" ? 10000 : rule.kind === "percentage" ? rule.bps : 0),
      targets(state.nextContracts),
      parent,
    ];
  }
  if (value.kind === "split" && node.templateKind === "SPLITTER")
    return [admin, asset, init, i128("0"), parent, targets([])];
  if (value.kind === "condition" && node.templateKind === "ROUTER")
    return [
      admin,
      asset,
      init,
      targets([state.nextContracts[0]!]),
      targets([state.nextContracts[1]!]),
      parent,
    ];
  throw new Error("Semantic configuration does not match the compiled contract family");
}
function nodeInput(input: NodeExecutionInput): xdr.ScVal {
  if (input.kind === "pay")
    return variant(
      "Pay",
      record({ node_id: string(input.nodeId), recipient: address(input.recipient) }),
    );
  return variant(
    "Split",
    record({
      node_id: string(input.nodeId),
      rows: vec(
        input.rows.map((row) =>
          record({
            row_id: string(row.rowId),
            recipient: optionalAddress(row.recipient),
            allocation: maybeAllocation(row.allocation),
          }),
        ),
      ),
      additional:
        input.additionalRecipients === undefined
          ? xdr.ScVal.scvVoid()
          : vec(input.additionalRecipients.map(additional)),
    }),
  );
}
const encodedBindings = (intent: ConditionalExecutionIntent) =>
  vec(
    intent.nodes.map((node) =>
      record({
        node_id: string(node.nodeId),
        contract_address: address(node.contractAddress),
        expected_revision: u64(node.expectedRevision),
        wasm_hash: bytes(node.wasmHash),
      }),
    ),
  );
const encodedRoute = (intent: ConditionalExecutionIntent) =>
  record({
    selected_branch: variant(intent.selectedBranch === "true" ? "True" : "False"),
    amount_at_condition: i128(intent.amountAtConditionStroops),
  });
/** Root args authenticate every graph pin/revision and the independently checked
 * route assertion. Invalid/inactive inputs fail before anything is serialized. */
export function executionV2Args(raw: ConditionalExecutionIntent): xdr.ScVal[] {
  const intent = ConditionalExecutionIntentSchema.parse(raw);
  return [
    address(intent.payer),
    address(intent.assetContract),
    i128(intent.amountStroops),
    bytes(intent.nonce),
    u32(intent.expiresAtLedger),
    encodedBindings(intent),
    vec(intent.arguments.inputs.map(nodeInput)),
    encodedRoute(intent),
  ];
}
export function conditionalExecutionContextScVal(raw: ConditionalExecutionIntent): xdr.ScVal {
  const intent = ConditionalExecutionIntentSchema.parse(raw);
  return record({
    payer: address(intent.payer),
    root: address(intent.rootContract),
    asset: address(intent.assetContract),
    funded_amount: i128(intent.amountStroops),
    nonce: bytes(intent.nonce),
    expires_at_ledger: u32(intent.expiresAtLedger),
    bindings: encodedBindings(intent),
    inputs: vec(intent.arguments.inputs.map(nodeInput)),
    route: encodedRoute(intent),
  });
}
export function executionV2StepArgs(
  intent: ConditionalExecutionIntent,
  amountStroops: string,
): xdr.ScVal[] {
  const parsed = ConditionalExecutionIntentSchema.parse(intent);
  const amount = StroopsSchema.parse(amountStroops);
  if (BigInt(amount) > BigInt(parsed.amountStroops))
    throw new Error("A hop cannot enlarge the invocation budget");
  return [conditionalExecutionContextScVal(parsed), i128(amount)];
}

const rawDecimal = z.bigint().nonnegative().transform(String);
const rawMode = z
  .union([
    z.tuple([z.literal("Constant")]),
    z.tuple([z.literal("Execution")]),
    z.tuple([z.literal("Mutable")]),
  ])
  .transform(
    ([value]): FieldMode =>
      value === "Constant" ? "constant" : value === "Execution" ? "execution" : "mutable",
  );
const rawStoredMode = z
  .union([z.tuple([z.literal("Constant")]), z.tuple([z.literal("Mutable")])])
  .transform(([value]) => (value === "Constant" ? ("constant" as const) : ("mutable" as const)));
const rawAllocation = z
  .union([
    z.tuple([z.literal("Fixed"), rawDecimal]),
    z.tuple([z.literal("Percentage"), z.number().int().min(1).max(10000)]),
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
const rawPay = z
  .object({
    version: z.literal(1),
    node_id: PolicyIdSchema,
    recipient_mode: rawMode,
    payout_value_mode: rawStoredMode,
    recipient: WalletAddressSchema.nullable(),
    payout_rule: z.union([
      z.tuple([z.literal("Full")]),
      z.tuple([z.literal("Fixed"), rawDecimal]),
      z.tuple([z.literal("Percentage"), z.number().int().min(1).max(10000)]),
    ]),
  })
  .strict()
  .transform(
    (value): ConditionalPayNode => ({
      kind: "pay",
      nodeId: value.node_id,
      policy: {
        kind: "pay",
        nodeId: value.node_id,
        recipient: value.recipient_mode,
        payoutValue: value.payout_value_mode,
      },
      configuration: {
        kind: "pay",
        ...(value.recipient === null ? {} : { recipient: value.recipient }),
        payoutValue:
          value.payout_rule[0] === "Full"
            ? { kind: "full" }
            : value.payout_rule[0] === "Fixed"
              ? { kind: "fixed", amountStroops: value.payout_rule[1] }
              : { kind: "percentage", bps: value.payout_rule[1] },
      },
    }),
  );
const rawSplit = z
  .object({
    policy: z
      .object({
        version: z.literal(1),
        node_id: PolicyIdSchema,
        allocation_mode: z.union([
          z.tuple([z.literal("Fixed")]),
          z.tuple([z.literal("Percentage")]),
        ]),
        additional_mode: rawMode,
        rows: z
          .array(
            z
              .object({
                row_id: PolicyIdSchema,
                recipient_mode: rawMode,
                allocation_mode: rawMode,
                recipient: WalletAddressSchema.nullable(),
                allocation: rawMaybeAllocation,
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
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
      .max(20),
  })
  .strict()
  .transform(
    (value): ConditionalSplitNode => ({
      kind: "split",
      nodeId: value.policy.node_id,
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
          ...(row.recipient === null ? {} : { recipient: row.recipient }),
          ...(row.allocation === undefined ? {} : { allocation: row.allocation }),
        })),
        additionalRecipients: value.additional.map((row) => ({
          rowId: row.row_id,
          recipient: row.recipient,
          allocation: row.allocation,
        })),
      },
    }),
  );
const rawConfiguration = z.union([
  z
    .tuple([z.literal("Receive"), z.object({ min_amount: rawDecimal }).strict()])
    .transform(([, value]) => ({ kind: "receive" as const, minAmountStroops: value.min_amount })),
  z.tuple([z.literal("Pay"), rawPay]).transform(([, value]) => value),
  z.tuple([z.literal("Split"), rawSplit]).transform(([, value]) => value),
  z
    .tuple([
      z.literal("Condition"),
      z
        .object({
          comparison: z.union([z.tuple([z.literal("AmountGt")]), z.tuple([z.literal("AmountLt")])]),
          threshold: rawDecimal,
          threshold_mode: z.union([
            z.tuple([z.literal("Constant")]),
            z.tuple([z.literal("Mutable")]),
          ]),
        })
        .strict(),
    ])
    .transform(([, value]) => ({
      kind: "condition" as const,
      comparison:
        value.comparison[0] === "AmountGt" ? ("amount_gt" as const) : ("amount_lt" as const),
      thresholdStroops: value.threshold,
      thresholdMode:
        value.threshold_mode[0] === "Constant" ? ("constant" as const) : ("mutable" as const),
    })),
  z
    .tuple([z.literal("ReturnToOwner"), z.object({ recipient: WalletAddressSchema }).strict()])
    .transform(([, value]) => ({ kind: "return_to_owner" as const, recipient: value.recipient })),
]);
const RawNodeStateSchema = z
  .object({
    version: z.literal(2),
    node_id: PolicyIdSchema,
    contract_address: ContractAddressSchema,
    revision: rawDecimal,
    admin: WalletAddressSchema,
    asset: ContractAddressSchema,
    parent: ContractAddressSchema.nullable(),
    next_steps: z.array(ContractAddressSchema).max(2),
    configuration: rawConfiguration,
  })
  .strict()
  .transform((value) =>
    ConditionalNodeStateSchema.parse({
      version: 2,
      nodeId: value.node_id,
      contractAddress: value.contract_address,
      revision: value.revision,
      admin: value.admin,
      assetContract: value.asset,
      parentContract: value.parent,
      nextContracts: value.next_steps,
      configuration: value.configuration,
    }),
  );
const native = (raw: unknown): unknown => (raw instanceof xdr.ScVal ? scValToNative(raw) : raw);
export function decodeConditionalNodeState(raw: unknown): ConditionalNodeState {
  return RawNodeStateSchema.parse(native(raw));
}
export function decodeConditionalManifest(raw: unknown): ConditionalGraphManifest {
  const value = z
    .object({
      version: z.literal(2),
      root: ContractAddressSchema,
      admin: WalletAddressSchema,
      asset: ContractAddressSchema,
      nodes: z
        .array(
          z
            .object({
              wasm_hash: z
                .instanceof(Uint8Array)
                .refine((value) => value.length === 32)
                .transform((value) => Buffer.from(value).toString("hex")),
              state: RawNodeStateSchema,
            })
            .strict(),
        )
        .min(4)
        .max(40),
    })
    .strict()
    .parse(native(raw));
  return ConditionalGraphManifestSchema.parse({
    version: 2,
    rootContract: value.root,
    admin: value.admin,
    assetContract: value.asset,
    nodes: value.nodes.map((node) => ({ wasmHash: node.wasm_hash, state: node.state })),
  });
}
export function decodeConditionalMutationStatus(raw: unknown) {
  const value = z
    .object({ state: RawNodeStateSchema, obligations: rawDecimal })
    .strict()
    .parse(native(raw));
  return ConditionalMutationStatusSchema.parse({
    state: value.state,
    obligationsStroops: value.obligations,
  });
}
/** Local partial implementation tuple only. This decoder grants no production
 * artifact capability; the reviewed trust manifest intentionally has no v2 pins. */
export const ConditionalLocalCapabilitiesSchema = z
  .object({
    policy_version: z.literal(2),
    execution_abi: z.literal(2),
    mutation_abi: z.literal(0),
    conditional: z.literal(true),
    execution: z.literal(true),
    mutation: z.literal(false),
    immutable_policies: z.literal(true),
    revision_binding: z.literal(true),
  })
  .strict();
export function decodeConditionalCapabilities(raw: unknown) {
  return ConditionalLocalCapabilitiesSchema.parse(native(raw));
}
