import type { ExecutionDiscovery } from "@/lib/api/v1/execution-schema";
import { assertExecutionValues } from "@/lib/api/v1/execution-values";
import type { ExecutionIntent } from "@/lib/flows/field-policies";
import type { HostedReviewRow } from "./schema";
import { formatStroops } from "@/lib/utils";

/** Review only confirmed, public contract configuration; never draft/contact metadata. */
export function hostedPaymentReview(
  state: Extract<ExecutionDiscovery, { supported: true }>,
  execution: ExecutionIntent,
) {
  assertExecutionValues(
    state.policies,
    state.configurations,
    execution.arguments,
    execution.amountStroops,
  );
  let incoming = BigInt(execution.amountStroops);
  let accumulation = false;
  const rows: HostedReviewRow[] = [];
  for (const snapshot of state.configurations) {
    const config = snapshot.configuration;
    const input = execution.arguments.inputs.find((value) => value.nodeId === snapshot.nodeId);
    if (config.kind === "pay") {
      const payout =
        config.payoutValue.kind === "full"
          ? incoming
          : config.payoutValue.kind === "fixed"
            ? BigInt(config.payoutValue.amountStroops)
            : (incoming * BigInt(config.payoutValue.bps)) / 10_000n;
      const recipient = input?.kind === "pay" ? input.recipient : config.recipient;
      if (!recipient) throw new Error("Confirmed Pay recipient missing");
      rows.push({
        nodeId: snapshot.nodeId,
        rowId: "pay",
        recipient,
        amountStroops: payout.toString(),
        allocation:
          config.payoutValue.kind === "full"
            ? "Full incoming amount"
            : config.payoutValue.kind === "fixed"
              ? `${formatStroops(config.payoutValue.amountStroops)} tokens`
              : `${formatStroops(BigInt(config.payoutValue.bps), 2)}%`,
        recipientSource: input?.kind === "pay" ? "execution" : "constant",
        allocationSource: "constant",
      });
      incoming -= payout;
      continue;
    }
    const configured = config.configuredRows.map((row) => {
      const override =
        input?.kind === "split" ? input.rows.find((r) => r.rowId === row.rowId) : undefined;
      return {
        ...row,
        recipient: override?.recipient ?? row.recipient,
        allocation: override?.allocation ?? row.allocation,
        recipientSource: override?.recipient ? ("execution" as const) : ("constant" as const),
        allocationSource: override?.allocation ? ("execution" as const) : ("constant" as const),
      };
    });
    const additional = input?.kind === "split" ? (input.additionalRecipients ?? []) : [];
    const merged = [
      ...configured,
      ...config.additionalRecipients.map((row) => ({
        ...row,
        recipientSource: "constant" as const,
        allocationSource: "constant" as const,
      })),
      ...additional.map((row) => ({
        ...row,
        recipientSource: "execution" as const,
        allocationSource: "execution" as const,
      })),
    ];
    let distributed = 0n;
    const percentage =
      snapshot.policy.kind === "split" && snapshot.policy.allocationMode === "percentage";
    for (const [index, row] of merged.entries()) {
      if (!row.recipient || !row.allocation) throw new Error("Confirmed Split field missing");
      const payout =
        row.allocation.kind === "fixed"
          ? BigInt(row.allocation.amountStroops)
          : index === merged.length - 1
            ? incoming - distributed
            : (incoming * BigInt(row.allocation.bps)) / 10_000n;
      distributed += payout;
      rows.push({
        nodeId: snapshot.nodeId,
        rowId: row.rowId,
        recipient: row.recipient,
        amountStroops: payout.toString(),
        allocation:
          row.allocation.kind === "fixed"
            ? `${formatStroops(row.allocation.amountStroops)} tokens`
            : `${formatStroops(BigInt(row.allocation.bps), 2)}%`,
        recipientSource: row.recipientSource,
        allocationSource: row.allocationSource,
      });
    }
    if (!percentage && input?.kind !== "split") accumulation = true;
    incoming = 0n;
  }
  return { rows, refundStroops: incoming.toString(), accumulation };
}
