import { createHash } from "node:crypto";
import { Address, Networks, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  ConditionalDefinitionSchema,
  ConditionalExecutionIntentSchema,
  conditionalNodeOrder,
  selectConditionalBranch,
  type ConditionalDefinition,
  type ConditionalExecutionIntent,
  type ConditionalTerminal,
} from "@/lib/flows/conditional-v2";
import { compileConditionalPipeline } from "@/lib/flows/conditional-v2-compiler";
import {
  conditionalConstructorArgs,
  conditionalContractAddress,
  executionV2Args,
} from "@/lib/stellar/conditional-v2-codec";

/** Synthetic unsigned packet identities only. No keypair, signer or network I/O. */
export const conditionalWallet = (value: number) =>
  StrKey.encodeEd25519PublicKey(Buffer.alloc(32, value));
export const conditionalOwner = conditionalWallet(1);
export const conditionalPayer = conditionalWallet(2);
export const conditionalPlatform = conditionalWallet(3);
export const conditionalWorker = conditionalWallet(4);
export const conditionalAsset = StrKey.encodeContract(Buffer.alloc(32, 20));
export type ConditionalFixtureKind = "pay" | "split" | "return_to_owner";
export type ConditionalFixturePins = Record<
  "DEPOSIT_TRIGGER" | "PAYER" | "SPLITTER" | "ROUTER",
  string
>;
/** Explicit native-test declarations, never trusted artifact hashes. */
export const conditionalSyntheticPins: ConditionalFixturePins = {
  DEPOSIT_TRIGGER: "a1".repeat(32),
  PAYER: "a2".repeat(32),
  SPLITTER: "a3".repeat(32),
  ROUTER: "a4".repeat(32),
};
function terminal(kind: ConditionalFixtureKind, nodeId: string): ConditionalTerminal {
  if (kind === "return_to_owner") return { kind, nodeId };
  if (kind === "pay")
    return {
      kind,
      nodeId,
      policy: { kind, nodeId, recipient: "execution", payoutValue: "constant" },
      configuration: { kind, payoutValue: { kind: "fixed", amountStroops: "20" } },
    };
  return {
    kind,
    nodeId,
    policy: {
      kind,
      nodeId,
      allocationMode: "percentage",
      rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
      additionalRecipients: "execution",
    },
    configuration: {
      kind,
      configuredRows: [
        {
          rowId: "platform",
          recipient: conditionalPlatform,
          allocation: { kind: "percentage", bps: 1000 },
        },
      ],
      additionalRecipients: [],
    },
  };
}
export function conditionalAcceptanceDefinition(
  comparison: "amount_gt" | "amount_lt" = "amount_gt",
  trueKind: ConditionalFixtureKind = "split",
  falseKind: ConditionalFixtureKind = "return_to_owner",
): ConditionalDefinition {
  return ConditionalDefinitionSchema.parse({
    version: 2,
    owner: conditionalOwner,
    assetContract: conditionalAsset,
    root: { nodeId: "receive", minAmountStroops: "1" },
    prefix: [
      {
        nodeId: "fee",
        kind: "pay",
        policy: { nodeId: "fee", kind: "pay", recipient: "constant", payoutValue: "constant" },
        configuration: {
          kind: "pay",
          recipient: conditionalPlatform,
          payoutValue: { kind: "fixed", amountStroops: "10" },
        },
      },
    ],
    condition: {
      nodeId: "condition",
      kind: comparison,
      thresholdStroops: "100",
      thresholdMode: "mutable",
    },
    trueBranch: terminal(trueKind, "yes"),
    falseBranch: terminal(falseKind, "no"),
  });
}
export function conditionalAcceptancePlan(
  definition = conditionalAcceptanceDefinition(),
  pins = conditionalSyntheticPins,
) {
  const conditionIndex = definition.prefix.length + 1;
  const bindings = conditionalNodeOrder(definition).map((nodeId, index) => {
    const kind =
      index === 0
        ? "DEPOSIT_TRIGGER"
        : index === conditionIndex
          ? "ROUTER"
          : index < conditionIndex
            ? "PAYER"
            : (index === conditionIndex + 1 ? definition.trueBranch : definition.falseBranch)
                  .kind === "split"
              ? "SPLITTER"
              : "PAYER";
    return {
      nodeId,
      contractAddress: conditionalContractAddress(
        definition.owner,
        Buffer.alloc(32, index + 101),
        Networks.TESTNET,
      ),
      expectedRevision: "0",
      wasmHash: pins[kind],
    };
  });
  return compileConditionalPipeline(definition, bindings);
}
function selectedInputs(definition: ConditionalDefinition, amountStroops: string) {
  const selection = selectConditionalBranch(definition, amountStroops);
  const branch =
    selection.selectedBranch === "true" ? definition.trueBranch : definition.falseBranch;
  if (branch.kind === "return_to_owner") return [];
  if (branch.kind === "pay")
    return [{ kind: "pay" as const, nodeId: branch.nodeId, recipient: conditionalWorker }];
  return [
    {
      kind: "split" as const,
      nodeId: branch.nodeId,
      rows: [],
      additionalRecipients: [
        {
          rowId: "worker",
          recipient: conditionalWorker,
          allocation: { kind: "percentage" as const, bps: 9000 },
        },
      ],
    },
  ];
}
export function conditionalAcceptanceIntent(
  definition = conditionalAcceptanceDefinition(),
  amountStroops = "111",
  serial = 1,
  pins = conditionalSyntheticPins,
): ConditionalExecutionIntent {
  const plan = conditionalAcceptancePlan(definition, pins);
  return ConditionalExecutionIntentSchema.parse({
    version: 2,
    deploymentId: "12231223-1223-4223-8223-122312231223",
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: plan.bindings[0]!.contractAddress,
    assetContract: definition.assetContract,
    payer: conditionalPayer,
    amountStroops,
    nonce: serial.toString(16).padStart(64, "0"),
    expiresAtLedger: 100,
    definition,
    nodes: plan.bindings,
    arguments: { version: 2, inputs: selectedInputs(definition, amountStroops) },
    ...selectConditionalBranch(definition, amountStroops),
  });
}
export type ConditionalAcceptanceScenario = { name: string; definition: ConditionalDefinition };
const fixtureKinds: ConditionalFixtureKind[] = ["pay", "split", "return_to_owner"];
export const conditionalAcceptanceScenarios: ConditionalAcceptanceScenario[] = (
  ["amount_gt", "amount_lt"] as const
).flatMap((comparison) =>
  fixtureKinds.flatMap((trueKind) =>
    fixtureKinds.map((falseKind) => ({
      name: `${comparison}-${trueKind}-${falseKind}`,
      definition: conditionalAcceptanceDefinition(comparison, trueKind, falseKind),
    })),
  ),
);
const string = (value: string) => nativeToScVal(value, { type: "string" });
const vec = (values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
const addr = (value: string) => new Address(value).toScVal();
const amount = (value: string) => nativeToScVal(BigInt(value), { type: "i128" });
/** Production codec output consumed by Rust without reconstructing constructors:
 * [admin,asset,[[id,address,family,constructor_args]],
 *  [[name,succeeds,execute_args,[[recipient,amount]],condition_amount,branch]],pin_source].
 * Native and guest packets differ only in the caller-supplied executable pins. */
export function conditionalAcceptancePacket(
  scenario: ConditionalAcceptanceScenario,
  pins = conditionalSyntheticPins,
  pinSource = "synthetic-native-test-pins",
): string {
  const plan = conditionalAcceptancePlan(scenario.definition, pins);
  const calls = ["109", "110", "111"].map((funded, index) => {
    const intent = conditionalAcceptanceIntent(scenario.definition, funded, index + 1, pins);
    const selected =
      intent.selectedBranch === "true"
        ? scenario.definition.trueBranch
        : scenario.definition.falseBranch;
    const incoming = BigInt(intent.amountAtConditionStroops);
    const payouts = [{ recipient: conditionalPlatform, amount: "10" }];
    if (selected.kind === "return_to_owner")
      payouts.push({ recipient: conditionalOwner, amount: String(incoming) });
    else if (selected.kind === "pay")
      payouts.push(
        { recipient: conditionalWorker, amount: "20" },
        { recipient: conditionalPayer, amount: String(incoming - 20n) },
      );
    else {
      const platform = (incoming * 1000n) / 10000n;
      payouts.push(
        { recipient: conditionalPlatform, amount: String(platform) },
        { recipient: conditionalWorker, amount: String(incoming - platform) },
      );
    }
    return vec([
      string(`funded-${funded}`),
      xdr.ScVal.scvBool(true),
      vec(executionV2Args(intent)),
      vec(payouts.map((payout) => vec([addr(payout.recipient), amount(payout.amount)]))),
      amount(intent.amountAtConditionStroops),
      string(intent.selectedBranch),
    ]);
  });
  return vec([
    addr(scenario.definition.owner),
    addr(scenario.definition.assetContract),
    vec(
      plan.nodes.map((node) =>
        vec([
          string(node.nodeId),
          addr(node.initialState.contractAddress),
          string(node.templateKind),
          vec(conditionalConstructorArgs(node, plan.manifest)),
        ]),
      ),
    ),
    vec(calls),
    string(pinSource),
  ]).toXDR("hex");
}
