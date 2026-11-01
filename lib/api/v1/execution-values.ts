import { z } from "zod";
import {
  executionArgumentsSchema,
  type Allocation,
  type ConfirmedNodeConfiguration,
  type ExecutionArguments,
  type FlowFieldPolicies,
} from "@/lib/flows/field-policies";

/** Validate the complete reviewed payout before signing. Contract enforcement is
 * authoritative; this preflight cannot authenticate chain state or revisions. */
export function assertExecutionValues(
  policies: FlowFieldPolicies,
  configurations: ConfirmedNodeConfiguration[],
  arguments_: ExecutionArguments,
  fundedAmount: string,
): void {
  const args = executionArgumentsSchema(policies).parse(arguments_);
  let incoming = BigInt(fundedAmount);
  const fail = (nodeId: string, message: string): never => {
    throw new z.ZodError([{ code: "custom", path: ["arguments", "inputs", nodeId], message }]);
  };
  for (const [index, snapshot] of configurations.entries()) {
    const config = snapshot.configuration;
    const input = args.inputs.find((value) => value.nodeId === snapshot.nodeId);
    if (config.kind === "pay") {
      const recipient = input?.kind === "pay" ? input.recipient : config.recipient;
      if (!recipient) fail(snapshot.nodeId, "Every Pay recipient is required");
      const payout =
        config.payoutValue.kind === "full"
          ? incoming
          : config.payoutValue.kind === "fixed"
            ? BigInt(config.payoutValue.amountStroops)
            : (incoming * BigInt(config.payoutValue.bps)) / 10_000n;
      if (payout > incoming) fail(snapshot.nodeId, "Payment is insufficient for configured Pay");
      incoming -= payout;
      if (incoming === 0n && index < configurations.length - 1)
        fail(snapshot.nodeId, "A downstream execution must receive a positive amount");
      continue;
    }
    const rows = config.configuredRows.map((row) => {
      const override =
        input?.kind === "split" ? input.rows.find((r) => r.rowId === row.rowId) : undefined;
      return {
        rowId: row.rowId,
        recipient: override?.recipient ?? row.recipient,
        allocation: override?.allocation ?? row.allocation,
      };
    });
    rows.push(...config.additionalRecipients);
    if (input?.kind === "split") rows.push(...(input.additionalRecipients ?? []));
    if (rows.length < 1 || rows.length > 20)
      fail(snapshot.nodeId, "Split requires 1–20 recipients");
    if (new Set(rows.map((row) => row.rowId)).size !== rows.length)
      fail(snapshot.nodeId, "Split row IDs must be unique");
    if (rows.some((row) => !row.recipient || !row.allocation))
      fail(snapshot.nodeId, "Every declared Split field is required");
    if (new Set(rows.map((row) => row.recipient)).size !== rows.length)
      fail(snapshot.nodeId, "Split recipients must be unique, including constant recipients");
    const allocations = rows.map((row) => row.allocation as Allocation);
    const policy = snapshot.policy;
    if (policy.kind !== "split") return fail(snapshot.nodeId, "Split policy is inconsistent");
    if (allocations.some((allocation) => allocation.kind !== policy.allocationMode))
      fail(snapshot.nodeId, "Split allocation mode is fixed at deployment");
    if (policy.allocationMode === "percentage") {
      const total = allocations.reduce(
        (sum, allocation) => sum + (allocation.kind === "percentage" ? allocation.bps : 0),
        0,
      );
      if (total !== 10_000) fail(snapshot.nodeId, "Split percentages must total 10000 bps");
    } else {
      const total = allocations.reduce(
        (sum, allocation) =>
          sum + (allocation.kind === "fixed" ? BigInt(allocation.amountStroops) : 0n),
        0n,
      );
      if (input?.kind === "split" && total !== incoming)
        fail(
          snapshot.nodeId,
          "Fixed execution allocations must equal the amount entering this Split exactly",
        );
    }
    incoming = 0n;
  }
}
