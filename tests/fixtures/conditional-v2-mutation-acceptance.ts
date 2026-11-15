import { createHash } from "node:crypto";
import { Address, Networks, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  ConditionalDefinitionSchema,
  ConditionalExecutionIntentSchema,
  ConditionalMutationIntentSchema,
  selectConditionalBranch,
  type ConditionalDefinition,
  type ConditionalExecutionIntent,
  type ConditionalMutationIntent,
  type ConditionalSplitNode,
} from "@/lib/flows/conditional-v2";
import {
  conditionalConstructorArgs,
  executionV2Args,
  mutationV2Args,
} from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalAcceptancePlan,
  conditionalAsset,
  conditionalOwner,
  conditionalPayer,
  conditionalPlatform,
  conditionalSyntheticPins,
  conditionalWallet,
  type ConditionalFixturePins,
} from "@/tests/fixtures/conditional-v2-acceptance";

export type ConditionalMutationFixture = "grouped-amount_gt" | "grouped-amount_lt" | "accumulation";
export const conditionalMutationFixtures: ConditionalMutationFixture[] = [
  "grouped-amount_gt",
  "grouped-amount_lt",
  "accumulation",
];
export const mutationFirstRecipient = conditionalWallet(7);
export const mutationSecondRecipient = conditionalWallet(8);
export const mutationUpdatedRecipient = conditionalWallet(9);

function terminal(nodeId: string): ConditionalSplitNode {
  return {
    kind: "split",
    nodeId,
    policy: {
      kind: "split",
      nodeId,
      allocationMode: "fixed",
      rows: [
        { rowId: "first", recipient: "mutable", allocation: "mutable" },
        { rowId: "second", recipient: "constant", allocation: "mutable" },
      ],
      additionalRecipients: "mutable",
    },
    configuration: {
      kind: "split",
      configuredRows: [
        {
          rowId: "first",
          recipient: mutationFirstRecipient,
          allocation: { kind: "fixed", amountStroops: "40" },
        },
        {
          rowId: "second",
          recipient: mutationSecondRecipient,
          allocation: { kind: "fixed", amountStroops: "60" },
        },
      ],
      additionalRecipients: [],
    },
  };
}

/** Unsigned synthetic identities; generation does not access wallets or a network. */
export function conditionalMutationDefinition(
  fixture: ConditionalMutationFixture = "grouped-amount_gt",
): ConditionalDefinition {
  return ConditionalDefinitionSchema.parse({
    version: 2,
    owner: conditionalOwner,
    assetContract: conditionalAsset,
    root: { nodeId: "receive", minAmountStroops: "1" },
    prefix:
      fixture === "accumulation"
        ? []
        : [
            {
              kind: "pay",
              nodeId: "fee",
              policy: {
                kind: "pay",
                nodeId: "fee",
                recipient: "mutable",
                payoutValue: "mutable",
              },
              configuration: {
                kind: "pay",
                recipient: conditionalPlatform,
                payoutValue: { kind: "fixed", amountStroops: "10" },
              },
            },
          ],
    condition: {
      nodeId: "condition",
      kind: fixture === "grouped-amount_gt" ? "amount_gt" : "amount_lt",
      thresholdStroops: "50",
      thresholdMode: "mutable",
    },
    trueBranch: terminal("yes"),
    falseBranch: terminal("no"),
  });
}

export function conditionalMutationIntent(
  fixture: ConditionalMutationFixture = "grouped-amount_gt",
  pins: ConditionalFixturePins = conditionalSyntheticPins,
): ConditionalMutationIntent {
  const definition = conditionalMutationDefinition(fixture);
  const plan = conditionalAcceptancePlan(definition, pins);
  const changes =
    fixture === "accumulation"
      ? [
          {
            kind: "condition",
            nodeId: "condition",
            expectedRevision: "0",
            thresholdStroops: "60",
          },
          {
            kind: "split",
            nodeId: "yes",
            expectedRevision: "0",
            rows: [{ rowId: "first", recipient: mutationUpdatedRecipient }],
          },
        ]
      : [
          {
            kind: "pay",
            nodeId: "fee",
            expectedRevision: "0",
            payoutValue: { kind: "fixed", amountStroops: "11" },
          },
          {
            kind: "condition",
            nodeId: "condition",
            expectedRevision: "0",
            thresholdStroops: "200",
          },
          {
            kind: "split",
            nodeId: "yes",
            expectedRevision: "0",
            rows: [
              { rowId: "first", allocation: { kind: "fixed", amountStroops: "30" } },
              { rowId: "second", allocation: { kind: "fixed", amountStroops: "70" } },
            ],
            additionalRecipients: [],
          },
          {
            kind: "split",
            nodeId: "no",
            expectedRevision: "0",
            rows: [
              {
                rowId: "first",
                recipient: mutationUpdatedRecipient,
                allocation: { kind: "fixed", amountStroops: "20" },
              },
              { rowId: "second", allocation: { kind: "fixed", amountStroops: "80" } },
            ],
          },
        ];
  const intent = ConditionalMutationIntentSchema.parse({
    version: 2,
    deploymentId: "12241224-1224-4224-8224-122412241224",
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: plan.bindings[0]!.contractAddress,
    admin: conditionalOwner,
    definition,
    nodes: plan.bindings,
    arguments: { version: 2, changes },
  });
  // Patch order is caller-selected; immutable configured row order is not.
  if (fixture === "grouped-amount_lt")
    for (const change of intent.arguments.changes)
      if (change.kind === "split") change.rows.reverse();
  return intent;
}

/** Fixture-only application of an already validated group; contracts remain the
 * authority for authorization, obligations and atomicity. */
export function conditionalMutationResult(intent: ConditionalMutationIntent) {
  const parsed = ConditionalMutationIntentSchema.parse(intent);
  const definition = structuredClone(parsed.definition);
  const nodes = structuredClone(parsed.nodes);
  for (const change of parsed.arguments.changes) {
    nodes.find((node) => node.nodeId === change.nodeId)!.expectedRevision = (
      BigInt(change.expectedRevision) + 1n
    ).toString();
    if (change.kind === "condition") {
      definition.condition.thresholdStroops = change.thresholdStroops;
    } else {
      const node = [...definition.prefix, definition.trueBranch, definition.falseBranch].find(
        (node) => node.nodeId === change.nodeId,
      )!;
      if (change.kind === "pay" && node.kind === "pay") {
        if (change.recipient !== undefined) node.configuration.recipient = change.recipient;
        if (change.payoutValue !== undefined) node.configuration.payoutValue = change.payoutValue;
      } else if (change.kind === "split" && node.kind === "split") {
        for (const row of change.rows) {
          const current = node.configuration.configuredRows.find(
            (value) => value.rowId === row.rowId,
          )!;
          if (row.recipient !== undefined) current.recipient = row.recipient;
          if (row.allocation !== undefined) current.allocation = row.allocation;
        }
        if (change.additionalRecipients !== undefined)
          node.configuration.additionalRecipients = change.additionalRecipients;
      }
    }
  }
  return { definition: ConditionalDefinitionSchema.parse(definition), nodes };
}

export function conditionalMutationPayment(
  mutation: ConditionalMutationIntent,
  amountStroops: string,
  serial: number,
  updated = false,
): ConditionalExecutionIntent {
  const state = updated ? conditionalMutationResult(mutation) : mutation;
  return ConditionalExecutionIntentSchema.parse({
    version: 2,
    deploymentId: mutation.deploymentId,
    networkPassphraseHash: mutation.networkPassphraseHash,
    rootContract: mutation.rootContract,
    assetContract: mutation.definition.assetContract,
    payer: conditionalPayer,
    amountStroops,
    nonce: serial.toString(16).padStart(64, "0"),
    expiresAtLedger: 100,
    definition: state.definition,
    nodes: state.nodes,
    arguments: { version: 2, inputs: [] },
    ...selectConditionalBranch(state.definition, amountStroops),
  });
}

const string = (value: string) => nativeToScVal(value, { type: "string" });
const address = (value: string) => new Address(value).toScVal();
const amount = (value: string) => nativeToScVal(BigInt(value), { type: "i128" });
const vec = (values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);

/** Production-generated packet for native and compiled Rust tests:
 * [admin,asset,[[id,address,family,constructor_args]],mutation_args,
 *  [[name,execute_args,succeeds,[[recipient,credit]]]],pin_source].
 * Credits are per invocation, not cumulative.
 * Harness interleaves mutation calls with these named executions. */
export function conditionalMutationAcceptancePacket(
  fixture: ConditionalMutationFixture,
  pins: ConditionalFixturePins = conditionalSyntheticPins,
  pinSource = "synthetic-native-test-pins",
): string {
  const mutation = conditionalMutationIntent(fixture, pins);
  const plan = conditionalAcceptancePlan(mutation.definition, pins);
  const payments =
    fixture === "accumulation"
      ? [
          { name: "accumulate-40", amount: "40", succeeds: true, updated: false },
          { name: "accumulate-20", amount: "20", succeeds: true, updated: false },
          { name: "settle-40", amount: "40", succeeds: true, updated: false },
          { name: "current-after-40", amount: "40", succeeds: true, updated: true },
        ]
      : [
          { name: "old-before", amount: "110", succeeds: true, updated: false },
          { name: "stale-after", amount: "110", succeeds: false, updated: false },
          { name: "current-after", amount: "111", succeeds: true, updated: true },
        ];
  const calls = payments.map((payment, index) => {
    const intent = conditionalMutationPayment(mutation, payment.amount, index + 1, payment.updated);
    const payouts: { recipient: string; amount: string }[] = [];
    if (payment.succeeds && fixture !== "accumulation") {
      payouts.push({ recipient: conditionalPlatform, amount: payment.updated ? "11" : "10" });
      payouts.push(
        {
          recipient:
            payment.updated && intent.selectedBranch === "false"
              ? mutationUpdatedRecipient
              : mutationFirstRecipient,
          amount: !payment.updated ? "40" : intent.selectedBranch === "true" ? "30" : "20",
        },
        {
          recipient: mutationSecondRecipient,
          amount: !payment.updated ? "60" : intent.selectedBranch === "true" ? "70" : "80",
        },
      );
    } else if (payment.name === "settle-40") {
      payouts.push(
        { recipient: mutationFirstRecipient, amount: "40" },
        { recipient: mutationSecondRecipient, amount: "60" },
      );
    }
    return vec([
      string(payment.name),
      vec(executionV2Args(intent)),
      xdr.ScVal.scvBool(payment.succeeds),
      vec(payouts.map((payout) => vec([address(payout.recipient), amount(payout.amount)]))),
    ]);
  });
  return vec([
    address(mutation.admin),
    address(mutation.definition.assetContract),
    vec(
      plan.nodes.map((node) =>
        vec([
          string(node.nodeId),
          address(node.initialState.contractAddress),
          string(node.templateKind),
          vec(conditionalConstructorArgs(node, plan.manifest)),
        ]),
      ),
    ),
    vec(mutationV2Args(mutation)),
    vec(calls),
    string(pinSource),
  ]).toXDR("hex");
}
