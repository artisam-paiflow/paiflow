import { isDeepStrictEqual } from "node:util";
import { AppError } from "@/lib/errors";
import {
  ConfirmedNodeConfigurationSchema,
  type ConfirmedNodeConfiguration,
  type MutationArguments,
} from "@/lib/flows/field-policies";

/** Merge ONLY explicit mutable leaves. The final shared schema checks conservation,
 * immutable row ordering, uniqueness and configured/execution slot presence. */
export function applyMutationValues(
  configurations: ConfirmedNodeConfiguration[],
  args: MutationArguments,
) {
  return configurations
    .map((snapshot) => {
      const change = args.changes.find((c) => c.nodeId === snapshot.nodeId);
      if (!change) return snapshot;
      const fail = (message: string): never => {
        throw new AppError("VALIDATION", message, { arguments: [message] });
      };
      if (change.expectedRevision !== snapshot.revision)
        throw new AppError("CONFLICT", "Configuration revision changed", {
          expectedRevision: [snapshot.revision],
        });
      if (BigInt(snapshot.revision) === 2n ** 64n - 1n) fail("Configuration revision exhausted");
      const next = structuredClone(snapshot);
      const { policy, configuration } = next;
      if (change.kind === "pay" && policy.kind === "pay" && configuration.kind === "pay") {
        if (change.recipient !== undefined) {
          if (policy.recipient !== "mutable") fail("Recipient is not declared mutable");
          configuration.recipient = change.recipient;
        }
        if (change.payoutValue !== undefined) {
          if (
            policy.payoutValue !== "mutable" ||
            change.payoutValue.kind !== configuration.payoutValue.kind
          )
            fail("Payout value or allocation kind is immutable");
          configuration.payoutValue = change.payoutValue;
        }
      } else if (
        change.kind === "split" &&
        policy.kind === "split" &&
        configuration.kind === "split"
      ) {
        for (const row of change.rows) {
          const index = policy.rows.findIndex((p) => p.rowId === row.rowId),
            declared = policy.rows[index],
            actual = configuration.configuredRows[index];
          if (!declared || !actual) fail("Unknown configured row");
          if (row.recipient !== undefined) {
            if (declared!.recipient !== "mutable") fail("Configured recipient is not mutable");
            actual!.recipient = row.recipient;
          }
          if (row.allocation !== undefined) {
            if (declared!.allocation !== "mutable" || row.allocation.kind !== policy.allocationMode)
              fail("Configured allocation is not mutable");
            actual!.allocation = row.allocation;
          }
        }
        if (change.additionalRecipients !== undefined) {
          if (policy.additionalRecipients !== "mutable")
            fail("Additional recipients are not mutable");
          configuration.additionalRecipients = change.additionalRecipients;
        }
      } else fail("Mutation kind does not match its configured node");
      if (isDeepStrictEqual(configuration, snapshot.configuration))
        fail("Each changed node must contain an actual change");
      next.revision = (BigInt(next.revision) + 1n).toString();
      return ConfirmedNodeConfigurationSchema.parse(next);
    })
    .map((snapshot, index, all) => {
      if (index === 0 && args.changes.some((c) => !all.some((s) => s.nodeId === c.nodeId)))
        throw new AppError("VALIDATION", "Unknown mutation node");
      return snapshot;
    });
}
