import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { formatStroops } from "@/lib/utils";
import { FlowGraphSchema, assetLabel, migrateFlowGraph } from "./schema";
import { inboundRequirement } from "./inbound-amount";

/**
 * Refuse an amount the pipeline will not consume as configured.
 *
 * Only reaches the payer/splitter path — a webhook deposit and a streamer
 * top-up fund a contract rather than run a payout, so their amounts are the
 * sender's to choose.
 */
export function assertAmountMatchesFlow(
  deploymentId: string,
  graphSnapshot: unknown,
  amountStroops: string,
  options: { fixedSplitBatching?: boolean } = {},
): void {
  const parsed = FlowGraphSchema.safeParse(migrateFlowGraph(graphSnapshot));
  if (!parsed.success) {
    // Rows saved before a schema change still have to be triggerable, so this
    // fails open — logged rather than silent, because it is a hole in the guard.
    log.warn({ deploymentId }, "trigger amount guard skipped: graph snapshot did not parse");
    return;
  }

  const requirement = inboundRequirement(parsed.data, options);
  if (requirement.kind === "variable") return;

  const label = assetLabel(requirement.asset);
  const required = BigInt(requirement.stroops);
  const sent = BigInt(amountStroops);

  if (requirement.kind === "exact" && sent !== required) {
    throw new AppError(
      "VALIDATION",
      `This flow pays out exactly ${formatStroops(required)} ${label}. You entered ${formatStroops(sent)} ${label} — send ${formatStroops(required)} ${label} instead.`,
      { amount: [`Must be ${formatStroops(required)} ${label}`] },
    );
  }

  if (requirement.kind === "minimum" && sent < required) {
    throw new AppError(
      "VALIDATION",
      `This flow pays out ${formatStroops(required)} ${label}. You entered ${formatStroops(sent)} ${label}, which is not enough to cover it.`,
      { amount: [`Must be at least ${formatStroops(required)} ${label}`] },
    );
  }
}
