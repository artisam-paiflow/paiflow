import { ExecutePrepareSchema, type ExecutePrepare } from "@/lib/api/v1/schema";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import {
  ConditionalExecutePrepareSchema,
  ConditionalExecutionDiscoverySchema,
  type ConditionalExecutePrepare,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import { assertExecutionValues } from "@/lib/api/v1/execution-values";
import { conditionalExecutionArgumentsSchema } from "@/lib/flows/conditional-v2";
import {
  HostedPreparedSchema,
  HostedReceiptSchema,
  HostedOwnershipChallengeSchema,
  type HostedPrepared,
} from "@/lib/hosted-execution/schema";
import {
  ConditionalHostedBrowserRecoverySchema,
  ConditionalHostedPreparedSchema,
  ConditionalHostedReceiptSchema,
  ConditionalHostedOwnershipChallengeSchema,
  ConditionalHostedSubmittedSchema,
  type ConditionalHostedBrowserRecovery,
  type ConditionalHostedPrepared,
} from "@/lib/hosted-execution/conditional-schema";
import {
  HostedBrowserRecoverySchema,
  formArguments,
  restoredHostedInputs,
  tokenInput,
  fieldKey,
  type HostedBrowserRecovery,
  type HostedState,
  type HostedFieldValues,
  type AdditionalDraft,
} from "@/lib/hosted-execution/form";
import {
  conditionalHostedRequirements,
  conditionalFormArguments,
} from "@/lib/hosted-execution/conditional-form";
import {
  assertConditionalHostedPrepared,
  assertConditionalHostedCurrent,
} from "@/lib/hosted-execution/conditional-review";
import { assertHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership-transaction";
import { assertConditionalHostedOwnershipChallenge } from "@/lib/stellar/conditional-ownership-transaction";
import { formatStroops } from "@/lib/utils";
export type HostedUiState = HostedState | SupportedConditionalExecutionState;
export type HostedUiPrepared = HostedPrepared | ConditionalHostedPrepared;
export type HostedUiRecovery = HostedBrowserRecovery | ConditionalHostedBrowserRecovery;
export type HostedUiPayment = ExecutePrepare | ConditionalExecutePrepare;
export const conditionalHostedState = (
  state: HostedUiState,
): state is SupportedConditionalExecutionState => "version" in state && state.version === 2;
export const conditionalHostedRecord = (
  record: HostedUiRecovery,
): record is ConditionalHostedBrowserRecovery => "version" in record && record.version === 2;
export const conditionalHostedPrepared = (
  prepared: HostedUiPrepared,
): prepared is ConditionalHostedPrepared => "version" in prepared && prepared.version === 2;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function hostedUiProtocol(
  conditional: boolean,
  deploymentId: string,
  network: "testnet" | "mainnet",
) {
  const sameId = (a: string, b: string) =>
    conditional ? a.toLowerCase() === b.toLowerCase() : a === b;
  const parseRecord = (raw: unknown): HostedUiRecovery => {
    const record = conditional
      ? ConditionalHostedBrowserRecoverySchema.parse(raw)
      : HostedBrowserRecoverySchema.parse(raw);
    if (
      conditionalHostedRecord(record) &&
      (!sameId(record.deploymentId, deploymentId) || record.network !== network)
    )
      throw new Error(
        "Stored payment belongs to a different deployment or network; retain its original receipt.",
      );
    return record;
  };
  return {
    conditional,
    sameId,
    parseRecord,
    url: (base: string, operation: string) =>
      `${base}/${operation}${conditional ? "?version=2" : ""}`,
    parseState: (raw: unknown): HostedUiState => {
      const state = conditional
        ? ConditionalExecutionDiscoverySchema.parse(raw)
        : ExecutionDiscoverySchema.parse(raw);
      if (!state.supported) throw new Error("Verified payment terms are unavailable.");
      if (!sameId(state.deploymentId, deploymentId) || state.network !== network)
        throw new Error("Payment terms belong to a different deployment or network.");
      return state;
    },
    parsePrepared: (raw: unknown) =>
      conditional ? ConditionalHostedPreparedSchema.parse(raw) : HostedPreparedSchema.parse(raw),
    parseReceipt: (raw: unknown) =>
      conditional ? ConditionalHostedReceiptSchema.parse(raw) : HostedReceiptSchema.parse(raw),
    parseSubmitted: (raw: unknown, expectedHash: string) => {
      if (conditional && ConditionalHostedSubmittedSchema.parse(raw).txHash !== expectedHash)
        throw new Error(
          "Submission receipt differs from the original hash. Check the retained original receipt.",
        );
    },
    buildPayment: (
      state: HostedUiState,
      payer: string,
      amount: string,
      fields: HostedFieldValues,
      rosters: Record<string, AdditionalDraft[]>,
    ): HostedUiPayment => {
      const stroops = tokenInput(amount);
      return conditionalHostedState(state)
        ? ConditionalExecutePrepareSchema.parse({
            from: payer,
            amount: stroops,
            arguments: conditionalFormArguments(state, stroops, fields, rosters),
          })
        : ExecutePrepareSchema.parse({
            from: payer,
            amount: stroops,
            arguments: formArguments(state, fields, rosters),
          });
    },
    assertCurrentPayment: (state: HostedUiState, payment: HostedUiPayment) => {
      if (conditionalHostedState(state)) {
        const input = ConditionalExecutePrepareSchema.parse(payment);
        conditionalExecutionArgumentsSchema(state.definition, input.amount).parse(input.arguments);
      } else {
        const input = ExecutePrepareSchema.parse(payment);
        assertExecutionValues(
          state.policies,
          state.configurations,
          input.arguments ?? { version: 1, inputs: [] },
          input.amount,
        );
        if (BigInt(input.amount) < BigInt(state.minAmountStroops))
          throw new Error(
            `Enter at least ${formatStroops(state.minAmountStroops)} tokens to meet this flow’s minimum.`,
          );
      }
    },
    policies: (state: HostedUiState, amount: string) =>
      conditionalHostedState(state)
        ? conditionalHostedRequirements(state, tokenInput(amount)).nodes.map((node) => node.policy)
        : state.policies.nodes,
    asset: (state: HostedUiState) =>
      conditionalHostedState(state) ? state.definition.assetContract : state.assetContract,
    async assertOwnership(
      raw: unknown,
      payment: HostedUiPayment,
      recoveryKey: string,
      payer: string,
      canonicalId: string,
    ) {
      if (conditional) {
        const challenge = ConditionalHostedOwnershipChallengeSchema.parse(raw);
        await assertConditionalHostedOwnershipChallenge(
          challenge,
          canonicalId,
          { recoveryKey, payment: ConditionalExecutePrepareSchema.parse(payment) },
          network,
        );
        return challenge;
      }
      const challenge = HostedOwnershipChallengeSchema.parse(raw);
      assertHostedOwnershipChallenge(challenge, payer, network);
      return challenge;
    },
    assertPrepared: (result: HostedUiPrepared, record: HostedUiRecovery) => {
      if (conditional)
        assertConditionalHostedPrepared(
          deploymentId,
          network,
          ConditionalExecutePrepareSchema.parse(record.request),
          ConditionalHostedPreparedSchema.parse(result),
        );
      if (
        result.prepared.network !== network ||
        result.prepared.walletAddress !== record.request.from ||
        result.prepared.execution.amountStroops !== record.request.amount ||
        (record.intent !== undefined && !sameId(result.prepared.intent, record.intent)) ||
        (record.txHash !== undefined && result.prepared.txHash !== record.txHash) ||
        !same(
          result.prepared.execution.arguments,
          record.request.arguments ?? { version: 1, inputs: [] },
        )
      )
        throw new Error(
          "Prepared payment differs from the original request or identity. Retain its receipt.",
        );
    },
    assertCurrentPrepared: (state: HostedUiState, result: HostedUiPrepared) => {
      if (conditional) {
        if (!conditionalHostedState(state) || !conditionalHostedPrepared(result))
          throw new Error("Payment generation changed.");
        assertConditionalHostedCurrent(state, result.prepared.execution);
      }
    },
  };
}
/** Exact tagged v2 or exact untagged historical v1. Same physical key/lock. */
export function readHostedUiRecovery(
  key: string,
  protocol: ReturnType<typeof hostedUiProtocol>,
): HostedUiRecovery | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const decoded: unknown = JSON.parse(raw);
  const tagged = decoded && typeof decoded === "object" && "version" in decoded;
  const parsed = tagged
    ? ConditionalHostedBrowserRecoverySchema.parse(decoded)
    : HostedBrowserRecoverySchema.parse(decoded);
  if (conditionalHostedRecord(parsed) !== protocol.conditional)
    throw new Error(
      "Another payment generation has an unresolved original in this browser. Retain and resolve that receipt first.",
    );
  return protocol.parseRecord(parsed);
}
export function saveHostedUiRecovery(
  key: string,
  record: HostedUiRecovery,
  protocol: ReturnType<typeof hostedUiProtocol>,
  previous?: HostedUiRecovery | null,
) {
  if (
    protocol.conditional &&
    previous !== undefined &&
    !same(readHostedUiRecovery(key, protocol), previous)
  )
    throw new Error("Original payment changed in another tab. No action continued.");
  const parsed = protocol.parseRecord(record);
  localStorage.setItem(key, JSON.stringify(parsed));
  if (!same(readHostedUiRecovery(key, protocol), parsed))
    throw new Error("Payment recovery could not be saved; no signature was requested");
}
export function clearHostedUiRecovery(
  key: string,
  previous: HostedUiRecovery,
  protocol: ReturnType<typeof hostedUiProtocol>,
) {
  if (protocol.conditional && !same(readHostedUiRecovery(key, protocol), previous))
    throw new Error("Original receipt changed in another tab. Recovery retained.");
  localStorage.removeItem(key);
  if (protocol.conditional && localStorage.getItem(key) !== null)
    throw new Error("Payment receipt could not be advanced safely.");
}
export function restoredHostedUiInputs(record: HostedUiRecovery) {
  if (!conditionalHostedRecord(record)) return restoredHostedInputs(record);
  const fields: HostedFieldValues = {},
    rosters: Record<string, AdditionalDraft[]> = {};
  const value = (
    allocation: { kind: "fixed"; amountStroops: string } | { kind: "percentage"; bps: number },
  ) =>
    allocation.kind === "fixed"
      ? formatStroops(allocation.amountStroops)
      : formatStroops(BigInt(allocation.bps), 2);
  for (const input of record.request.arguments.inputs) {
    if (input.kind === "pay") fields[fieldKey(input.nodeId, "pay", "recipient")] = input.recipient;
    else {
      for (const row of input.rows) {
        if (row.recipient) fields[fieldKey(input.nodeId, row.rowId, "recipient")] = row.recipient;
        if (row.allocation)
          fields[fieldKey(input.nodeId, row.rowId, "allocation")] = value(row.allocation);
      }
      if (input.additionalRecipients)
        rosters[input.nodeId] = input.additionalRecipients.map((row) => ({
          rowId: row.rowId,
          recipient: row.recipient,
          allocation: value(row.allocation),
        }));
    }
  }
  return { amount: formatStroops(record.request.amount), fields, rosters };
}
