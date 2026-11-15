import {
  ConditionalExecutionDiscoverySchema,
  ConditionalExecutePrepareSchema,
  type ConditionalExecutePrepare,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import {
  ConditionalExecutionIntentSchema,
  type ConditionalExecutionIntent,
} from "@/lib/flows/conditional-v2";
import { formatStroops } from "@/lib/utils";
import { assertConditionalExecutionEnvelope } from "@/lib/stellar/conditional-execution-review";
import { canonicalHostedValue } from "./conditional-ownership-binding";
import {
  ConditionalHostedPreparedSchema,
  type ConditionalHostedPrepared,
  type ConditionalHostedReviewRow,
} from "./conditional-schema";
/** Deterministic review of the ACTUAL prepared intent, never current history or
 * an old draft. Stored fixed Split rows are batch terms, not claimed transfers. */
export function conditionalHostedPaymentReview(raw: ConditionalExecutionIntent) {
  const execution = ConditionalExecutionIntentSchema.parse(raw),
    definition = execution.definition,
    terminal = execution.selectedBranch === "true" ? definition.trueBranch : definition.falseBranch,
    rows: ConditionalHostedReviewRow[] = [];
  let incoming = BigInt(execution.amountStroops),
    accumulation = false;
  for (const node of [...definition.prefix, terminal]) {
    const input = execution.arguments.inputs.find((i) => i.nodeId === node.nodeId);
    if (node.kind === "return_to_owner") {
      rows.push({
        kind: "return_to_owner",
        nodeId: node.nodeId,
        rowId: "return_to_owner",
        recipient: definition.owner,
        amountStroops: incoming.toString(),
        allocation: "Full incoming branch amount to immutable owner (not a payer refund)",
        recipientSource: "constant",
        allocationSource: "constant",
      });
      incoming = 0n;
      continue;
    }
    if (node.kind === "pay") {
      const v = node.configuration.payoutValue,
        payout =
          v.kind === "full"
            ? incoming
            : v.kind === "fixed"
              ? BigInt(v.amountStroops)
              : (incoming * BigInt(v.bps)) / 10000n,
        recipient = input?.kind === "pay" ? input.recipient : node.configuration.recipient;
      if (!recipient) throw new Error("Prepared Pay recipient is missing");
      rows.push({
        kind: "pay",
        nodeId: node.nodeId,
        rowId: "pay",
        recipient,
        amountStroops: payout.toString(),
        allocation:
          v.kind === "full"
            ? "Full incoming amount"
            : v.kind === "fixed"
              ? `${formatStroops(v.amountStroops)} tokens`
              : `${formatStroops(BigInt(v.bps), 2)}% (rounded down)`,
        recipientSource: node.policy.recipient,
        allocationSource: node.policy.payoutValue,
      });
      incoming -= payout;
      continue;
    }
    const configured = node.configuration.configuredRows.map((row, index) => {
      const declared = node.policy.rows[index]!;
      const patch =
        input?.kind === "split" ? input.rows.find((r) => r.rowId === row.rowId) : undefined;
      return {
        ...row,
        recipient: patch?.recipient ?? row.recipient,
        allocation: patch?.allocation ?? row.allocation,
        recipientSource: declared.recipient,
        allocationSource: declared.allocation,
      };
    });
    const merged = [
      ...configured,
      ...node.configuration.additionalRecipients.map((row) => ({
        ...row,
        recipientSource: "mutable" as const,
        allocationSource: "mutable" as const,
      })),
      ...(input?.kind === "split" ? (input.additionalRecipients ?? []) : []).map((row) => ({
        ...row,
        recipientSource: "execution" as const,
        allocationSource: "execution" as const,
      })),
    ];
    const batch = node.policy.allocationMode === "fixed" && input?.kind !== "split";
    accumulation = batch;
    let distributed = 0n;
    for (const [index, row] of merged.entries()) {
      if (!row.recipient || !row.allocation) throw new Error("Prepared Split field is missing");
      const payout =
        row.allocation.kind === "fixed"
          ? BigInt(row.allocation.amountStroops)
          : index === merged.length - 1
            ? incoming - distributed
            : (incoming * BigInt(row.allocation.bps)) / 10000n;
      distributed += payout;
      rows.push({
        kind: "split",
        nodeId: node.nodeId,
        rowId: row.rowId,
        recipient: row.recipient,
        amountStroops: payout.toString(),
        allocation:
          row.allocation.kind === "fixed"
            ? `${batch ? "Configured batch amount: " : ""}${formatStroops(row.allocation.amountStroops)} tokens${batch ? " (accumulation; not an immediate payout claim)" : ""}`
            : `${formatStroops(BigInt(row.allocation.bps), 2)}%${index === merged.length - 1 ? " (last-row rounding remainder)" : " (rounded down)"}`,
        recipientSource: row.recipientSource,
        allocationSource: row.allocationSource,
      });
    }
    incoming = 0n;
  }
  return { rows, refundStroops: incoming.toString(), accumulation };
}
export function assertConditionalHostedPrepared(
  deploymentId: string,
  network: "testnet" | "mainnet",
  rawRequest: ConditionalExecutePrepare,
  rawPrepared: ConditionalHostedPrepared,
) {
  const request = ConditionalExecutePrepareSchema.parse(rawRequest),
    prepared = ConditionalHostedPreparedSchema.parse(rawPrepared),
    p = prepared.prepared,
    e = p.execution;
  if (
    e.deploymentId.toLowerCase() !== deploymentId.toLowerCase() ||
    p.network !== network ||
    p.walletAddress !== request.from ||
    e.payer !== request.from ||
    e.amountStroops !== request.amount ||
    canonicalHostedValue(e.arguments) !== canonicalHostedValue(request.arguments)
  )
    throw new Error(
      "Prepared conditional payment differs from the original deployment, payer, amount or inputs",
    );
  const review = conditionalHostedPaymentReview(e);
  if (
    canonicalHostedValue(review) !==
    canonicalHostedValue({
      rows: prepared.rows,
      refundStroops: prepared.refundStroops,
      accumulation: prepared.accumulation,
    })
  )
    throw new Error("Prepared conditional payment review differs from its actual financial terms");
  assertConditionalExecutionEnvelope(prepared);
}
export function assertConditionalHostedCurrent(
  rawState: SupportedConditionalExecutionState,
  rawExecution: ConditionalExecutionIntent,
) {
  const state = ConditionalExecutionDiscoverySchema.parse(rawState),
    execution = ConditionalExecutionIntentSchema.parse(rawExecution),
    hashes = {
      testnet: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
      mainnet: "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979",
    };
  if (
    !state.supported ||
    state.deploymentId.toLowerCase() !== execution.deploymentId.toLowerCase() ||
    hashes[state.network] !== execution.networkPassphraseHash ||
    canonicalHostedValue(state.definition) !== canonicalHostedValue(execution.definition) ||
    canonicalHostedValue(state.nodes) !== canonicalHostedValue(execution.nodes)
  )
    throw new Error(
      "Conditional terms changed. Reconcile the original payment before reviewing another payment",
    );
}
